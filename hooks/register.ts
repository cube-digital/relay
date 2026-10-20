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
    "conductor": "mid",
    "implementer-deep": "strong",
    "implementer-fast": "cheap",
    "implementer": "mid",
    "reviewer": "mid",
    "scout": "cheap",
    "test-author": "mid"
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
        "test-author"
      ],
      "hide": [
        "implementer-deep"
      ]
    }
  }
} as const satisfies Routing
// </relay:generated>

type Tier = 'cheap' | 'mid' | 'strong'
type Cap = { capStrongTo: Tier; exempt: readonly string[] }
type Routing = {
  tiers: Record<Tier, string>
  roles: Record<string, Tier>
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
    if (model === undefined && cwd === e.cwd) return next(e)
    return next({ ...e, ...(model !== undefined ? { model } : {}), ...(cwd !== undefined ? { cwd } : {}) })
  }).catch(($, e, next) => next(e)) // fail open: a relay bug must never block a spawn

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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (bandHidden || e.props.hasSurvey || !showsBand(board, Date.now())) return next(e)
    const b = board
    const { Box, Text, Button } = $.ui.resolve(e)
    const tasks = b.waves.flatMap(w => w.lanes.flatMap(l => l.tasks))
    const room = Math.max(0, (e.props.bodyColumns ?? 80) - 60)
    const dots = tasks.length <= room ? tasks.map(t => el(Text, { color: COLOR[t.light] }, t.state === 'queued' ? '·' : '●')) : []
    return el(
      Box,
      { flexDirection: 'row', columnGap: 1, alignItems: 'center' },
      el(Text, { bold: true }, `relay · ${b.slug}`),
      el(Text, {}, ...dots),
      el(Text, { dimColor: true }, boardSummary(b)),
      el(Button, { key: 'relay-board-open', label: 'Board', onPress: () => openBoard($) }),
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
}
