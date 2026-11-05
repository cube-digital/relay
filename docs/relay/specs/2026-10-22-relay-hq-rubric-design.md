# Relay HQ, second design: a RUBRIC-style command centre and Recos

**Status:** design approved in conversation on 2026-10-22; this spec is the written version for review.
**Scope:** a redesign of relay HQ (`docs/relay/specs/2026-10-21-relay-hq-design.md`) after Jay E.'s RUBRIC Agentic OS. It has three parts:

- a new Home laid out as a dashboard;
- a Skills Deck that launches with per-card model and effort;
- a new **Recos** page.

The other views keep their structure and take the new look.

**Approved mockups:**
- `docs/relay/mockups/hq-home.html`
- `docs/relay/mockups/hq-recos.html`

They are static, with illustrative data. Where they disagree with this spec, the spec wins.

## 1. Why

The first HQ design works but reads as a list of sections. Jay's layout is easier to read and to use:

- one dark page with panels;
- everything that needs you on the right;
- what is running in the middle;
- one accent colour;
- the whole system reachable from a ring of buttons around a central visual.

His Recos app turns what the system notices into cards that you add to a cart and apply in one go. Relay already knows most of what such cards need: routine findings, deferred minors, skipped pieces, missing keys, and broken skill links.

### Success criteria

1. **From Home alone, without scrolling on a 1440×900 screen, an engineer sees:**
   - what is waiting on them;
   - today's timeline;
   - each running plan's agents;
   - their routines and their Skills Deck;
   - a way into every section.
2. **Starting a pinned command or skill** takes two clicks: ▶, then Start in the launch dialog. The dialog is prefilled with that card's harness, model and effort.
3. **Recos** lists what relay found to improve, each with its benefit, what relay can do, effort, priority and cost. Several can be applied together through one confirmation.
4. **The palette** is greys plus one light-blue accent, with red only for blocked or failed states.

## 2. Constraints

From AGENTS.md and the earlier specs; not up for change here.

- **No dependencies, no CDN, no web fonts.** Everything works offline.
- **Rendering is text-only** through `lib/hq/ui/dom.js` (`h`, `fill`). No HTML sinks, and the static-files test keeps checking it.
- **No explanatory copy on any page.** Labels are terse; users are engineers.
- **Facts come from disk and the CLI.** Recos are built deterministically from relay's own files, with no model involved.
- **Every action that runs something goes through the launch dialog,** with the exact commands shown. The browser sends intents (ids), never commands.
- **Both harnesses**, as before. The orb and the mascots are drawn with canvas and inline SVG, with no images.
- **Motion:**
  - the orb rotates;
  - running bars shimmer;
  - `prefers-reduced-motion` stops all of it.

## 3. Decisions made in the conversation

| Question | Decision |
|---|---|
| Direction | Take Jay's RUBRIC layout and fit it to relay's data |
| Colours | Fewer colours: greys plus one light-blue accent (`#7cc8ff`); red only for blocked or failed |
| Home | Three columns: Projects and Today on the left; a centre with the wordmark, the orb with a ring of section buttons, and Running now as an agents panel; Waiting on you, Routines and the Skills Deck on the right |
| Recos | A page of recommendation cards with areas, priority, cart and Apply, built from relay's own data |

## 4. Look

### 4.1 Tokens

Defined on `:root`, dark by default:

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#090909`, with a faint radial `#0f1216` at the top | `#f5f6f8` |
| `--panel` | `#0f0f0f` | `#ffffff` |
| `--line` / `--line2` | `#222` / `#2c2c2c` | `#e3e6ea` / `#d5dae0` |
| `--ink` / `--ink2` / `--mute` | `#efece6` / `#a19c93` / `#6f6b64` | `#14171c` / `#4a525c` / `#7a838d` |
| `--accent` / `--accent-2` | `#7cc8ff` / `#a8dbff` | `#1f6fae` / `#2b7fc4` (AA on white) |
| `--red` | `#ff5c5c` | `#c62828` |

- **Project avatars** use one neutral tile. A project with something waiting gets the accent tile.
- **The per-project colour palette from the first design is removed.**

### 4.2 Type and components

- **Panel headings:** uppercase, `letter-spacing: .24em`, 13px, bold, after a small outlined icon.
- **Times, tags, counts and model labels:** `ui-monospace`.
- **Tags:** monospace, 9–10px, uppercase, outlined. The accent variant marks next and selected; red marks blocked and failed.
- **Mascots:** a 9×8 pixel critter drawn as inline SVG, with a hat that depends on the role's `kind`:

  | `kind` | Hat |
  |---|---|
  | planner | helmet |
  | builder | cap |
  | reviewer | visor |
  | coordinator | flag |
  | finder | none |

  The body is grey; while the agent is working, it is drawn in the accent.
- **The orb:** a canvas sphere of about 900 grey dots and an inner core of accent and white particles. The number of core particles scales with the running lanes (none when idle). It rotates slowly and is static under reduced motion.

## 5. Home

### 5.1 Top of the centre column

- **The wordmark** `RELAY` with `Command Centre` in the accent, above a small subline: `git config user.name` · `relay HQ`.
- **An icon row:**
  - **Search:** a palette over projects, repositories, plans, skills and recos, opened with `/`;
  - **Add repository:** the existing dialog;
  - **Run a skill:** the launch dialog;
  - **Budget:** the 5h and 7d readings in a popover.

### 5.2 Left column

- **PROJECTS:**
  - one row per project: tile with initials, name, and one status line (repos, running wave, `N blocked`, `CI red`, `ready to merge`), with the red parts in `--red`;
  - Unassigned last;
  - **Expand** opens the Projects page; **+ Add repo** opens the add dialog.
- **TODAY:** a timeline for the local day. Each row has a time, text and a tag. Sources:
  - routine runs, done or scheduled today, with their outcome tag;
  - launches started and ended;
  - ledger lines that matter: `start:`, `wave N: merged`, a blocked lane, `plan: complete`.

  The row closest to now has its time in the accent. **Week** opens the Routines week grid.

### 5.3 Centre

- **The orb** (4.2), with the waiting-on-you count and its label in the middle.
- **The ring:** 14 round section buttons evenly spaced around the orb, each with its count underneath and a tooltip:
  - Projects, Plans, Board (the latest running plan's board);
  - Team, Flows, Pieces, Skills, Connectors, API keys;
  - Routines, Launches, Activity;
  - Recos, Budget.

  A button gets the accent ring when its section needs attention: Board with a blocked lane, Recos with high-priority items, Keys with a missing key, Routines with new findings. The ring replaces the top pill navigation on Home.
- **RUNNING NOW** is the agents panel, one per running plan. With several plans, a tab per plan sits above it.
  - **Four KPI tiles:**
    - Green `x/y`;
    - Wave `n / m`;
    - Lanes `running · finished · planned`;
    - Time since the ledger's `start:` line.
  - **Groups** Running · n, Finished · n and Planned · n. Each lane segment shows:
    - its mascot;
    - the current task (`T15 Tenant switching`), or the lane's tasks when it is planned;
    - its role title, lane, model and effort (from routing);
    - progress as tasks done out of the lane's tasks, or the fix round;
    - a status tag: elapsed time, `blocked`, or ✓.
  - **Buttons:** Board and Team.
  - **With nothing running:** `Nothing is running.` and a **Run a skill** button.
  - Tokens and cost per agent are left out here, because only the Claude Code mod sees them.

### 5.4 Right column

- **WAITING ON YOU:**
  - the count, large, in the accent;
  - the five newest items, each with an outlined square icon (red for blocked, failed or CI, grey otherwise), bold text, the repository, and the relative time;
  - **Today's mix:** a segmented bar by kind with monospace counts;
  - each row opens its target.
- **ROUTINES:**
  - a table with the columns TIME, ROUTINE (with scope), ON (harness tag) and STATUS (`NEXT`, `QUEUED`, `TOMORROW`, `n NEW`, `FAILED`);
  - today and the next scheduled run of each instance, with the next one's time in the accent;
  - **All** opens Routines.
- **SKILLS DECK:**
  - a two-column grid of cards. Each card has `/name`, `MODEL · EFFORT` in monospace, and three buttons:
    - **▶** opens the launch dialog prefilled with the card's harness, model, effort and action;
    - **⚙** sets the card's harness, model and effort;
    - **⧉** copies the command.
  - **+ Add skill** pins a relay command or any skill from Brain → Skills.
  - The deck is stored in `<relayHome>/hq/deck.json` (`{ version: 1, items: [{ kind: "command"|"skill", id, harness?, model?, effort? }] }`).
  - When the file is missing, the default deck is `/relay:plan`, `/relay:run`, `/relay:marathon`, `/relay:connectors`, `qa-mindset` and `handoff`, each with its routing tier as the default model and effort.
  - The launch dialog validates the card's model and effort against `routing.json`, as today.

## 6. Recos

### 6.1 Where recos come from

Each source is read deterministically, with no model involved. A source that cannot be read is skipped and does not break the page.

| Area | Source | One reco per |
|---|---|---|
| Brain | `gh` not installed or not signed in | machine |
| Brain | API keys with status `missing` or `in-file` | key |
| Brain | connectors that need auth | connector |
| Brain | broken skill symlinks found by the skills scanner, which now records them instead of only skipping them | skills folder |
| Brain | routine instances marked `stale path` | instance |
| Repos | open, undismissed pr-hygiene findings | finding kind and repository |
| Runs | `deferred minor` lines in the ledgers of complete plans, grouped | plan |
| Runs | pieces skipped at `final` because a `requires` was missing (for example `requirements-check`) | plan and piece |
| Routines | weekly-report suggestions not yet created | suggestion |

### 6.2 A reco

```json
{
  "id": "repos:<rid>:relay-branches",
  "area": "repos",
  "title": "Delete 21 leftover relay branches",
  "benefit": "Three finished plans stop showing as ready to merge, and pr-hygiene stops reporting them.",
  "action": "Run the two quoted git branch -D commands pr-hygiene found.",
  "effort": "low",
  "priority": "mid",
  "cost": { "tokens": 0 },
  "refs": ["relay/relay-hq/*", "relay/relay-flows-team/*"],
  "apply": { "kind": "command", "commands": ["git -C '/…' branch -D 'relay/relay-hq/integration' …"] },
  "source": "pr-hygiene@relay"
}
```

- **Ids are stable** across rebuilds, so done and skipped states survive.
- **Titles, benefit and action** come from fixed English templates per source, filled with counts and names. The text is terse, with no explanations.
- **`apply.kind`:**
  - `command`: one or more commands relay builds on the server, run through the launch machinery at zero tokens;
  - `plan`: contributes a goal line to a `/relay:plan` launch on the `bugfix` flow. `cost` carries the forecast estimate, a share of the 5h window;
  - `routine`: enables a routine template and scope, through the routine dialog;
  - `manual`: copy only, for things relay must not do for the user, such as `gh auth login`.
- **Priority:**
  - `high` for anything that blocks a relay feature (`gh` missing, a missing needed key, a broken required piece);
  - `mid` for cleanup that changes what Home shows;
  - `low` otherwise.

  Order is priority, then area, then newest. The **Priority** view lists `high`, plus `mid` items that cost zero tokens, at most 6.

### 6.3 State

`<relayHome>/hq/recos.json` holds `{ done: { id: at }, skipped: { id: at }, cart: [id] }`.

- **Done:** set by the user, or automatically when a later rebuild no longer produces the reco.
- **Skipped:** hides the reco until its source changes. A changed count produces a new id suffix.

### 6.4 The page

- **Top bar:**
  - ← Home;
  - Search (`/`), which filters titles and refs;
  - a Cards / List toggle;
  - **Cart** with a count;
  - **Apply n** in the accent.
- **Left nav:** Priority; then AREAS (Repos, Runs, Routines, Brain) and STATE (Done, Skipped), each with a count.
- **Header:**
  - the logo and `RELAY RECOS`;
  - the team's mascots (the working ones in the accent);
  - a stats line: total, per area, how many cost zero tokens, when the list was built and from what.
- **Cards:**
  - a 3px left border: accent for high or mid, red when the reco unblocks something;
  - a top area on a dotted background with the area label, the `#rank` and a glyph;
  - the title, `What's the benefit`, and `What I can do`;
  - chips: Effort, Priority, and the cost (`0 tokens` or `~n% of 5h`);
  - ref chips in monospace;
  - buttons:
    - Add to cart or In cart ✓;
    - Skip;
    - Copy and Done for `manual` recos.
- **The List view** shows the same data in one row per reco.
- **The cart panel** lists the selected recos with their kind. **Apply** opens the launch dialog with:
  - each `command` reco's exact commands, as separate launches that run no model;
  - one `/relay:plan` launch on the `bugfix` flow, whose goal joins the selected `plan` recos' goal lines. The harness, model and effort are chosen in the dialog, as for every plan launch;
  - `routine` recos, which open the routine dialog after confirmation.

  Nothing runs before Start. Commands that delete something (`git branch -D`) are listed under a **Deletes** heading in the dialog.

## 7. The other pages

The Projects, Plan board, Brain tabs, Routines and Launches pages and the dialogs keep their structure. They take the tokens, type and components above.

- **Instead of the pill navigation,** a slim top bar holds ← Home, the breadcrumb and the budget.
- **The ring appears only on Home.**
- **The per-project colours of the first design are removed everywhere.**

## 8. API

| Method and path | Returns or does |
|---|---|
| `GET /api/home` | extended with `today` (timeline rows), `running` (per plan: KPIs and lane segments with role identity, model, effort, progress, status), `ring` (counts and hot flags), and `deck` |
| `GET /api/deck` | the deck |
| `POST /api/deck` | `add`, `remove`, `set` (harness, model, effort per item; validated against `routing.json`) |
| `GET /api/recos` | the recos with state, the counts per area and state, and `builtAt` |
| `POST /api/recos` | `done`, `skip`, `unskip`, `cart-add`, `cart-remove`, `cart-clear` (ids only) |
| `POST /api/recos/apply/preview` | the launch intents for the cart: commands, the plan goal and flow, routines; starts nothing |
| `POST /api/recos/apply` | the same intents plus `confirm: true`: starts the launches |

All POSTs keep the token, Host, Origin and JSON checks. Apply takes reco ids only, and the server rebuilds every command from the reco sources at apply time. A reco that no longer exists is refused.

## 9. Errors

| Situation | Behaviour |
|---|---|
| Nothing is running | Running now shows `Nothing is running.` and Run a skill |
| `deck.json` missing or invalid | the default deck; an invalid file is kept as `deck.json.bad` |
| A deck item names a skill that no longer exists | the card shows `missing`, and ▶ is disabled |
| A reco source cannot be read | that source is skipped; the stats line names it |
| Apply with a reco whose source changed since it was added to the cart | it is refused with `changed, refresh`; the other recos still apply |
| The canvas is unavailable | the orb area shows the waiting count only |

## 10. Testing

The approach follows qa-mindset: few tests that catch real bugs, real git repositories, fake `HOME` and `RELAY_HOME`. About 5 tests:

1. **The recos builder.** From fixtures: a pr-hygiene finding, a ledger with deferred minors on a complete plan, a skipped `requirements-check`, a missing key, a broken skill symlink, a stale routine path.
   - It produces the expected areas, priorities and stable ids.
   - Rebuilding without a source marks that reco done.
2. **Recos state:** done, skip and cart persist across server restarts. A changed source yields a new id.
3. **Apply security:** with a crafted body, a reco id that does not exist, a `command` field, or a changed source, the request is refused. The preview of a valid cart contains only server-built commands, and one plan intent on the `bugfix` flow.
4. **The deck:**
   - `set` refuses a model or effort outside `routing.json`;
   - the default deck appears when the file is missing;
   - ▶'s launch preview uses the card's harness, model and effort.
5. **Home data:** `GET /api/home` on a repository with a running plan returns `today` rows in time order and `running` lanes with role identity and progress matching the board.

The existing static-files and no-native-DOM assertions cover the new UI files. The views are checked by hand in a browser at 1440×900 and at narrow width, dark and light, with reduced motion on.

## 11. Out of scope

- Token and cost figures per agent in HQ (only the Claude Code mod sees them).
- Comments on recos, Jay's "Apply all comments".
- Reordering the Skills Deck by dragging.
- Recos written by a model.
- A 3D graph of the repository's files (Jay's second brain).
- Keeping per-project colours.
