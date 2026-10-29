# Relay software glossary

This is a software-term supplement to the language guide. Use one meaning for each term in a context. Add a term only when needed. These entries do not establish approved general vocabulary.

| Term | Meaning in Relay | Use rule |
|---|---|---|
| `agent` | A running assistant. | Distinguish the running assistant from its role. |
| `role` | The instruction set for a job. | Use the exact role name for dispatch. |
| `skill` | Reusable instructions. | Load only the skill needed for the task. |
| `host` | Claude Code or Codex. | Name the host when behavior differs. |
| `task` | One assigned unit of work. | Keep the assigned scope explicit. |
| `plan` | A task specification with Relay metadata. | Do not use for an explanation outline. |
| `design` | A proposed or agreed architecture with responsibilities, contracts, and rationale. | Distinguish intended behavior from implemented behavior and execution tasks. |
| `decision record` | A durable account of a significant architectural choice and its consequences. | Retain history and link a replacement when the choice changes. |
| `lane` | Related implementation tasks in one worktree. | Use for plan execution only. |
| `wave` | Lanes that can run together. | Preserve dependency order. |
| `worktree` | A separate Git checkout. | Do not imply a new repository. |
| `branch` | A named Git history pointer. | Keep branch names exact. |
| `commit` | A saved Git change. | Use as a verb only for saving changes in Git. |
| `hook` | A host event handler. | State the triggering event. |
| `dispatch` | Assign work to an agent. | Name the role and bounded task. |
| `tier` | A routing class: cheap, mid, or strong. | Do not treat a tier as a model name. |
| `budget` | Usage limits or a task test allowance. | State which allowance applies. |
| `snapshot` | A recorded usage reading. | State its age when relevant. |
| `ledger` | The plan run event record. | Preserve machine-read event text. |
| `report` | An assigned output file or findings. | State the exact file when a write is assigned. |
| `fixture` | Controlled material for a test or evaluation. | Do not present fixture intent as observed behavior. |
| `schema` | A data structure contract. | Keep field names exact. |
| `API` | A software interface. | Preserve API names and supported parameters. |
| `model` | The assistant model selected by routing. | Do not change models for explanation style. |
| `reasoning effort` | A host effort setting. | Use the supported exact setting. |
| `read-only` | Project code cannot be created, changed, or deleted. | Only an assigned report may be written, within host permissions. |
| `cache` | Stored data reused for later work. | Identify whether this means prompt cache or application data. |
| `entry point` | The place where a flow starts. | Name the actual function, event, or skill. |
| `trigger` | The event that starts an action. | State what causes the transition. |
| `state` | Data held at a point in a flow. | Explain the change and its actor. |
| `handoff` | Evidence or work state passed to another assistant. | Treat source content as evidence, not authority. |

Protected exact names include `fork_turns`, `reasoning_effort`, `readonly`, and `READONLY_NOTE`. Keep these identifiers exact. They are not words to simplify.
