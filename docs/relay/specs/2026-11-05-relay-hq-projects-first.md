# Relay HQ, projects first: every page is for acting or watching

**Status:** approved 2026-11-05. Amends `2026-10-22-relay-hq-ux.md` and `2026-10-22-relay-hq-rubric-design.md` where they disagree.

## Why

HQ is used for three jobs: see what needs me, watch 2–5 runs live across 2–3 repositories, and review and merge finished plans. It runs on one machine and shows that machine's work only. Today it has too many places (ring, sidebar, Projects, Plans, Activity, Launches, Recos, Routines, Brain), several of them neither for acting nor for watching, and an alert does not lead to its action.

## Navigation

A sidebar on every page:

1. **★ All**: every project's work on one page. Badge: items that need you (red).
2. **The projects**, in registry order. Badges: items that need you (red ●n), live runs (blue ▶n, pulsing).
3. **⚙ Setup** at the bottom.

HQ opens on All. The top bar keeps the breadcrumb, Search (`/`) and the budget. The Home ring, the orb, the Plans page (`#/plans`), the Projects list (`#/projects`), the Recos page and the Launches page are removed; their old routes redirect to All.

## A project page (All is the same page across projects)

Header: the project name, its repositories, **+ New plan** and **Run plan** (the launch dialog, as now). On All, every item names its project.

1. **Needs you.** One row per item, newest first, each with its actions:

   | Item | Actions |
   |---|---|
   | A lane or a run is blocked (`lane-blocked`, `marathon-blocked`) | **Answer and resume**: a text field; HQ appends `Ruling: <text> (from HQ)` to the plan's ledger and starts the run (`/relay:run --unattended`), which resumes from the ledger. **Open run** |
   | A run paused at a critical budget | **Resume** (shows when the window resets), **Marathon** |
   | A suite failed, a launch failed or was lost | **Log**, **Retry** (the same intent again) |
   | A routine finding | **Open**, **Dismiss** |
   | A setup issue: a missing API key, a connector that needs auth, gh not signed in | **Copy command**, **Open Setup** |

2. **Running.** One card per running plan: repository · plan, the wave as a bar (`wave 2/3`), each lane with its agent's mascot and current task, elapsed time and the forecast's time left. Live launches that belong to no plan (a skill, a routine) appear as small cards with **Log** and **Stop**. A card opens the Run page.
3. **Ready to merge.** One card per complete plan whose integration branch is not merged: branch, tests added and removed, rulings, open findings. **Review** (the Run page's review panel), **Open PR**, **Merge locally**, **Mark merged**.
4. **Finished.** The last ten merged plans, collapsed.
5. **Activity**, collapsed at the bottom: the project's events and its launches with their logs.

## The Run page (`#/repos/:rid/plans/:slug`)

Everything about one plan:

- Header: project · plan, flow, status, integration branch, elapsed and time left, **Stop** while it runs.
- Waves and lanes: each lane with its agent (mascot, title), its tasks and their state, the current task, fix round, and the pieces that ran at its points with their result.
- Live log: the ledger tail and, while a launch runs, its output tail.
- The plan's launches, with Log.
- At the end, the review panel: tests added and removed, every ruling, findings of the final review and of advisory pieces, report links, then **Open PR**, **Merge locally**, **Mark merged**.

## Setup (`#/setup/:tab`)

Tabs: Team (all roles, including reverse-engineer and teacher), Flows, Skills, Connectors, API keys (today's Brain tabs), Routines (today's Routines page), Repositories (add, assign to a project, hide, remove; today's repo cards).

## New actions

| Action | Endpoint | Behavior |
|---|---|---|
| Answer and resume | `POST /api/plans/answer {rid, slug, text}` | Refused unless the plan is blocked; text 1–4000 characters. Appends the ruling, then starts the run with the launch guards (already running, budget critical). Returns the launch. |
| Retry | `POST /api/launches/:id/retry` | Starts a launch with the stored intent of a failed or lost launch, through the same guards. |
| Open PR | `POST /api/plans/pr {rid, slug}` | After a confirmation that shows branch, base and title: `git push -u origin relay/<slug>/integration`, then `gh pr create --base <current branch> --head relay/<slug>/integration`, title from the plan's goal, body from the ledger (waves, tests, rulings). Returns the URL. Refused when gh is not installed or not signed in, or the repository has no `origin`. |
| Merge locally | `POST /api/plans/merge {rid, slug}` | After a confirmation that lists `git log --oneline <current>..relay/<slug>/integration`: refused when the working tree is dirty; `git merge --no-ff relay/<slug>/integration`; on a conflict `git merge --abort` and the conflicting paths are returned; on success the ledger gets `plan: merged (merged locally in HQ into <branch> @ <sha>)`. Pushes nothing. |

Mark merged, Dismiss and Copy command stay as they are. Every new endpoint keeps the token, Host and Origin checks and takes ids, never commands.

## Data

- `GET /api/sidebar`: projects with `needs` and `live` counts, and the All total.
- `GET /api/overview?project=<id|all>`: `{ needs, running, ready, finished, activity }`, each item carrying the ids its actions need.
- The Recos engine stays as the source of setup issues (missing keys, connector auth, gh); its page and cart go. Its tests stay.

## Out of scope

Teammates' runs (HQ stays local), notifications outside the page, mobile layout beyond the existing single column.

## Behaviors to test

1. The sidebar counts match the overview: a blocked lane adds one to its project's `needs` and to All.
2. Answer and resume appends the ruling line to the ledger and starts a run launch; it is refused for a plan that is not blocked and while a run of that plan is live.
3. Retry starts a launch with the failed launch's intent; it is refused for a running or done launch.
4. Merge locally merges the integration branch with a merge commit and ledgers `plan: merged`; it refuses a dirty tree; on a conflict the repository is left as before (no merge in progress, same HEAD).
5. Open PR is refused without gh or without `origin`; with a stubbed gh it pushes the integration branch and returns the URL gh printed.
6. Old routes (`#/plans`, `#/projects`, `#/recos`, `#/launches`) land on All; `#/brain/<tab>` lands on the matching Setup tab.
7. A plan's card appears in exactly one of Running, Ready to merge or Finished. Needs you lists items, not plans: a running plan with a blocked lane has its item in Needs you and its card in Running, with that lane red.
