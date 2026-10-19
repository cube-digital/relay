// Glob → RegExp for repo-relative paths: `**` crosses directories, `*` and `?`
// stay within one segment. A pattern ending in `/` matches everything below it.

export function globToRegExp(glob) {
  let pattern = glob.trim().replace(/^\.\//, '');
  if (pattern.endsWith('/')) pattern += '**';
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const slash = pattern[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  const clean = path.replace(/^\.\//, '');
  return globs.some((g) => globToRegExp(g).test(clean));
}
