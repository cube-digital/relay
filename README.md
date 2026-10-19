# relay

Relay is a plugin for Claude Code and Codex that keeps long coding sessions inside your usage limits. It plans work so each task runs on the cheapest model that can do it, runs related tasks together in parallel git worktrees, watches your 5-hour usage window, and stops agents from writing piles of tests nobody needs.

It builds on ideas from [superpowers](https://github.com/obra/superpowers) by Jesse Vincent, a plugin that teaches agents to plan, test and review before they write code. Relay keeps that discipline and adds the part that hurts most on a subscription: cost.

## Why we built it

If you use Claude Code on a Pro or Max plan, some of this will sound familiar:

- The 5-hour limit runs out in the middle of a feature.
- Every helper agent runs on Opus, because a subagent inherits your session's model unless something tells it otherwise.
- The agent coordinating the work is the most expensive one in the room. It re-reads a growing conversation on every turn.
- A two-line change comes back with forty new tests, and the suite ran six times on the same code.

Relay answers each of these with a rule. Where it can, it also ships code that enforces the rule, so nothing depends on the model remembering it.

## What it does

### Picks a model for every task

When relay plans a feature, each task gets a tier: cheap (Haiku), mid (Sonnet) or strong (Opus). Opus writes the plan and does the final review. Sonnet coordinates and does most of the building. Haiku finds code and types out code the plan already contains.

In Claude Code a small mod enforces this. A helper agent started without a model gets Sonnet; without that rule it would inherit your session's model, which on Pro and Max is Opus.

### Runs related tasks together

Tasks that touch the same files go into one *lane*: one git worktree, one agent, one commit per task. Lanes that share no files run in parallel, in waves. Worktrees are reused from one wave to the next, so dependencies install once, and at the end you review a single integration branch.

### Watches your usage window

Relay reads the same 5-hour and weekly figures Claude Code shows you in `/usage`. Under 60% of the 5-hour window it works normally. From 60% it keeps Opus for the final review only. From 85% it finishes the lanes already running, commits, writes a handoff note and starts nothing new; Claude Code can then wait for the reset and carry on.

### Tests like QA

Each task gets a test budget from its risk: no new tests for a low-risk change, one per behavior for user-facing changes, boundary cases on top for code that touches money, data or security. For riskier tasks a separate agent writes the acceptance tests from the spec before the code exists, and the agent building the feature is not allowed to edit them. A hook refuses to rerun a test command when the code has not changed since its last run. The full suite runs once per wave, on the merged code.

### Works in Codex too

The same skills, roles and hooks run in Codex, generated from one source. You can split the work between them: Claude builds, Codex reviews, and each one spends its own subscription's window.

## What a run looks like

You describe a feature or point relay at a spec:

> Plan the billing export from docs/specs/billing-export.md with relay.

The architect agent writes a plan to `docs/relay/plans/`. Every task in it lists its files, its dependencies, its model tier, its risk, a test budget and the one command that proves it works. Relay checks the plan and shows how it will run:

```
$ relay lanes docs/relay/plans/2026-10-19-billing-export.md
plan billing-export: 6 tasks → 4 lanes in 2 wave(s)
wave 1
  lane a  [risk medium, new tests ≤ 2]  lane-a=implementer(T1 → T2)
  lane b  [risk low, new tests ≤ 0]  lane-b=implementer-fast(T4)
  lane c  [risk medium, new tests ≤ 1]  lane-c=implementer(T5)
wave 2
  lane d  [risk high, new tests ≤ 3]  lane-d=implementer(T3), then lane-d-s2=implementer-deep(T6)
```

When you say go, the conductor agent runs it on Sonnet. The three lanes of wave 1 work in parallel. Each lane gets a review; problems go back to the same agent for up to three rounds, then to a stronger model for two more. The lanes merge, the full suite runs once, and wave 2 starts from the merged code. Lane d shows one more trick: T6 is a hard task, so it gets its own Opus agent in the same worktree while T3 stays on Sonnet.

You end up with the branch `relay/billing-export/integration` and a summary: what was built, how many tests were added and removed, and every decision the agents made on your behalf, so you can check them before you merge.

## Install

Relay needs git and Node 20 or newer.

### Claude Code

```text
/plugin marketplace add cube-digital/relay
/plugin install relay@relay
```

Then, inside each repository where you want lanes:

```bash
relay setup claude --write-project
```

This adds two settings a plugin cannot set for itself. Lane worktrees will branch from your current branch (by default they would start from `origin`'s main branch), and helper agents keep their prompt cache for an hour while they wait for reviews (the default is five minutes).

Run `/plugin` and check for `1 mod active · relay`. The mod needs a recent Claude Code; relay is tested on 2.1.303. If the mod does not load, the skills, agents and hooks still work, without automatic model routing and budget readings.

### Codex

```bash
codex plugin marketplace add cube-digital/relay       # the skills
git clone https://github.com/cube-digital/relay ~/relay
cd ~/relay && npm link                                  # puts `relay` on your PATH
relay setup codex /path/to/your/project                 # agents, hooks, model defaults
```

Open Codex in the project and trust relay's hooks with `/hooks`.

## Everyday use

Mostly you talk to your agent as usual. A few phrases get relay's attention:

| Say | What happens |
|---|---|
| "Plan this with relay" | The architect writes a tiered plan and shows its lanes. |
| "Run the plan" | The conductor executes it lane by lane and reports back. |
| "Write a handoff" | State, next steps and decisions go to `HANDOFF.md`, ready for a fresh session. |

In a terminal:

```bash
relay budget                     # where you are in the 5-hour and weekly windows
relay worktrees status           # what each lane is doing
relay ledger <plan> --rulings    # decisions the agents made during a run
relay protect list               # tests the implementers may not change
relay --help                     # everything else
```

## Tuning

Models and limits live in `config/routing.json`:

| Tier | Claude Code | Codex | Used for |
|---|---|---|---|
| cheap | Haiku, low effort | gpt-6-luna, low | finding code, transcribing planned code |
| mid | Sonnet, medium | gpt-6.1-sol, medium | building, reviewing, writing tests, coordinating |
| strong | Opus, high | gpt-6-astra, high | planning, final review, hard tasks |

The same file holds the budget thresholds (60% and 85% of the 5-hour window, 80% and 95% of the weekly one) and the lane limits (up to 6 tasks per lane, 4 lanes at a time). Treat them as starting points: watch `/usage` for a week, then adjust. After editing, run `relay build` so both tools get the new agent files.

## Questions

**Do parallel agents save tokens?**
No. Anthropic measured multi-agent systems using about 15 times the tokens of a chat. Lanes save time. The tokens are saved by running most of the work on Sonnet and Haiku, keeping each agent's context small, and never doing the same work twice.

**Will relay change the model of my main session?**
No. Your session stays on the model you picked. Relay routes the helper agents, and it recommends keeping one model for the whole session, because switching mid-session throws away the prompt cache.

**What if relay has a bug?**
Its hooks fail open: when one crashes, your tool call goes ahead as if relay were not installed. `/plugin` disables relay completely.

**Can I use it with superpowers?**
Yes, with one caveat. superpowers' TDD skill asks for a failing test before every change, and relay sets a test budget per task, so their testing advice disagrees. superpowers' brainstorming and debugging skills work well alongside relay.

**Do I need Codex?**
No. Codex support is for teams that use both tools, or that want a second model family to review the first one's work.

## Status

Version 0.1. The `relay` command, the hooks and the Claude Code mod have automated tests (`npm test`, `claude plugin test`), and the plugin passes `claude plugin validate`. Still to confirm on a real install:

- that an agent started as `lane-a` lands in its lane's worktree and stays there when resumed; [spikes/worktree-lanes.md](spikes/worktree-lanes.md) walks through the check in about 30 minutes;
- that Codex accepts the generated hooks file as written;
- the Codex model names, which change often;
- reading Codex's usage window, which relies on an undocumented file.

Issues and pull requests are welcome.

## Contributing

```bash
npm test                         # unit and integration tests, run against real git repos
node bin/relay build --check     # generated files are in sync
claude plugin validate . && claude plugin test .
```

Edit `roles/` and `config/routing.json`, then run `relay build`; the files in `agents/` and `codex/` are generated. [AGENTS.md](AGENTS.md) holds the rules for agents working on relay itself, and [docs/design.md](docs/design.md) the research and sources behind each decision.

## License

Apache 2.0, see [LICENSE](LICENSE).
