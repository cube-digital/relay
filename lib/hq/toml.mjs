// A TOML subset: enough for ~/.codex/config.toml and Codex agent files. Tables,
// arrays of tables, dotted and quoted keys, basic/literal/multi-line strings,
// integers, floats, booleans, arrays and inline tables; dates stay strings.
// parseToml never throws: { ok: true, value } or { ok: false, error: 'line N: ...' }.

export function parseToml(text) {
  try {
    return { ok: true, value: new Parser(String(text)).document() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BARE = /[A-Za-z0-9_-]+/y;
const ATOM = /[0-9A-Za-z_+\-.:]+/y;
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };

class Parser {
  constructor(src) {
    this.src = src.replace(/\r\n/g, '\n');
    this.i = 0;
    this.root = {};
  }

  fail(msg) {
    const line = this.src.slice(0, this.i).split('\n').length;
    throw new Error(`line ${line}: ${msg}`);
  }

  peek() {
    return this.src[this.i];
  }

  at(s) {
    return this.src.startsWith(s, this.i);
  }

  skipWs() {
    while (this.peek() === ' ' || this.peek() === '\t') this.i++;
  }

  skipComment() {
    if (this.peek() === '#') while (this.i < this.src.length && this.peek() !== '\n') this.i++;
  }

  skipBlank() {
    for (;;) {
      this.skipWs();
      this.skipComment();
      if (this.peek() !== '\n') return;
      this.i++;
    }
  }

  endOfLine() {
    this.skipWs();
    this.skipComment();
    if (this.i < this.src.length && this.peek() !== '\n') this.fail('unexpected text after a value');
    this.i++;
  }

  document() {
    let current = this.root;
    for (;;) {
      this.skipBlank();
      if (this.i >= this.src.length) return this.root;
      if (this.at('[[')) {
        this.i += 2;
        const path = this.keyPath();
        this.skipWs();
        if (!this.at(']]')) this.fail('expected ]]');
        this.i += 2;
        current = this.arrayTable(path);
      } else if (this.peek() === '[') {
        this.i++;
        const path = this.keyPath();
        this.skipWs();
        if (this.peek() !== ']') this.fail('expected ]');
        this.i++;
        current = this.table(this.root, path);
      } else {
        this.keyValue(current);
      }
      this.endOfLine();
    }
  }

  keyPath() {
    const parts = [];
    for (;;) {
      this.skipWs();
      parts.push(this.key());
      this.skipWs();
      if (this.peek() !== '.') return parts;
      this.i++;
    }
  }

  key() {
    let k;
    if (this.peek() === '"') k = this.basicString();
    else if (this.peek() === "'") k = this.literalString();
    else {
      BARE.lastIndex = this.i;
      const m = BARE.exec(this.src);
      if (!m) this.fail('expected a key');
      this.i += m[0].length;
      k = m[0];
    }
    if (k === '__proto__') this.fail('unsupported key');
    return k;
  }

  descend(t, k) {
    if (t[k] === undefined) t[k] = {};
    const v = t[k];
    if (Array.isArray(v) && isTable(v[v.length - 1])) return v[v.length - 1];
    if (!isTable(v)) this.fail(`"${k}" is not a table`);
    return v;
  }

  table(base, path) {
    let t = base;
    for (const k of path) t = this.descend(t, k);
    return t;
  }

  arrayTable(path) {
    const parent = this.table(this.root, path.slice(0, -1));
    const k = path[path.length - 1];
    if (parent[k] === undefined) parent[k] = [];
    if (!Array.isArray(parent[k])) this.fail(`"${k}" is not an array of tables`);
    const t = {};
    parent[k].push(t);
    return t;
  }

  keyValue(target) {
    const path = this.keyPath();
    this.skipWs();
    if (this.peek() !== '=') this.fail('expected =');
    this.i++;
    this.skipWs();
    const value = this.value();
    const t = this.table(target, path.slice(0, -1));
    const k = path[path.length - 1];
    if (Object.hasOwn(t, k)) this.fail(`duplicate key "${k}"`);
    t[k] = value;
  }

  value() {
    if (this.at('"""')) return this.multiBasic();
    if (this.at("'''")) return this.multiLiteral();
    const c = this.peek();
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    if (c === '[') return this.array();
    if (c === '{') return this.inlineTable();
    ATOM.lastIndex = this.i;
    const m = ATOM.exec(this.src);
    if (!m) this.fail('expected a value');
    this.i += m[0].length;
    const s = m[0];
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(s)) return Number(s.replace(/_/g, ''));
    if (/^0x[0-9a-fA-F](_?[0-9a-fA-F])*$/.test(s)) return parseInt(s.slice(2).replace(/_/g, ''), 16);
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(s)) return Number(s.replace(/_/g, ''));
    if (/^[+-]?(inf|nan)$/.test(s)) return s.endsWith('nan') ? NaN : s.startsWith('-') ? -Infinity : Infinity;
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{2}:\d{2}/.test(s)) return s;
    return this.fail('invalid value');
  }

  escape() {
    const c = this.src[this.i++];
    if (c !== undefined && Object.hasOwn(ESCAPES, c)) return ESCAPES[c];
    if (c === 'u' || c === 'U') {
      const n = c === 'u' ? 4 : 8;
      const hex = this.src.slice(this.i, this.i + n);
      if (hex.length !== n || !/^[0-9a-fA-F]+$/.test(hex)) this.fail('bad unicode escape');
      this.i += n;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    return this.fail('bad escape');
  }

  basicString() {
    this.i++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '\n') this.fail('unterminated string');
      this.i++;
      if (c === '"') return out;
      out += c === '\\' ? this.escape() : c;
    }
  }

  literalString() {
    this.i++;
    const end = this.src.indexOf("'", this.i);
    const nl = this.src.indexOf('\n', this.i);
    if (end === -1 || (nl !== -1 && nl < end)) this.fail('unterminated string');
    const s = this.src.slice(this.i, end);
    this.i = end + 1;
    return s;
  }

  multiBasic() {
    this.i += 3;
    if (this.peek() === '\n') this.i++;
    let out = '';
    for (;;) {
      if (this.i >= this.src.length) this.fail('unterminated string');
      if (this.at('"""')) {
        this.i += 3;
        for (let extra = 0; extra < 2 && this.peek() === '"'; extra++) {
          out += '"';
          this.i++;
        }
        return out;
      }
      const c = this.src[this.i++];
      if (c !== '\\') {
        out += c;
        continue;
      }
      const fold = /[ \t]*\n\s*/y;
      fold.lastIndex = this.i;
      const m = fold.exec(this.src);
      if (m) this.i += m[0].length;
      else out += this.escape();
    }
  }

  multiLiteral() {
    this.i += 3;
    if (this.peek() === '\n') this.i++;
    let end = this.src.indexOf("'''", this.i);
    if (end === -1) this.fail('unterminated string');
    for (let extra = 0; extra < 2 && this.src[end + 3] === "'"; extra++) end++;
    const s = this.src.slice(this.i, end);
    this.i = end + 3;
    return s;
  }

  array() {
    this.i++;
    const out = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === ']') {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.skipBlank();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      if (this.peek() === ']') {
        this.i++;
        return out;
      }
      this.fail('expected , or ] in an array');
    }
  }

  inlineTable() {
    this.i++;
    const t = {};
    this.skipWs();
    if (this.peek() === '}') {
      this.i++;
      return t;
    }
    for (;;) {
      this.skipWs();
      this.keyValue(t);
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      if (this.peek() === '}') {
        this.i++;
        return t;
      }
      this.fail('expected , or } in an inline table');
    }
  }
}
