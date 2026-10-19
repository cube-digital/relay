---
name: relay-setup
description: Use when installing relay in a repository or on a machine, or when relay's routing, budget or lanes do not behave as expected. Covers Claude Code settings, Codex agents and hooks, and a quick self-check.
---
# Relay setup

Ask before writing any settings file; show the human what will change.

## Claude Code

1. The plugin brings skills, agents, hooks, the `relay` CLI and a mod (model routing, budget readings, lane worktrees). Mods need a recent Claude Code; check `/plugin` shows `1 mod active · relay`.
2. Settings a plugin cannot set for itself: `relay setup claude` prints them, `relay setup claude --write-project` merges them into `<repo>/.claude/settings.json`:
   - `worktree.baseRef: "head"`: lane and subagent worktrees start from your HEAD, not from origin's default branch.
   - `subagentPromptCacheTtl: "1h"`: keeps a lane's cache warm while its review runs.
3. Self-check: `relay budget` (after one reply in a session it shows the 5h/7d reading), `relay lanes skills/plan-with-tiers/template.md`.

## Codex

1. Install the skills: `codex plugin marketplace add cube-digital/relay`, then enable relay in `/plugins`.
2. `relay setup codex <project>` installs `.codex/agents/relay-*.toml` (model and reasoning effort per role), `.codex/hooks.json` (bootstrap, retest guard, protected tests) and the `[agents]` backstop so a spawn without a model never inherits the most expensive one. Then trust the hooks in Codex with `/hooks`.
3. Put the CLI on PATH: `npm link` inside the relay checkout.
4. Budget on Codex is best effort: `relay budget --codex` reads the newest session file; its format is unofficial. When it shows unknown, check `/status` and act as tight.

## Changing routing

Edit `config/routing.json` (models per tier per harness, budget thresholds, lane limits) or a role in `roles/`, then run `relay build` and commit the regenerated `agents/`, `codex/` and `hooks/register.ts`. `relay build --check` fails in CI when they drift.
