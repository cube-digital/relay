# Source cross-check: openai/codex tag rust-v0.163.0

Commit 83086188ae0614bd882818ff1aa23f3194962012 (2026-10-15 18:57:07 +0000), cloned with `git clone --depth 1 --branch rust-v0.163.0 https://github.com/openai/codex`. Excerpts only; the files are Apache-2.0.

## Subagent concurrency default

`codex-rs/core/src/config/mod.rs:256-259`
```rust
pub(crate) const DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION: usize = 4;
pub(crate) const DEFAULT_MULTI_AGENT_V2_MIN_WAIT_TIMEOUT_MS: i64 = 10_000;
pub(crate) const DEFAULT_MULTI_AGENT_V2_MAX_WAIT_TIMEOUT_MS: i64 = 3600 * 1000;
pub(crate) const DEFAULT_MULTI_AGENT_V2_DEFAULT_WAIT_TIMEOUT_MS: i64 = 30_000;
```

`codex-rs/core/src/config/mod.rs:2813-2826` (resolve_multi_agent_v2_config)
```rust
fn resolve_multi_agent_v2_config(config_toml: &ConfigToml) -> MultiAgentV2Config {
    let base = multi_agent_v2_toml_config(config_toml.features.as_ref());
    let max_concurrent_threads_per_session = base
        .and_then(|config| config.max_concurrent_threads_per_session)
        .or_else(|| {
            config_toml
                .agents
                .as_ref()
                .and_then(|agents| agents.max_concurrent_threads_per_session)
                .map(|max_threads| max_threads.saturating_add(1))
        })
        .unwrap_or(DEFAULT_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION);
    let default =
        MultiAgentV2Config::defaults_for_max_concurrency(max_concurrent_threads_per_session);
```

`codex-rs/core/src/agent/registry.rs:90-100,333-349` (the limit is enforced on the registry total count)
```rust
    pub(crate) fn reserve_spawn_slot(
        self: &Arc<Self>,
        max_threads: Option<usize>,
    ) -> Result<SpawnReservation> {
        if let Some(max_threads) = max_threads {
            if !self.try_increment_spawned(max_threads) {
                return Err(
                    CodexErr::new(CodexErrorDetails::AgentLimitReached { max_threads })
                        .with_agent_context(AgentErrorContext::RegistryCapacity),
                );
            }
    // ...
    fn try_increment_spawned(&self, max_threads: usize) -> bool {
        let mut current = self.total_count.load(Ordering::Acquire);
        loop {
            if current >= max_threads {
                return false;
            }
            match self.total_count.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return true,
                Err(updated) => current = updated,
            }
        }
    }
```

## Auto-compaction default

`codex-rs/protocol/src/openai_models.rs:518-541`
```rust
    pub fn resolved_context_window(&self) -> Option<i64> {
        self.context_window.or(self.max_context_window)
    }

    /// Context available to inference after reserving this model's configured headroom.
    pub fn usable_context_window(&self) -> Option<i64> {
        self.resolved_context_window().map(|context_window| {
            context_window.saturating_mul(self.effective_context_window_percent) / 100
        })
    }

    pub fn auto_compact_token_limit(&self) -> Option<i64> {
        let context_limit = self
            .resolved_context_window()
            .map(|context_window| (context_window * 9) / 10);
        let config_limit = self.auto_compact_token_limit;
        if let Some(context_limit) = context_limit {
            return Some(
                config_limit.map_or(context_limit, |limit| std::cmp::min(limit, context_limit)),
            );
        }
        config_limit
    }
}
```

`codex-rs/protocol/src/openai_models.rs:393-395` (effective_context_window_percent default)
```rust
const fn default_effective_context_window_percent() -> i64 {
    95
}
```

`codex-rs/core/src/session/context_window.rs:53-95` (how the limit and the hard cap are applied)
```rust
async fn context_window_token_status_with_config(
    sess: &Session,
    config: &Config,
    model_info: &ModelInfo,
) -> ContextWindowTokenStatus {
    let active_context_tokens = sess.get_total_token_usage().await;

    // Count either the full active context or only the tokens added after the initial prefix.
    let (auto_compact_scope_tokens, auto_compact_scope_limit, auto_compact_window_prefill_tokens) =
        match config.model_auto_compact_token_limit_scope {
            AutoCompactTokenLimitScope::Total => (
                active_context_tokens,
                model_info.auto_compact_token_limit(),
                None,
            ),
            AutoCompactTokenLimitScope::BodyAfterPrefix => {
                let window = sess.auto_compact_window_snapshot().await;
                let baseline = window.prefill_input_tokens.unwrap_or(active_context_tokens);

                let scope_limit = config
                    .model_auto_compact_token_limit
                    .or_else(|| model_info.auto_compact_token_limit());
                (
                    active_context_tokens.saturating_sub(baseline),
                    scope_limit,
                    window.prefill_input_tokens,
                )
            }
        };

    // The model's full context window is a hard cap, independent of the auto-compaction scope.
    let full_context_window_limit = model_info.resolved_context_window().map(|context_window| {
        context_window.saturating_mul(model_info.effective_context_window_percent) / 100
    });

    // Report remaining tokens against the base (unbuffered) window, capped by the full context.
    let base_window_tokens_remaining = [
        tokens_remaining(auto_compact_scope_limit, auto_compact_scope_tokens),
        tokens_remaining(full_context_window_limit, active_context_tokens),
    ]
    .into_iter()
    .flatten()
    .min();
```
