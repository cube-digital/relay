// Conservative TOML syntax preflight for setup. This is not a TOML serializer:
// existing configuration is always preserved byte-for-byte, even when valid.
export function configProblem(source) {
  const stack = [];
  let quote = '', multiline = false, escaped = false, comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (comment) { if (c === '\n') comment = false; continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (quote === '"' && c === '\\') { escaped = true; continue; }
      if (multiline && source.slice(i, i + 3) === quote.repeat(3)) { i += 2; quote = ''; multiline = false; }
      else if (!multiline && c === quote) quote = '';
      else if (!multiline && c === '\n') return 'unterminated quoted value';
      continue;
    }
    if (c === '#') { comment = true; continue; }
    if (c === '"' || c === "'") {
      quote = c;
      multiline = source.slice(i, i + 3) === c.repeat(3);
      if (multiline) i += 2;
    } else if (c === '[' || c === '{') stack.push(c);
    else if (c === ']' || c === '}') {
      if (stack.pop() !== (c === ']' ? '[' : '{')) return 'unbalanced delimiters';
    }
  }
  if (quote || stack.length) return 'unterminated quoted value or table/array';
  return null;
}
