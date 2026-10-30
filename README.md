# relay

[![ci](https://github.com/cube-digital/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/cube-digital/relay/actions/workflows/ci.yml)

Relay is a plugin for **Claude Code** and **Codex** that keeps long coding sessions inside your usage limits without lowering the quality of the work. It plans each feature so every task runs on the cheapest model that can do it, runs related tasks together in parallel git worktrees, watches your 5-hour usage window, and teaches agents to test like a QA engineer: few tests, each one able to catch a real bug.

You can also use Relay to design an architecture, learn a topic, or reconstruct how an existing system works from evidence. These paths work independently of implementation. They adapt explanations to your question and topic familiarity, and keep project code read-only.

It builds on [superpowers](https://github.com/obra/superpowers) by Jesse Vincent, which showed that agents work far better when they plan, test and review in a fixed rhythm. Relay keeps that rhythm and adds what a Pro or Max subscription makes painful: cost, time and limits.

**One-page whitepaper:** [relay-whitepaper.pdf](docs/whitepaper/relay-whitepaper.pdf) covers the problem, the mechanism, and the statistical model behind the forecast (fix rounds as independent per-lane Bernoullis with the exact usage distribution, ratio-estimator calibration, the window walk), plus what is not proven yet.

```mermaid
flowchart LR
    request["Your request"] --> implementation["Implementation<br/>relay-plan / relay-run"]
    implementation --> branch["Plan → lanes → reviewed branch"]
    request --> design["Architecture design<br/>relay-design / architect"]
    design --> document["Decisions → architecture document"]
    document -->|Optional planning handoff| implementation
    request --> teach["Teaching<br/>relay-teach / teacher"]
    request --> reconstruct["Reconstruction<br/>relay-reverse-engineer / reverse-engineer"]
    teach --> research["Shared research-and-explain engine"]
    reconstruct --> research
    research --> answer["Evidence → explanation or system reconstruction"]
```

## Contents

- [Documentation](#documentation)
- [The problem](#the-problem)
- [How relay works, in one picture](#how-relay-works-in-one-picture)
- [Core ideas](#core-ideas)
  - [1. A model for every task](#1-a-model-for-every-task)
  - [2. Plans that carry the decisions](#2-plans-that-carry-the-decisions)
  - [3. Lanes and waves](#3-lanes-and-waves)
  - [4. Reviews and the fix loop](#4-reviews-and-the-fix-loop)
  - [5. The usage budget](#5-the-usage-budget)
  - [6. Testing like QA](#6-testing-like-qa)
  - [7. Claude Code and Codex together](#7-claude-code-and-codex-together)
  - [8. Forecast, then run for hours](#8-forecast-then-run-for-hours)
  - [9. The board: what is done, at a glance](#9-the-board-what-is-done-at-a-glance)
- [Workflows, step by step](#workflows-step-by-step)
- [Architecture design](#architecture-design)
- [Teaching and reverse engineering](#teaching-and-reverse-engineering)
- [Installation](#installation)
- [What's inside](#whats-inside)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)

## Documentation

| Start here | What it covers |
|---|---|
| [Getting started](docs/guides/getting-started.md) | Prerequisites, installation and the first request. |
| [Architecture](docs/architecture/overview.md) | Components, generation and data flow. |
| [Architecture design](docs/guides/architecture-design.md) | Collaborative design, research, maintained documents and planning handoff. |
| [Teaching and reverse engineering](docs/guides/teaching-and-reverse-engineering.md) | Independent entry paths, evidence, focus, helper limits and examples. |
| [Configuration](docs/configuration/README.md) | Shared tiers, Codex policy, budgets and defaults. |
| [Development](docs/guides/development.md) | Source changes, generation and local commands. |
| [Testing](docs/testing/README.md) | Automated checks, language review and live evaluation limits. |
| [Contributing](CONTRIBUTING.md) | Changes, verification and pull requests. |

## The problem

If you build with Claude Code on a subscription, you have probably seen most of these:

- **The 5-hour limit runs out in the middle of a feature.** The work stops at whatever state it was in.
- **Every helper agent runs on Opus.** A subagent inherits your session's model unless something tells it otherwise, and on Pro and Max the default model is Opus.
- **The coordinator is the most expensive seat.** The agent that hands out work re-reads a growing conversation on every turn. In superpowers' own measurements, coordination was about half the cost of a plan run.
- **One worktree per task.** Every task pays for a fresh checkout, a fresh dependency install and a cold cache, and every task needs its own review.
- **Too many tests.** A two-line change comes back with forty new tests, half of which only repeat what the code already says, and the same suite runs six times on the same code.

Here is the difference relay makes to who works on what:

```mermaid
flowchart LR
    subgraph before["Without relay"]
        direction TB
        s1["Your session<br/>Opus"] --> h1["helper<br/>Opus"]
        s1 --> h2["helper<br/>Opus"]
        s1 --> h3["helper<br/>Opus"]
        s1 --> h4["helper<br/>Opus"]
    end
    subgraph after["With relay"]
        direction TB
        s2["Your session"] --> ar["architect<br/>Opus, plans once"]
        s2 --> co["conductor<br/>Sonnet, coordinates"]
        co --> im["implementers<br/>Sonnet or Haiku"]
        co --> rv["reviewers<br/>Sonnet"]
        co --> fr["architect<br/>Opus, final review once"]
    end
    before ~~~ after
```

## How relay works, in one picture

```mermaid
flowchart TD
    you(["You: describe a feature or hand over a spec"]) --> plan["<b>architect</b> (Opus) writes the plan<br/>each task gets a model tier, a risk,<br/>its files, a test budget, a done check"]
    plan --> check{{"relay lanes<br/>validates the plan and groups tasks<br/>into lanes and waves"}}
    check --> go(["You: go"])
    go --> conductor["<b>conductor</b> (Sonnet) runs the plan"]
    subgraph w1["Wave 1: lanes run in parallel, each in its own worktree"]
        la["lane a<br/>implementer<br/>Sonnet"]
        lb["lane b<br/>implementer-fast<br/>Haiku"]
        lc["lane c<br/>implementer<br/>Sonnet"]
    end
    conductor --> la & lb & lc
    la & lb & lc --> review["<b>reviewer</b> per lane (Sonnet)<br/>fix loop when needed"]
    review --> merge{{"merge the wave<br/>run the full test suite once"}}
    merge --> w2["Wave 2 starts from the merged code"]
    w2 --> final["<b>architect</b> (Opus) final review"]
    final --> done(["You: one branch to review<br/>and a list of every decision the agents made"])
```

Opus plans the work and reviews the finished branch. Between those two points it only touches the tasks the plan marks as hard and fixes that cheaper models could not finish. Everything else runs on Sonnet or Haiku, and because the expensive judgment calls were already made in the plan, the cheaper models mostly carry out decisions.

## Core ideas

### 1. A model for every task

Relay has three tiers. Each agent role belongs to one, and every task in a plan gets one.

| Tier | Claude Code | Codex | Who uses it |
|---|---|---|---|
| **cheap** | Haiku, low effort | gpt-6-luna, low | `scout` (finds code), `implementer-fast` (types out code the plan already contains) |
| **mid** | Sonnet, medium effort | gpt-6.1-sol, medium | `implementer`, `test-author`, `reviewer`, `conductor`, `teacher`, `reverse-engineer`, and any helper started without a model |
| **strong** | Opus, high effort | gpt-6-astra, high | `architect` (design, plan and review), `implementer-deep` (hard tasks and escalations) |

The architect picks a task's tier while planning, with simple rules:

```mermaid
flowchart TD
    t["A task in the plan"] --> q1{"Does the plan contain<br/>the complete code?"}
    q1 -- "yes, or a 1-2 file<br/>mechanical edit" --> cheap["<b>cheap</b><br/>implementer-fast, Haiku"]
    q1 -- no --> q2{"Does it need design judgment,<br/>subtle concurrency or a broad refactor?"}
    q2 -- yes --> strong["<b>strong</b><br/>implementer-deep, Opus"]
    q2 -- no --> mid["<b>mid</b><br/>implementer, Sonnet"]
```

When in doubt the answer is mid. Cheap models often need two or three times as many turns on instructions written in prose, which can cost more than running Sonnet once.

In Claude Code, relay's **mod** (a small module that hooks into Claude Code itself) enforces the routing, so it does not depend on the model remembering a rule:

- a built-in helper started without a model (`general-purpose`, `Plan`) gets Sonnet, and `Explore` gets Haiku, where they would otherwise inherit Opus;
- when the usage budget is tight, any helper headed for Opus is moved to Sonnet, except the architect;
- when the budget is critical, new implementers are refused with a message telling the coordinator to wrap up.

### 2. Plans that carry the decisions

Everything that needs judgment is decided once, at plan time, by the strongest model. A plan is a markdown file for people plus one JSON block for tools:

````markdown
### T2: CSV writer
`writeCsv(rows: ExportRow[]): string` in `src/export/csv.ts`. Header `id,amount,currency`;
amount as `12.34` (two decimals, dot); RFC 4180 quoting.

```relay-plan
{
  "slug": "billing-export",
  "suite": "pnpm test",
  "setup": "pnpm install --frozen-lockfile",
  "tasks": [
    { "id": "T2", "title": "CSV writer", "tier": "mid", "risk": "medium",
      "files": ["src/export/csv.ts", "src/export/csv.test.ts"], "deps": ["T1"],
      "behaviors": ["amounts render with two decimals", "fields with commas or quotes are quoted"],
      "tests": 2,
      "done": "pnpm vitest run src/export/csv.test.ts" }
  ]
}
```
````

Each field has a job:

| Field | What it decides |
|---|---|
| `tier` | Which model builds the task. |
| `risk` | How much testing and review it gets (`low`, `medium`, `high`). |
| `files` | Every path the task touches. Relay groups tasks into lanes from this, so a missing file means a merge conflict later. |
| `deps` | Which tasks must land first. |
| `behaviors` and `tests` | What the task changes, seen from outside, and how many new tests that is worth. |
| `done` | The narrowest command that proves the task works. Never the whole suite. |

`relay lanes <plan>` checks the plan before anything runs: missing fields, unknown dependencies, cycles, a cheap tier on a multi-file prose task, a high-risk task with no test, a low-risk task with three. The full template is in [skills/plan-with-tiers/template.md](skills/plan-with-tiers/template.md).

### 3. Lanes and waves

A **lane** is a group of tasks that touch the same files. A lane gets one git worktree and one implementer, who does its tasks in order with one commit per task. Because the agent stays in the same context, it reads the module once and keeps working, and its prompt cache stays warm.

A **wave** is a set of lanes that can run at the same time. Lanes in a wave share no files, so they never conflict. When a lane depends on another lane's work, it waits for the next wave.

Relay computes this from the plan, with no model involved:

1. Tasks that share a file go in the same lane.
2. A chain of dependent tasks folds into one lane, while it stays small (6 tasks by default), so there is no merge between steps.
3. Waves follow the remaining dependencies between lanes.
4. A wave with too many lanes (4 by default) packs its smallest lanes together.

Here is the example plan from this repository's tests, six tasks for a billing export:

```mermaid
flowchart LR
    subgraph wave1["Wave 1"]
        direction TB
        subgraph la["lane a: one worktree"]
            T1["T1 schema<br/>cheap"] --> T2["T2 CSV writer<br/>mid"]
        end
        subgraph lb["lane b"]
            T4["T4 README section<br/>cheap"]
        end
        subgraph lc["lane c"]
            T5["T5 rounding helper<br/>mid"]
        end
    end
    subgraph wave2["Wave 2"]
        direction TB
        subgraph ld["lane d: one worktree, two agents"]
            T3["T3 export endpoint<br/>Sonnet"] --> T6["T6 billing route<br/>Opus"]
        end
    end
    T2 -. "T3 depends on T2" .-> T3
    T5 -. "T6 depends on T5" .-> T6
```

T3 and T6 both edit `src/routes/index.ts`, so they share lane d. They depend on work from lanes a and c, so lane d runs in wave 2. T6 is the one hard task in the plan, so lane d is split: a Sonnet agent does T3, then an Opus agent does T6 in the same worktree. The routine task never runs on the expensive model.

This is what relay prints for that plan:

```text
$ relay lanes docs/relay/plans/2026-10-19-billing-export.md
plan billing-export: 6 tasks → 4 lanes in 2 wave(s)
wave 1
  lane a  [risk medium, new tests ≤ 2]  lane-a=implementer(T1 → T2)
  lane b  [risk low, new tests ≤ 0]  lane-b=implementer-fast(T4)
  lane c  [risk medium, new tests ≤ 1]  lane-c=implementer(T5)
wave 2
  lane d  [risk high, new tests ≤ 3]  lane-d=implementer(T3), then lane-d-s2=implementer-deep(T6)
```

#### Worktrees are reused

Relay keeps a small pool of worktrees per plan. They are created once and dependencies are installed once. Between waves, each worktree is moved to the newly merged code; nobody creates a fresh checkout.

```text
your-repo/                              your checkout, untouched during a run
├── .claude/worktrees/
│   ├── relay-billing-export-int        integration branch; the full suite runs here
│   ├── relay-billing-export-1          slot 1: lane a, then lane d in wave 2
│   ├── relay-billing-export-2          slot 2: lane b
│   └── relay-billing-export-3          slot 3: lane c
└── .relay/runs/billing-export/         briefs, reports, review packages, the ledger
```

The branches end up like this:

```mermaid
gitGraph
    commit id: "your branch"
    branch integration
    checkout integration
    branch lane-a
    checkout lane-a
    commit id: "T1 schema"
    commit id: "T2 CSV writer"
    checkout integration
    branch lane-b
    checkout lane-b
    commit id: "T4 README"
    checkout integration
    branch lane-c
    checkout lane-c
    commit id: "T5 rounding"
    checkout integration
    merge lane-a
    merge lane-b
    merge lane-c
    commit id: "wave 1: suite passed" type: HIGHLIGHT
    branch lane-d
    checkout lane-d
    commit id: "T3 endpoint"
    commit id: "T6 billing route"
    checkout integration
    merge lane-d
    commit id: "wave 2: suite passed" type: HIGHLIGHT
```

The real branch names are `relay/<slug>/integration` and `relay/<slug>/lane-<id>`. Your own branch is never touched; merging the integration branch into it is your call.

In Claude Code, an agent started with the name `lane-a` is placed in lane a's worktree by relay's mod. In Codex, the dispatch tells the agent which directory to work in.

### 4. Reviews and the fix loop

Every lane is reviewed once, task by task, against the plan and the spec. The reviewer gets a single file with the lane's commits and full diff (`relay worktrees pack`), so it does not spend turns rebuilding the diff with git commands.

```mermaid
flowchart TD
    done["Lane reports DONE"] --> pack["relay worktrees pack<br/>commits + diff in one file"]
    pack --> rev{"reviewer<br/>spec ✅/❌ and quality, per task"}
    rev -- clean --> ok(["lane complete, written to the ledger"])
    rev -- "minor findings" --> led["noted in the ledger<br/>for the final review"] --> ok
    rev -- "critical or important" --> f13["rounds 1 to 3:<br/>the same agent fixes,<br/>its context is still warm"]
    f13 --> rr1{"scoped re-review<br/>of the fix only"}
    rr1 -- addressed --> ok
    rr1 -- "still open" --> f45["rounds 4 and 5:<br/>a fresh implementer-deep (Opus)<br/>reads what was tried and takes over"]
    f45 --> rr2{"scoped re-review"}
    rr2 -- addressed --> ok
    rr2 -- "still open after round 5" --> rule["the conductor rules on each finding<br/>and records why"]
    rule --> ok
```

Three rules keep this loop from eating the budget:

- Re-reviews only look at the fix, so they cannot wander into new topics.
- Minor findings never enter the loop. They are written down for the final review to triage.
- After five rounds the loop stops. A loop that has not converged by then is a problem in the plan, and more rounds will not fix it.

Every decision the conductor makes on your behalf is written to the ledger as `Ruling: what — why — what it costs if wrong`, and the final report lists all of them.

### 5. The usage budget

Relay's mod reads the same 5-hour and weekly figures Claude Code shows you in `/usage`, and writes them to `~/.relay/budget.json` so that `relay budget` and the skills can read them.

For Codex, `relay budget --harness codex` first attempts a bounded `account/rateLimits/read` request through `codex app-server`. If that fails, it uses a fresh Codex snapshot or a best-effort rollout reading. Codex snapshots live separately at `~/.relay/codex/budget.json`. A missing or stale reading is `unknown`; it does not mean zero usage. Account windows can differ from Claude's 5-hour and weekly pair.

```mermaid
stateDiagram-v2
    direction LR
    normal --> tight: 5-hour window ≥ 60%<br/>or weekly ≥ 80%
    tight --> critical: 5-hour window ≥ 85%<br/>or weekly ≥ 95%
    tight --> normal: window resets
    critical --> normal: window resets
```

| Level | What changes |
|---|---|
| **normal** | Every task runs on its planned tier. |
| **tight** | Opus is kept for the final review. Anything else headed for Opus runs on Sonnet. The conductor prefers cheap tiers where the plan holds complete code, and can send reviews to Codex. |
| **critical** | No new implementation starts. Lanes already running finish their tasks and fix rounds, the wave merges, and the conductor writes a handoff note. Claude Code can wait for the reset and pick up from there. |
| **unknown** | No usable reading, or a stale reading. Relay behaves as if the budget were tight. |

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Mod as relay mod
    participant Snap as ~/.relay/budget.json
    participant Cond as conductor
    CC->>Mod: new usage reading: 5h 72%, week 41%
    Mod->>Snap: save snapshot (level: tight)
    Cond->>Snap: relay budget (before wave 2)
    Snap-->>Cond: tight, 5h 72%, resets 18:00
    Cond->>Mod: start implementer-deep for lane d (Opus)
    Mod-->>Cond: started on Sonnet: budget is tight
```

In your own session, relay also adds one line to your next prompt whenever the level changes, so the model you talk to knows where the budget stands.

The thresholds are starting points. Watch `/usage` for a week of real work and adjust them in `config/routing.json`.

### 6. Testing like QA

Coding agents tend to over-test. In recent studies, most tests written by agents had weak assertions or none, and re-running tests on unchanged code was one of the most common wastes in agent sessions. In one small experiment, making an agent write a failing test before every change cost three to eight times more tokens with no measurable gain in quality. [docs/design.md](docs/design.md#4-testing-evidence) has the sources.

Relay treats tests the way a QA engineer would: each test has to be able to catch a real bug that nothing else catches.

**A test budget per task, from its risk:**

| Risk | Examples | New tests |
|---|---|---|
| low | internal refactor, docs, config | 0 or 1. Types and existing tests usually cover it. |
| medium | user-visible behavior | One per behavior listed in the plan. |
| high | money, data loss, security, concurrency, migrations | One per behavior, plus boundary values and error cases, or one property-based test. Mutation testing on the changed lines. |

**Tests come from the spec, written by someone else.** For medium and high-risk lanes, a `test-author` agent writes the acceptance tests from the spec before the code exists. Tests written after reading the code tend to copy its bugs. Relay then protects those files: the implementer cannot edit, skip or weaken them.

```mermaid
flowchart LR
    spec["spec + task behaviors"] --> ta["test-author<br/>writes acceptance tests<br/>without seeing the code"]
    ta --> prot["relay protect add<br/>tests are now locked"]
    prot --> impl["implementer<br/>writes the code"]
    impl -- "tries to edit a protected test" --> block["blocked by a hook"]
    block --> rep["reports BLOCKED with evidence:<br/>spec line, expected, observed"]
    rep --> cond["the conductor decides:<br/>fix the code, or have the<br/>test-author fix the test"]
```

**Verification goes from narrow to wide, and only the last step is the full suite:**

```mermaid
flowchart LR
    a["typecheck and lint<br/>of touched files"] --> b["tests related<br/>to the change"] --> c["the task's<br/>done command"] --> d["full suite<br/>once per wave,<br/>after the merge"]
```

**The same test never runs twice on the same code.** A hook fingerprints the test command together with the exact state of the code. If nothing changed since the last run, the result cannot change either, so the run is refused and the agent gets the previous output back:

```mermaid
sequenceDiagram
    participant A as implementer
    participant G as retest guard
    A->>G: pytest tests/export (code state A)
    G-->>A: allowed, result remembered
    A->>G: pytest tests/export (code state still A)
    G-->>A: refused: already ran at 14:02 on identical code.<br/>Last output: 3 passed
    Note over A: edits src/export/csv.py
    A->>G: pytest tests/export (code state B)
    G-->>A: allowed
```

For a test that is really flaky, the agent can prefix the command with `RELAY_RERUN=1` and has to explain why in its report.

**Every report says what happened to the tests:** how many were added and removed, one line per new test naming the behavior it guards, and the commands that ran with their results. Reviewers delete tests that only mirror the code, assert nothing, or duplicate another test.

The full rules are in [skills/qa-mindset/SKILL.md](skills/qa-mindset/SKILL.md).

### 7. Claude Code and Codex together

Relay keeps source role instructions in `roles/` and shared model tiers in `config/routing.json`. `node bin/relay build` generates the Claude agent definitions, Codex agent definitions and hook manifests, Codex agent defaults, and the routing block inside the Claude mod. The skills are shared directly. Hook logic remains in its source files.

```mermaid
flowchart LR
    src["roles/*.md<br/>config/routing.json"] --> build{{"relay build"}}
    build --> cc["Claude Code<br/>agents/*.md"]
    build --> cx["Codex<br/>codex/agents/*.toml<br/>codex/hooks.json<br/>[agents] defaults"]
    build --> mod["Claude mod<br/>generated routing block"]
    skills["skills/<br/>shared source instructions"] --> cc & cx
```

Claude and Codex have separate usage windows, so you can split the work between them. A common split: Claude plans and builds, Codex reviews read-only. A second model family also has different blind spots than the first, which makes it a better reviewer of the first one's code.

```mermaid
sequenceDiagram
    participant C as Claude Code (conductor)
    participant L as lane worktree
    participant X as Codex (read-only)
    C->>L: implementer builds lane b
    L-->>C: DONE, 2 commits
    C->>C: relay worktrees pack plan b
    C->>X: codex exec --sandbox read-only "review this package"
    X-->>C: review file: 1 important finding
    C->>L: resume lane-b with the finding
```

### 8. Forecast, then run for hours

After the plan, before anyone says go, `/relay:forecast` says what the run will take (the plan-with-tiers skill also runs it for you before it hands the plan over). Agents, worktrees and parallelism are exact, computed from the plan. Usage and time come from your own past runs once you have any; until then relay uses placeholder rates and says so on every line that depends on them.

```text
> /relay:forecast docs/relay/plans/2026-10-19-password-reset.md
forecast for password-reset: 6 tasks · 3 lanes · 2 wave(s)
agents       ~11 starts (3 reviewer, 2 implementer, 2 test-author, 1 conductor, 1 architect,
             1 implementer-fast, 1 implementer-deep), plus ~1.8 fix round(s) on resumed agents
parallel     up to 2 lane(s) at once (plan allows 2, cap 4)
worktrees    3 (2 lane slot(s) reused across waves + 1 integration)
usage        ~31.7% of a 5h window ± 2.9% from fix rounds — 24.6 units of work + 7.1 expected in fix rounds,
             at 1.00% per unit — PLACEHOLDER rate, not your data: run a plan, then `relay calibrate`
windows      ~1 five-hour window(s) at the 85% stop line — from placeholder rates
time         ~2h 3m of work — from placeholder rates
  wave 1: ~11.1% · ~41m · window 1
  wave 2: ~20.6% · ~1h 22m · window 1
```

**How it learns.** Every ledger line is stamped with the usage reading at that moment and the time the 5-hour window resets, for example `[5h 23.4% resets 16:30 · 7d 41%]`. When a wave merges, the difference between the wave's start stamp and its merge stamp is one sample: this much of the window for this much expected work, reviews and fix rounds included. `/relay:calibrate <plan>` collects the samples into `~/.relay/calibration.json`, and the next forecast uses them; run-lanes does this on its own at the end of a run. A wave during which the window reset is dropped, never guessed. After two or three plans the numbers are yours.

**The 5-hour limit is a quota. Relay crosses it; nothing dodges it.** Optimizing tokens fits more work into each window and leaves the window itself in place. A long plan passes through several windows, and `/relay:marathon` makes that happen without you:

```mermaid
flowchart LR
    start(["/relay:marathon plan.md 20"]) --> leg["leg N<br/>a headless session in the selected harness<br/>continues the plan from saved state"]
    leg --> q{"how did the leg end?"}
    q -- "plan complete" --> done(["stop: done<br/>relay calibrate"])
    q -- "budget critical<br/>or usage limit" --> wait["wait for the<br/>window reset"]
    wait --> deadline{"before the<br/>deadline?"}
    deadline -- yes --> leg
    deadline -- no --> stop1(["stop: deadline"])
    q -- "progress, no marker<br/>(ran out of turns)" --> leg
    q -- "BLOCKED" --> stop2(["stop: needs a human"])
    q -- "no progress<br/>twice in a row" --> stop3(["stop: stalled"])
```

Marathon supports both harnesses. Claude legs use short `claude -p` sessions with empty context, continuing from the ledger, lane branches and worktrees. They use `--permission-mode auto --permission-prompts none`. Codex legs use `codex exec` and resume the saved thread on subsequent legs or after a restart. The controller shares the same deadline, ledger, reset waits, stop requests and stall detection across both backends.

Select Codex explicitly and inspect the dry run before starting:

```bash
node /absolute/path/to/installed/relay/bin/relay marathon plan.md --hours 20 --harness codex --dry-run
node /absolute/path/to/installed/relay/bin/relay marathon plan.md --hours 20 --harness codex
```

Codex uses its native `workspace-write` sandbox and `--approve-for-me` approval flow, loads installed plugins, and selects the conductor model/effort from Relay's mid tier. Use `--codex-bin /absolute/path/to/codex` or `RELAY_CODEX_BIN` when the executable is absent from PATH. Claude-only flags (`--permission-mode`, `--allowed-tools`, `--plugin-dir`, `--max-turns`) are rejected for Codex. Account readings and calibration remain separate per harness; waits use the actual blocking window resets. At the end you get an integration branch, test counts and every recorded ruling.

**Where a marathon runs.** `/relay:marathon plan.md 20` starts it from the chat as a background task of the session. You can keep working in the same session; `/relay:marathon status` shows the current leg or how long until the window resets, and `/relay:marathon stop` ends it after the current leg (`stop now` ends that leg too). A background task lives as long as the session, so keep Claude Code open and the computer awake. If the session closes anyway, the same command continues from the ledger. On macOS, `/relay:marathon plan.md 20 terminal` opens the run in its own Terminal window instead, and it keeps going after you close Claude Code.

What a marathon can and cannot promise: any plan, whatever its size, keeps advancing until it is done, with as much work as possible in each window. What changes with complexity is the number of windows. The real ceiling is the weekly limit; `relay forecast` warns when a plan does not fit in what is left of it, and the way past that ceiling is a second quota (Codex, or paid extra usage), not a trick.

### 9. The board: what is done, at a glance

Once a plan exists, every task has a traffic light: **grey** planned, **yellow** in progress, **green** done, **red** blocked. Within a busy lane, the tasks waiting for the one before them are hollow grey (queued).

![The relay board in a browser: three waves of lanes, each task with a traffic light, details of the selected task on the right](docs/images/board.png)

The lights are computed, not reported by an agent. A task turns green when its own commit (`T3: ...`) is on its lane branch, and stays green once merged into the integration branch; the tests a test-author writes for it do not count. A lane turns red when its latest ledger line says BLOCKED or its wave's suite failed. Every `relay ledger` and `relay worktrees` call refreshes the board, so it moves as the run moves.

Three places show it:

- **`/relay:board`** prints it in the chat and opens the roadmap page in your browser, which reloads itself while the run goes. Click a task for its files, behaviors, test budget and done check; filter by light.
- **A band above the prompt** in Claude Code, while a run is going: one dot per task and the count of green ones, with a button that opens the pane.
- **`/relay-board`** opens the whole board in a pane beside the chat.

From a terminal: `relay board <plan> --html --open`.

## Workflows, step by step

The examples below show what you type and what relay does. Agent output is shortened.

### Workflow 1: a new feature, end to end

**1. Describe the feature.** Give relay a spec, or just say what you want:

```text
/relay:plan CSV export of invoices for the billing page, plus a rounding helper
```

Relay scouts the code, asks at most three questions that change the plan (here: which currencies, and whether totals round per line or per invoice), and writes a one-page spec with the behaviors that will become tests.

**2. The architect writes the plan** (on Opus) to `docs/relay/plans/2026-10-19-billing-export.md`, runs `relay lanes` on it, fixes anything it reports, and you get one line per task, the lanes and waves, and the forecast:

```text
plan billing-export: 6 tasks → 4 lanes in 2 wave(s)
wave 1
  lane a  [risk medium, new tests ≤ 2]  lane-a=implementer(T1 → T2)
  lane b  [risk low, new tests ≤ 0]  lane-b=implementer-fast(T4)
  lane c  [risk medium, new tests ≤ 1]  lane-c=implementer(T5)
wave 2
  lane d  [risk high, new tests ≤ 3]  lane-d=implementer(T3), then lane-d-s2=implementer-deep(T6)
```

Read the plan. This is the cheapest moment to change your mind.

**3. Say go.**

```text
/relay:run
```

The conductor (Sonnet) takes over in the background and works without stopping to check in; `/relay:status` shows where it is:

```text
relay budget                         → budget: normal — 5h 18%, 7d 22%
relay worktrees sync <plan> --wave 1 → 3 worktrees created, briefs written
test-author for lane a (risk medium) → 2 acceptance tests, protected
lane-a, lane-b, lane-c dispatched in parallel
lane-b DONE → reviewer: clean
lane-c DONE → reviewer: 1 important finding → fix round 1 → addressed
lane-a DONE → reviewer: clean
relay worktrees merge <plan> --wave 1 --suite → 4 commits merged, suite passed
relay worktrees sync <plan> --wave 2 → slot 1 reused for lane d
lane-d (Sonnet: T3) DONE → lane-d-s2 (Opus: T6) DONE → reviewer: clean
relay worktrees merge <plan> --wave 2 --suite → suite passed
architect: final review of the whole branch → 1 deferred minor to fix before merge
```

**4. Read the report.** You get the branch `relay/billing-export/integration`, the waves and lanes with their status, how many tests were added and removed, and every ruling the conductor made, each with its reason and what it costs if it was wrong. Review the branch like any pull request and merge it when you are happy.

### Workflow 2: a small change, no plan

Not everything needs lanes. For a bug fix or a one-file change, keep talking to your agent as usual:

> The invoice total is off by a cent when a line has three decimals. Fix it.

Relay still shapes the work:

- If the agent sends a helper to look around, the helper runs on Haiku (`Explore`) or Sonnet, not Opus.
- The `qa-mindset` skill asks for one regression test that reproduces the bug, with the expected value taken from the bug report, never from running the code.
- Verification stays narrow: the related test file, then the typecheck. The retest guard stops the agent from re-running the suite "to be sure".

### Workflow 3: the budget runs low mid-run

You are halfway through a large plan and the 5-hour window reaches 86%.

1. The mod marks the budget **critical**. The conductor sees it when it checks `relay budget` after a lane finishes, and any new implementer it tries to start is refused with the same message.
2. Lanes already working finish their current tasks and fix rounds; nothing new starts.
3. The conductor merges what is done, then writes `.relay/runs/<slug>/HANDOFF.md`: the goal, the branch and its last commit, what is finished and verified, what is in flight, the next three steps, and every ruling so far.
4. When the window resets, start a fresh session and say:

> Read .relay/runs/billing-export/HANDOFF.md and continue from "Next".

The ledger and the lane branches are on disk, so nothing depends on the old conversation. Lanes that already finished are never dispatched again.

### Workflow 4: a protected test looks wrong

The implementer of lane a cannot make the acceptance test for "amounts render with two decimals" pass. The test expects `12.3`, the spec says `12.30`.

1. The implementer tries to change the test. The protect hook refuses the edit.
2. It reports `BLOCKED` with the evidence: the spec line, what the test expects, what the code produces.
3. The conductor compares that against the spec, rules that the test is wrong, and records the ruling.
4. It runs `relay protect remove` for that file, has the test-author fix it, protects it again, and resumes the implementer.

The implementer never decides on its own that a test is wrong, and the decision ends up in the final report.

### Workflow 5: Claude builds, Codex reviews

With Codex installed, the conductor sends reviews of high-risk lanes to Codex, and all reviews once the budget is tight:

```bash
codex exec --sandbox read-only -o .relay/runs/billing-export/lane-d.codex-review.md \
  "Review per /absolute/path/to/installed/relay/roles/reviewer.md: brief <path>, report <path>, package <path>"
```

The review lands in a file, the conductor reads its verdicts, and the fix loop continues as usual. The review is paid from your Codex window.

### Workflow 6: running relay inside Codex

The shared implementation workflows are available through `$relay-plan` or `$relay-run` in Codex; the engine skills `$plan-with-tiers` and `$run-lanes` remain available. The conductor dispatches `relay-implementer`, `relay-reviewer` and the other agents installed by `relay setup codex`, always naming the model and reasoning effort. Each lane's dispatch starts with the absolute path of its worktree. Discovery and dispatch depend on the active host tools and installation.

### Workflow 7: run for 20 hours while you sleep

You have a large plan, say 30 tasks in 5 waves, and you want it done by morning. Everything happens in the Claude Code chat.

**1. Read the forecast.**

```text
/relay:forecast docs/relay/plans/2026-10-19-big-feature.md
```

If it says the plan does not fit the weekly limit, split the plan or let Codex take the reviews. If the time estimate is longer than your night, that is fine: the marathon stops at the deadline with the ledger showing where it got to.

**2. Start it.**

```text
/relay:marathon docs/relay/plans/2026-10-19-big-feature.md 20
```

Claude does a dry run first: it shows the forecast and refuses if the main checkout has uncommitted changes or the plan has errors. Then it starts the marathon as a background task and tells you where it runs. Leave Claude Code open and the computer awake (on a laptop: plugged in, lid open or sleep disabled). Add `terminal` at the end, on macOS, to run it in its own Terminal window instead.

**3. Look in whenever you like.**

```text
/relay:marathon status
```

```text
marathon big-feature: running · pid 48211 · waiting for the usage window until 2026-10-20 03:02 (1h 31m from now)
deadline 2026-10-20 18:04 (16h 33m left) · model sonnet · permission auto
legs 1: paused · api-equivalent $14.20
last  leg 1 paused: budget critical [5h 86% · 7d 38%]
ledger
  - 2026-10-20 01:12 [5h 71% · 7d 35%] wave 2: merged @ 9c41e0a, suite pass
  - 2026-10-20 01:30 [5h 86% · 7d 38%] handoff: wave 3 lanes a, b in flight at critical; next leg resumes them
```

The full log, one line per event, is in `.relay/runs/big-feature/marathon.log`:

```text
22:04 marathon start: big-feature, 20h, deadline 18:04, model sonnet, permission auto
22:04 leg 1: starting
01:31 leg 1: paused — budget critical (api-equivalent $14.20) [5h 86% · 7d 38%]
01:31 waiting until 03:02 (+90s) for the window to reset: budget critical
03:04 leg 2: starting
06:48 leg 2: progress — leg ended with progress; continuing
06:48 leg 3: starting
07:40 leg 3: done — merged (api-equivalent $3.10) [5h 41% · 7d 52%]
07:40 marathon stop: plan complete
```

Leg 1 worked until the window was nearly spent, merged what was clean and wrote a handoff. The marathon waited for the reset and started leg 2 with an empty context, which picked up from the ledger. Leg 2 ran out of its turn budget mid-wave, so leg 3 continued at once. Each leg is its own headless session with its own session id, recorded with its cost and usage reading in `.relay/runs/big-feature/marathon.json`.

**4. In the morning.** When the background task ends, Claude reports the outcome, the waves merged, what is left and the rulings worth a look, and calibrates the forecast from this run. Review `relay/big-feature/integration` like a pull request.

**From a terminal instead.** With the `relay` command installed in your shell (see [In your own terminal](#in-your-own-terminal)), `relay marathon <plan> --hours 20` does the same under `tmux` or `screen`, and `--status` and `--stop` work the same way.

## Architecture design

Use `/relay:relay-design` in Claude Code or `$relay-design` in Codex. This shared skill uses the existing architect in the current conversation. The architect works with you to challenge assumptions, research alternatives, compare trade-offs, and document a balanced solution. Its planning and final branch review duties remain available.

```text
Design a durable import pipeline from requirements.md. Research comparable
approaches and explain one concrete flow. We have one operations engineer.
Save the design in docs/architecture/imports.md; leave implementation for later.
```

The design records constraints, responsibilities, contracts, significant decisions, failure scenarios, and validation. It follows existing documentation conventions and distinguishes proposed changes from implemented behavior. You can keep a small comparison in chat. Helpers are optional; `max-helpers=0` keeps research serial.

When requested, `/relay:plan docs/architecture/imports.md` or `$relay-plan docs/architecture/imports.md` turns that design into implementation tasks while preserving its accepted decisions. Design does not start implementation automatically. See the [architecture design guide](docs/guides/architecture-design.md) for examples, research rules, review, and document maintenance.

The architect defines the responsibilities; the skill guides the design workflow. Both hosts share these sources. These are chat invocations, with no new `relay design` terminal command. The guide explains [which workflow to choose](docs/guides/architecture-design.md#choose-the-work-you-need) and [how to keep documents current](docs/guides/architecture-design.md#keep-the-architecture-useful-after-implementation).

## Teaching and reverse engineering

Use `/relay:relay-teach` or `/relay:relay-reverse-engineer` through Claude Code skill discovery. In Codex, use `$relay-teach` or `$relay-reverse-engineer`. These shared entry skills act as the lead in the current conversation. You can also choose native `relay:teacher` / `relay:reverse-engineer` in Claude Code or `relay-teacher` / `relay-reverse-engineer` in Codex. Each role works independently.

Example teaching requests:

```text
Explain the cache hit path in src/cache.ts; focus=technical max-helpers=0. Just explain.
I know functions but not caching. Show one example, a diagram and the underlying details.
Research queueMicrotask using the Node 20 primary documentation. Give the exact contract in two sentences.
```

Example reconstruction requests:

```text
Reconstruct src/cache.ts using docs/cache-intent.md; focus=technical max-helpers=0.
Now connect the same mechanisms to stakeholders and outcomes; focus=business+technical.
Give me an optional teacher handoff for the expiry gap, with cited evidence and open questions.
```

Both roles use one bundled default method. It starts with a direct answer and adds purpose, a causal diagram, a concrete input, underlying details, and a transferable principle when useful. Vocabulary, depth, pace, examples and analogy limits adapt to topic familiarity and the question. There are no named or custom explanation profiles. `focus=technical` is the default; `business+technical` adds stakeholders, outcomes and business rules. Focus does not set beginner level or response length. Technical explanations still explain why a mechanism exists.

`max-helpers` accepts integers 0–3 and defaults to 3. It is a ceiling. Small questions need no helpers. The lead uses actual remaining global host capacity and existing budget caps. Unknown capacity or unavailable nesting means zero helpers. Direct native Claude child roles research serially because their allowlist has no Agent tool. Interactive leads may use available dispatch tools. Research-only helpers cannot delegate. This policy does not create a global scheduler or guarantee parallelism.

Project code stays read-only. Only an explicitly assigned report may be written within actual host permissions. A restrictive sandbox returns evidence for the caller to save. Research does not automatically create coding plans, tests, worktrees, commits, installations or saved learner history. Handoffs are optional evidence to reuse and check for relevant gaps. Lead answers follow your requested depth; helper returns are compact.

All runtime instruction drafts use the shared language guide and software glossary. Teacher explanations use adaptive STE-based language. Instruction drafts follow a strict STE-style policy; this does not establish audited ASD-STE100 conformance. The [both-host evaluation recipe](docs/relay/evaluations/2026-10-25-teaching-and-reverse-engineering.md) separates static checks from live scenarios A–H, which remain **UNEXECUTED** in both hosts.

See the [teaching and reverse-engineering guide](docs/guides/teaching-and-reverse-engineering.md) for request fields, evidence handling and diagrams. The [architecture overview](docs/architecture/overview.md) shows the shared engine and independent roles. The [testing guide](docs/testing/README.md) explains which checks establish source behavior and which need a live host session.

## Installation

You need a recent **Claude Code** (run `claude update`), **git**, and **Node 20 or newer**. Relay's hooks and its `relay` command run on Node.

### Claude Code

**1. Add the marketplace and install the plugin.** Inside Claude Code:

```text
/plugin marketplace add cube-digital/relay
/plugin install relay@relay
```

The same from a terminal:

```bash
claude plugin marketplace add cube-digital/relay
claude plugin install relay@relay
```

**2. Restart Claude Code** (or run `/reload-plugins`), then run `/plugin`. Check that relay appears and that the mod is active (`1 mod active · relay` in the recorded pilot). The mod routes models and reads your usage budget. The October 20 pilot used Claude Code 2.1.303. That historical result does not establish support for every host version; check discovery, hooks and the mod on your installation.

**3. Set up each repository once.** Relay relies on two settings that a plugin is not allowed to set for itself. Open Claude Code inside the repository and ask:

> Run `relay setup claude --write-project`.

The `relay` command ships inside the plugin: Claude runs it for you, and the `/relay:` commands below wrap the parts you use yourself. If you prefer to do it by hand, add this to the repository's `.claude/settings.json`:

```json
{
  "worktree": { "baseRef": "head" },
  "subagentPromptCacheTtl": "1h"
}
```

The first setting makes lane worktrees branch from your current branch (by default they would start from `origin`'s main branch). The second keeps a lane's prompt cache warm for an hour while it waits for a review (the default is five minutes).

**4. Try it.** In the same session:

```text
/relay:budget
```

After your first message in a session it prints your 5-hour and weekly usage. Then describe a feature and say "plan this with relay".

#### For a whole team

Install with project scope from inside the repository:

```bash
claude plugin install relay@relay --scope project
```

This records relay in the repository's `.claude/settings.json`. Commit that file, and everyone who opens the repository in Claude Code is offered the same plugin. Commit the two settings from step 3 at the same time.

#### Updating and removing

```bash
claude plugin marketplace update relay      # fetch the latest version
claude plugin update relay@relay            # install it, then restart Claude Code
claude plugin uninstall relay@relay         # remove relay
```

#### In your own terminal

Optional. Everything works from the chat; install the command in your shell only to run marathons under `tmux`, in CI, or by hand:

```bash
npm install -g github:cube-digital/relay
relay --help
```

### Codex

Relay ships its CLI, roles, skills and command hooks in one portable payload. Invoke the CLI by its absolute plugin path; `npm link` is optional.

For a local checkout (including hook changes), use Relay's canonical marketplace:

```bash
codex plugin marketplace add /absolute/path/to/relay
codex plugin add relay@relay
node /absolute/path/to/installed/relay/bin/relay setup codex /path/to/project --plugin
node /absolute/path/to/installed/relay/bin/relay doctor --harness codex --project /path/to/project
```

Keep the marketplace name `relay` for Git and local installations, so the plugin remains `relay@relay`. To switch a registered marketplace to another checkout or Git ref, remove that marketplace source and add the desired source, using `--ref` for a branch or tag.

Use the installed cache path for setup, as shown by Codex's plugin details. If Codex is bundled with the desktop app and absent from PATH, invoke its absolute executable path; `RELAY_CODEX_BIN` or `--codex-bin` also selects that executable for Relay diagnostics and long runs. No global settings changes are required.

The manifest's native onboarding skill guides project setup. `--plugin` copies project agents and adds `[agents]` defaults only when project config is absent. Existing config stays intact; merge any printed missing defaults. Generated Codex TOML agent definitions leave model and effort to explicit dispatch and the spawn guard. They cannot override that request or budget routing. Start a new chat after setup so agents are discovered, and inspect `/hooks` to approve native hooks. Files on disk do not prove trust; doctor reports it as unknown.

Local installation copies the payload into `~/.codex/plugins/cache/<marketplace>/<plugin>/local`. Source edits are **not live**: refresh/reinstall the local plugin, then start a new chat. Hook-containing plugins currently use manual/local desktop installation rather than the public plugin directory. See the official [plugin development guide](https://developers.openai.com/plugins/build/plugins) and [command hooks guide](https://learn.chatgpt.com/docs/hooks).

Without native plugin hooks, use `node /absolute/path/to/relay/bin/relay setup codex /path/to/project` for project agent definitions, project hooks and `.agents/skills/` discovery links. Existing differing hooks are preserved with a separate merge candidate. **Choose one hook installation:** do not install fallback project hooks alongside enabled native Relay hooks. Setup rejects an existing Relay project-hook file when `--plugin` is requested; remove only Relay entries during migration and keep unrelated hooks.

The thirteen shared entrypoints are `$relay-design`, `$relay-plan`, `$relay-to-tickets`, `$relay-run`, `$relay-status`, `$relay-board`, `$relay-lanes`, `$relay-forecast`, `$relay-calibrate`, `$relay-budget`, `$relay-marathon`, `$relay-teach` and `$relay-reverse-engineer`. Their seven engine skills remain available. Per-harness references explain actual dispatch tools, installed resource paths and sandbox/report handling. Use `--harness codex` for budget, forecast, calibration, ledger and marathon so Claude and Codex readings stay separate.

### Trying relay without installing it

To try a local copy (or your own fork) for one session:

```bash
git clone https://github.com/cube-digital/relay ~/relay
cd /path/to/your/project
claude --plugin-dir ~/relay
```

Nothing is installed; the next session starts without relay.

## What's inside

### Commands in Claude Code

Claude Code provides the command wrappers, board UI command, and shared design and research skills below. Availability depends on the loaded plugin components. Design, teaching and reconstruction are shared skills; they have no wrapper under `commands/`.

| Command | What it does |
|---|---|
| `/relay:relay-design <problem>` | Collaborates on architecture, researches alternatives, and writes or updates design documents when requested. |
| `/relay:plan <what to build \| spec \| design>` | Turns requirements into a plan with tasks, lanes and a forecast. Reuses a supplied spec or accepted design; writes a short spec when neither exists. Writes no code. |
| `/relay:to-tickets <plan, spec, or request>` | Converts existing requirements into self-contained tickets with acceptance criteria and blockers. Returns drafts unless another destination is requested. |
| `/relay:run [plan]` | Runs the plan now: the conductor works through the waves in the background while you keep using the session. |
| `/relay:status [plan]` | Where a run is: waves, lanes, fix rounds, rulings, budget, and the marathon if one is running. |
| `/relay:board [plan]` | The roadmap as traffic lights, in the chat and as a page in your browser that follows the run. |
| `/relay-board` | The same board in a pane beside the chat; a band above the prompt shows it while a run is going. |
| `/relay:forecast [plan]` | Agents, worktrees, parallel lanes, usage windows and hours for a plan, before you run it. |
| `/relay:lanes [plan]` | The blueprint: which tasks share a lane and which lanes run in parallel, wave by wave. |
| `/relay:marathon <plan> <hours> [terminal]` | Runs the plan unattended across usage windows, as a background task or in its own Terminal window. |
| `/relay:marathon status \| stop [now]` | Where a marathon is (leg, wait, last outcome, ledger tail), or end it. |
| `/relay:calibrate [plan]` | Learns your account's real usage and speed from a finished run; without a plan, shows the current calibration. |
| `/relay:budget` | The 5-hour and weekly level relay routes by: normal, tight or critical. |
| `/relay:relay-teach <question>` | Uses the shared teaching skill to explain a topic from evidence in the current conversation. |
| `/relay:relay-reverse-engineer <system>` | Uses the shared reconstruction skill to explain mechanisms, constraints and rationale from evidence. |

Commands that operate on an existing plan use the newest plan in `docs/relay/plans/` when you omit its path. The usual path is `/relay:plan` → read the plan → `/relay:run` (or `/relay:marathon` when it spans more than one window) → `/relay:status` while it runs. Plain words work too: "plan this with relay", then "run it". Teaching and reconstruction take a question or subject instead of a plan.

### Skills

Relay contains **20 shared skills**: 13 public entry points and 7 engines or supporting skills. Both hosts load the same source instructions.

The session-start hook loads `using-relay`. Before responding or acting, the lead checks the request and conversation context, then loads an applicable Relay skill. You do not need to name Relay or invoke a skill explicitly. The lead checks again when the task changes and preserves your instructions, scope, and existing authorization. Assigned workers follow their role and task. Selection is model-driven; it depends on skill discovery and the bootstrap being loaded by the host.

| Kind | Skill | Used when |
|---|---|---|
| Entry point | `relay-design` | Designing architecture, comparing approaches, or preparing maintained architecture documentation. |
| Entry point | `relay-plan` | Turning a request, spec, or accepted design into a plan. |
| Entry point | `relay-to-tickets` | Turning an existing plan, spec, or agreed discussion into tickets for people or agents. |
| Entry point | `relay-run` | Starting a plan run. |
| Entry point | `relay-status` | Checking a run's progress, budget and rulings. |
| Entry point | `relay-board` | Showing task status in chat and a browser. |
| Entry point | `relay-forecast` | Estimating a plan's agents, worktrees, usage and time. |
| Entry point | `relay-lanes` | Inspecting a plan's lanes and waves. |
| Entry point | `relay-marathon` | Running a plan across usage windows. |
| Entry point | `relay-calibrate` | Learning usage and time rates from completed work. |
| Entry point | `relay-budget` | Reading the current usage level. |
| Entry point | `relay-teach` | Independent interactive teaching in the current conversation. |
| Entry point | `relay-reverse-engineer` | Independent interactive reconstruction of an existing system. |
| Engine/support | `using-relay` | Selecting a workflow and applying shared language, budget and dispatch rules. |
| Engine/support | `plan-with-tiers` | Writing task tiers, risks, files, test budgets and done checks. |
| Engine/support | `run-lanes` | Executing waves, reviews, fix loops, merges and the final review. |
| Engine/support | `qa-mindset` | Writing, running or reviewing tests. |
| Engine/support | `research-and-explain` | Applying shared request, evidence, helper and teaching rules for both research roles. |
| Engine/support | `handoff` | Recording implementation state for a later session. |
| Engine/support | `relay-setup` | Installing relay or checking routing, discovery and hooks. |

### Agents

| Agent | Tier | Job |
|---|---|---|
| `scout` | cheap | Finds files, symbols and call sites. Returns paths and line numbers, never whole files. |
| `implementer-fast` | cheap | Transcribes code the plan already contains. Stops when the plan is unclear. |
| `implementer` | mid | Builds a lane task by task in its worktree, one commit per task. |
| `implementer-deep` | strong | Hard tasks, and fix rounds 4 and 5 when others got stuck. |
| `test-author` | mid | Writes acceptance tests from the spec without reading the implementation. |
| `reviewer` | mid | Read-only. Reviews a lane per task against the spec, and audits its tests. |
| `architect` | strong | Collaborates on architecture, researches alternatives, writes plans, and reviews designs or the finished branch. |
| `conductor` | mid | Runs a whole plan, so coordination happens on Sonnet. |
| `teacher` | mid | Teaches from supplied material, independent research, or an optional handoff. Project code is read-only. |
| `reverse-engineer` | mid | Reconstructs mechanisms, constraints and rationale from evidence. Project code is read-only. |

Implementation workers write their full reports to files and return at most eight lines: a status (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT` or `BLOCKED`), its commits, its test counts, the report path and any concern. The conductor's context stays small however long the run.

### Hooks and the mod

| Piece | Runs in | What it does |
|---|---|---|
| `session-start` | Claude Code, Codex | Loads the `using-relay` rules and the current budget level into every new session. |
| `retest-guard` | Claude Code, Codex | Refuses a test command on code that has not changed since its last run. |
| `protect-tests` | Claude Code, Codex | Refuses edits, from editors or the shell, to protected acceptance tests. |
| mod (`hooks/register.ts`) | Claude Code | Model routing, budget readings, budget caps, putting `lane-*` agents into their worktrees, and the board's band and pane. |

All hooks fail open: if one crashes, the tool call goes ahead as if relay were not installed.

### The `relay` command

```text
relay lanes <plan> [--write]                  validate a plan, show lanes and waves, write briefs
relay forecast <plan>                         agents, worktrees, usage windows and hours the run will take
relay board <plan> [--html] [--open]          traffic lights for every task, lane and wave; the roadmap page
relay marathon <plan> --hours N [--dry-run]   run the plan unattended across usage windows
relay marathon <plan> --status | --stop [--now]  where a marathon is, or end it
relay calibrate <plan> | --show               learn real usage and time rates from a finished run
relay worktrees sync <plan> --wave N          create or reuse lane worktrees from the integration head
relay worktrees pack <plan> <lane> [--from]   review package for a lane, or for a fix
relay worktrees pack <plan> --final           package of the whole branch for the final review
relay worktrees merge <plan> --wave N --suite merge a wave, then run the full suite once
relay worktrees status | clean <plan>         what each lane is doing; remove the worktrees
relay ledger <plan> ["line"] [--rulings]      the run's memory on disk
relay protect add | remove | list <paths>     acceptance tests the implementers may not change
relay budget [--codex] [--json]               5-hour and weekly level: normal, tight, critical
relay build [--check]                         regenerate agents and hooks for both tools
relay setup claude | codex                    project settings and discovery (--plugin: native Codex hooks)
relay doctor --harness codex                  read-only executable, resource, discovery and hook diagnostics
```

Claude runs these for you; the commands above are the ones worth calling yourself. Mechanical work runs in this command and costs no tokens: checking plans, grouping lanes, managing worktrees, building review packages.

## Configuration

Shared model tiers, Claude budget policy, lane limits and common forecast weights live in [config/routing.json](config/routing.json). This excerpt shows the main settings:

```jsonc
{
  "tiers": {
    "cheap":  { "claude": { "model": "haiku",  "effort": "low" },    "codex": { "model": "gpt-6-luna",  "effort": "low" } },
    "mid":    { "claude": { "model": "sonnet", "effort": "medium" }, "codex": { "model": "gpt-6.1-sol", "effort": "medium" } },
    "strong": { "claude": { "model": "opus",   "effort": "high" },   "codex": { "model": "gpt-6-astra", "effort": "high" } }
  },
  "unrouted": { "general-purpose": "mid", "claude": "mid", "Plan": "mid", "Explore": "cheap" },
  "budget": {
    "fiveHour": { "tight": 60, "critical": 85 },
    "sevenDay": { "tight": 80, "critical": 95 },
    "tight":    { "capStrongTo": "mid", "exempt": ["architect"] },
    "critical": { "capStrongTo": "mid", "denyNewSpawns": ["implementer", "implementer-fast", "implementer-deep", "test-author"] }
  },
  "lanes": { "maxLaneTasks": 6, "maxParallelLanes": 4 }
}
```

To change which tier a role uses, edit its file in `roles/`. After role or shared routing changes, run `node bin/relay build`. It regenerates `agents/`, `codex/` and the marked routing block in `hooks/register.ts`. Edit the source files, then rebuild; do not edit those generated outputs by hand.

Codex also uses [codex-math/config/codex-routing.json](codex-math/config/codex-routing.json) for its role registry, window policy and forecast priors, plus [codex-math/config/codex-harness.json](codex-math/config/codex-harness.json) for harness data. These files are maintained separately; `relay build` does not generate the Codex role registry from the shared tiers. The integration reads shared Codex model tiers at runtime, while the Codex spawn hook combines them with the separate role registry and budget policy. Keep a role's registry entry aligned when its tier changes. See the [configuration guide](docs/configuration/README.md) for the source boundaries and defaults.

`maxParallelLanes` is limited more by your machine than by relay: each lane may run its own dev server, database or test ports. Four is a safe start.

## FAQ

**Do parallel agents save tokens?**
No. Anthropic measured multi-agent systems using about 15 times the tokens of a chat. Lanes save time. Tokens are saved by running most work on Sonnet and Haiku, keeping each agent's context small, and never doing the same work twice.

**Will relay change the model of my main session?**
No. Your session stays on the model you chose. Relay routes the helper agents, and it recommends keeping one model and effort for the whole session, because switching mid-session re-reads the whole conversation without the cache.

**Is the conductor required?**
No. The main session can run the `run-lanes` skill itself. The conductor exists so coordination runs on Sonnet when your session runs on Opus.

**What if relay has a bug?**
Its hooks fail open, and `/plugin` disables relay completely.

**Can I use it with superpowers?**
Yes, with one caveat. superpowers' test-driven development skill asks for a failing test before every change, and relay sets a test budget per task, so their testing advice disagrees. superpowers' brainstorming and debugging skills work well next to relay.

**Do I need Codex?**
No. Codex support is for teams that use both tools, or that want a second model family to review the first one's work.

**What does "the plan contains the complete code" mean?**
For a mechanical task, the architect can write the exact code into the plan. The task then becomes transcription plus a check, which Haiku does well. This is where the biggest savings come from, so the architect is asked to do it wherever it is practical.

## Status and roadmap

Package version **0.5.0**. The repository defines **10 roles** and **20 shared skills**. Automated checks cover the CLI, hooks, generated artifacts and Claude mod. See the [testing guide](docs/testing/README.md) for the current check results and their limits. Source checks do not establish plugin discovery, hook trust or live teaching behavior on either host.

A first pilot (October 20, Claude Code 2.1.303) ran a 3-task plan from `/relay:plan` to a merged, reviewed integration branch: lane agents landed in their worktrees by name, each role ran on its planned model, and the run produced its first calibration sample. One sample is not a rate; more pilots are the next step.

Still to confirm on a real install:

- [x] An agent started as `lane-a` lands in its lane's worktree ([spikes/worktree-lanes.md](spikes/worktree-lanes.md)).
- [ ] A resumed lane agent (fix rounds 1–3) stays in its worktree.
- [ ] The board's band and pane draw in a live Claude Code session (mod tests cover the terminal and desktop surfaces).
- [ ] An installed Codex session discovers the candidate roles and trusts and executes its hooks.
- [ ] The Codex model names in `config/routing.json` match the current ones (they change often).
- [ ] Teaching and reverse-engineering scenarios A–H run on both hosts; all remain **UNEXECUTED** in the [evaluation record](docs/relay/evaluations/2026-10-25-teaching-and-reverse-engineering.md).
- [ ] Installed design-skill selection, native architect use, external research, helper limits, and the full planning handoff run on both hosts. An isolated exercise passed; the [design evaluation](docs/relay/evaluations/2026-10-30-architect-design.md) lists the remaining live scenarios.

Codex budget reads now attempt `account/rateLimits/read` through the app-server RPC before using the separate snapshot and rollout fallbacks. Availability still depends on the selected executable and account.

Next:

- Codex taking reviews during a marathon's waits, so the other window is not idle;
- diff-scoped mutation testing as one `relay` command;
- cost measurements on real plans, with and without relay.

Issues and pull requests are welcome.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines and the [development guide](docs/guides/development.md) for the source and generation workflow.

```bash
npm test                          # unit and integration tests, against real git repositories
node bin/relay build --check      # generated files are in sync, skills are portable
claude plugin validate . && claude plugin test .
```

Edit `roles/` and `config/routing.json`, then run `relay build`. The files in `agents/` and `codex/` are generated. [AGENTS.md](AGENTS.md) has the rules for agents working on relay itself, and [docs/design.md](docs/design.md) the research and sources behind each decision.

### Releasing

For an intentional release, update `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json` together. Keep the RPC client version in `lib/codex-rpc.mjs` aligned. Verify version agreement before tagging or publishing, and use release commands supported by the installed host. Editing this checkout alone does not refresh a cached plugin; verify the installed release and follow the host's supported update and restart workflow.

## Credits

Relay borrows its best mechanics from [superpowers](https://github.com/obra/superpowers): plans as the single source of decisions, a ledger on disk that survives compaction, the worker status protocol, review packages, and bounded fix loops with escalation.

## License

Apache 2.0. See [LICENSE](LICENSE).
