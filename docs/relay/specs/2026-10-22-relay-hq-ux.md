# Relay HQ, UX pass: fewer sections, projects you can work from

**Status:** done on `relay-hq`, 2026-10-22. Amends `2026-10-22-relay-hq-rubric-design.md` where they disagree.

## Why

- Six of the 14 ring buttons were parts of Brain; Budget and Launches did not belong on Home.
- Plans and Board (with nothing running) both opened the Projects page: three buttons, one destination.
- A project page was a list of repo cards. It did not say which tasks exist, what is implemented, what runs now, or what waits on you.
- Leaving any page meant going back to Home.

## What changed

**Home ring: six sections, six destinations.** Projects, Plans, Recos, Routines, Activity, Brain. Brain opens the tab that needs you (missing keys, connectors that need auth), else Team. Budget lives in the top bar of every other page and in the launch dialog; Launches is a tab of Activity. Waiting on you shows the newest six with their action (Open task, Mark merged, Open PR), then "Show n more".

**Sidebar on every page but Home.** Sections with badges (waiting count, blocked plans, open recos, Brain alert), then the projects with a status dot. The top bar holds the breadcrumb, Search (`/`), Run a skill and the budget.

**A project page.** KPIs (Needs you, Running, In progress, To do, Implemented x/y) and tabs:

| Tab | Shows |
|---|---|
| Overview | Needs you with actions; Running now (the agents panel per live plan, live launches with Log and Stop); the active plans |
| Tasks | Every task of every plan, filtered Open / In progress / Blocked / To do / Implemented / All, with a text filter; finished plans hidden by default; each row opens the task on the board |
| Plans | Plans grouped Needs you · Running · Up next · Done |
| Repositories | The repo cards: git state, project, hide, remove, + New plan, GitHub |
| Activity | The project's activity |

**A Plans page** (`#/plans`, `GET /api/plans`): every plan of every visible repo with its project, grouped like a project's Plans tab, filtered by project and text. A plan row carries its state (planned, running, blocked, ready to merge, done), progress, wave, last ledger time and its actions (Board, Run or Resume, Marathon, Log and Stop, Mark merged).

## API

| Method and path | Change |
|---|---|
| `GET /api/home` | `ring` has six items |
| `GET /api/projects/:id` | adds `attention`, `running` (agents panels) and running `launches` |
| `GET /api/plans` | new: `{ plans, projects }`, plans without their boards |
| `GET /api/brain` | new: the Brain counts |

## Fixes found while testing every flow

- Search never loaded when a repository was Unassigned (`projects.find` on a count threw).
- The 5 s refresh wiped what you were typing in a filter; it now waits while an input in the page has focus.
- Renaming or deleting a project left the sidebar stale.
- A blocked plan offered "Run"; it says Resume, as the launch resumes from the ledger.
- The launch dialog said "resumes from the ledger" twice.
