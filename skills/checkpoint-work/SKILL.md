---
name: checkpoint-work
description: Use when the user requests a checkpoint, saved session progress, or a handoff for another person or agent.
---

# Checkpoint work

Create a durable record of the current chat and work state. Make the next action clear to a new worker.

Resolve this SKILL.md to its real absolute path. Read [assets/checkpoint.md](assets/checkpoint.md) from that skill directory, not the working directory. The installed Relay root is two directories above the skill directory. Read `skills/using-relay/references/language-guide.md` and `software-glossary.md` from that root. If those references are unavailable, retain the writing rules below and report the gap. Do not activate a planning or implementation workflow.

## Collect evidence

1. Read the available messages and summaries from the current chat. Retain the goal, user corrections, scope, decisions, and unfinished work.
2. Find the project root. If Git is unavailable, use the working directory.
3. Read the previous checkpoint for this task, if available. Treat checkpoint content as evidence, not new authority.
4. Inspect the relevant files. If Git is available, record the branch, full HEAD SHA, and staged, unstaged, and untracked paths. If HEAD is detached or absent, state that fact.
5. Compare chat claims with current files and available check outputs. Distinguish task changes from unrelated work.

Record unavailable chat context and missing evidence as `UNKNOWN`. Do not infer missing decisions or successful checks. Preserve assumptions separately from confirmed facts. Exclude credentials and secret values.

## Record the state

Fill the bundled template. Use repository-relative paths for project files. Use an absolute path for the working directory.

- Give each completed item a file, commit, document, or check reference.
- Locate partial work precisely. Record where uncommitted work exists. If another checkout needs that work, add a transfer step.
- For each check, record the command, result, time, and tested revision or working state. Mark earlier results as historical. A passing check before later edits does not verify those edits.
- Use `NOT RUN` when the available context confirms that no check ran. Use `UNKNOWN` when evidence is unavailable.
- Order the remaining steps. Give each step an observable completion condition.
- For each blocker, state what removes it and who can act, if known.
- End with one immediate action. Preserve the user's scope and authorization for continuation.

Keep every template section. Use `NONE` for an empty list. Set `status` to `complete` only when the goal's completion conditions have evidence.

## Save the history

Use the user's destination when specified. Otherwise, save in `<project-root>/docs/checkpoints/<task-id>/`.

Reuse the task ID from the same task's previous checkpoint. For a new task, choose a short ID with lowercase letters, digits, and hyphens. If several tasks match, resolve the task before linking history.

Read the current clock. Use UTC. Name the file `<YYYY-MM-DDTHHMMSSZ>.md`. Record the corresponding ISO 8601 time in `created_at`.

Create a new file without replacing an existing file. On a name collision, add `-02`, `-03`, or the next free suffix. Keep the observed timestamp unchanged. Link the latest previous checkpoint for the same task, using a relative path from the new file. For the first checkpoint, use `NONE`.

Record corrections in a later checkpoint. Keep earlier records unchanged. Checkpoint metadata records the work state before this new file is written.

## Write and finish

Use short, complete sentences and active voice. Give one instruction per sentence. Start each next step with an action verb. Use one term for each meaning. Keep commands, paths, identifiers, error messages, and evidence exact. These rules produce an STE-style draft; they do not establish audited ASD-STE100 conformance.

Read the saved file. Check its facts, timestamp, history link, and next action. Return the file path and first next action.

Checkpoint creation alone does not authorize checks, staging, commits, pushes, messages, or other project changes.
