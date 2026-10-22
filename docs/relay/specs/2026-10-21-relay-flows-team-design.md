# Relay flows and the team: building blocks around the lane chassis

**Status:** design approved in conversation on 2026-10-21; this spec is the written version for review.
**Scope:** sub-projects C (flows as building blocks) and D (the team) of the relay HQ roadmap (see `docs/relay/specs/2026-10-21-relay-hq-design.md`, "Later sub-projects"). Sub-projects E (project contract) and F (routines) get their own specs.

## 1. Why

Relay's pipeline is fixed today. `skills/run-lanes/SKILL.md` spells out one sequence in prose:

1. test-author;
2. implementer;
3. reviewer;
4. fix rounds;
5. merge;
6. final review.

`config/flow.json` only describes that sequence for HQ's drawing. To add a step or an agent, someone has to edit that prose, and every plan runs the same steps, whether it is a feature or a bug fix.

The goal is to keep Alex's logic exactly as it is and make it extensible:

- roles with a tier;
- the tier choosing model and effort per harness;
- lanes, reviews and bounded fix loops;
- one suite run per wave.

New pieces, and new team members to own them, plug into that logic.

### Success criteria

1. **A new step needs no edit to `run-lanes`.** Adding a step such as a platform review after implementation, or a requirements check at the end, means one piece file and one line in a flow file. `relay build --check` validates both.
2. **A plan chooses its flow.** `feature` and `bugfix` ship; others are new files.
3. **Every role has an identity:** a title, an avatar, a colour, a kind and a four-part profile. The team is visible:
   - live in Claude Code, through the mod: who is working on which lane, on which model, with how many tokens;
   - in HQ: the team, the flows with their pieces, and each piece's result on the board.
4. **The team gains two roles:** Business Analyst (requirements before the plan, and a requirements check at the end) and Platform Engineer (infra, CI/CD, deploy and observability tasks, plus a deployability review).
5. **Model and effort still come only from the role's tier** through `config/routing.json`, and the budget caps apply to pieces as to every other spawn.

## 2. Constraints

From AGENTS.md and the existing design; not up for change here.

- **Alex's chassis stays.** Worktrees, the implement → review → fix loop (rounds 1–3 same agent, 4–5 implementer-deep), the wave merge with one suite run, the final architect review, rulings and the ledger keep their behaviour.
- **Pieces add around the chassis; they never replace it.**
- **Pieces are data; the CLI decides what applies.** A model executes the piece; it never decides whether a piece runs.
- **A piece never picks a model.** It inherits its role's tier: model, effort and budget caps, both harnesses.
- **Both harnesses.** Claude Code and Codex run every flow; only the live team pane is Claude-only (Codex has no mods).
- **No dependencies.** Hooks and mod hooks fail open. Skills keep `name` + `description` frontmatter only.
- **Generated files stay generated.** Agents, `codex/**` and the mod's `<relay:generated>` block come from `relay build`.
- **Old plans keep working.** A plan without `flow` runs as `feature`.

## 3. Decisions made in the conversation

| Question | Decision |
|---|---|
| What must building blocks allow? | Both: insert pieces at fixed points of the existing pipeline, and compose different whole flows from the same pieces; each plan picks its flow |
| New roles in this version | Business Analyst, Platform Engineer (QA and Security come next, as pieces) |
| Identity | Title + avatar (two initials) + colour + profile (Understands, Receives, Delivers, Never); no invented personal names |
| Authoring | Files plus CLI (`relay role new`, `relay piece new`, `relay flow add`); HQ draws them and copies commands; a visual editor comes later |
| Execution model | Fixed points around the unchanged chassis; `relay flow at` resolves the pieces that apply |
| Model and effort | Unchanged: the role's tier through `config/routing.json`; pieces inherit it |

## 4. Pieces, points and flows

### 4.1 Files

| Path | What it is |
|---|---|
| `roles/<role>.md` | a team member: tier, tools, identity, profile, instructions (exists; section 6 extends it) |
| `pieces/<piece>.json` | a reusable building block |
| `flows/<flow>.json` | a flow: which pieces sit at each point |

`config/flow.json` is removed; its content becomes `flows/feature.json`. HQ's wiring view reads `flows/`.

### 4.2 Points

Six named points sit around the chassis, in run order:

| Point | When | Runs in |
|---|---|---|
| `plan.before` | after the spec, before the architect writes the plan | `/relay:plan` |
| `plan.after` | after `relay lanes` accepts the plan | `/relay:plan` |
| `lane.before` | per lane, before its implementer | run-lanes, each wave |
| `lane.after` | per lane, after its implementer returns DONE, next to the reviewer | run-lanes, each wave |
| `wave.after` | after the wave's merge and suite | run-lanes, each wave |
| `final` | next to the architect's final review | run-lanes, finish |

### 4.3 A piece

```json
{
  "id": "platform-review",
  "title": "Deployability review",
  "role": "platform-engineer",
  "slots": ["lane.after"],
  "skills": [],
  "when": { "any": [ { "files": ["infra/**", ".github/workflows/**", "**/Dockerfile", "**/*.tf", "k8s/**", "deploy/**"] }, { "tags": ["infra"] } ] },
  "requires": [],
  "brief": "Review the lane's changes for deployability: rollout and rollback, secrets and configuration, reversible migrations, and logs, metrics and health checks for what was added. Do not edit files.",
  "output": "{run}/lane-{lane}.platform-review.md",
  "gate": "blocking",
  "readonly": true
}
```

**Fields:**

- **`id`:** kebab-case and the file name.
- **`title`:** shown in HQ and in the ledger.
- **`role`:** a role in `roles/`. It sets the model, effort and tools.
- **`slots`:** the points where the piece may be placed.
- **`skills`:** skill folders the agent is told to use. They must exist in `skills/`.
- **`when`:** conditions, all of which must hold; `{ "any": [...] }` groups alternatives. They are evaluated per lane at lane points, and per plan at plan, wave and final points. Missing means always. The keys:
  - `risk`: a list; a lane matches when its riskiest task is in it;
  - `tier`: a list; any task in it;
  - `testsAtLeast`: the lane's new-test budget is at least this;
  - `files`: globs; any task file matches;
  - `tags`: any task carries one.
- **`requires`:** paths with `{slug}` and `{run}` that must exist. When one is missing, the piece is skipped and the skip is ledgered.
- **`brief`:** the piece's instruction. It is written into the piece's brief file together with the lane brief path, the spec, and the outputs it can read.
- **`output`:** where the agent writes its report. Placeholders: `{slug}`, `{run}`, `{lane}`.
- **`gate`:**
  - `blocking`: a lane piece's Critical/Important findings enter that lane's existing fix loop, the same rounds and escalation as a reviewer's. A plan-point piece must produce its output before the next step. A `final` piece's findings join the single final fix dispatch.
  - `advisory`: the findings are ledgered as `deferred` and listed in the final report.
- **`readonly`:** the piece must not commit (see 4.5).
- **`protect`:** the piece writes tests that later agents must not change. The agent lists the test paths in its return. `relay flow done … --protect <path>…` adds them to the protected tests, as `relay protect add` does today. For a piece with `protect: true`, `flow done` refuses `--status pass` when no path is given.

### 4.4 A flow

```json
{
  "id": "feature",
  "title": "Feature",
  "slots": {
    "plan.before": ["requirements"],
    "lane.before": ["acceptance-tests"],
    "lane.after": ["platform-review"],
    "final": ["requirements-check"]
  },
  "overrides": { "platform-review": { "gate": "advisory" } }
}
```

`overrides` may change a piece's `when` or `gate` inside this flow only. It cannot change the piece's `role`, `slots`, `output` or `readonly`.

**Flows in this version:**

| Flow | `plan.before` | `lane.before` | `lane.after` | `final` |
|---|---|---|---|---|
| `feature` | `requirements` | `acceptance-tests` | `platform-review` | `requirements-check` |
| `bugfix` | — | `reproduce`, `acceptance-tests` | `platform-review` | — |

**Pieces in this version:**

| Piece | Role | Points | When | Gate | Read-only |
|---|---|---|---|---|---|
| `acceptance-tests` | test-author | lane.before | risk medium or high and `testsAtLeast: 1` | blocking | no (writes tests only; `protect: true`) |
| `reproduce` | test-author | lane.before | always | blocking | no (one failing test that shows the bug; `protect: true`) |
| `requirements` | business-analyst | plan.before | always | blocking | no (writes `docs/relay/requirements/{slug}.md` only) |
| `requirements-check` | business-analyst | final | requires `docs/relay/requirements/{slug}.md` | blocking | yes |
| `platform-review` | platform-engineer | lane.after | infra files or the `infra` tag | blocking | yes |

`acceptance-tests` is today's run-lanes step 1.2 ("Tests first for risky lanes") moved into data with the same condition. There is then one mechanism, and a flow that does not want acceptance tests leaves the piece out.

### 4.5 The CLI

```text
relay flow list                                       flows and pieces
relay flow show <flow>                                each point and its pieces, with gate and when
relay flow at <plan> <point> [--lane <id>]            the pieces that apply now
relay flow at --flow <flow> --slug <slug> <point>     the same before a plan file exists (plan.before)
relay flow done <plan> <piece> [--lane <id>] --status pass|findings|blocked --report <path> [--protect <path>...]
relay flow add <flow> <piece> --at <point>            edit a flow file (validated)
relay flow remove <flow> <piece> [--at <point>]
relay piece new <id> --role <role> --slot <point>     scaffold pieces/<id>.json
relay role new <name> --kind <kind> --tier <tier> --title "<title>"   scaffold roles/<name>.md
```

**What `relay flow at` does:**

- Prints one entry per applicable piece:
  - `piece`, `role`, `gate`, `readonly`;
  - `agent`: a stable name, `lane-<id>-<piece>` at lane points and `<piece>` elsewhere. The mod's lane rule moves `lane-<id>-<suffix>` agents into the lane's worktree, so lane pieces work in the right place without new code;
  - `brief`: the path of the brief file it wrote under the run directory;
  - `report`: the resolved `output`.
- `--json` gives the same entries as JSON.
- Skipped pieces (`when` false, a `requires` missing) are listed with the reason, so the conductor and the ledger can say why.
- For each read-only piece it records the lane or integration head it starts from, in `<run>/pieces.json`.

**What `relay flow done` does:**

- Appends a ledger line of a fixed shape: `piece <id>[ lane <lane>]: <status> (<report path>)`. The board, HQ and calibration read that line.
- For a read-only piece, compares the current head with the one recorded at `flow at`. When the head moved, it records `blocked` with the new commit subjects and exits 1, whatever `--status` said.

**`relay build --check` fails when:**

- a flow names a piece that does not exist, or places it at a point not in its `slots`;
- a piece names a role or skill that does not exist;
- a piece has an unknown `when` key, or an output placeholder that is not valid for its points;
- a role lacks its identity fields or profile sections (section 6).

### 4.6 How the chassis runs pieces

`skills/run-lanes/SKILL.md` replaces step 1.2 with one generic rule, used at `lane.before`, `lane.after`, `wave.after` and `final`:

1. Run `relay flow at <plan> <point> [--lane <id>]`.
2. Dispatch every listed piece with its role, as the agent it names, giving it its brief and report paths.
3. Run lane pieces of a wave in parallel with the other lanes, exactly as lane agents are today.
4. When a piece returns, run `relay flow done ...`.
5. Treat a blocking piece's findings like a reviewer's.

`commands/plan.md` gains the same rule for `plan.before` (before the architect) and `plan.after` (after `relay lanes` accepts the plan).

**The flow** is chosen at plan time:
- `/relay:plan` picks `bugfix` when the goal is a defect and `feature` otherwise;
- it passes the choice to the architect, who writes it into the plan;
- the headless prompt from HQ does the same without asking.

The text stays short. Everything about which pieces, where and when is resolved by the CLI.

## 5. Plans choose a flow and roles per task

- **Plans:** the `relay-plan` block gains `"flow": "<id>"`, defaulting to `feature`. `relay lanes` rejects an unknown flow and lists the known ones.
- **Tasks** gain two optional fields:
  - `"role": "<role>"`: the role that implements this task in its lane. It must be a role of kind `builder`; `relay lanes` rejects any other kind. The architect puts `"role": "platform-engineer"` on infra, CI/CD, deploy, configuration and observability tasks.
  - `"tags": [...]`: free labels, such as `infra`, `api` or `ui`, used by pieces' `when`.
- **Segments:** a task with `role` starts its own segment in its lane: same worktree, run in sequence. This extends today's rule that splits strong tasks onto implementer-deep:
  - `segmentsFor` splits on `role ?? (strong ? 'strong' : 'default')`;
  - a segment's role is the task's `role` when set, otherwise `roleFor(...)` as today;
  - `relay lanes` warns when a task's `tier` differs from its role's tier, because the role's tier decides the model.
- **Forecast:** counts the pieces that apply to the plan (resolved with the same `when` logic) with their role's tier weight, so usage and time forecasts include them.
- **Budget:** `config/routing.json` gains `platform-engineer` in `critical.denyNewSpawns`. Business Analyst, a planner, is capped from strong to mid at `tight`, like every role except the exempt architect.
- **The plan-with-tiers skill** (kept short):
  - the architect writes `flow`;
  - puts `role` on infra tasks;
  - may add `tags`;
  - links task behaviours to requirement ids (R1…) when a requirements document exists.

## 6. The team

### 6.1 Identity in `roles/<role>.md`

**Frontmatter** gains, next to the existing `name`, `tier`, `description`, `tools`, `maxTurns` and `color`:

- `title`: a job title, such as "Business Analyst";
- `avatar`: two capital letters;
- `kind`: `planner` | `coordinator` | `builder` | `reviewer` | `finder`.

**The body** starts with a profile of four short sections, then the existing instructions:

```markdown
## Understands
## Receives
## Delivers
## Never
```

The profile is part of the agent's prompt, so it sharpens behaviour as well as describing it.

**`relay build`:**
- checks that every role has `title`, `avatar`, `kind`, `color` and the four sections;
- writes the team's identity (title, avatar, colour, kind and tier per role) into the mod's generated block, so the mod needs no file access;
- for Codex, carries the profile in the agent's instructions.

`color` stays one of the colour names Claude Code accepts for agents. The exact list is verified against the current build (section 9).

### 6.2 The roster

| Role | Title | Avatar | Kind | Tier |
|---|---|---|---|---|
| scout | Code Scout | SC | finder | cheap |
| architect | Software Architect | AR | planner | strong |
| conductor | Delivery Lead | DL | coordinator | mid |
| implementer-fast | Engineer | EN | builder | cheap |
| implementer | Software Engineer | SE | builder | mid |
| implementer-deep | Senior Engineer | SR | builder | strong |
| test-author | Test Engineer | TE | builder | mid |
| reviewer | Code Reviewer | CR | reviewer | mid |
| business-analyst | Business Analyst | BA | planner | strong |
| platform-engineer | Platform Engineer | PE | builder | mid |

The eight existing roles keep their instructions. They gain the identity fields and a profile written from what their instructions already say.

### 6.3 Business Analyst

- **Tools:** Read, Grep, Glob, Bash, Write. It writes only its own documents.
- **Piece `requirements` (`plan.before`, blocking).** From the spec and any documents under `docs/requirements/`, it writes `docs/relay/requirements/<slug>.md`:
  - requirements R1…Rn, each with actor, need and acceptance criteria (Given / When / Then);
  - what is out of scope;
  - open questions, each with the assumption taken.

  The architect receives the document and links task behaviours to R ids.
- **Piece `requirements-check` (`final`, blocking, read-only).** For each R, it records met, partial or missing with evidence: tests, files, behaviours. Missing and partial items join the final fix dispatch.
- **Seed for sub-project E**, which turns this document into the continuously validated requirements appendix.

### 6.4 Platform Engineer

- **Tools:** the builder set (Read, Edit, Write, Bash, Grep, Glob).
- **Implements** tasks with `"role": "platform-engineer"`: infra, CI/CD, deploy, configuration, observability.
- **Piece `platform-review` (`lane.after`, blocking, read-only).** For lanes that touch infra paths or carry the `infra` tag, it checks:
  - rollout and rollback;
  - secrets and configuration;
  - reversible migrations;
  - logs, metrics and health checks for what was added.

  Read-only is enforced by `relay flow done` (4.5).

### 6.5 Adding a role

`relay role new <name> --kind <kind> --tier <tier> --title "<title>"`:

- writes `roles/<name>.md` with the identity fields, an empty profile and a description to fill in;
- picks an avatar from the title's initials and a free colour.

`relay build` then generates its Claude and Codex agents and adds it to the mod's routing. QA and Security are expected to be the next roles added this way, each with a piece.

## 7. Seeing the team

### 7.1 Claude Code (mod)

**What it tracks:**

| Event | What the mod records |
|---|---|
| `agent.spawn` of a `relay:<role>` agent | `{ name, role, title, avatar, color, lane, model, startedAt }`; the lane comes from the `lane-<id>…` name, the model from relay's own routing decision |
| `turn.step` with `e.agentId` | the request's tokens (input, output, cache read and write), added to that agent |
| `turn.complete` with `e.agentId` | the agent finished, with the time |

**The band** above the prompt shows, next to the board's dots, the avatars of the agents working now (coloured initials) and a **Team** button.

**The pane `/relay-team`:**
- agents grouped by lane: avatar and title, agent name, the task it is on (from the board), model, tokens, elapsed time, and working or done;
- with nothing running, the roster.

**Robustness:** tracking is best effort. Every handler fails open, and the existing `agent.spawn` routing and lane-cwd logic are untouched in behaviour. The tracking logic is pure functions covered by `hooks/register.test.ts`.

### 7.2 HQ

- **Brain → Team** replaces the Agents tab:
  - one card per relay role, with the avatar tile in its colour, title, kind, tier, and Claude and Codex model and effort;
  - its profile, expandable;
  - the flows and pieces it appears in;
  - other plugins' agents listed below, as today;
  - a button that copies `relay role new …`.
- **Brain → Flows** keeps "What is generated from what" and "Who uses whom" and replaces the drawn pipeline:
  - a flow selector;
  - the six points around the chassis;
  - pieces as chips in their role's colour, with avatar, a blocking or advisory badge and a summary of `when`;
  - clicking a piece shows its role, brief, output and allowed points;
  - buttons that copy `relay flow add <flow> <piece> --at <point>` and `relay piece new …`.
- **The plan board:**
  - the heading shows the flow;
  - each lane shows its roles' avatars and chips with its pieces' results, read from the `piece …` ledger lines;
  - the task panel lists the pieces applied to its lane.
- **Home → Running now:** the avatars of the roles on each running plan's active lanes.

## 8. Errors

| Situation | Behaviour |
|---|---|
| The plan names an unknown flow | `relay lanes` fails with the list of flows |
| A flow, piece or role refers to something missing, or a role lacks its profile | `relay build --check` fails and names the file and the field |
| A piece's `requires` is missing | the piece is skipped; `flow at` lists the reason; the skip is ledgered |
| A piece's agent returns BLOCKED or NEEDS_CONTEXT | handled as a lane agent today (context, escalation, or a ruling) |
| A read-only piece committed | `flow done` records `blocked` with the commits and exits 1; the conductor rules; nothing is reset automatically |
| `flow at` for an unknown point | exit 64 with the list of points |
| A plan without `flow` | runs as `feature`; plan points do not run again for an existing plan |
| The mod's tracking fails | the spawn proceeds; the pane shows what it has |

## 9. To verify at the start of implementation

- **Mod types for the current build:**
  - how a spawn is tied to its `agentId` (the `agent.spawn` result, or a field on `turn.step` / `turn.complete`);
  - the exact fields of `turn.step` usage and of `turn.complete`.
- **Agent colours:** the colour names Claude Code accepts for agents.
- **Codex:** whether its agent TOML accepts anything beyond `name`, `description`, `model`, `model_reasoning_effort` and `developer_instructions`. If not, identity stays in the instructions.

## 10. Testing

The approach follows qa-mindset: few tests, each able to catch a real bug, using real git repositories through `test/helpers.mjs`.

1. **`relay flow at`.** On a feature plan:
   - the lane that touches `infra/**` gets `platform-review`;
   - a low-risk lane does not get `acceptance-tests`;
   - brief files are written;
   - agent names are stable;
   - a missing `requires` is reported as skipped.
2. **`relay flow done`.** For a read-only piece:
   - a new commit on the lane after `flow at` gives `blocked` and exit 1;
   - no new commit gives the `pass` ledger line in its fixed shape.
3. **`relay build --check`** fails for:
   - a piece with an unknown role;
   - a flow placing a piece at a point outside its `slots`;
   - a role without its profile.
4. **`relay lanes`:**
   - a task with `role: platform-engineer` becomes its own segment with that role;
   - a `reviewer` role on a task is rejected;
   - a plan without `flow` resolves to `feature`.
5. **Forecast:** an added assertion in the existing test, that applicable pieces add work.
6. **Mod** (`hooks/register.test.ts`):
   - spawn → working, `turn.step` tokens accumulate per agent, `turn.complete` → done;
   - the band includes the avatars of working agents.
7. **HQ:** the Team and Flows API returns each role's identity and each flow's points with pieces, in an extended existing test.

The views are checked by hand in a browser, dark and light. Before finishing:

- `npm test`;
- `node bin/relay build --check`;
- `claude plugin validate .`;
- `claude plugin test .` (the mod changes).

## 11. Out of scope

- The QA and Security roles. They come next, added as roles plus pieces with the mechanism built here.
- Spike and migration flows.
- A visual flow editor in HQ.
- Per-agent cost in currency (tokens only).
- A live team view for Codex.
- Routines (F).
- The continuously validated requirements appendix (E), beyond the Business Analyst's document and final check.
