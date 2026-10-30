# Working on relay

Instructions for coding agents. Claude Code and Codex both read AGENTS.md; there is deliberately no CLAUDE.md (at a plugin root it would not load as context anyway).

- **Sources vs generated.** Edit `roles/*.md`, `config/routing.json` and `codex-math/config/codex-routing.json`. Never hand-edit `agents/*.md`, `codex/**` or the `<relay:generated>` block in `hooks/register.ts`; run `node bin/relay build`.
- **Before you finish:** `npm test`, `node bin/relay build --check`, and when you touched `hooks/register.ts`: `claude plugin validate .` and `claude plugin test .`.
- **Skills are shared by Claude Code and Codex.** Frontmatter is `name` + `description` only. Name actions, not tools ("dispatch the reviewer agent"), unless you give both harnesses' forms. The description says when to use the skill, nothing else. Keep SKILL.md short: everything in it is paid for on every invocation.
- **Hooks must fail open.** A hook that errors exits 0; only a deliberate decision blocks (exit 2 with the reason on stderr). The mod's gating hooks keep their `.catch(... => next(e))`.
- **The mod runs without Node:** no `node:` imports, no fs except through `$`. Keep its logic pure and covered by `hooks/register.test.ts`.
- **No dependencies.** The CLI is plain Node ≥ 20.
- **Tests for the CLI use real git repositories** (`test/helpers.mjs`). Test behavior, not implementation; follow `skills/qa-mindset`.
