# Verified facts: relay flows and the team

Claude Code build: 2.1.304 at `$HOME/Library/Application Support/Claude/claude-code/2.1.304/6bbba6adc37f/claude.app/Contents/MacOS/claude` (PATH's `claude` is 2.1.119 and has no mods). Method: scratch mods and `plugin test` runs in the scratchpad, plus the engine source embedded in the binary (`python3` byte search; `grep` there hits ugrep complexity limits).

## agent.spawn → agentId
Verified. `await next(e)` in an `agent.spawn` handler returns `{ model, agentId }`; the core builds it as `{ model, agentId?, teammateId? }`, `agentId` present when the spawn produced one, `deny` instead when refused. In a scratch mod test (`on('agent.spawn', … => ({ model: e.model ?? 'sonnet', agentId: 'x1' }))`) `$.agent.spawn(...)` returned `{"model":"sonnet","agentId":"x1"}`, and a spawn with `resume: 'x1'` returned the same `agentId`. relay's handler returns `next(e)` untouched for fork/resume/workflow, so a resumed agent keeps its first `agentId` and is never re-registered; `turn.step` then marks it working again.

Timing of the result: unverified. The test kit resolves `$.agent.spawn` immediately and cannot show whether the real engine resolves `await next(e)` when the agent starts or when it finishes. Fallback used: `trackStep`/`trackComplete` remember steps and completions for ids not yet registered, and `trackSpawn` folds them in (a completed agent is registered `done`, never stuck `working`).

## turn.step
Verified, with a difference from a plain event. `turn.step` is a streaming event: both `on('turn.step', …)` and its `.catch(…)` must be `async function* ($, e, next) { … }` (a plain function fails the module load: "takes an async generator"). The event carries `{ turnId, index, messageCount, agentId, model, effort? }` (engine's `checkArgument`: `turnId`, `index`, `messageCount`, `agentId` are pinned; `model` a non-empty string). It carries no usage. Usage rides on the chunk of kind `stop`: `{ kind: 'stop', stopReason, usage }` where `usage` is `null` or `{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }` (all four numbers; the kit rejects `inputTokens…` and `{ input, output, … }` for a stop chunk). Chunk kinds: text, thinking, tool, input, stop, engine. Fallback used: the handler iterates the chunks, re-yields each unchanged, and reads usage from `stop` chunks inside a try/catch that swallows.

## turn.complete
Verified. Plain handler `($, e, next) => result`. Event: `{ turnId, agentId, answer, usage? }` with `usage = { input, output, cacheRead, cacheWrite }` (the totals for the turn; seen in a scratch handler's `e`). The default result is `{ text }`; `next(e)` is checked for `{ answer }` and an unchanged `agentId`. There is no duration field: elapsed time is `now - startedAt` kept by relay.

## Emitting events in the test kit
Verified (this section corrects an earlier reading made before the mod's handlers were written). `$.turn.start/step/complete` exist. `$.turn.complete(input)` returns a promise; `$.turn.step(input)` returns an async iterable (not awaited): `for await (const c of $.turn.step({ turnId, index, messageCount, agentId, model })) {}`. The mod's own `turn.step` and `turn.complete` handlers do run for them (a scratch run of the final handlers: a step whose test-level bottom hook yields `{ kind: 'stop', stopReason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100 } }` put "1.6k tok" in the team pane; a `turn.complete` made the band disappear). The test must supply the bottom hooks (`on('turn.step', async function* …)`, `on('turn.complete', …)`); the kit has no core for them. `console.log` and `globalThis` writes from a mod are not visible to the test.
Mod state is not shared with the test file: the engine loads `hooks/register.ts` in its own instance, so a test that imports `levelOf` or `teamState` from `./register.ts` reads a different module instance from the one the handlers mutate (checked: after a `session.measure` to 91% the engine denies a spawn while the imported `levelOf()` still says `unknown`). A mod test can assert only through the kit (spawn result, mounted `AbovePrompt`/`Pane`, command results) or on pure functions with its own `Map`.

## Text colours in ui.render
Partly verified. The test kit passes any `color` string through unchanged to the rendered `Text` (`#f43f5e`, `cyan` and `bogus-name` all came back as props), so it validates nothing. Claude Code's own colour parser documents `#rrggbb`, `rgb(r,g,b)`, `ansi256(n)` and `ansi:<name>` as accepted (custom-theme and spell-check colour settings in the binary), so the mod draws avatars with the `#rrggbb` hex. If a build rejects hex, the fallback is the agent colour name (`red`…`cyan`), which the theme also resolves.

## Agent colours
Verified. The binary's theme table has exactly eight `<name>_FOR_SUBAGENTS_ONLY` entries: red, blue, green, yellow, purple, orange, pink, cyan (rgb values e.g. `cyan: rgb(8,145,178)`). That is the set `AGENT_COLORS` uses; no change.

## Codex agent TOML
unverified: codex not installed; identity stays in developer_instructions
