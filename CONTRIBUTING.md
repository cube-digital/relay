<!-- generated-by: gsd-doc-writer -->
# Contributing

Use the [getting-started guide](docs/guides/getting-started.md) for prerequisites and first use, the [development guide](docs/guides/development.md) for source changes, and the [testing guide](docs/testing/README.md) for verification.

## Development setup

Relay requires Node.js `>=20` and Git. The CLI has no runtime dependencies or compile step.

```bash
git clone https://github.com/cube-digital/relay.git
cd relay
node bin/relay --help
```

Read [AGENTS.md](AGENTS.md) before editing. Shared instructions belong there; this plugin root deliberately has no `CLAUDE.md`.

## Coding standards

- Edit role sources in `roles/` and shared policy in `config/routing.json` (Claude) and `codex-math/config/codex-routing.json` (Codex), then run `node bin/relay build`. Review the generated diff; do not hand-edit `agents/`, `codex/`, or the marked routing block in `hooks/register.ts`.
- The build checks the Codex role tiers against `roles/`. Package and discovery changes need the existing package checks for both hosts.
- Keep shared skills short and portable. Frontmatter permits only `name` and `description`; descriptions state when the skill applies. Use action names or both hosts' supported forms.
- Follow the shared [language guide](skills/using-relay/references/language-guide.md). Keep exact literals intact. Instruction drafts and adaptive learner explanations have different writing needs. Preserve hook fail-open behavior and add no runtime dependencies.

There is no configured linter or formatter. Follow surrounding style. CI runs the Node test suite and generation check.

## Pull request checklist

No dedicated PR template, contributor branch convention, or commit-message format is documented. The default branch is `main`; use a descriptive branch and clear commits.

- Describe the problem and the resulting behavior. Keep the change scoped and preserve other contributors' work.
- Include relevant source changes and regenerated artifacts. Review role contracts, output scope, exact identifiers, and host differences.
- Test observable behavior with existing focused checks before broad checks. CLI tests use real temporary Git repositories. Preserve protected acceptance tests; report a specification conflict instead of weakening one.
- Record the commands run, their results, and any unavailable checks. For code/test reports, include `tests: +<added> -<removed>` and the behavior each added test guards.
- For prose-only work, check facts, links, and diagrams manually. Run required repository checks without adding unit tests that repeat the prose.
- Distinguish automated checks, language assessment, and live-host observations. Static checks do not prove discovery, hook trust, audited STE conformance, or passed teaching scenarios.

Before finishing:

```bash
npm test
node bin/relay build --check
```

When `hooks/register.ts` changes, also run `claude plugin validate .` and `claude plugin test .`. If the installed CLI lacks the test command, record its version and the blocker; do not report success for that check. Details are in the [development guide](docs/guides/development.md#verification).

Relay runs produce `relay/<slug>/integration` and lane branches. Merging the integration branch into the user's branch is the human's decision. Keep assigned reports within their scope and host permissions.

## Issue reporting

Use the repository's [issue tracker](https://github.com/cube-digital/relay/issues). No issue templates are present. For a bug, include:

- Reproduction steps, expected behavior, and actual behavior.
- Relay version, host name/version, Node version, and operating system.
- Relevant command output, errors, and a small fixture where possible. Omit secrets and personal configuration values.

For a feature request, describe the use case and desired behavior. Identify relevant Claude Code and Codex differences.

## Releases

Follow the [README release workflow](README.md#releasing). Releases keep `package.json` and both plugin manifest versions aligned. New capabilities require the corresponding packaged release and plugin refresh; a checkout edit does not update an installed cache. Do not bump versions for unrelated documentation work.
