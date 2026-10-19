// Minimal frontmatter parser for relay's own files: flat `key: value` pairs,
// optional quotes, `[a, b]` or comma lists for list keys. Not a YAML parser.

const LIST_KEYS = new Set(['tools', 'disallowedTools', 'skills']);

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.trimStart().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) throw new Error(`frontmatter: cannot parse line "${line}"`);
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (LIST_KEYS.has(key)) {
      const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
      data[key] = inner.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (/^-?\d+$/.test(value)) {
      data[key] = Number(value);
    } else if (value === 'true' || value === 'false') {
      data[key] = value === 'true';
    } else {
      data[key] = value;
    }
  }
  return { data, body: match[2] };
}

export function stripFrontmatter(text) {
  return parseFrontmatter(text).body;
}
