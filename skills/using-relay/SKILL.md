---
name: using-relay
description: Use at the start of any session that will plan, delegate or run multi-step coding work. Sets relay's rules for model tiers, the usage budget, lanes and testing.
---
# Relay rules

1. **Plan first.** Multi-step work gets a plan from the plan-with-tiers skill: every task has a tier, risk, files, deps, a test budget and a `done` check. Judgment is spent once, at plan time.
2. **Delegate to relay agents, never to a bare general-purpose agent.** scout (find), implementer-fast / implementer / implementer-deep (build), test-author (tests from spec), reviewer (review), architect (plan, final review), conductor (run a whole plan). In Claude Code they are `relay:<role>`; in Codex `relay-<role>` with model and reasoning effort set on every spawn.
3. **Run plans with the run-lanes skill.** Related tasks share a lane: one worktree, one implementer, one commit per task. Workers write reports to files and return at most 8 lines. Never paste file contents or session history into a dispatch.
4. **Test like QA (qa-mindset skill).** Test budget per task, narrowest check first, never rerun an unchanged test, never edit a protected test.
5. **Budget.** `relay budget` prints the 5-hour/7-day level. normal: route by plan tier. tight: Opus only for the final review; prefer cheap tiers where the plan holds complete code. critical: finish the current wave, commit, write a handoff (handoff skill), start nothing new. unknown: act as tight.
6. **Keep the cache warm.** Pick the main model and effort at session start and keep them; a mid-session switch re-reads the whole conversation uncached. Use `/clear` between unrelated tasks.
