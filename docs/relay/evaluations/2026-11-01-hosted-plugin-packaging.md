# Hosted Plugin Packaging Evaluation

**Date:** 2026-11-01
**Version:** 0.6.1
**Plan:** [Hosted plugin packaging](../plans/2026-11-01-hosted-plugin-packaging.md)

## Observed problem and repair

Claude Code's local installer reported Relay 0.6.0 installed and enabled. The user confirmed that the repeated sync error appeared in Claude Desktop's Settings > Plugins screen.

Relay's marketplace points to the repository root, which contained `bin/relay`. [Anthropic's hosted packaging rule](https://code.claude.com/docs/en/plugins/host-marketplace#distribute-through-organization-settings) rejects plugins that contain a top-level `bin/` directory. This established a concrete packaging incompatibility. The detailed response from Relay's hosted sync attempt was unavailable, so additional hosted validation errors could not be excluded.

The repair moves the executable to `scripts/relay.mjs`. Package metadata retains the command name `relay`. Runtime callers, CI, shared skills, setup diagnostics, tests, and maintained guides use the new path. The old directory is absent. Existing cached releases remain self-contained. Dated plans and evaluation records retain their original paths.

## Verification

- The existing packaged-resource test failed on 0.6.0 with `hosted Claude plugins must not contain a top-level bin directory`.
- `node --check scripts/relay.mjs`: PASS.
- `node --check lib/marathon.mjs`: PASS.
- `node scripts/relay.mjs build`: PASS. Generated outputs did not change.
- `node scripts/relay.mjs build --check`: PASS. Generated files are current and skills are portable.
- `npm test`: PASS. All 93 tests passed, with no skipped or failed tests. Existing package coverage executes the relocated entry point from package metadata, outside the source checkout.
- An offline `npm pack --dry-run --json --ignore-scripts` inspection found 138 files. The payload includes `scripts/relay.mjs` with mode `755` and contains no top-level `bin/` entries.
- Package and both plugin manifest versions agree at `0.6.1`. The RPC client identifier also uses `0.6.1`.
- `claude plugin validate .`: PASS, with the existing nonblocking marketplace description warning.
- `claude plugin validate .claude-plugin/plugin.json`: PASS.
- Independent source review approved both plan tasks and reported zero blocking findings.
- `hooks/register.ts` is unchanged. Its additional modification-specific checks were not required.

Tests: `+0 -0`. The existing packaging test now rejects the forbidden source and payload layout. Existing CLI and marathon tests use the relocated executable.

## Remaining live check

Computer Use access to Claude Desktop was not approved. The account-level marketplace sync could not be retried through the UI during this evaluation. After the corrected source reaches GitHub, retry Sync in Claude Desktop. A successful local validation or package inspection does not establish hosted server acceptance.
