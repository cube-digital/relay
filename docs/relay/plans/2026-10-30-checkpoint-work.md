# Checkpoint Work Plan

**Goal:** Add the agreed current-session checkpoint skill and set the package version to `0.6.0`.
**Design:** The user approved the skill and template examples in this chat on 2026-10-30.
**Architecture:** Add one shared skill, one Markdown asset, and one Claude command wrapper. Reuse existing skill discovery and packaging. Keep checkpoint creation independent of implementation lanes and the budget handoff workflow.

## Global Constraints

- Use the current chat, available summaries, current files, and earlier checkpoints as evidence.
- Record completed work, partial work, decisions, verification, blockers, and concrete next steps.
- Create a new UTC-timestamped file. Link the previous record for the same task. Preserve existing records.
- Use short STE-style instructions. Preserve exact paths, commands, identifiers, and error messages.
- Checkpoint creation does not authorize tests, commits, pushes, or other project changes.
- Keep the pre-existing untracked `.codex/` directory unchanged.
- Edit source files only. Use `node bin/relay build` for generated artifacts.
- No release tags, publishing, installation, or remote changes are part of this task.

## Review Focus

- Current chat decisions must appear in the checkpoint even when they do not appear in the source diff.
- An earlier passing check must not imply verification of later edits.
- Uncommitted work must have a concrete location and transfer instruction when needed.
- Filename collisions must not overwrite history or change the observed timestamp.
- Packaged and symlinked skills must resolve their bundled template from the installed skill directory.

## Tasks

### T1: Add the skill and template

Create `skills/checkpoint-work/SKILL.md` and `assets/checkpoint.md` from the approved examples. Add installed-root resolution and the shared language policy. Make current-chat collection explicit. Record unavailable context and evidence honestly. Use a stable task ID, UTC filenames, same-task predecessor links, and sequence suffixes for collisions. Preserve other workers' changes. Add `commands/checkpoint.md` using the existing command-wrapper convention.

Use an isolated fixture for one baseline and one forward evaluation. The fixture includes a chat-only decision, an earlier passing check, a later source edit, an untracked file, and a previous checkpoint. Record observed results separately from live host installation claims.

### T2: Integrate and version the release

Update the package, both plugin manifests, and RPC client identifier to `0.6.0`. Update current-version documentation and the README skill count to 21 (14 entry points, 7 supporting skills). Document both hosts' invocation forms and default storage. Extend the existing packaging test to exercise the shipped skill, command, template, and relocated discovery. Existing checks cover portable frontmatter. Do not add tests that match prompt wording.

Run `npm test` once after integration. Run `node bin/relay build --check`. If the build changes `hooks/register.ts`, also run the required Claude plugin checks.

```relay-plan
{
  "slug": "checkpoint-work",
  "suite": "npm test",
  "tasks": [
    {
      "id": "T1", "title": "Checkpoint skill and template", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["skills/checkpoint-work/SKILL.md", "skills/checkpoint-work/assets/checkpoint.md", "commands/checkpoint.md", "docs/relay/evaluations/2026-10-30-checkpoint-work.md"],
      "deps": [],
      "behaviors": ["Current-session evidence becomes a concrete handoff", "New UTC records preserve same-task history", "Historical checks remain distinct from current verification"],
      "tests": 0, "done": "node bin/relay build --check"
    },
    {
      "id": "T2", "title": "Release integration and packaging", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "lib/codex-rpc.mjs", "README.md", "docs/configuration/README.md", "docs/guides/development.md", "test/package.test.mjs"],
      "deps": ["T1"],
      "behaviors": ["Packaged checkpoint resources remain available after relocation", "Release identifiers agree at 0.6.0"],
      "tests": 0, "done": "node --test test/package.test.mjs"
    }
  ]
}
```
