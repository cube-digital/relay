// Relay's Claude Code mod: deterministic model routing, budget-aware caps, and
// lane worktrees for subagents. Codex has no mods; there the same policy comes
// from codex/agents/*.toml and [agents] defaults (see scripts/relay-setup.mjs).

import type { EngineInterface, Register } from 'claude-code'

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
}
