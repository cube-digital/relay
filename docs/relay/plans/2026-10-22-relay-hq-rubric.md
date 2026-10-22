# Relay HQ RUBRIC Plan

**Goal:** Redesign relay HQ after RUBRIC: a three-column dashboard Home with an orb and a ring of section buttons, a Skills Deck that launches with per-card harness, model and effort, and a Recos page that turns what relay notices into cards you add to a cart and apply through one launch dialog.
**Spec:** docs/relay/specs/2026-10-22-relay-hq-rubric-design.md
**Mockups:** docs/relay/mockups/hq-home.html, docs/relay/mockups/hq-recos.html (layout and CSS only; their data is illustrative)
**Architecture:** Data first, views after. `lib/hq/recos.mjs` collects facts from relay's files and builds recos with a pure function; `lib/hq/recos-state.mjs` keeps done, skipped and cart in `<relayHome>/hq/recos.json` and turns a cart of ids into launches whose commands the server rebuilds at apply time. `lib/hq/deck.mjs` keeps the Skills Deck, `lib/hq/home.mjs` computes Today, Running now, the routines panel and the ring, and `lib/hq/server.mjs` wires them into `/api/*`. The UI gets new tokens and components (`app.css`, `dom.js`), a slim top bar, and new modules `home.js`, `orb.js`, `search.js`, `recos.js` and `apply-dialog.js` with their own stylesheets.

## Global Constraints

- Plain Node >= 20, ESM, named exports, no dependencies, no CDN, no web fonts, no images. New files start with a 1–3 line comment saying what they are.
- Never hand-edit `agents/`, `codex/` or the `<relay:generated>` block in `hooks/register.ts`. This plan changes no roles, routing or mod. `node bin/relay build --check` stays green.
- Tests: `node:test` + `node:assert/strict`. They use real git repositories (`tempRepo`, `copyFixture` from `test/helpers.mjs`) and a temp `RELAY_HOME` and fake `HOME` set on `process.env` and restored in `finally`. Test behavior, not implementation (`skills/qa-mindset`). The spec allows about 5 new tests; this plan uses exactly 5 (T1 1, T2 2, T3 1, T5 1).
- UI: all rendering through `h`/`fill` from `lib/hq/ui/dom.js`. No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, and no native `.append(`/`.replaceChildren(` outside `dom.js` (the server test greps for them). `appendChild` on SVG and canvas setup is allowed. Links only through `link()`/`safeHref`. `h` drops `style` attributes (CSP `style-src 'self'`): set sizes through `el.style.x = …` in JS.
- UI copy: terse English labels, no explanations, no teaching text. The words on screen are the ones in the spec and this plan.
- Every file the page loads must be served: `server.mjs` serves every `lib/hq/ui/*.{html,css,js}` by its name, and `test/hq-server.test.mjs` fails when `index.html` or a static `from './x.js'` import names a file that does not exist. A task may only add a static import of a UI module that exists once its dependencies have landed; otherwise use a dynamic `import('./x.js')`.
- POST bodies are intents: the server reads only named fields. Every POST keeps the existing gate (token, Host, Origin, JSON). The browser never sends a command, argv or path to run.
- Motion: the orb rotates, running bars shimmer; `prefers-reduced-motion: reduce` stops both (orb drawn once, no CSS animation).
- Each task's commit subject starts with its id: `T4: Home data`.

#### Fixed names and values (binding for every task)

- **Files:** recos state `<relayHome>/hq/recos.json`; deck `<relayHome>/hq/deck.json` (invalid file renamed to `deck.json.bad`); both written with `writeJsonAtomic` from `lib/routines/store.mjs` after `mkdirSync(join(relayHome(), 'hq'), { recursive: true, mode: 0o700 })`. `relayHome()` from `lib/budget.mjs`.
- **Areas:** `AREAS = ['repos', 'runs', 'routines', 'brain']` (also the sort order). Priorities `['high', 'mid', 'low']`. Effort `'low' | 'mid' | 'high'`.
- **Reco (internal, T1):**
  ```js
  { id, base, area, title, benefit, action, effort, priority, unblocks, cost, refs, apply, source, at }
  // id      = `${base}#${sha1(JSON.stringify(fingerprint)).slice(0, 8)}` (fingerprint below)
  // cost    = { tokens: 0 } | { tokens: null, windowPct: n }
  // refs    = string[] (sorted)
  // apply   = { kind: 'command', run: [{ bin, argv, cwd, deletes }] }
  //         | { kind: 'plan', rid, repo, repoName, goal }
  //         | { kind: 'routine', routine, create: { id, kind, days, at, prompt } }
  //         | { kind: 'manual', copy }
  // source  = the source name (see T1), at = ISO | null
  ```
  Fingerprint: `command` → `run.map(r => [r.bin, ...r.argv])`; `plan` → `goal`; `routine` → `create`; `manual` → `[copy, ...refs]`.
- **Reco (public, `GET /api/recos`):** the internal reco without `base`, `apply.run`, `apply.repo`, with `apply` = `{ kind, commands?: [display], deletes?: [display], goal?, routine?, copy? }` (`commands` the non-deleting displays, `deletes` the deleting ones; display = `displayCommand({ bin, argv, cwd }, 'relay')` from `lib/hq/launch.mjs`), plus `state: 'open'|'done'|'skipped'`, `inCart: boolean`, `rank: n` (1-based among open recos, in order).
- **recos.json:** `{ version: 1, done: { id: ISO }, skipped: { id: ISO }, cart: [id], known: { id: { title, area, source } } }`. `known` holds every id ever built (capped to the newest 500 by insertion) so Done and Skipped can show titles after the reco is gone.
- **deck.json:** `{ version: 1, items: [{ kind: 'command'|'skill', id, harness?, model?, effort? }] }`, at most 24 items, unique by `kind:id`.
- **Deck defaults (T3):** commands `plan` (tier strong), `run` (mid), `marathon` (mid), `connectors` (cheap); skills `qa-mindset` (mid), `handoff` (cheap). Allowed command ids and their tiers: `DECK_COMMANDS = { plan: 'strong', run: 'mid', marathon: 'mid', connectors: 'cheap', 'setup-codex': 'cheap' }`; any other skill's tier is `mid`. Default harness `claude`; model and effort from `modelFor(loadRouting(), tier, harness)`.
- **Launch action for reco commands:** launches started by apply have `action: 'reco'`, `harness: 'relay'`, `model: null`, `effort: null`, and are started with `startLaunch` from `lib/hq/launches.mjs`. Plan recos start through `startFromIntent({ action: 'plan', flow: 'bugfix', … , confirm: true })`.
- **Ledger line regex** (UTC): `/^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: \[[^\]]*\])? (.*)$/`. Text patterns: started `/^start:/`; complete `/^plan: complete\b/`; merged `/^wave (\d+): merged\b/`; deferred `/\bdeferred minors?:\s*(.+)$/i` (anywhere in the text; one minor per matching line); skipped piece without a lane `/^piece ([a-z0-9][a-z0-9-]*): skipped \(requires (.+) missing\)$/`; blocked `/\bBLOCKED\b/` or `/\blane [a-z]+\b.*\bblocked\b/i`.
- **Tokens (`app.css`, `:root`, dark default, light under `@media (prefers-color-scheme: light)`):**

  | Token | Dark | Light |
  |---|---|---|
  | `--bg` | `#090909` (body: `radial-gradient(1200px 600px at 50% 0%, #0f1216 0%, #090909 60%)`) | `#f5f6f8` |
  | `--panel` | `#0f0f0f` | `#ffffff` |
  | `--line` / `--line2` | `#222` / `#2c2c2c` | `#e3e6ea` / `#d5dae0` |
  | `--ink` / `--ink2` / `--mute` | `#efece6` / `#a19c93` / `#6f6b64` | `#14171c` / `#4a525c` / `#7a838d` |
  | `--accent` / `--accent-2` | `#7cc8ff` / `#a8dbff` | `#1f6fae` / `#2b7fc4` |
  | `--accent-line` / `--accent-bg` / `--on-accent` | `#24445e` / `#0f1a24` / `#061018` | `#b9d3ea` / `#e8f1f9` / `#ffffff` |
  | `--red` / `--red-line` | `#ff5c5c` / `#5a1c1c` | `#c62828` / `#f0c4c4` |
  | `--tile` | `#1c1c1c` | `#e9ecef` |

  The mockups call the accent `--or`/`--ac` and `--or2`/`--ac2`; use `--accent`/`--accent-2`. Font stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`; mono `ui-monospace, Menlo, monospace`. No other colours: the old `--cyan`, `--violet`, `--pink`, `--grad`, yellow and green tokens go away (yellow states use the accent, green states use `--ink`).

#### HQ API shapes (T2–T5 produce, T6–T11 read)

- `GET /api/home` → the existing fields (`budget`, `attention`, `projects`, `repos`, `activity`, `running.launches`) plus:
  - `projects[]` gains `{ waiting: n, blocked: n, ready: n, wave: 'c/m' | null }` (attention items of its repos; blocked lanes; ready-to-merge plans; the first running plan's wave).
  - `plans: [{ rid, repoName, slug, title, status }]` for every plan of the visible repos.
  - `today: [{ at, time: 'HH:MM', text, tag, tone: 'accent'|'red'|'mute', href, closest: boolean }]`, oldest first (T4).
  - `running.plans: [RunningPlan]` for plans with status `running` or `blocked` (T4).
  - `routines: [{ id, title, scopeLabel, harness, time: 'HH:MM', at, status, tone, href }]` (T4).
  - `ring: [{ id, label, glyph, href, count: string, hot: boolean }]`, 14 items (T4).
  - `deck`: the `deckView()` result (T3).
- `RunningPlan` = the old fields (`rid, repoName, slug, file, title, status, green, totals, currentWave, waveCount, roles, launch`) plus `href`, `kpis: { green, total, wave, waves, lanes: { running, finished, planned }, startedAt: ISO|null }`, `groups: { running: [Segment], finished: [Segment], planned: [Segment] }`. `Segment = { lane, role, title, kind, avatar, model, effort, task: { id, title } | null, tasks: [id], done, total, fix: 'n/m' | null, status: 'working'|'blocked'|'done'|'merged'|'planned', since: ISO|null }`.
- `GET /api/deck` → `{ items: [DeckItem], commands: [id], options: { claude: { models, efforts }, codex: { models, efforts } } }`; `DeckItem = { key: 'kind:id', kind, id, label, harness, model, effort, missing, intent }`; `label` = `/relay:<id>` for commands, `/<id>` for skills; `intent` = `{ action: <command id>, harness, model, effort }` or `{ action: 'skill', skill: id, harness, model, effort }`.
- `POST /api/deck` `{ op: 'add'|'remove'|'set', kind, id, harness?, model?, effort? }` → `{ ok: true, deck: deckView() }`.
- `GET /api/recos` → `{ builtAt, sources: [{ name, ok, error? }], recos: [PublicReco] (open first in rank order, then done, then skipped), gone: [{ id, title, area, state: 'done'|'skipped' }] (known ids no longer built), counts: { total, priority, repos, runs, routines, brain, done, skipped, zeroTokens, cart }, cart: [id], team: [{ role, title, kind, working }] }`.
- `POST /api/recos` `{ op: 'done'|'skip'|'unskip'|'cart-add'|'cart-remove'|'cart-clear', ids: [id] }` → `{ ok: true, counts, cart }`.
- `POST /api/recos/apply/preview` `{ ids, plan?: { harness, model, effort, permissionMode, confirmDangerous } }` → `{ commands: [{ reco, display, deletes }], plans: [{ rid, repoName, flow: 'bugfix', goal, recos: [id], preview }], routines: [{ reco, routine, create: display | null }], refused: [{ id, reason }] }` (`preview` = `previewLaunch` result).
- `POST /api/recos/apply` the same body plus `confirm: true` → `{ launches: [{ id, action, display }], routines: [{ reco, routine, launch: id | null }], refused: [{ id, reason }] }`.

## Review Focus

- Apply: no byte of the request body reaches an argv. Commands are rebuilt from disk at apply time (branches re-listed, merged state re-checked), unknown body fields are refused, plan launches pass the launch guards (budget critical refuses), and a reco whose source changed is refused per id while the others still apply.
- Auto-done only for recos whose source was read successfully in the same build; a source that fails (gh missing, unreadable state) must not mark its recos done.
- Ids stay stable across rebuilds: no timestamps or unordered lists in a fingerprint.
- Deleting commands (`branch -D`, `branch -d`, `worktree remove`, `rm`) always appear under **Deletes** in the apply dialog; nothing runs before Start.
- Polling: the 5 s poll pauses while `#launch` is open (search palette, apply dialog, deck settings and add-skill all use that one `<dialog>`); the Recos page does not poll (`{ poll: false }`), so filters and the cart panel are not reset.
- `/api/home` cost: Brain counts and recos counts are memoised (60 s / 30 s); Apply never uses the memo.
- Today uses the local day while ledger stamps are UTC.
- No per-project or per-role colour remains (`colorOf`, `PALETTE`, `hex` styling are gone from the UI); the light theme keeps AA contrast for `--accent` on white.
- Reduced motion: orb static, shimmer off.

## Tasks

### T1: Recos builder

Build recos from relay's own files, deterministically. Files: `lib/hq/recos.mjs` (new), `lib/hq/sources.mjs` (broken skill links), `lib/hq/routines.mjs` (export `suggestionsFrom`), `test/recos-fixture.mjs` (new, shared with T2), `test/hq-recos.test.mjs` (new).

**`lib/hq/sources.mjs`.** Replace `skillFiles` with `scanSkills`, which also records dangling symlinks, and keep `skillFiles` as a wrapper (its callers stay unchanged). Add `lstatSync, readlinkSync` to the `node:fs` import.

```js
// Every SKILL.md HQ knows (relay's, the user's, each plugin's except relay's own copy,
// Codex's), up to 3 levels below each root, following directory symlinks once per real
// directory; plus the symlinks whose target is gone, so Recos can offer to remove them.
export function scanSkills({ home = homedir(), relayRoot = RELAY_ROOT } = {}) {
  const paths = harnessPaths(home);
  const skills = [];
  const broken = [];
  const seen = new Set();
  const add = (root, source, harness) => {
    const walk = (dir, depth) => {
      let names;
      try {
        names = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const entry of names) {
        const path = join(dir, entry);
        try {
          if (!statSync(path).isDirectory()) continue; // stat follows symlinks
          const real = realpathSync(path);
          if (seen.has(real)) continue; // also stops symlink cycles
          seen.add(real);
          const file = join(path, 'SKILL.md');
          if (existsSync(file)) skills.push({ name: skillName(file) ?? entry, source, harness, file });
          else if (depth < SKILL_DEPTH) walk(path, depth + 1);
        } catch {
          try {
            if (lstatSync(path).isSymbolicLink()) broken.push({ root, path, target: readlinkSync(path) });
          } catch {
            // unreadable: skip
          }
        }
      }
    };
    walk(root, 1);
  };
  add(join(relayRoot, 'skills'), 'relay', ['claude', 'codex']);
  add(paths.claudeSkills, 'user', ['claude']);
  for (const p of installedPlugins(paths)) if (p.name !== 'relay') add(join(p.installPath, 'skills'), p.name, ['claude']);
  add(paths.codexSkills, 'codex', ['codex']);
  return { skills, broken };
}

export const skillFiles = (opts) => scanSkills(opts).skills;
```

**`lib/hq/routines.mjs`.** Change `function suggestionsFrom(text)` to `export function suggestionsFrom(text)`. Nothing else.

**`lib/hq/recos.mjs`** exports:

- `AREAS`, `PRIORITIES` (as in Global Constraints).
- `collectRecoSources({ home = homedir(), env = process.env, relayRoot = RELAY_ROOT, registry = readRegistry(), now = new Date() } = {})` → `[{ name, ok, error?, items }]`, one entry per source below, each computed inside its own `try/catch` (a throw gives `{ name, ok: false, error: err.message, items: [] }`). It reads disk and runs `git` (via `git()` from `lib/git.mjs`, `allowFail: true`), never `gh` and never the network. Repositories = `listRepos(registry)` not hidden and existing on disk, each with `rid = ridOf(path)` and `name = basename(path)`.
  First entry `{ name: 'bins', ok: true, items: { git: onPath('git', env) ?? null, rm: onPath('rm', env) ?? null, node: process.execPath, relay: join(relayRoot, 'bin', 'relay') } }`.
- `buildRecos(sources, { routing = loadRouting(), home = homedir() } = {})` → ordered `Reco[]`. Pure: no fs, no git, no clock. Skips sources with `ok: false`.
- `reconcile(state, recos, sources, now = new Date())` → new state (pure, does not mutate its input): for each id in `state.known` that is not built now, whose `known[id].source` is a source with `ok: true`, and that is neither done nor skipped → `done[id] = now.toISOString()`. Then add every built reco to `known` (`{ title, area, source }`), trimming `known` to the newest 500 keys.
- `orderRecos(recos)`: priority (`high`, `mid`, `low`), then `AREAS` order, then `at` descending (null last), then `id` ascending.

`tilde(p)` below = `p` with the leading `home` replaced by `~`. `n` = count; plural `s` added when n ≠ 1. Every reco has `effort: 'low'` and `cost: { tokens: 0 }` unless stated. `base` ids use `:` separators as written.

| source name | items collected | one reco per | base | area | title | benefit | action | apply | priority / unblocks |
|---|---|---|---|---|---|---|---|---|---|
| `gh` | `{ installed: Boolean(onPath('gh', env)), signedIn }`; signed in when `env.GH_TOKEN` or `env.GITHUB_TOKEN` is set, or `<env.GH_CONFIG_DIR ?? home/.config/gh>/hosts.yml` matches `/^\s+user:\s*\S/m` | machine (none when installed and signed in) | `brain:gh:install` / `brain:gh:login` | brain | `Install gh` / `Sign in to gh` | `CI and review items reach Waiting on you, and pr-hygiene checks pull requests.` | `Copy the install link.` / `Copy gh auth login.` | manual, copy `https://cli.github.com` / `gh auth login` | high / true |
| `keys` | `brainKeys({ home, env, relayRoot }).keys` with status `missing` or `in-file` | key | `brain:key:<NAME>` | brain | missing: `Set <NAME>`; in-file: `Move <NAME> out of <basename(literalIn)>` | missing: `<neededBy names joined ', '> can run.` (no needers: `Nothing breaks when it is unset.`); in-file: `The key stops living in a config file.` | `Copy export <NAME>=.` / `Copy the file path.` | manual, copy `export <NAME>=` / `tilde(literalIn)`; refs neededBy names / `[tilde(literalIn)]` | missing with needers: high / true; in-file: mid / false (a secret written in a config file is a security risk; human ruling 2026-10-22); otherwise low / false |
| `connectors` | `brainConnectors({ home, env, relayRoot }).connectors` with status `needs-auth` | connector | `brain:connector:<harness>:<name>` | brain | `Authenticate <name>` | `<name> tools become available.` | `Run /mcp in Claude Code.` | manual, copy `/mcp`; refs `[name]` | low / false |
| `skill-links` | `scanSkills({ home, relayRoot }).broken` grouped by `root` | skills folder | `brain:skill-links:<tilde(root)>` | brain | `Remove <n> broken skill link<s> in <tilde(root)>` | `Brain → Skills lists only skills that load.` | `Delete the dangling symlinks.` | command, run per link `{ bin: bins.rm, argv: ['--', path], cwd: root, deletes: true }`; refs link basenames | low / false |
| `routine-paths` | `listInstances()` not disabled, with `!existsSync(inst.relayCli)` → `{ id, harness }` | instance | `brain:routine-path:<id>` | brain | `Repoint routine <id>` | `The routine runs on schedule again.` | codex: `Rewrite its Codex automation.`; claude: `Copy relay routine refresh.` | codex: command, run `{ bin: bins.node, argv: [bins.relay, 'routine', 'refresh'], cwd: home, deletes: false }`; claude: manual, copy `relay routine refresh`; refs `[id]` | high / true |
| `pr-hygiene` | for every instance with `routine === 'pr-hygiene'`: `readState(id).state.current` minus `dismissed`, deduped by finding id, grouped by `(kind, repo)`; `at` = newest `seen[f.id]`. Kinds `relay-branches`, `relay-worktrees`, `branch-merged-old` are re-checked with git here (below); `pr-stale`, `pr-approved-unmerged`, `review-requested` keep `href`; other kinds (incl. `gh-not-connected`) are dropped. A finding whose `repo` is not a registered visible repo is dropped. | finding kind and repository | `repos:<rid>:<kind>` | repos | see below | see below | see below | see below | see below |
| `ledgers` | for each repo and each `.relay/runs/<slug>/ledger.md` that has a `plan: complete` line: the deferred lines (text after the pattern, trimmed, ≤ 200 chars each) and `at` = the complete line's time; also, after the last `start:` line, every skipped-piece line `{ piece, path, at }` | — | — | — | — | — | — | — | — |
| `weekly-report` | for each instance with `routine === 'weekly-report'`: `suggestionsFrom(readFileSync(listReports(id, { limit: 1 })[0].path))`, minus ids that `loadTemplates().templates` already has; `at` = the report's date | suggestion | `routines:suggest:<id>` | routines | `Add routine <id>` | `<what>` | `Create it, then enable it in the routine dialog.` | routine, `{ routine: id, create: { id, kind, days, at, prompt: what } }`; refs `[`${days} ${at}`]` | low / false |

`pr-hygiene` details, per `(kind, repo)` group (`rid`, `repo` = the path):

- `relay-branches`: for each finding the slug is the key (`f.id.split(':').slice(2).join(':')`, must match `/^[a-z0-9][a-z0-9-]*$/`). Re-check: `refs/heads/relay/<slug>/integration` exists and `git merge-base --is-ancestor relay/<slug>/integration HEAD` succeeds; branches = `git for-each-ref --format=%(refname:short) refs/heads/relay/<slug>/`. Drop the slug when the check fails or no branch is left. Title `Delete <N> leftover relay branches` (N = all branches), benefit `<k> finished plan<s> stop showing as ready to merge, and pr-hygiene stops reporting them.`, action `Run git branch -D for the merged plans' branches.`, run per slug `{ bin: bins.git, argv: ['-C', repo, 'branch', '-D', ...branches], cwd: repo, deletes: true }`, refs `relay/<slug>/*`, priority mid.
- `relay-worktrees`: re-list `git worktree list --porcelain` and keep worktrees whose branch is `refs/heads/relay/<slug>/lane-*` for a slug in the findings. Title `Remove <N> lane worktrees of finished plans`, benefit `Disk space comes back, and pr-hygiene stops reporting them.`, action `Run git worktree remove for each.`, run per worktree `{ bin: bins.git, argv: ['-C', repo, 'worktree', 'remove', wt], cwd: repo, deletes: true }`, refs `tilde(wt)`, priority mid.
- `branch-merged-old`: branch = the key; keep it when `refs/heads/<branch>` exists, it does not start with `-`, and `git merge-base --is-ancestor <branch> HEAD` succeeds. Title `Delete <N> old merged branches`, benefit `git branch lists only live work.`, action `Run git branch -d for each.`, run per branch `{ bin: bins.git, argv: ['-C', repo, 'branch', '-d', branch], cwd: repo, deletes: true }`, refs the branch names, priority low.
- `pr-stale` / `pr-approved-unmerged` / `review-requested`: titles `<N> PRs wait for review` / `<N> approved PRs are not merged` / `<N> PRs ask for your review`; benefit `Reviews stop waiting.` / `Approved work lands.` / `Reviewers stop waiting on you.`; action `Open them on GitHub.`; manual, copy = the hrefs joined by `\n`; refs `#<key>`; priority low.
- Drop a group that ends with nothing to run.

`ledgers` recos:

- Deferred minors, one per complete plan with at least one: base `runs:<rid>:<slug>:deferred`, area runs, title `Fix <n> deferred minor<s> of <slug>`, benefit `The minors the reviewers deferred in <slug> get fixed.`, action `Plan a bugfix run for them.`, apply `{ kind: 'plan', rid, repo, repoName, goal }` with goal = `Fix the deferred minors of plan <slug>: <minors joined '; '>` cut to 1000 characters, cost `{ tokens: null, windowPct: Math.max(1, Math.round(n * routing.forecast.tierWeight.mid * routing.forecast.riskFactor.low * routing.forecast.defaults.pctPerUnit)) }`, effort `low` (n ≤ 3), `mid` (n ≤ 8), else `high`, priority low, refs `[`${repoName}/${slug}`]`, source `ledgers`.
- Skipped pieces, one per `(plan, piece)`: base `runs:<rid>:<slug>:skipped:<piece>`, title `<piece> was skipped in <slug>`, benefit `<piece> runs at final.`, action `Copy the missing path.`, manual copy `<path>`, refs `[path]`, priority high, unblocks true, source `ledgers`.

**`test/recos-fixture.mjs`** exports `recosFixture()` → `{ home, relayHome, repo, rid, restore() }`. It sets `process.env.RELAY_HOME` and `process.env.HOME` to temp dirs (restore puts both back), and builds:
- a `tempRepo` registered with `addRepo`, with branches `relay/demo/integration` and `relay/demo/lane-a` at HEAD (so integration is merged);
- `<repo>/.relay/runs/demo/ledger.md` with header `# relay ledger — plan: docs/relay/plans/demo.md`, lines `- 2026-10-20 09:00 start: 2 tasks, 1 lanes, 1 waves`, `- 2026-10-20 09:30 deferred minor: lane a: one`, `- 2026-10-20 09:31 lane a: clean; deferred minor: two`, `- 2026-10-20 09:40 piece requirements-check: skipped (requires docs/relay/requirements/demo.md missing)`, `- 2026-10-20 09:45 plan: complete (relay/demo/integration @ abc1234)`;
- a `pr-hygiene@all` instance in `<relayHome>/routines/enabled.json` (shape per `lib/routines/store.mjs`, harness codex, `relayCli` = the real `bin/relay`, registration active) whose `state.json` `current` holds the finding `{ id: '<rid>:relay-branches:demo', kind: 'relay-branches', repo, repoName, text: '2 branches of finished plan demo', href: null, command: null }`;
- a second instance `pr-hygiene@x` (harness codex, registration active) whose `relayCli` is a path that does not exist;
- `<home>/.claude/skills/needs-key/SKILL.md` with frontmatter `name: needs-key` and a body that mentions `DEMO_API_KEY` (so the key is `missing` with a needer), and a dangling symlink `<home>/.claude/skills/gone` → `<home>/nowhere`.

**Test (1), `test/hq-recos.test.mjs`:** using `recosFixture()` and `env = { PATH: process.env.PATH }`: `buildRecos(collectRecoSources({ home, env }))` yields recos with these bases and priorities: `repos:<rid>:relay-branches` mid (its run argv is `['-C', repo, 'branch', '-D', 'relay/demo/integration', 'relay/demo/lane-a']`), `runs:<rid>:demo:deferred` low with `windowPct ≥ 1`, `runs:<rid>:demo:skipped:requirements-check` high, `brain:key:DEMO_API_KEY` high, `brain:skill-links:~/.claude/skills` low, `brain:routine-path:pr-hygiene@x` high; a second build gives the same ids; after removing the dangling symlink, `reconcile(reconcile(empty, first, s1), second, s2)` marks the skill-links id done and nothing else. Restore env in `finally`.

### T2: Recos state and apply

Files: `lib/hq/recos-state.mjs` (new), `lib/hq/launch.mjs` (a `flow` for plan intents), `test/hq-recos-state.test.mjs` (new).

**`lib/hq/launch.mjs`.**
- `normalizeIntent`: add `flow: str(raw?.flow) || undefined` to the returned object (not for `routine`).
- `evaluateGuards`: when `i.flow !== undefined`: error `unknown flow` unless `i.action === 'plan'`, `/^[a-z0-9][a-z0-9-]*$/.test(i.flow)` and `existsSync(join(RELAY_ROOT, 'flows', `${i.flow}.json`))`.
- `promptFor` case `plan`: when `i.flow` is set, use `PLAN_PREFIX.replace('Choose the flow yourself in step 1, without asking.', `Use the ${i.flow} flow in step 1, without asking.`)`.
- `server.mjs`'s `INTENT_FIELDS` does not get `flow`: only the server sets it.

**`lib/hq/recos-state.mjs`** exports:

- `recosPath()` = `join(relayHome(), 'hq', 'recos.json')`; `readRecoState()` → the state (missing → empty; invalid JSON or shape → copy to `recos.json.bad`, return empty); `emptyRecoState()`.
- `buildNow(opts)` → `{ builtAt, sources, recos }` = `collectRecoSources(opts)` + `buildRecos`; `recosView({ maxAgeMs = 30_000, ...opts } = {})` memoises `buildNow` for `maxAgeMs` (module-level `{ at, value }`), reconciles with `reconcile`, writes the state only when it changed, and returns the public view (see API shapes) without `team` (the server adds it). Drops from `cart` ids that are done or skipped.
- `recoOp(body)`: `op` must be one of the six; `ids` an array of ≤ 100 strings of 1–400 chars (except `cart-clear`, which ignores ids). `done`, `skip`, `cart-add` need each id to be an open reco of a fresh `recosView({ maxAgeMs: 0 })`, else 404 `unknown reco: <id>`; `cart-add` refuses manual recos with 400 `manual recos are not applied`. `done`/`skip` set `{ id: now }` and remove the id from the cart; `unskip` deletes from `skipped`; `cart-add` appends unique ids; `cart-remove` removes; `cart-clear` empties. Writes atomically. Errors carry `status`.
- `applyPreview(body, ctx = {})` and `applyRecos(body, ctx = {})`:
  - Body check first: allowed keys `ids`, `plan` (and `confirm` for apply); any other key → 400 `unknown field: <key>`. `plan`, when present, is an object whose keys are a subset of `harness, model, effort, permissionMode, confirmDangerous`, else 400 `unknown field: plan.<key>`. `ids`: non-empty array of ≤ 50 strings of 1–400 chars, else 400. Apply needs `confirm === true`, else 400 `apply needs confirm: true`.
  - Always a fresh build (`buildNow`, never the memo) reconciled with the stored state. Per id, in this order: built and open → accepted (a manual reco → refused `manual`); built but done → `done`; built but skipped → `skipped`; not built, and a built reco has the same `base` (id up to the last `#`) → `changed, refresh`; otherwise `gone`.
  - `commands`: each accepted command reco's `run` entries, in order, deduped by display, as `{ reco, display, deletes }`; a run entry whose `bin` is null → the reco is refused `<git|rm> not found`.
  - `plans`: accepted plan recos grouped by `rid`, one entry per repository, goal = their goal lines joined by `\n`, intent `{ action: 'plan', repo, goal, flow: 'bugfix', ...body.plan }`, `preview: previewLaunch(intent)`.
  - `routines`: accepted routine recos as `{ reco, routine, create }`, `create` = the display of `{ bin: bins.node, argv: [bins.relay, 'routine', 'new', id, '--kind', kind, '--days', days, '--at', at, '--prompt', prompt], cwd: home }`.
  - `applyRecos` then: plans whose `preview.guards.errors` is non-empty → their recos refused with the errors joined by `; `; if nothing is left → 409 `nothing to apply` with `refused` on the error. Starts each command run with `startLaunch({ action: 'reco', repo: cwd if it is a registered repo else null, plan: null, harness: 'relay', bin, argv, cwd, env: {}, display })`, each plan with `startFromIntent({ ...intent, confirm: true })` (a throw → refused with its message), each routine's `create` with `startLaunch` the same way. Marks every reco that started at least one launch `done`, removes it from the cart, writes the state, and returns `{ launches, routines, refused }`.

**Tests (2), `test/hq-recos-state.test.mjs`,** using `recosFixture()` from T1:
1. State persists: `recoOp` `skip` on the deferred reco and `cart-add` of the relay-branches reco; a fresh module state (call `readRecoState()` again and `recosView({ maxAgeMs: 0 })`) shows the same skipped and cart; then create `relay/demo/lane-b` → the relay-branches reco has a new id with the same base, and the old id is `done` (its source was read).
2. Apply security: each of these is refused without starting anything (`listLaunches()` stays empty): a body with a `command` field (400), `ids: ['repos:nope#00000000']` alone (409, refused `gone`), the old relay-branches id after its source changed (409, refused `changed, refresh`), no `confirm` (400). `applyPreview({ ids: [branchesId, deferredId] })` returns exactly one command whose display is the server-built `git -C … branch -D …` with `deletes: true`, and one plan entry with `flow: 'bugfix'` whose `preview.intent.goal` starts with `Fix the deferred minors of plan demo`.

### T3: Skills Deck store

File: `lib/hq/deck.mjs` (new), `test/hq-deck.test.mjs` (new).

- `deckPath()` = `join(relayHome(), 'hq', 'deck.json')`.
- `readDeck()` → `{ version: 1, items }`. Missing → the defaults (not written). Invalid JSON, wrong `version`, `items` not an array, or any item failing validation → rename the file to `deck.json.bad` and return the defaults.
- Item validation: `kind` is `command` or `skill`; `id` matches `/^[a-z0-9][a-z0-9:_-]*$/i`; a command id is a key of `DECK_COMMANDS`; optional `harness` ∈ `claude, codex`; optional `model`/`effort` strings.
- `deckView({ skills = listSkills().skills, routing = loadRouting() } = {})` → the `GET /api/deck` shape. `missing` = a skill whose id is not among `skills[].name`. Model and effort: the item's own, else `modelFor(routing, tier, harness)`. `options[h] = { models, efforts }` from `launchOptions(h, routing)`.
- `deckOp(body, { skills, routing } = {})`: `add` (`kind`, `id`; a skill must be listed now; 409 `already in the deck`; 400 `the deck holds 24 items`), `remove` (404 `not in the deck`), `set` (`harness` must be `claude`|`codex`; `model` must be in `launchOptions(harness, routing, action).models`, `effort` in its `efforts`, else 400 with the same `model must be one of …` / `effort must be one of …` text the launch guards use). Persists the whole deck (defaults first when the file was missing) and returns `{ ok: true, deck: deckView(...) }`. Unknown op → 400.

**Test (1):** with a temp `RELAY_HOME` and fake `HOME`: `deckView()` without a file lists the six defaults with `plan` at the strong tier's Claude model; `deckOp({ op: 'set', kind: 'command', id: 'plan', harness: 'claude', model: 'gpt-6-luna' })` throws status 400 and the file is unchanged; a valid `set` (`codex`, its cheap model, effort `low`) persists across a fresh `deckView()`; `previewLaunch({ ...item.intent, repo: <registered tempRepo> })` for that card returns `intent.harness === 'codex'` and the card's model and effort; writing `{` to `deck.json` gives the defaults and leaves `deck.json.bad`.

### T4: Home data

File: `lib/hq/home.mjs` (new). No route changes (T5 wires it). Exports:

- `todayRows({ repos, launches, now = new Date() })` → rows (API shape), oldest first; local day = `[local midnight, next local midnight)` of `now`.
  - Routine runs today: every instance's `listRuns(id, { limit: 50 })` with `startedAt` today → text `<template title> · <scopeLabel>`, tag `n NEW` (outcome new, tone accent), `FAILED` (red), `SKIPPED`, `REPORT`, else `DONE` (mute); scheduled runs later today (not disabled, `weekSlots(schedule, now)` slots today and after now) → tag `SCHEDULED`. Href `#/routines/<id>`.
  - Launches with `startedAt` / `endedAt` today → `<action> started on <harnessLabel>` tag `LAUNCH`; `<action> <status>` tag status upper-cased (`FAILED`/`LOST` red). Href `#/launches/<id>`.
  - Ledger lines today (UTC stamps converted) of every `.relay/runs/*/ledger.md` of the repos, only: `start:` → tag `START`; `wave N: merged` → `MERGED`; blocked → `BLOCKED` (red); `plan: complete` → `COMPLETE` (accent). Text `<slug>: <ledger text without the bracketed budget, ≤ 80 chars>`. Href `#/repos/<rid>/plans/<slug>`.
  - `time` local `HH:MM`; exactly one row (the smallest `|at − now|`) has `closest: true`.
- `runningPlan(summary, plan, { launches, routing = loadRouting(), team = loadTeam(RELAY_ROOT) })` → `RunningPlan`. Harness for models = the HQ launch running this plan (`l.repo === summary.path && l.plan === plan.file`), its `harness` when `codex`, else `claude`. Per lane of `plan.board.waves[].lanes[]`: group `running` for state `working`/`blocked`, `finished` for `done`/`merged`, `planned` otherwise; role = `team` member named `lane.agents[0]` (`title`, `kind`, `avatar`; unknown role → title = the name, kind `builder`); model/effort = `modelFor(routing, lane.tier, harness)`; task = the first task in state `working` or `blocked`, else the first not `done`/`merged`, else null; `tasks` = task ids; `done` = tasks `done` or `merged`; `fix` from `lane.note` `/fix round (\d+\/\d+)/`; `since` = time of the first ledger line after the last `start:` whose text matches `/\blane[- ]<id>(?![a-z])/i`. KPIs: `green`, `total` = `plan.totals.tasks`, `wave` = `currentWave`, `waves` = `waveCount`, lane counts per group, `startedAt` = the last `start:` line time. Ledger path: `join(runDir(join(summary.path, plan.file), plan.slug), 'ledger.md')` (`runDir` from `scripts/relay-lanes.mjs`). `href` = `#/repos/<rid>/plans/<slug>`.
- `routineRows({ now = new Date() })` → for each instance not disabled: one row per run today (status `n NEW`, `FAILED`, `DONE`, tone accent/red/mute) and one row for its next run (`nextRun` from `instanceView`): the earliest next run today across instances → `NEXT` (accent), other runs later today → `QUEUED`, tomorrow → `TOMORROW`, later → the weekday upper-cased (`THU`). Sorted by `at`. `title` = template title, `scopeLabel`, `harness`, href `#/routines/<id>`.
- `brainCounts({ home, env, relayRoot } = {})` memoised 60 s → `{ team, flows, pieces, skills, connectors, keys, keysMissing }` from `loadTeam`, `wiring()` (`flows.length`, `pieces.length`), `listSkills`, `brainConnectors`, `brainKeys` (each in its own try, 0 on failure).
- `teamStatus(plans)` → `[{ role, title, kind, working }]` for every `loadTeam` member; `working` when the role is `agents[0]` of a lane in state `working` in any of the given board plans.
- `ringFor({ projects, plans, runningPlans, launches, activityToday, routines, attentionRoutine, recos, budget, brain })` → the 14 ring items in this order (glyph, href, count, hot):
  `projects` `▦` `#/projects` count projects; `plans` `☰` `#/projects` count plans; `board` `◫` the first running plan's href (else `#/projects`) count its running lanes, hot when any running plan has a blocked lane; `team` `☺` `#/brain/team`; `flows` `⇄` `#/brain/flows`; `pieces` `◆` `#/brain/flows`; `skills` `⚡` `#/brain/skills`; `connectors` `⚭` `#/brain/connectors`; `keys` `⚿` `#/brain/keys` hot when `keysMissing > 0`; `routines` `◷` `#/routines` count instances, hot when `attentionRoutine > 0`; `launches` `▶` `#/launches` count running; `activity` `≋` `#/activity` count today's activity events; `recos` `✦` `#/recos` count open, hot when any open reco is high; `budget` `◔` `#budget` count `<5h>%` (or `?`), hot at `tight`/`critical`. Labels: `Projects, Plans, Board, Team, Flows, Pieces, Skills, Connectors, API keys, Routines, Launches, Activity, Recos, Budget`. Counts are strings.

Done: the module imports cleanly; T5's test covers the behavior.

### T5: HQ API wiring

File: `lib/hq/server.mjs`, `test/hq-home.test.mjs` (new).

- `home(reg)`: keep every existing field. Add `user` (`git(['config', 'user.name'], homedir(), { allowFail: true })` trimmed, or `null`), `plans`, the project fields (`waiting`, `blocked`, `ready`, `wave`), `today: todayRows({ repos: visible, launches })`, `running.plans` built with `runningPlan` for plans with status `running` or `blocked` (keep `roles` from `rolesWorking`), `routines: safe(routineRows)`, `deck: safe(deckView)` (`safe` returning `null` for objects), and `ring: ringFor({...})` with `recos` = `recosView()` counts and whether any open reco is high (wrapped in try: on failure count `?`, not hot), `brain: brainCounts()`, `attentionRoutine` = the count of `routineAttention()` items, `activityToday` = activity events whose `at` is today (local).
- Routes (exact): `GET /api/deck` → `deckView()`; `POST /api/deck` → `deckOp(body)`; `GET /api/recos` → `{ ...recosView(), team: teamStatus(<running plan boards of visible repos>) }`; `POST /api/recos` → `recoOp(body)`; `POST /api/recos/apply/preview` → `applyPreview(body)`; `POST /api/recos/apply` → the result of `applyRecos(body)` with each launch through `cleanLaunch` and reduced to `{ id, action, display }`. Errors keep the existing `{ error }` shape (`err.refused` is added to the body when present).

**Test (1), `test/hq-home.test.mjs`:** a `tempRepo` with `copyFixture('plan-basic.md', dir)`, registered, a ledger in the plan's run dir with today's `start:` line (UTC stamp of now − 30 min) and a later line naming a lane, and the server on port 0: `GET /api/home` returns `today` rows sorted by `at` that include the `START` row, and `running.plans[0]` whose segments carry a role title and kind from `roles/*.md` and whose `kpis.green`/`total` equal `GET /api/repos/<rid>/plans/<slug>`'s board `green`/`totals.tasks`; `ring` has 14 items. Restore env in `finally`.

### T6: Look, components and chrome

Files: `lib/hq/ui/app.css`, `lib/hq/ui/dom.js`, `lib/hq/ui/index.html`, `lib/hq/ui/app.js`.

**`app.css`.** Replace the palette with the tokens in Global Constraints (dark default, light in the media query) and restyle every existing class (`.top`, `.side`, `.card`, `.btn`, `.tag`, `.chip`, `.light`, `.bar`, tables, dialogs, `.tabs`, `.menu`, errors) on greys plus the accent: panels `--panel` with a 1px `--line` border and 10px radius; `.light.yellow` → accent, `.light.green` → `--ink`, `.light.red` → `--red`. Add the shared components, copied from the mockups' CSS: `.ph` (panel heading: uppercase, `letter-spacing: .24em`, 13px, bold, after `.ph .ic`, a 16px outlined square; actions in `.ph .act`), `.tag` (mono 9–10px uppercase outlined; `.tag.ac` accent, `.tag.red` red), `.btn` (mono 10px uppercase outlined; `.btn.ac` accent outline; `.btn.primary` filled accent with `--on-accent` text), `.mono`, `.tile` (28px rounded square, neutral `--tile`, mono initials; `.tile.hot` filled accent), `.mascot` (`.mascot .body{fill:var(--mute)}`, `.mascot .hat{fill:var(--ink2)}`, `.mascot.on .body,.mascot.on .hat{fill:var(--accent)}`), `.pbar` with `.pbar .run` shimmering (keyframes on a gradient), `.kpi`. First lines of the file: `@import url("/home.css");` and `@import url("/recos.css");` (T9 and T10 create them; until then they 404 harmlessly). End with `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`.

**`dom.js`.** Remove `PALETTE`; `colorOf` stays exported for now but returns `'var(--tile)'` (T11 removes its callers and it). `avatar(name, id, size, hot = false)` renders a `.tile` (`.tile.hot` when hot) with the initials of the name's first two words (one word → its first two letters), upper-case, and sets no inline colour. `roleTile(member, size)` renders a neutral `.tile` with `member.avatar`, no `hex`. Add:

```js
const SVG_NS = 'http://www.w3.org/2000/svg';
const MASCOT_BODY = ['..XXXXX..', '.XXXXXXX.', 'XX.XXX.XX', 'XXXXXXXXX', '.XXXXXXX.', '.X.X.X.X.'];
const MASCOT_HAT = {
  planner: ['..HHHHH..', '.HHHHHHH.'], // helmet
  builder: ['...HHHH..', '..HHHHHH.'], // cap
  reviewer: ['.........', 'HHHHHHHHH'], // visor
  coordinator: ['....HHH..', '....H....'], // flag
  finder: ['.........', '.........'],
};

// A role's 9×8 pixel critter; the hat follows the role's kind, the accent marks a working agent.
export function mascot(kind, working = false, title = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: '36', height: '32', viewBox: '0 0 9 8', 'shape-rendering': 'crispEdges', class: working ? 'mascot on' : 'mascot', role: 'img', 'aria-label': title || kind || 'agent' })) svg.setAttribute(k, v);
  [...(MASCOT_HAT[kind] ?? MASCOT_HAT.finder), ...MASCOT_BODY].forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const r = document.createElementNS(SVG_NS, 'rect');
      for (const [k, v] of Object.entries({ x: String(x), y: String(y), width: '1', height: '1', class: ch === 'H' ? 'hat' : 'body' })) r.setAttribute(k, v);
      svg.appendChild(r);
    });
  });
  return svg;
}

export const tag = (text, variant) => h('span', { class: variant ? `tag ${variant}` : 'tag' }, text);

// A panel heading: outlined icon, uppercase title, actions on the right.
export const panelHead = (title, ...actions) => h('div', { class: 'ph' }, h('span', { class: 'ic', 'aria-hidden': 'true' }), title, actions.length ? h('span', { class: 'act' }, actions) : null);
```

**`index.html`.** Header becomes `<header class="top"><a class="back" href="#/">← Home</a><nav class="crumbs" aria-label="Breadcrumb"></nav><span class="budget" aria-live="polite"></span></header>`; the `.nav` pill navigation is gone; `.side`, `#view` and `<dialog id="launch">` stay.

**`app.js`.**
- Remove the pill nav (`navEl`, `tab`). `refreshChrome` keeps the budget and the sidebar (avatars now neutral, `hot` when the project has `waiting > 0`).
- `document.body.classList.toggle('home', r.name === 'home')` on every route; CSS hides `.top` and `.side` under `body.home`.
- Routes: `home` → `lazy('./home.js', (m) => m.renderHome(main, {}, ctx))`; new `#/recos` → `lazy('./recos.js', (m) => m.renderRecos(main, {}, ctx))` with crumbs `Home › Recos`; new `#/activity` → an Activity page in app.js (crumbs `Home › Activity`, `activityGroups` over `GET /api/home` `activity`). Delete the old Home code (`renderHome`, `waitingList`, `runningNow`, `projectsList`, `attentionRow`, the GitHub merge for Home); keep Projects, Project, Launches, Launch. Remove `card.style.setProperty('--accent', colorOf(...))` from the repo card. Export nothing new; `ctx` gains `openLaunch: (intent) => import('./launch-dialog.js').then((m) => m.openLaunchDialog(intent, { repos: ctx.repos }))` and `repos` (set from the last `/api/home`).
- Global key `/` (ignored while focus is in an input, textarea or select, or a dialog is open): on `#/recos` focus `document.querySelector('[data-filter]')`; elsewhere `import('./search.js').then((m) => m.openSearch(ctx))`.
- `#budget` in the ring is not a route: `parseRoute` maps it to `home`.

### T7: Launch dialog prefill and pickers

File: `lib/hq/ui/launch-dialog.js`. New signature `openLaunchDialog(intent, { repos = [] } = {})` (old callers keep working).

- Initial state from the intent: `harness` = `intent.harness` (codex rules as today), `model` = `intent.model`, `effort` = `intent.effort`. The skill input starts with `intent.skill`.
- When the intent has no `rid` and the action is `plan`, `run`, `marathon` or `skill`: a `Repository` select over `repos` (`{ rid, name }`), first one selected; its value is sent as `rid`. With no repositories: `No repositories.` and Start stays disabled.
- When the action is `run` or `marathon` and the intent has no `plan`: a `Plan` select filled from `GET /api/repos/<rid>` plans whose status is not `complete` (value `file`, label `title ?? slug`), refilled when the repository changes; sent as `plan`.
- Everything else (preview, guards, Start, copy) unchanged.

### T8: Search palette

File: `lib/hq/ui/search.js` (new). `export function openSearch(ctx)` fills the `#launch` dialog with a text input (`aria-label` `Search`, placeholder `Search`) and a result list, then `showModal()`.

- Data, fetched once per open: `GET /api/home` (`projects`, `repos`, `plans`), `GET /api/brain/skills`, `GET /api/recos` (each in its own try; a failed source is left out).
- Items: project → `#/projects/<id>`; repository → `#/projects/<project id or _unassigned>`; plan → `#/repos/<rid>/plans/<slug>`; skill → `#/brain/skills`; open reco → `#/recos`. Each row: a `tag` with the kind (`PROJECT`, `REPO`, `PLAN`, `SKILL`, `RECO`), the name/title, and a muted detail (repo name, source, area).
- Match: case-insensitive substring over name, title and detail; at most 30 rows; ↑/↓ move, Enter opens, Esc closes, click opens. Opening sets `location.hash` and closes the dialog.

### T9: Home view

Files: `lib/hq/ui/home.js` (new), `lib/hq/ui/orb.js` (new), `lib/hq/ui/home.css` (new). Layout, sizes and CSS: copy `docs/relay/mockups/hq-home.html`, scoping every selector under `.hq-home` (the root element `renderHome` fills `main` with) so nothing leaks into other pages (`.grid` 330px / 1fr / 380px, `.col`, `.centre`, `.stage` 640×640, `.rb`, `.core`, `.kpis`, `.ag`, `.pbar`, `.today .row`, `.deck`), renaming its colour variables to the tokens and its per-role colours to the mascot classes. Under 1100px the columns stack (centre first).

`export async function renderHome(main, _params, ctx)` → `GET /api/home`, then `fill(main, …)` the three columns and return `{ poll: true }`. GitHub attention arrives later per repository from `GET /api/repos/<rid>/github` and joins Waiting on you and the project status lines as it comes (same as the old Home did).

- **Centre top:** `RELAY` + `Command Centre` (accent), subline `<user> · relay HQ` from `GET /api/home` `user` (`relay HQ` alone when it is null). Icon row: Search (opens `search.js`), Add repository (`openAddDialog`), Run a skill (`ctx.openLaunch({ action: 'skill' })`), Budget (a `details.menu` popover with `5h n%`, `7d n%`, `resets HH:MM`).
- **Orb and ring:** a 420×420 `canvas` started with `orb(canvas, { lanes })` (lanes = running segments across plans); `.core` shows the waiting count and `waiting on you`. When `orb()` returns null, only the core shows. The 14 ring buttons are links placed on a circle of radius 280 around (320, 320), angle `-π/2 + i·2π/14`, each with its glyph, its count in `small`, a `title` tooltip and the label; `hot` adds `.hot`. The Budget button opens the budget popover instead of navigating.
- **Running now:** one panel per running plan, a tab per plan above it when there are several (selected tab kept in a module variable). `.ph` `Running now · <title>` with `Board` (plan href) and `Team` (`#/brain/team`). KPI tiles `Green x/y`, `Wave n / m`, `Lanes r · f · p`, `Time h:mm` since `startedAt`. Groups `Running · n`, `Finished · n`, `Planned · n`; each segment: `mascot(kind, status === 'working')`, bold `T15 Tenant switching` (planned: `Lane g · T28–T30`), meta `<title> · lane <id> · <model> · <effort> · <done>/<total> tasks` (or `fix round n/m`), a `.pbar` (`.run` while working, red when blocked) and a tag: elapsed since `since` (`.tag.ac`), `blocked` (`.tag.red`) or `✓`. Nothing running: `Nothing is running.` and a `Run a skill` button.
- **Left:** `PROJECTS` with `Expand` (`#/projects`) and `+ Add repo`; one row per project: `avatar(name, id, null, waiting > 0)`, name, status line joined by ` · ` from `n repos`, `wave c/m`, `n blocked` (red), `CI red` (red, from GitHub items), `n ready to merge`; Unassigned last. `TODAY` with `Week` (`#/routines`): rows `time` (`.t.now` on `closest`), text, `tag(tag, tone)`.
- **Right:** `WAITING ON YOU` with the count large in the accent, the five newest attention items (outlined square icon, red for `lane-blocked`, `suite-failed`, `marathon-blocked`, `ci-red`, grey otherwise; bold text; repo; `ago(at)`), each a link to its `href`; `Today's mix`: a segmented bar by kind of today's items with mono counts. `ROUTINES` with `All` (`#/routines`): table `TIME`, `ROUTINE` (title + scope), `ON` (harness tag), `STATUS` (tag; tone accent for `NEXT` and `n NEW`, red for `FAILED`), the `NEXT` row's time in the accent. `SKILLS DECK` with `+ Add skill`: two-column cards, `label`, `MODEL · EFFORT` mono, buttons `▶` (`ctx.openLaunch(item.intent)`, disabled with tag `missing` when `item.missing`), `⚙` (fills `#launch` with harness radios, model and effort selects from `deck.options`, Save → `POST /api/deck` `set`, then re-render), `⧉` (`copyButton('⧉', item.label)`). `+ Add skill` fills `#launch` with the relay commands (`deck.commands` not yet in the deck) and the skills from `GET /api/brain/skills`; picking one posts `add`.

**`orb.js`** (complete):

```js
// The Home orb: a canvas sphere of grey dots around an accent core that grows with the
// running lanes. Rotates slowly; drawn once under prefers-reduced-motion.

let angle = 0; // kept across re-renders so the 5 s poll does not reset the rotation

export function orb(canvas, { lanes = 0 } = {}) {
  const x = canvas.getContext?.('2d');
  if (!x) return null;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#7cc8ff';
  const dot = css.getPropertyValue('--ink2').trim() || '#a19c93';
  const W = canvas.width;
  const C = W / 2;
  const shell = [];
  const N = 900;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    shell.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  const core = [];
  const count = Math.min(420, Math.max(0, lanes) * 70);
  for (let i = 0; i < count; i++) {
    const u = ((i * 0.754877) % 1) * 2 - 1;
    const t = ((i * 0.569840) % 1) * 6.283;
    const rr = Math.cbrt((i * 0.618034) % 1) * 0.45;
    const s = Math.sqrt(1 - u * u);
    core.push([s * Math.cos(t) * rr, u * rr, s * Math.sin(t) * rr, i % 6 === 0]);
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plot = (px, py, pz, ca, sa, size, colour, alpha) => {
    const X = px * ca + pz * sa;
    const Z = -px * sa + pz * ca;
    const s = (W * 0.476) / (2.6 - Z);
    x.globalAlpha = alpha(Z);
    x.fillStyle = colour;
    x.fillRect(C + X * s * 1.3 - 1, C + py * s * 1.3 - 1, size, size);
  };
  const draw = () => {
    x.clearRect(0, 0, W, W);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (const [px, py, pz] of shell) plot(px, py, pz, ca, sa, 1.6, dot, (Z) => 0.12 + 0.35 * (Z + 1) / 2);
    for (const [px, py, pz, white] of core) plot(px * 1.6, py, pz, ca, sa, 2, white ? '#ffffff' : accent, () => 0.85);
    x.globalAlpha = 1;
  };
  const tick = () => {
    if (!canvas.isConnected) return; // a re-render replaced this canvas
    angle += 0.004;
    draw();
    requestAnimationFrame(tick);
  };
  if (still) draw();
  else requestAnimationFrame(tick);
  return { draw };
}
```

### T10: Recos page

Files: `lib/hq/ui/recos.js` (new), `lib/hq/ui/apply-dialog.js` (new), `lib/hq/ui/recos.css` (new). Layout and CSS: copy `docs/relay/mockups/hq-recos.html` (`.bar`, `.body` 230px / 1fr, `.side`, `.nav`, `.cap`, `.head`, `.logo`, `.title`, `.mascots`, `.stats`, the card grid and card parts), with the tokens instead of `--ac*`; scope every selector under `.recos` so nothing leaks into other pages.

`export async function renderRecos(main, _params, ctx)` → `GET /api/recos`, render, return `{ poll: false }`. Actions re-fetch and re-render; filter text, view (Cards/List) and selected nav are module variables.

- **Top bar:** `← Home`, a filter input (`data-filter`, placeholder `Search`, filters titles and refs), `Cards` / `List` toggle, `Cart n` (opens the cart panel), `Apply n` (`.btn.primary`, disabled at 0).
- **Left nav:** `Priority` (count `counts.priority`), caption `AREAS`: `Repos`, `Runs`, `Routines`, `Brain`; caption `STATE`: `Done`, `Skipped`; each with its count. Priority = open recos with priority high, plus mid with `cost.tokens === 0`, at most 6. Done/Skipped list the recos in that state plus `gone` entries (title only).
- **Header:** logo, `RELAY RECOS`, the team's mascots (`mascot(kind, working, title)`), stats line: `<total> open · repos n · runs n · routines n · brain n · <zeroTokens> at 0 tokens · built HH:MM from <ok source names>` and, when a source failed, `· skipped <names>` in red.
- **Card:** 3px left border (`.hi` accent for high or mid, `.unblocks` red when `unblocks`); top area on a dotted background with the area label, `#rank` and a glyph per area (`⎇` repos, `▶` runs, `◷` routines, `⚿` brain); title; `What's the benefit` + benefit; `What I can do` + action; chips `Effort <e>`, `Priority <p>`, cost `0 tokens` or `~n% of 5h`; ref chips in mono; buttons: `Add to cart` / `In cart ✓` (toggle via `cart-add`/`cart-remove`), `Skip` (`skip`; on Skipped: `Unskip`), and for manual recos `Copy` (`copyButton('Copy', apply.copy)`) and `Done`. **List view:** one row per reco: rank, area tag, title, priority, cost, the same buttons.
- **Cart panel:** a side panel listing cart recos with their `apply.kind` tag and a remove button, `Clear`, and `Apply n`.
- **Apply** → `openApplyDialog(cartIds, { onDone })` from `apply-dialog.js`.

**`apply-dialog.js`:** `export async function openApplyDialog(ids, { onDone })` fills `#launch`:
- Calls `POST /api/recos/apply/preview` `{ ids, plan }` (debounced 250 ms after any change, like the launch dialog) and shows: `Commands` (displays in `pre.code`, non-deleting), `Deletes` (the deleting displays, under that heading, in red), for each plan entry `Plan · <repoName> · bugfix` with the goal in `pre.code`, harness radios, model, effort and permission mode selects filled from `preview.options` (one shared choice sent as `plan`), the plan's command display, warnings and guard errors; `Routines` (template ids, `opens the routine dialog after Start`); `Refused` (`<title or id> — <reason>`).
- `Start` (disabled while a preview is pending or when there is nothing to apply) → `POST /api/recos/apply` `{ ids, plan, confirm: true }`. Then, for each `routines` entry in order: wait until its create launch has ended (poll `GET /api/launches/<id>` every 1 s, at most 15 s), fetch `GET /api/routines` and `openRoutineDialog({ templates, scopes, routine, onDone })` from `routine-dialog.js`, one after the other. Finally `onDone()` and `location.hash = '#/launches'` (or the single launch when there is one). Errors from Start show in the dialog; `Cancel` closes.

### T11: Restyle the other views

Files: `lib/hq/ui/plan.js`, `lib/hq/ui/brain.js`, `lib/hq/ui/routines.js`, `lib/hq/ui/activity.js`, `lib/hq/ui/dom.js`, `lib/hq/repo.mjs`.

- `lib/hq/repo.mjs` `planDetail`: the `team` map becomes `{ title, avatar, kind }` (drop `hex`).

- Remove every `colorOf`, `hex`, `borderLeftColor` and inline colour from these files; then delete `colorOf` from `dom.js`.
- Board (`plan.js`): role tiles become `mascot(team[role]?.kind ?? 'builder', lane.state === 'working', title)`; lane and wave headings use `panelHead`; states use `tag` (`.tag.ac` working, `.tag.red` blocked, plain otherwise).
- Brain (`brain.js`): connector tiles neutral `.tile`; Team tab and flow pieces show `mascot(kind ?? 'builder')` beside the title (kind from the item when the API gives it); tab bar and section headings take `.ph` styling.
- Routines (`routines.js`): project avatars neutral; status tags `NEXT`/`n NEW`/`FAILED` use `tag` with accent/red as on Home.
- Activity (`activity.js`): group heads use a neutral `.tile` instead of a coloured one.
- Structure and behavior of every page unchanged.

```relay-plan
{
  "slug": "relay-hq-rubric",
  "flow": "feature",
  "suite": "npm test",
  "tasks": [
    {
      "id": "T1", "title": "Recos builder", "tier": "strong", "code": "prose", "risk": "medium",
      "files": ["lib/hq/recos.mjs", "lib/hq/sources.mjs", "lib/hq/routines.mjs", "test/recos-fixture.mjs", "test/hq-recos.test.mjs"],
      "deps": [], "tags": ["api"],
      "behaviors": [
        "recos are built from pr-hygiene findings, deferred minors, skipped pieces, gh, keys, connectors, broken skill links, stale routine paths and weekly-report suggestions",
        "each reco has a stable id whose suffix changes when its source changes",
        "priority is high for blockers, mid for Home-changing cleanup, low otherwise",
        "the skills scanner records broken symlinks",
        "a reco no longer built from a source that was read is marked done"
      ],
      "tests": 1,
      "done": "node --test test/hq-recos.test.mjs"
    },
    {
      "id": "T2", "title": "Recos state and apply", "tier": "strong", "code": "prose", "risk": "high",
      "files": ["lib/hq/recos-state.mjs", "lib/hq/launch.mjs", "test/hq-recos-state.test.mjs"],
      "deps": ["T1"], "tags": ["api"],
      "behaviors": [
        "done, skipped and cart persist in <relayHome>/hq/recos.json",
        "apply takes reco ids only and refuses unknown body fields",
        "apply rebuilds every command from disk and refuses gone or changed recos per id",
        "plan recos become one /relay:plan launch per repository on the bugfix flow, through the launch guards",
        "applied recos are marked done and leave the cart"
      ],
      "tests": 2,
      "done": "node --test test/hq-recos-state.test.mjs test/hq-launch.test.mjs"
    },
    {
      "id": "T3", "title": "Skills Deck store", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/deck.mjs", "test/hq-deck.test.mjs"],
      "deps": [], "tags": ["api"],
      "behaviors": [
        "a missing deck.json gives the six default cards at their routing tiers",
        "an invalid deck.json is kept as deck.json.bad and the defaults are used",
        "set refuses a model or effort outside routing.json",
        "a card's intent previews with its harness, model and effort"
      ],
      "tests": 1,
      "done": "node --test test/hq-deck.test.mjs"
    },
    {
      "id": "T4", "title": "Home data", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/home.mjs"],
      "deps": [], "tags": ["api"],
      "behaviors": [
        "today lists routine runs, launches and key ledger lines of the local day, oldest first, with the closest row marked",
        "running plans carry KPIs and lane segments with role, model, effort, progress and status",
        "the routines panel lists today's runs and each next run with NEXT, QUEUED, TOMORROW, n NEW, FAILED",
        "the ring has 14 sections with counts and hot flags"
      ],
      "tests": 0,
      "done": "node --input-type=module -e \"await import('./lib/hq/home.mjs')\""
    },
    {
      "id": "T5", "title": "HQ API wiring", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/server.mjs", "test/hq-home.test.mjs"],
      "deps": ["T2", "T3", "T4"], "tags": ["api"],
      "behaviors": [
        "GET /api/home adds today, running lanes, routines, ring, deck, plans and project status counts",
        "GET/POST /api/deck and /api/recos, /api/recos/apply/preview and /api/recos/apply are served behind the existing gate"
      ],
      "tests": 1,
      "done": "node --test test/hq-home.test.mjs test/hq-server.test.mjs"
    },
    {
      "id": "T6", "title": "Look, components and chrome", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/app.css", "lib/hq/ui/dom.js", "lib/hq/ui/index.html", "lib/hq/ui/app.js"],
      "deps": [], "tags": ["ui"],
      "behaviors": [
        "greys plus one light-blue accent, red only for blocked or failed, in dark and light",
        "a slim top bar with Home, breadcrumb and budget replaces the pill navigation",
        "project avatars are one neutral tile, accent when something waits",
        "mascots drawn as inline SVG with a hat per role kind",
        "/ opens search, or focuses the Recos filter on Recos",
        "reduced motion stops all animation"
      ],
      "tests": 0,
      "done": "node --check lib/hq/ui/app.js && node --check lib/hq/ui/dom.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T7", "title": "Launch dialog prefill and pickers", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/launch-dialog.js"],
      "deps": [], "tags": ["ui"],
      "behaviors": [
        "the dialog opens with the intent's harness, model and effort",
        "without a repository the dialog offers one, and run or marathon offer a plan"
      ],
      "tests": 0,
      "done": "node --check lib/hq/ui/launch-dialog.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T8", "title": "Search palette", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["lib/hq/ui/search.js"],
      "deps": [], "tags": ["ui"],
      "behaviors": ["a palette searches projects, repositories, plans, skills and recos and opens the match"],
      "tests": 0,
      "done": "node --check lib/hq/ui/search.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T9", "title": "Home view", "tier": "strong", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/home.js", "lib/hq/ui/orb.js", "lib/hq/ui/home.css"],
      "deps": ["T6", "T7", "T8"], "tags": ["ui"],
      "behaviors": [
        "three columns: Projects and Today; wordmark, orb with a 14-button ring and Running now; Waiting on you, Routines and Skills Deck",
        "the orb's core grows with running lanes and shows the waiting count; canvas missing shows the count only",
        "deck cards launch, set harness/model/effort and copy; a missing skill disables play",
        "Nothing is running shows a Run a skill button"
      ],
      "tests": 0,
      "done": "node --check lib/hq/ui/home.js && node --check lib/hq/ui/orb.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T10", "title": "Recos page", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["lib/hq/ui/recos.js", "lib/hq/ui/apply-dialog.js", "lib/hq/ui/recos.css"],
      "deps": ["T6"], "tags": ["ui"],
      "behaviors": [
        "cards and list views with Priority, areas, Done and Skipped, filter and stats",
        "add to cart, skip, copy and done act on recos",
        "Apply shows commands, Deletes, the bugfix plan and routines, and runs nothing before Start",
        "routine recos open the routine dialog after Start"
      ],
      "tests": 0,
      "done": "node --check lib/hq/ui/recos.js && node --check lib/hq/ui/apply-dialog.js && node --test test/hq-server.test.mjs"
    },
    {
      "id": "T11", "title": "Restyle the other views", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["lib/hq/ui/plan.js", "lib/hq/ui/brain.js", "lib/hq/ui/routines.js", "lib/hq/ui/activity.js", "lib/hq/ui/dom.js", "lib/hq/repo.mjs"],
      "deps": ["T6"], "tags": ["ui"],
      "behaviors": [
        "board, Brain, Routines and Activity use the new tokens, tags, panel headings and mascots",
        "no per-project or per-role colour remains"
      ],
      "tests": 0,
      "done": "node --check lib/hq/ui/plan.js && node --check lib/hq/ui/brain.js && node --check lib/hq/ui/routines.js && node --check lib/hq/ui/activity.js && node --check lib/hq/ui/dom.js && node --test test/hq-server.test.mjs test/hq-repo.test.mjs"
    }
  ]
}
```
