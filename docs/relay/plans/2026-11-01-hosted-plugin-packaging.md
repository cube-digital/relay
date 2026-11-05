# Hosted Plugin Packaging Plan

**Goal:** Remove Relay's top-level `bin/` directory so hosted Claude marketplace sync can accept its layout.
**Design:** The user approved the packaging repair in the current chat on 2026-11-01.
**Evidence:** [Anthropic's hosted packaging rule](https://code.claude.com/docs/en/plugins/host-marketplace#distribute-through-organization-settings) rejects top-level `bin/` directories. Relay 0.6.0 ships `bin/relay`. Local Claude Code reports that version installed and enabled; the Desktop sync response has not exposed its detailed validation error.
**Architecture:** Move the Node entry point to `scripts/relay.mjs`. Update package metadata, runtime callers, installation diagnostics, CI, skills, and maintained guides together. Keep the public npm command `relay` and all subcommands unchanged. Release identifiers become `0.6.1`.

## Constraints and migration

- Do not leave a top-level `bin/` directory, wrapper, or symlink in the plugin.
- Existing cached 0.6.0 installations remain self-contained. New installations receive a complete 0.6.1 payload.
- Direct callers of `node bin/relay` must use `node scripts/relay.mjs` after updating. Document that path change.
- Rollback uses the complete previous release. That restores local CLI behavior and its known hosted-sync limitation.
- Preserve dated plans, specifications, evaluations, and historical check records.
- Keep the pre-existing untracked `.codex/` directory unchanged.
- Edit instruction sources. Regenerate any changed agent or hook output through the CLI build.
- No new dependencies, authentication changes, or automatic hook trust.
- Run the required suite once after integration. Use the new entry point for the required build check.
- A local validator pass does not prove hosted server acceptance. Record that limit separately.

## Tasks

### T1: Move the executable and preserve runtime behavior

Move `bin/relay` to `scripts/relay.mjs`, retaining executable permissions. Resolve dispatch modules from the same scripts directory. Point `package.json#bin.relay` to the new entry point and remove `bin` from the file list. Update marathon prompts, setup output, doctor resources, test callers, and CI. Extend the existing packaged-resource test to reject the forbidden root directory and execute the entry point named by package metadata. Update the package, both plugin manifests, and RPC client identifier to 0.6.1.

The existing packaging test must fail on the old layout before implementation. Existing CLI, marathon, setup, and build tests cover behavior after the move. New test count is zero; extend existing behavioral coverage.

### T2: Update current instructions and explain installation

Replace active CLI paths in shared skills, host references, AGENTS.md, CONTRIBUTING.md, README.md, and maintained guides. Preserve all other instruction contracts and protected literals. Keep dated history unchanged. Document the hosted packaging requirement and the direct-path migration. Update current version statements to 0.6.1. Perform an independent review after integration.

```relay-plan
{
  "slug": "hosted-plugin-packaging",
  "suite": "npm test",
  "tasks": [
    {
      "id": "T1", "title": "Move executable and runtime references", "tier": "mid", "code": "prose", "risk": "medium",
      "files": ["bin/relay", "scripts/relay.mjs", "package.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "lib/codex-rpc.mjs", "lib/marathon.mjs", "scripts/relay-setup.mjs", "scripts/relay-doctor.mjs", "test/helpers.mjs", "test/package.test.mjs", "test/marathon.test.mjs", "test/build.test.mjs", ".github/workflows/ci.yml"],
      "deps": [], "behaviors": ["Hosted payload has no top-level bin directory", "Public CLI and relocated package execution retain behavior"], "tests": 0,
      "done": "node --test test/package.test.mjs test/marathon.test.mjs test/build.test.mjs"
    },
    {
      "id": "T2", "title": "Update active instructions and guides", "tier": "mid", "code": "prose", "risk": "low",
      "files": ["AGENTS.md", "CONTRIBUTING.md", "README.md", "docs/architecture/overview.md", "docs/configuration/README.md", "docs/guides/development.md", "docs/guides/getting-started.md", "docs/testing/README.md", "skills/handoff/SKILL.md", "skills/plan-with-tiers/SKILL.md", "skills/qa-mindset/SKILL.md", "skills/relay-board/SKILL.md", "skills/relay-budget/SKILL.md", "skills/relay-calibrate/SKILL.md", "skills/relay-forecast/SKILL.md", "skills/relay-lanes/SKILL.md", "skills/relay-marathon/SKILL.md", "skills/relay-plan/SKILL.md", "skills/relay-run/SKILL.md", "skills/relay-setup/SKILL.md", "skills/relay-status/SKILL.md", "skills/run-lanes/SKILL.md", "skills/using-relay/SKILL.md", "skills/using-relay/references/codex.md", "skills/using-relay/references/claude-code.md"],
      "deps": [], "behaviors": ["Active instructions resolve the new installed executable", "Current guides explain hosted packaging and the direct-path change"], "tests": 0,
      "done": "node scripts/relay.mjs build --check"
    }
  ]
}
```
