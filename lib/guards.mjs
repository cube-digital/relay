// Pure helpers for the protect-tests hook (kept here so tests can import them).

const WRITE_VERBS = /(\bsed\s+(-\w*\s+)*-i|\bperl\s+(-\w*\s+)*-i|\btee\b|\bmv\b|\brm\b|\bcp\b|\btruncate\b|\bgit\s+(checkout|restore|rm|mv)\b|\bdd\b)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Running a protected test is fine; writing to it from the shell is not.
export function shellWritesTo(command, literal) {
  if (!command.includes(literal)) return false;
  if (WRITE_VERBS.test(command)) return true;
  return new RegExp(`>{1,2}\\s*['"]?\\S*${escapeRe(literal)}`).test(command);
}

export function literalPrefix(glob) {
  return glob.replace(/[*?[].*$/, '');
}

export function protectedMessage(path) {
  return (
    `relay protect-tests: ${path} is a protected acceptance test, written from the spec.\n` +
    'Do not edit, weaken, skip or delete it to get green. If you believe the test is wrong, stop and report ' +
    'BLOCKED with the evidence: the spec line, what the test expects, what the code does.'
  );
}
