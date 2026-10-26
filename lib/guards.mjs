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
    `relay protect-tests: ${path} is a protected acceptance test. It was written from the spec.\n` +
    'Do not edit, weaken, skip or delete it to make tests pass. If you believe the test is wrong, stop. Report ' +
    'BLOCKED with the evidence: the spec line, what the test expects, what the code does.'
  );
}

// Recognize literal targets of common shell writes. This is deliberately a
// small lexer, not an interpreter for variables, substitutions or program code.
export function shellWriteTargets(command) {
  const tokens = [...command.matchAll(/((?:[^\s"';&|<>\\]|\\.|'[^']*'|"[^"]*")+)|([;&|<>\n]+)/g)]
    .map(match => match[2] ?? match[1].replace(/'([^']*)'|"([^"]*)"|\\(.)/g, (_, single, double, escaped) => single ?? double ?? escaped));
  const paths = [];
  const fallbackCommands = [];
  const segmentPaths = words => {
    const segment = words.join(' ');
    while (/^(?:\w+=|env$|time$|exec$|command$)/.test(words[0] ?? '')) words.shift();
    const verb = (words.shift() ?? '').split('/').at(-1);
    if (verb === 'git' && !['checkout', 'restore', 'rm', 'mv'].includes(words.shift())) { fallbackCommands.push(segment); return; }
    if (verb === 'dd') {
      paths.push(...words.filter(word => word.startsWith('of=')).map(word => ({ path: word.slice(3) })));
      return;
    }
    if (!['rm', 'mv', 'cp', 'tee', 'truncate', 'git', 'sed', 'perl'].includes(verb)) {
      if (segment) fallbackCommands.push(segment);
      return;
    }
    if (['sed', 'perl'].includes(verb) && !words.some(word => /^-\w*i/.test(word))) return;
    const positional = [];
    let targetDirectory;
    let expressionOption = false;
    let literal = false;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!literal && word === '-i' && words[i + 1] === '' && verb === 'sed') { i++; continue; }
      if (!literal && word === '--') { literal = true; continue; }
      if (!literal && ['-t', '--target-directory'].includes(word)) { targetDirectory = words[++i]; continue; }
      if (!literal && ['-e', '-f'].includes(word) && ['sed', 'perl'].includes(verb)) { expressionOption = true; i++; continue; }
      if (!literal && ['-s', '--size', '-r', '--reference'].includes(word) && verb === 'truncate') { i++; continue; }
      if (!literal && word.startsWith('-')) continue;
      positional.push(word);
    }
    if (['sed', 'perl'].includes(verb) && !expressionOption) positional.shift();
    if (verb === 'cp' || verb === 'mv') {
      const destination = targetDirectory ?? positional.pop();
      for (const source of positional) {
        paths.push({ path: destination, source, removesAncestors: verb === 'mv' || words.some(word => /^-[^-]*[rRa]/.test(word) || word === '--recursive' || word === '--archive') });
        if (verb === 'mv') paths.push({ path: source, removesAncestors: true });
      }
    } else paths.push(...positional.map(path => ({ path, removesAncestors: verb === 'rm' || verb === 'git' })));
  };
  let words = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^[;&|\n]+$/.test(token)) { segmentPaths(words); words = []; }
    else if (/^>{1,2}$/.test(token)) {
      if (tokens[i + 1] && !/^[;&|<>\n]+$/.test(tokens[i + 1])) paths.push({ path: tokens[++i] });
    } else words.push(token);
  }
  segmentPaths(words);
  return { targets: paths.filter(target => typeof target.path === 'string' && target.path.length), fallbackCommands };
}
