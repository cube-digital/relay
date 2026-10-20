# Spike: putting several tasks in one worktree (30 minutes)

Relay runs a lane (several related tasks) in one reusable worktree with one implementer. Three mechanisms could put a Claude Code subagent into that worktree. Run this once on your Claude Code version and record the results in the table at the bottom; `skills/run-lanes` assumes mechanism A.

## Setup

```bash
mkdir -p /tmp/relay-spike && cd /tmp/relay-spike && git init -q && echo "x" > a.txt && git add . && git commit -qm init
claude --plugin-dir /path/to/relay      # or with relay installed from the marketplace
```

Inside the session:

```
relay worktrees sync /path/to/relay/test/fixtures/spike-plan.md --wave 1
```

(`spike-plan.md` is a 2-lane plan; copy it into /tmp/relay-spike/docs/ first so the repo is the spike repo.)

## A. Name → cwd via relay's mod (expected to work)

Prompt: *Dispatch the relay:implementer agent with name "lane-a" and the prompt "Run pwd and git branch --show-current, create note.txt with the text lane-a, commit it, report the output."*

Pass if: pwd is `.claude/worktrees/relay-<slug>-1`, the branch is `relay/<slug>/lane-a`, and the main checkout has no `note.txt`.

Then: *Send lane-a a message: "Append a second line to note.txt and commit."* Pass if the resumed run is still in the same worktree.

## B. EnterWorktree inside a subagent

Prompt: *Dispatch a general-purpose agent: "Call EnterWorktree with path .claude/worktrees/relay-<slug>-2, then run pwd, create note.txt, commit."*

Pass if the commit lands on `relay/<slug>/lane-b` and the main checkout is untouched.

## C. isolation: worktree + resume

Prompt: *Dispatch a general-purpose agent with isolation "worktree" and name "iso": "Create iso.txt, commit, report pwd and branch."* Then *Send iso: "Create iso2.txt, commit, report pwd."*

Pass if the second run is in the same worktree as the first. (Docs do not say; this is the open question.)

## Results

| Mechanism | Claude Code version | Works? | Notes |
|---|---|---|---|
| A. name → cwd (mod) | 2.1.303 | yes | 2026-10-20 pilot (3-task plan): `lane-a` and `lane-a-tests` ran in `relay-slugify-1`, `lane-b` in `relay-slugify-2`; commits landed on their lane branches. Models routed as planned: implementer-fast on Haiku, reviewers and test-author on Sonnet, architect on Opus. |
| A. resume keeps cwd | | not yet exercised | the pilot needed no fix round |
| B. EnterWorktree in subagent | | | |
| C. isolation + resume | | | |

If A fails: switch `skills/run-lanes` to B (put the EnterWorktree call first in every lane dispatch). If A and B fail: run each lane as its own headless session started inside its slot (`cd <slot> && claude -p "<lane dispatch>"`), driven by the conductor.
