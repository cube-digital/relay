// Answer and resume: the human's answer to a blocked plan becomes a ruling in its ledger,
// then HQ starts the run, which resumes from the ledger. Refusals write nothing.

import { relative, sep } from 'node:path';
import { boardFor } from '../../scripts/relay-board.mjs';
import { appendLedger } from '../../scripts/relay-ledger.mjs';
import { previewLaunch, startFromIntent } from './launch.mjs';
import { listLaunches } from './launches.mjs';
import { clearRepoCache, planFileOf } from './repo.mjs';

const MAX_TEXT = 4000;
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function isBlocked(board) {
  const m = board.marathon;
  return board.status === 'blocked' || Boolean(m?.endedAt && String(m.stopReason ?? '').startsWith('blocked'));
}

export function answerPlan(path, slug, text, ctx = {}) {
  const ruling = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (ruling.length < 1 || ruling.length > MAX_TEXT) throw fail(400, `the answer must be 1 to ${MAX_TEXT} characters`);
  const abs = planFileOf(path, slug);
  const r = boardFor(abs);
  if (r.errors) throw fail(409, r.errors.join('; '));
  if (!isBlocked(r.board)) throw fail(409, `plan "${slug}" is not blocked`);
  const plan = relative(path, abs).split(sep).join('/');
  const launches = ctx.launches ?? listLaunches();
  const last = launches.find((l) => l.repo === path && l.plan === plan && (l.action === 'run' || l.action === 'marathon'));
  const intent = { action: 'run', repo: path, plan, harness: last?.harness === 'codex' ? 'codex' : 'claude' };
  const preview = previewLaunch(intent, ctx);
  if (preview.guards.errors.length) throw fail(409, preview.guards.errors.join('; '), { guards: preview.guards });
  appendLedger(abs, `Ruling: ${ruling} (from HQ)`);
  clearRepoCache();
  return startFromIntent({ ...intent, confirm: true }, ctx);
}
