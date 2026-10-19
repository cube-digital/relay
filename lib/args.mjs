// Tiny argv parser: positionals, `--flag`, `--key value`, `--key=value`.
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (booleans.includes(a.slice(2)) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      out[a.slice(2)] = true;
    } else {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}
