# Model profiles

`config/model-profiles.json` says what Relay changes when the main Claude Code session runs on a given model. `relay build` embeds the profiles and the texts in `overlays/` in the mod (`hooks/register.ts`). `relay profile` shows the route for the current session, or for `--model <id>`.

The texts in `overlays/` are Relay's own wording of the behaviors that Anthropic's [Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2) guide addresses. The effects that Anthropic measured are for the guide's own text. To compare, replace an overlay with the guide's text, run `relay build`, and measure both versions on the same plans.

| Overlay | Goes to | Why |
| --- | --- | --- |
| `finishing-work` | The lead below `high` effort; the round-6 fix agent | Fable 5.2 can end a long turn early at `low` and `medium` effort. On Opus 5.5 the same text causes extra work, so it is in the Fable profile only. |
| `subagent-cost` | The lead | Fable 5.2 dispatches subagents readily when a prompt invites it; subagents can be a large part of a session's cost. |
| `communicating-clearly` | Agents that run on the frontier model | Reports for a reader who did not watch the work. |
