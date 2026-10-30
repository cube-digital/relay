# Handoff: codex-math integration

**Goal:** make Codex run relay as efficiently as Claude by integrating the `codex-math/` model (the user approved it as valid on 2026-10-30). Plan: `docs/relay/plans/2026-10-30-codex-math-integration.md`.

## State
- Branch `relay/codex-math-integration`, cut from `main` at 0d11919 (pulled 2026-10-30). Not pushed. No PR yet.
- Commits so far: plan only (7ec8222, 6669084, plus the handoff commit). No code has changed.
- No plan run has started, so there are no worktrees or ledger yet.

## Done
- Pulled `main`, which had 6 new commits including the native Codex integration (#2).
- `codex-math` tests pass: `node --test codex-math/test/*.test.mjs` gives 12 pass.
- The plan has 9 tasks in 7 lanes and 3 waves. `node bin/relay lanes <plan>` reports no errors or warnings.
- Live Codex 0.163.0 probes are recorded in the plan's Evidence section. The scratch repo is `/tmp/claude-1000/-home-aleliuhin-Work-relay/023ba898-4c4e-4a60-a5ef-fbfebc5774af/scratchpad/codex-probe`; it is disposable.

## In flight
- Nothing. The working tree is clean apart from the user's untracked `Claude outputs/`, which must not be committed.

## Next
1. Run `node bin/relay budget`. If the level is normal, run the plan with the run-lanes skill (or dispatch the conductor): `/relay:run docs/relay/plans/2026-10-30-codex-math-integration.md`. At tight, use cheap and mid implementers and Opus only for the final review.
2. After all waves, run `npm test`, `node --test codex-math/test/*.test.mjs` and `node bin/relay build --check`. If `hooks/register.ts` changed, also run `claude plugin validate .` and `claude plugin test .`.
3. Delete this `HANDOFF.md`, then push the branch and open a PR to `main` for review. The PR body states that every Codex rate is a placeholder prior, and lists the probe evidence and the open questions below.

## Decisions
- The math is valid; integrate it as is. Assumed numbers carry a `prior:` label. Doc inconsistencies get their labels and prose fixed. Where a doc and the code disagree, the code wins.
- Agent TOMLs stay model-free. The live probe showed that a model in the TOML overrides the model the spawn requests, which would disable the budget downgrades. The spawn hook stays the only place that enforces model and effort, and `test/build.test.mjs:28` stays.
- Roles must be registered as `[agents.relay-<role>]` (description plus config_file), or Codex offers no `agent_type` (T9). Setup writes these to the project `.codex/config.toml` with absolute paths. Doctor warns when the project is not trusted in `~/.codex/config.toml`. This was the user's choice.
- Codex lane cap is min(4, 3 child-thread limit) = 3; `--max-lanes` overrides it.
- `codex-math/config/codex-routing.json` is the single Codex source; `config/routing.json` becomes Claude-only (T5).
- `origin/relay/codex-plugin-integration` is treated as superseded by #2 and ignored.

## Open questions (for the PR)
- Whether a relative `config_file` resolves against the config file is unknown.
- That Codex reads the project config only when the project is trusted in user config is likely but unconfirmed; confirming it needs a global config edit.

## Don't
- Don't pin `model`/`model_reasoning_effort` in `codex/agents/*.toml`.
- Don't run `codex exec` probes without `< /dev/null`; without it they hang reading stdin.
- Don't count on `.codex/agents/*.toml` alone to register roles: Codex ignores them unless the config registers them.
