# Relay design notes

Why relay is built the way it is, with the sources checked in October 2026. Facts marked *(unverified)* came only from secondary sources or need a run on a real install.

## 1. Where usage goes

- Multi-agent systems use about 15× the tokens of a chat, single agents about 4×; token usage alone explained 80% of performance variance in Anthropic's research eval. Parallelism buys time, not savings. [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- In superpowers' own measurements of a ~$13 plan run, the controller on Opus cost ~$6–7: ~150 turns re-reading a growing context. [superpowers strict-cost spec](https://github.com/obra/superpowers/tree/main/docs/superpowers/specs)
- A subagent with no model inherits the main conversation's model; on Pro/Max the default model is Opus 5.5. Resolution order: per-call `model`, agent frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, main model. [sub-agents](https://code.claude.com/docs/en/sub-agents), [model-config](https://code.claude.com/docs/en/model-config)
- Cheap models often need 2–3× the turns on prose instructions, which can erase the saving; they pay off when the plan holds the code. [superpowers SDD skill](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)

→ Relay decides tiers at plan time, routes deterministically, keeps coordination on mid tier and spends Opus twice: plan and final review.

## 2. Limits and the cache

- Pro and Max have a five-hour session limit and a weekly limit, shared across Claude and Claude Code. [support](https://support.claude.com/en/articles/11145838-claude-code-usage-and-permissions) Switching models does not restore the session limit (family-specific Opus/Sonnet limits aside). [errors](https://code.claude.com/docs/en/errors)
- Anthropic publishes no per-model multiplier for subscription usage *(not found either way)*; `/usage` attributes usage to skills, subagents, plugins and MCP servers. [costs](https://code.claude.com/docs/en/costs)
- The status line receives `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`) on Pro/Max after the first response; a mod gets the same through `$.session.usage()` and the `session.measure` event. [statusline](https://code.claude.com/docs/en/statusline), [mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
- Claude Code can wait at a usage limit and continue after the reset (`autoContinueAtUsageLimit`, on by default in interactive sessions). [settings](https://code.claude.com/docs/en/settings-reference)
- Cache: switching model or (on most models) effort re-reads the whole conversation uncached; so does a skill whose frontmatter names a different `model` (a `context: fork` skill does not). Subagents get a 5-minute cache even on a subscription unless `subagentPromptCacheTtl` is set. Sessions in different directories do not share a cache. [prompt-caching](https://code.claude.com/docs/en/prompt-caching)

→ Budget levels from the session's own readings; no model or effort switches on the main thread; `subagentPromptCacheTtl: 1h` for lanes that wait on reviews; skills never set `model`.

## 3. Mechanisms in Claude Code

- **Mods** (plugin hooks modules, Claude Code ≥ 2.1.287): `agent.spawn` can rewrite a spawn's `model` and `cwd` or deny it; `agent.offer` can hide an agent type; `prompt.submit` can add context the user does not see. [mods reference](https://code.claude.com/docs/en/plugins/mods/reference); input shapes from the mods type declarations shipped with Claude Code 2.1.303.
- The model-facing Agent tool has no `cwd` parameter; only a mod can set it. Relay maps agent names `lane-<id>[-suffix]` to lane worktrees through `.relay/lanes/active.json`. *(unverified on a live session: see spikes/worktree-lanes.md)*
- Plugin `settings` only accept `agent` and `subagentStatusLine`, so `worktree.baseRef` and cache TTLs go through `relay setup claude`. [plugins reference](https://code.claude.com/docs/en/plugins-reference)
- Subagent worktrees (`isolation: worktree`) branch from the default branch unless `worktree.baseRef: "head"`; worktrees with changes persist until a periodic sweep; worktrees made outside Claude Code are not swept. [worktrees](https://code.claude.com/docs/en/worktrees)
- Plugin agents ignore `hooks`, `mcpServers` and `permissionMode` frontmatter. [sub-agents](https://code.claude.com/docs/en/sub-agents)
- Skill descriptions are always in context (1% of the window in total, 1,536 characters each); a skill's body stays in context once invoked; after compaction each re-attached skill keeps its first 5,000 tokens within a 25,000 budget. [skills](https://code.claude.com/docs/en/skills)

## 4. Testing evidence

Most of these studies are recent, read through summaries, and measured mainly on SWE-bench bug fixing; treat the numbers as directional.

- On SWE-bench Verified, Claude Opus 4.5 wrote tests in 83% of tasks and GPT-5.2 in 3%, with similar resolve rates (74.4% vs 71.8%); encouraging tests cost +19.8% output tokens for no extra resolved tasks. [arXiv 2602.07900](https://arxiv.org/html/2602.07900v1)
- 80.2% of 86,156 agent-written test patches had weak or no oracles. [arXiv 2606.18168](https://arxiv.org/abs/2606.18168)
- Re-running unchanged tests appears in 50–83% of agent tasks; three wasteful habits cost up to 22.75%; a human-written skill ("rerun only when code or evidence changed") cut cost up to 41.7%. [arXiv 2609.30725](https://arxiv.org/abs/2609.30725)
- Restricting test execution saved 56–62% of Claude Code's tokens with a non-significant 1.25-point drop. [ISSTA 2026](https://conf.researchr.org/details/issta-2026/issta-2026-research-papers/22/To-Run-or-Not-to-Run-Analyzing-the-Cost-Effectiveness-of-Code-Execution-in-LLM-Based)
- Prescribing TDD in the agent loop cost 3–8.5× the tokens with no measurable quality or mutation-score gain (small sample). [Böckeler](https://martinfowler.com/articles/exploring-gen-ai/tdd-in-the-agent-loop.html)
- Tests written after seeing faulty code caught 14% of injected faults vs 25% when written from the task description. [arXiv 2607.05139](https://arxiv.org/abs/2607.05139)
- Agents edit or special-case tests under pressure; read-only tests stop edits but not special-casing. [Claude 3.7 Sonnet system card](https://assets.anthropic.com/m/785e231869ea8b3b/original/claude-3-7-sonnet-system-card.pdf), [ImpossibleBench](https://arxiv.org/pdf/2510.20270)
- Mutation testing on changed lines is the gate used at Google and Meta (ACH); coverage is a signal, not a target. [Google](https://arxiv.org/html/2103.07189), [Meta ACH](https://arxiv.org/html/2501.12862v1), [Fowler](https://martinfowler.com/bliki/TestCoverage.html)
- Principles: test behaviors through public APIs, avoid change-detector tests, push tests down the pyramid. [SWE at Google ch. 12](https://abseil.io/resources/swe-book/html/ch12.html), [Testing on the Toilet](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html), [Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)

→ Test budgets by risk, tests from the spec by a separate role, protected acceptance tests, a deterministic retest guard, the full suite once per wave, diff-scoped mutation only for high risk.

## 5. Codex

- Skills (`SKILL.md`, `name` + `description`, in `.agents/skills`), plugins (`.codex-plugin/plugin.json`), hooks with the same event names and exit-code-2 blocking, PreToolUse `updatedInput`, and the matcher aliases `Agent` ≈ `spawn_agent`, `Edit|Write` ≈ `apply_patch`. Hooks are "a useful guardrail, not a complete enforcement boundary". [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- Custom agents are TOML files in `.codex/agents/` with `model` and `model_reasoning_effort`; `[agents] default_subagent_model` is the backstop for spawns without a model. [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- No documented machine-readable rate-limit source; the session rollout files carry `rate_limits` *(unofficial)*. 
- `codex mcp-server` was removed; Claude → Codex goes through the official [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) or `codex exec`. Its review gate "may drain usage limits quickly".
- superpowers ships one skills tree to both harnesses with a per-harness tool-mapping reference; its Codex notes require setting both `model` and `reasoning_effort` on every spawn. [codex-tools.md](https://github.com/obra/superpowers/blob/main/skills/using-superpowers/references/codex-tools.md)

→ One neutral source (`roles/`, `config/routing.json`, `skills/`), generated per harness. Claude and Codex have separate 5-hour windows: Codex takes reviews and test authoring when Claude's budget is tight.
