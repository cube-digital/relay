// relay HQ routes: hash → view, old routes redirected. Pure (no DOM), so Node tests import it.

// [id, name, glyph]
export const SETUP_TABS = [
  ['team', 'Team', '☻'],
  ['flows', 'Flows', '⇄'],
  ['skills', 'Skills', '✦'],
  ['connectors', 'Connectors', '⌁'],
  ['keys', 'API keys', '⚿'],
  ['routines', 'Routines', '◷'],
  ['repos', 'Repositories', '▦'],
];
const TAB_IDS = new Set(SETUP_TABS.map(([id]) => id));
const BRAIN_ALIASES = { agents: 'team', wiring: 'flows' };
const ALL = '#/';

const decode = (p) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

// { name: 'overview' | 'all' | 'project' | 'run' | 'setup' | 'launch' | 'routine', ...params, redirect?: hash }
export function parseRoute(hash = '') {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  const [head, a, b, c, d, e] = parts;
  const enc = encodeURIComponent;
  switch (head) {
    case undefined:
      return { name: 'all' };
    case 'overview':
      return { name: 'overview' };
    case 'projects':
      if (!a) return { name: 'all', redirect: ALL };
      return b ? { name: 'project', id: a, redirect: `#/projects/${enc(a)}` } : { name: 'project', id: a };
    case 'repos':
      if (a && b === 'plans' && c) return { name: 'run', rid: a, slug: c, task: d === 'tasks' ? e : undefined };
      return { name: 'all', redirect: ALL };
    case 'setup':
      return TAB_IDS.has(a) ? { name: 'setup', tab: a } : { name: 'setup', tab: 'team', redirect: '#/setup/team' };
    case 'brain': {
      const wanted = BRAIN_ALIASES[a] ?? a;
      const tab = TAB_IDS.has(wanted) ? wanted : 'team';
      return { name: 'setup', tab, redirect: `#/setup/${tab}` };
    }
    case 'routines':
      return a ? { name: 'routine', id: a } : { name: 'setup', tab: 'routines', redirect: '#/setup/routines' };
    case 'launches':
      return a ? { name: 'launch', id: a } : { name: 'all', redirect: ALL };
    default:
      return { name: 'all', redirect: ALL };
  }
}
