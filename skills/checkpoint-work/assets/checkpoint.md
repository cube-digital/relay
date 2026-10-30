---
task_id: "<stable-task-id>"
created_at: "<YYYY-MM-DDTHH:MM:SSZ>"
author: "<person or agent, or UNKNOWN>"
status: "<in-progress | blocked | complete>"
previous_checkpoint: "<relative path or NONE>"
---

# Checkpoint: <task title>

## Goal

<Describe the required result.>

Complete when:
- <State an observable completion condition.>

## Current state

<Describe where the work stopped.>

- Work location: <repository or document location>
- Working directory: <absolute path>
- Branch: <branch, detached HEAD, UNKNOWN, or NOT APPLICABLE>
- Commit: <full SHA, no commits, UNKNOWN, or NOT APPLICABLE>
- Staged changes: <paths or NONE>
- Unstaged changes: <paths or NONE>
- Untracked files: <paths or NONE>

<Identify unrelated changes when present. This state precedes the new checkpoint file.>

## Completed work

- Change: <Describe the completed change, or write NONE.>
  Evidence: <file, commit, document section, or check result>

## Work in progress

- Item: <Describe the partial change, or write NONE.>
  Location: <file, function, or document section>
  Remaining work: <State what is incomplete.>
  Transfer: <State how another worker can access uncommitted work, or write NOT REQUIRED.>

## Verification

- Command or check: <exact command or procedure, or NONE>
  Result: <PASS | FAIL | NOT RUN | UNKNOWN>
  Checked at: <UTC timestamp, NONE for NOT RUN, or UNKNOWN>
  Tested state: <commit and relevant uncommitted changes, or UNKNOWN>
  Relevance: <current, historical, or UNKNOWN>
  Evidence: <result summary or saved output location, or NONE>

## Decisions

- Decision: <State the choice, or write NONE.>
  Reason: <Explain why it applies, or write UNKNOWN.>

## Next steps

1. <Perform the first concrete action, or write NONE.>
   Complete when: <State the expected result.>
2. <Perform the next action. Remove this item if unnecessary.>
   Complete when: <State the expected result.>

## Blockers

- Blocker: <Describe the obstacle, or write NONE.>
  Required action: <State what removes the obstacle.>
  Responsible party: <person, service, or UNKNOWN>

## Assumptions and unknowns

- <State an assumption, missing fact, or unavailable chat context, or write NONE.>

## Start here

<Give one immediate action within the agreed scope. If the task is complete, state that no further action is required.>
