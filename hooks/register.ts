// Relay's Claude Code mod: deterministic model routing, budget-aware caps, and
// lane worktrees for subagents. Codex has no mods; there the same policy comes
// from codex/agents/*.toml and [agents] defaults (see scripts/relay-setup.mjs).

import type { EngineInterface, Register, RenderElement } from 'claude-code'

// <relay:generated> written by scripts/build.mjs from config/routing.json and roles/*.md; do not edit by hand
const ROUTING = {
  "tiers": {
    "cheap": "haiku",
    "mid": "sonnet",
    "strong": "opus"
  },
  "roles": {
    "architect": "strong",
    "business-analyst": "strong",
    "conductor": "mid",
    "implementer-deep": "strong",
    "implementer-fast": "cheap",
    "implementer": "mid",
    "platform-engineer": "mid",
    "reviewer": "mid",
    "scout": "cheap",
    "test-author": "mid"
  },
  "team": {
    "architect": {
      "title": "Software Architect",
      "avatar": "AR",
      "color": "red",
      "hex": "#f43f5e",
      "kind": "planner",
      "tier": "strong"
    },
    "business-analyst": {
      "title": "Business Analyst",
      "avatar": "BA",
      "color": "cyan",
      "hex": "#5ee7ff",
      "kind": "planner",
      "tier": "strong"
    },
    "conductor": {
      "title": "Delivery Lead",
      "avatar": "DL",
      "color": "pink",
      "hex": "#f472b6",
      "kind": "coordinator",
      "tier": "mid"
    },
    "implementer-deep": {
      "title": "Senior Engineer",
      "avatar": "SR",
      "color": "purple",
      "hex": "#8b5cf6",
      "kind": "builder",
      "tier": "strong"
    },
    "implementer-fast": {
      "title": "Engineer",
      "avatar": "EN",
      "color": "green",
      "hex": "#34d399",
      "kind": "builder",
      "tier": "cheap"
    },
    "implementer": {
      "title": "Software Engineer",
      "avatar": "SE",
      "color": "blue",
      "hex": "#60a5fa",
      "kind": "builder",
      "tier": "mid"
    },
    "platform-engineer": {
      "title": "Platform Engineer",
      "avatar": "PE",
      "color": "orange",
      "hex": "#fb923c",
      "kind": "builder",
      "tier": "mid"
    },
    "reviewer": {
      "title": "Code Reviewer",
      "avatar": "CR",
      "color": "orange",
      "hex": "#fb923c",
      "kind": "reviewer",
      "tier": "mid"
    },
    "scout": {
      "title": "Code Scout",
      "avatar": "SC",
      "color": "cyan",
      "hex": "#5ee7ff",
      "kind": "finder",
      "tier": "cheap"
    },
    "test-author": {
      "title": "Test Engineer",
      "avatar": "TE",
      "color": "yellow",
      "hex": "#f59e0b",
      "kind": "builder",
      "tier": "mid"
    }
  },
  "unrouted": {
    "general-purpose": "mid",
    "claude": "mid",
    "Plan": "mid",
    "Explore": "cheap"
  },
  "budget": {
    "fiveHour": {
      "tight": 60,
      "critical": 85
    },
    "sevenDay": {
      "tight": 80,
      "critical": 95
    },
    "tight": {
      "capStrongTo": "mid",
      "exempt": [
        "architect"
      ]
    },
    "critical": {
      "capStrongTo": "mid",
      "exempt": [],
      "denyNewSpawns": [
        "implementer",
        "implementer-fast",
        "implementer-deep",
        "test-author",
        "platform-engineer"
      ],
      "hide": [
        "implementer-deep"
      ]
    }
  }
} as const satisfies Routing
// </relay:generated>

type Tier = 'cheap' | 'mid' | 'strong'
type Member = { title: string; avatar: string; color: string; hex: string; kind: string; tier: Tier }
type Cap = { capStrongTo: Tier; exempt: readonly string[] }
type Routing = {
  tiers: Record<Tier, string>
  roles: Record<string, Tier>
  team: Record<string, Member>
  unrouted: Record<string, Tier>
  budget: {
    fiveHour: { tight: number; critical: number }
    sevenDay: { tight: number; critical: number }
    tight: Cap
    critical: Cap & { denyNewSpawns: readonly string[]; hide: readonly string[] }
  }
}
type Level = 'normal' | 'tight' | 'critical' | 'unknown'
type Window = { percentUsed: number; resetsAt?: string }
type Limits = { kind: string; percentUsed: number; resetsAt?: string }[]

const routing: Routing = ROUTING
const LANE_NAME = /^lane-([a-z]+)(?:-[\w-]+)?$/

let fiveHour: Window | undefined
let sevenDay: Window | undefined
let announced: Level | undefined

export function remember(limits: Limits): void {
  for (const l of limits) {
    if (l.kind === 'five_hour') fiveHour = { percentUsed: l.percentUsed, resetsAt: l.resetsAt }
    if (l.kind === 'seven_day') sevenDay = { percentUsed: l.percentUsed, resetsAt: l.resetsAt }
  }
}

export function levelOf(): Level {
  if (!fiveHour && !sevenDay) return 'unknown'
  const b = routing.budget
  const p5 = fiveHour?.percentUsed ?? 0
  const p7 = sevenDay?.percentUsed ?? 0
  if (p5 >= b.fiveHour.critical || p7 >= b.sevenDay.critical) return 'critical'
  if (p5 >= b.fiveHour.tight || p7 >= b.sevenDay.tight) return 'tight'
  return 'normal'
}

function describe(): string {
  const part = (label: string, w?: Window) => (w ? `${label} ${w.percentUsed}%` : undefined)
  return [part('5h', fiveHour), part('7d', sevenDay)].filter(Boolean).join(', ') || 'no reading'
}

function roleOf(agentType: string): string | undefined {
  const name = agentType.startsWith('relay:') ? agentType.slice('relay:'.length) : undefined
  return name !== undefined && name in routing.roles ? name : undefined
}

export function tierOfModel(model: string | undefined): Tier | undefined {
  if (!model) return undefined
  const m = model.toLowerCase()
  if (m.includes('opus') || m.includes('fable') || m === 'best') return 'strong'
  if (m.includes('sonnet')) return 'mid'
  if (m.includes('haiku')) return 'cheap'
  return undefined
}

// The model this spawn should get, or undefined to leave Claude Code's choice alone.
export function routeModel(
  input: { subagentType: string; model?: string; parentModel: string },
  level: Level,
): string | undefined {
  const role = roleOf(input.subagentType)
  let model = input.model
  if (!model && !role) {
    const tier = routing.unrouted[input.subagentType]
    if (tier) model = routing.tiers[tier]
  }
  const roleTier = role !== undefined ? routing.roles[role] : undefined
  const effective = model ?? (roleTier ? routing.tiers[roleTier] : input.parentModel)
  if (level === 'tight' || level === 'critical') {
    const cap = routing.budget[level]
    const exempt = role !== undefined && cap.exempt.includes(role)
    if (!exempt && tierOfModel(effective) === 'strong') model = routing.tiers[cap.capStrongTo]
  }
  return model === input.model ? undefined : model
}

async function laneCwd($: EngineInterface, name?: string): Promise<string | undefined> {
  const id = name ? LANE_NAME.exec(name)?.[1] : undefined
  if (!id) return undefined
  try {
    const root = await $.session.root()
    const text = await $.fs.read(`${root}/.relay/lanes/active.json`)
    const active = JSON.parse(String(text)) as { lanes?: Record<string, { worktree?: string }> }
    return active.lanes?.[id]?.worktree
  } catch {
    return undefined
  }
}

async function snapshot($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (!home) return
  const body = { source: 'claude-code', updatedAt: new Date().toISOString(), level: levelOf(), fiveHour, sevenDay }
  await $.fs.write(`${home}/.relay/budget.json`, JSON.stringify(body, null, 2) + '\n')
}


// ---- The board: a traffic light per task of the plan being run, drawn in a band
// above the prompt while a run is going and in a pane (/relay-board). `relay board`,
// `relay ledger` and `relay worktrees` write .relay/board.json; this mod only reads it.

type Light = 'grey' | 'yellow' | 'green' | 'red'
type BoardTask = { id: string; title: string; state: string; light: Light }
type BoardLane = { id: string; state: string; light: Light; note: string; tasks: BoardTask[] }
type BoardWave = { wave: number; state: string; light: Light; lanes: BoardLane[] }
export type Board = {
  slug: string
  status: 'planned' | 'running' | 'blocked' | 'complete'
  green: number
  currentWave: number
  waveCount: number
  updatedAt: string
  totals: { tasks: number; working: number; blocked: number }
  waves: BoardWave[]
  rulings: string[]
}

const BOARD_PANE = 'relay-board'
const COLOR: Record<Light, string> = { grey: 'inactive', yellow: 'warning', green: 'success', red: 'error' }
const GLYPH: Record<string, string> = { planned: '○', queued: '·', working: '◐', done: '✓', merged: '✓', blocked: '✕' }
const LABEL: Record<string, string> = {
  planned: 'planned',
  queued: 'queued',
  working: 'in progress',
  done: 'done, not merged',
  merged: 'merged',
  blocked: 'blocked',
}

let board: Board | undefined
let boardStamp = -1
let bandHidden = false

export function boardSummary(b: Board): string {
  const where = b.status === 'complete' ? 'complete' : b.status === 'planned' ? 'not started' : `wave ${b.currentWave}/${b.waveCount}`
  return `${b.green}/${b.totals.tasks} green · ${where}` + (b.totals.blocked ? ` · ${b.totals.blocked} blocked` : '')
}

// The band shows while a run is going, and for an hour after it completes.
export function showsBand(b: Board | undefined, now: number): b is Board {
  if (!b) return false
  if (b.status === 'running' || b.status === 'blocked') return true
  return b.status === 'complete' && now - Date.parse(b.updatedAt) < 3_600_000
}

async function loadBoard($: EngineInterface): Promise<boolean> {
  try {
    const path = `${await $.session.root()}/.relay/board.json`
    const st = await $.fs.stat(path)
    if (st.mtimeMs === boardStamp) return false
    board = JSON.parse(String(await $.fs.read(path))) as Board
    boardStamp = st.mtimeMs
    return true
  } catch {
    const had = board !== undefined
    board = undefined
    boardStamp = -1
    return had
  }
}

// h() as JSX would type it: the element a render hook returns
const el = (...args: Parameters<typeof h>): RenderElement => h(...args) as RenderElement

async function openBoard($: EngineInterface): Promise<void> {
  if (board) await $.ui.open({ id: BOARD_PANE, title: `relay · ${board.slug}` })
}

// ---- The team: who is working, drawn as avatars in the band and listed in a pane
// (/relay-team). Tracked from agent.spawn (identity, lane, model), turn.step (tokens
// from each step's stop chunk) and turn.complete (done). In memory only.

export type TeamAgent = {
  id: string
  name: string
  role: string
  title: string
  avatar: string
  color: string
  hex: string
  lane?: string
  model: string
  startedAt: number
  endedAt?: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  state: 'working' | 'done'
}
type Tokens = TeamAgent['tokens']

const TEAM_PANE = 'relay-team'
const team = new Map<string, TeamAgent>()
const NO_HEX = '#888888'
const FORGET_AFTER = 3_600_000
const INVALIDATE_EVERY = 2000
let lastInvalidate = 0

export function teamState(): Map<string, TeamAgent> {
  return team
}

export function laneOf(name?: string): string | undefined {
  return name ? LANE_NAME.exec(name)?.[1] : undefined
}

// Steps and completions that arrive before their spawn is registered (the spawn result may
// resolve late); trackSpawn folds them in, so a finished agent is never left 'working'.
type Early = { tokens: Tokens; endedAt?: number }
const early = new WeakMap<Map<string, TeamAgent>, Map<string, Early>>()
function earlyOf(map: Map<string, TeamAgent>, id: string): Early {
  const all = early.get(map) ?? new Map<string, Early>()
  early.set(map, all)
  const e = all.get(id) ?? { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  all.set(id, e)
  if (all.size > 200) all.delete(all.keys().next().value as string)
  return e
}

export function trackSpawn(
  map: Map<string, TeamAgent>,
  s: { agentId: string; name?: string; subagentType: string; model: string },
  now: number,
): TeamAgent | undefined {
  const role = roleOf(s.subagentType)
  if (role === undefined) return undefined
  for (const [id, a] of map) if (a.state === 'done' && a.endedAt !== undefined && now - a.endedAt > FORGET_AFTER) map.delete(id)
  const who = routing.team[role] as Member | undefined
  const agent: TeamAgent = {
    id: s.agentId,
    name: s.name ?? role,
    role,
    title: who?.title ?? role,
    avatar: who?.avatar ?? role.slice(0, 2).toUpperCase(),
    color: who?.color ?? '',
    hex: who?.hex ?? NO_HEX,
    lane: laneOf(s.name),
    model: s.model,
    startedAt: now,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    state: 'working',
  }
  const seen = early.get(map)?.get(s.agentId)
  if (seen) {
    agent.tokens = { ...seen.tokens }
    if (seen.endedAt !== undefined) {
      agent.state = 'done'
      agent.endedAt = seen.endedAt
    }
    early.get(map)?.delete(s.agentId)
  }
  map.set(s.agentId, agent)
  return agent
}

export function trackStep(map: Map<string, TeamAgent>, agentId: string, tokens: Tokens): void {
  const a = map.get(agentId)
  if (!a) {
    const e = earlyOf(map, agentId)
    e.tokens.input += tokens.input
    e.tokens.output += tokens.output
    e.tokens.cacheRead += tokens.cacheRead
    e.tokens.cacheWrite += tokens.cacheWrite
    return
  }
  a.tokens.input += tokens.input
  a.tokens.output += tokens.output
  a.tokens.cacheRead += tokens.cacheRead
  a.tokens.cacheWrite += tokens.cacheWrite
  if (a.state === 'done') {
    a.state = 'working'
    delete a.endedAt
  }
}

export function trackComplete(map: Map<string, TeamAgent>, agentId: string, now: number): void {
  const a = map.get(agentId)
  if (!a) {
    earlyOf(map, agentId).endedAt = now
    return
  }
  a.state = 'done'
  a.endedAt = now
}

export function workingAgents(map: Map<string, TeamAgent>): TeamAgent[] {
  return [...map.values()].filter(a => a.state === 'working').sort((a, b) => a.startedAt - b.startedAt)
}

export function formatTokens(n: number): string {
  return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}k tok`
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export type TeamGroup = { lane: string | null; rows: { agent: TeamAgent; task?: string }[] }

// Agents by lane (lanes sorted, agents outside lanes last), each with the first task of
// its lane the board shows as working.
export function teamRows(map: Map<string, TeamAgent>, b: Board | undefined, now: number): TeamGroup[] {
  void now
  const lanes = b?.waves.flatMap(w => w.lanes) ?? []
  const taskOf = (lane: string | undefined): string | undefined => {
    const t = lane === undefined ? undefined : lanes.find(l => l.id === lane)?.tasks.find(x => x.state === 'working')
    return t ? `${t.id} ${t.title}` : undefined
  }
  const groups = new Map<string | null, TeamGroup>()
  for (const a of [...map.values()].sort((x, y) => x.startedAt - y.startedAt)) {
    const key = a.lane ?? null
    const g = groups.get(key) ?? { lane: key, rows: [] }
    const task = taskOf(a.lane)
    g.rows.push(task === undefined ? { agent: a } : { agent: a, task })
    groups.set(key, g)
  }
  return [...groups.values()].sort((x, y) => (x.lane === null ? 1 : y.lane === null ? -1 : x.lane.localeCompare(y.lane)))
}

const tokenTotal = (t: Tokens): number => t.input + t.output + t.cacheWrite

function touchTeam($: EngineInterface, now: number, force = false): void {
  if (!force && now - lastInvalidate < INVALIDATE_EVERY) return
  lastInvalidate = now
  $.ui.invalidate('ui.render')
}

async function openTeam($: EngineInterface): Promise<void> {
  await $.ui.open({ id: TEAM_PANE, title: 'relay · team' })
}

export const register: Register = on => {
  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      remember(e.rateLimits)
      void snapshot($).catch(() => undefined)
    }
    return next(e)
  })

  on('agent.offer', ($, e, next) => {
    const role = roleOf(e.agent)
    if (role && levelOf() === 'critical' && routing.budget.critical.hide.includes(role)) return { isOffered: false }
    return next(e)
  }).catch(($, e, next) => next(e)) // fail open: a relay bug must never hide agents

  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.resume || e.workflow) return next(e)
    const level = levelOf()
    const role = roleOf(e.subagentType)
    if (role && level === 'critical' && routing.budget.critical.denyNewSpawns.includes(role)) {
      return {
        deny:
          `relay: usage budget is critical (${describe()}). Finish the current wave, commit, ` +
          'and write a handoff (relay:handoff). Start no new implementation work until the window resets.',
      }
    }
    const model = routeModel(e, level)
    const cwd = e.cwd ?? (await laneCwd($, e.name))
    const res =
      model === undefined && cwd === e.cwd
        ? await next(e)
        : await next({ ...e, ...(model !== undefined ? { model } : {}), ...(cwd !== undefined ? { cwd } : {}) })
    try {
      const started = res as { agentId?: string; model?: string }
      if (role && typeof started.agentId === 'string') {
        const used = started.model ?? model ?? e.model ?? routing.tiers[routing.roles[role]]
        trackSpawn(team, { agentId: started.agentId, name: e.name, subagentType: e.subagentType, model: used }, Date.now())
        touchTeam($, Date.now(), true)
      }
    } catch {
      // tracking is optional; the spawn already happened
    }
    return res
  }).catch(($, e, next) => next(e)) // fail open: a relay bug must never block a spawn

  // turn.step streams and is not a gating hook (no .catch: it would re-run next); the hook re-yields every chunk untouched and only reads tokens off the stop chunk.
  on('turn.step', async function* ($, e, next) {
    const agentId = (e as { agentId?: string }).agentId
    try {
      if (agentId) {
        trackStep(team, agentId, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
        touchTeam($, Date.now())
      }
    } catch {
      // tracking is optional
    }
    const it = next(e)[Symbol.asyncIterator]()
    try {
      for (;;) {
        const r = await it.next()
        if (r.done) return r.value
        try {
          const chunk = r.value as { kind?: string; usage?: Record<string, number> | null }
          if (agentId && chunk.kind === 'stop' && chunk.usage) {
            trackStep(team, agentId, {
              input: chunk.usage.input_tokens ?? 0,
              output: chunk.usage.output_tokens ?? 0,
              cacheRead: chunk.usage.cache_read_input_tokens ?? 0,
              cacheWrite: chunk.usage.cache_creation_input_tokens ?? 0,
            })
            touchTeam($, Date.now())
          }
        } catch {
          // tracking is optional
        }
        yield r.value
      }
    } finally {
      await it.return?.(undefined)
    }
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const agentId = (e as { agentId?: string }).agentId
      if (agentId) {
        trackComplete(team, agentId, Date.now())
        touchTeam($, Date.now(), true)
      }
    } catch {
      // tracking is optional
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    if (!fiveHour && !sevenDay) {
      try {
        remember((await $.session.usage()).rateLimits)
      } catch {
        // no reading yet
      }
    }
    const level = levelOf()
    if (level === 'unknown' || level === announced) return next(e)
    announced = level
    const line =
      `[relay budget] ${level}: ${describe()}. ` +
      (level === 'normal'
        ? 'Route by plan tier.'
        : level === 'tight'
          ? 'Opus only for the final review; prefer cheap tiers where the plan has complete code.'
          : 'Finish the current wave, commit, write a handoff; start nothing new.')
    return next({ ...e, context: [...(e.context ?? []), line] })
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'relay-board', description: "Open relay's board: a traffic light for every task of the plan being run" })
      try {
        await $.command.register({
          name: 'relay-team',
          description: "Open relay's team: who is working on which lane, on which model, with how many tokens",
        })
      } catch {
        // the team pane is optional
      }
      await loadBoard($)
      $.clock.every(5000, async () => {
        if (await loadBoard($)) $.ui.invalidate('ui.render')
      })
    } catch {
      // the board is optional; routing must not depend on it
    }
    return next(e)
  })

  on('command.run', { command: 'relay-board' }, async $ => {
    await loadBoard($)
    if (!board) return { text: 'No relay board yet: make a plan with /relay:plan, or run `relay board <plan>`.' }
    bandHidden = false
    await openBoard($)
    return { text: `relay board · ${board.slug}: ${boardSummary(board)}` }
  })

  on('command.run', { command: 'relay-team' }, async $ => {
    await $.ui.open({ id: TEAM_PANE, title: 'relay · team' })
    return { text: `relay team: ${workingAgents(team).length} working` }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = Date.now()
    const working = workingAgents(team)
    const b = showsBand(board, now) ? board : undefined
    if (bandHidden || e.props.hasSurvey || (!b && !working.length)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const avatars = working.slice(0, 6).map(a => el(Text, { bold: true, color: a.hex }, a.avatar))
    if (working.length > 6) avatars.push(el(Text, { dimColor: true }, `+${working.length - 6}`))
    const boardParts: RenderElement[] = []
    if (b) {
      const tasks = b.waves.flatMap(w => w.lanes.flatMap(l => l.tasks))
      const room = Math.max(0, (e.props.bodyColumns ?? 80) - 60)
      const dots = tasks.length <= room ? tasks.map(t => el(Text, { color: COLOR[t.light] }, t.state === 'queued' ? '·' : '●')) : []
      boardParts.push(
        el(Text, {}, ...dots),
        el(Text, { dimColor: true }, boardSummary(b)),
        el(Button, { key: 'relay-board-open', label: 'Board', onPress: () => openBoard($) }),
      )
    }
    return el(
      Box,
      { flexDirection: 'row', columnGap: 1, alignItems: 'center' },
      el(Text, { bold: true }, b ? `relay · ${b.slug}` : 'relay'),
      ...avatars,
      ...boardParts,
      el(Button, { key: 'relay-team-open', label: 'Team', onPress: () => openTeam($) }),
      el(Button, {
        key: 'relay-board-hide',
        label: 'Hide',
        onPress: () => {
          bandHidden = true
          $.ui.invalidate('ui.render')
        },
      }),
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: BOARD_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (!board) return el(Box, { flexDirection: 'column' }, el(Text, { dimColor: true }, 'No relay board yet.'))
    const b = board
    const light = (state: string, l: Light) => el(Text, { color: COLOR[l] }, GLYPH[state] ?? '○')
    const rows = [
      el(Text, { bold: true }, `${b.slug} · ${boardSummary(b)}`),
      el(Text, { dimColor: true }, `updated ${b.updatedAt.slice(11, 16)} UTC · ○ planned  ◐ in progress  ✓ done  ✕ blocked`),
    ]
    for (const w of b.waves) {
      rows.push(el(Text, {}, ' '))
      rows.push(el(Text, { bold: true }, light(w.state, w.light), ` Wave ${w.wave} · ${LABEL[w.state] ?? w.state}`))
      for (const l of w.lanes) {
        rows.push(el(Text, {}, '  ', light(l.state, l.light), ` lane ${l.id}  `, el(Text, { dimColor: true }, l.note)))
        for (const t of l.tasks) {
          rows.push(el(Text, {}, '     ', light(t.state, t.light), ` ${t.id} ${t.title}  `, el(Text, { dimColor: true }, LABEL[t.state] ?? t.state)))
        }
      }
    }
    if (b.rulings.length) rows.push(el(Text, {}, ' '), el(Text, { dimColor: true }, `${b.rulings.length} ruling(s): relay ledger <plan> --rulings`))
    return el(Box, { flexDirection: 'column' }, ...rows)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: TEAM_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = Date.now()
    const rows: RenderElement[] = []
    if (team.size) {
      for (const g of teamRows(team, board, now)) {
        rows.push(el(Text, { bold: true }, g.lane === null ? 'outside lanes' : `lane ${g.lane}`))
        for (const { agent: a, task } of g.rows) {
          rows.push(
            el(
              Text,
              {},
              '  ',
              el(Text, { bold: true, color: a.hex }, a.avatar),
              ` ${a.title}  `,
              el(
                Text,
                { dimColor: true },
                `${a.name}  ${task ?? '-'}  ${a.model}  ${formatTokens(tokenTotal(a.tokens))}  ${formatElapsed((a.endedAt ?? now) - a.startedAt)}  `,
              ),
              a.state,
            ),
          )
        }
      }
    } else {
      rows.push(el(Text, { dimColor: true }, 'Nobody is working. The team:'))
      for (const [role, m] of Object.entries(routing.team)) {
        rows.push(el(Text, {}, el(Text, { bold: true, color: m.hex }, m.avatar), ` ${m.title} (${role}) · ${m.kind} · ${m.tier}`))
      }
    }
    return el(Box, { flexDirection: 'column' }, ...rows)
  }).catch(($, e, next) => next(e))
}
