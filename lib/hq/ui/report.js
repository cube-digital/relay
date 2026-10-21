// Renders a routine report (a small markdown subset) as DOM built only with h().
// Links become anchors only for https:// URLs; everything else is plain text.

import { fill, h, link } from './dom.js';

const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)\]]+)/g;

function inline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h('code', {}, m[1]));
    else if (m[3] !== undefined) out.push(m[3].startsWith('https://') ? link(m[3], m[2]) : m[0]);
    else out.push(m[4].startsWith('https://') ? link(m[4], m[4]) : m[4]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};
const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function listFrom(lines, start) {
  let i = start;
  const items = [];
  const ordered = /\d+\./.test(ITEM.exec(lines[i])[2]);
  while (i < lines.length && ITEM.test(lines[i])) {
    const [, indent, marker, text] = ITEM.exec(lines[i]);
    if (indent.length < 2 && /\d+\./.test(marker) !== ordered) break;
    if (indent.length >= 2 && items.length) items[items.length - 1].sub.push({ marker, text });
    else items.push({ text, sub: [], marker });
    i += 1;
  }
  const tag = (marker) => (/\d+\./.test(marker) ? 'ol' : 'ul');
  const el = h(tag(ordered ? '1.' : '-'), {}, items.map((it) => h('li', {}, inline(it.text),
    it.sub.length ? h(tag(it.sub[0].marker), {}, it.sub.map((s) => h('li', {}, inline(s.text)))) : null)));
  return { el, next: i };
}

export function renderReport(text) {
  const root = h('div', { class: 'report' });
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      fill(root, [...root.childNodes], h('pre', {}, h('code', {}, code.join('\n'))));
      continue;
    }
    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head) { fill(root, [...root.childNodes], h(['h2', 'h3', 'h4'][head[1].length - 1], {}, inline(head[2]))); i += 1; continue; }
    if (ITEM.test(line)) {
      const { el, next } = listFrom(lines, i);
      fill(root, [...root.childNodes], el);
      i = next;
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      fill(root, [...root.childNodes], h('table', {}, h('thead', {}, h('tr', {}, header.map((c) => h('th', {}, inline(c))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c))))))));
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,3}\s|^\s*([-*]|\d+\.)\s/.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++].trim());
    fill(root, [...root.childNodes], h('p', {}, inline(para.join(' '))));
  }
  return root;
}
