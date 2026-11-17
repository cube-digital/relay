import { describe, expect, test } from 'claude-code/testing'
import {
  boardSummary,
  cacheShare,
  leadOverlay,
  profileFor,
  remember,
  routeModel,
  showsBand,
  spawnOverlay,
  tierOfModel,
  trackComplete,
  trackSpawn,
  trackStep,
  workingAgents,
} from './register.ts'
import type { Board } from './register.ts'

const CONTEXT = { window: 200_000 }

const spawnInput = (subagentType: string, extra: { model?: string; name?: string } = {}) => ({
  tool_use_id: 'toolu_test',
  prompt: 'do the task',
  description: 'test spawn',
  subagentType,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
  ...extra,
})

describe('routeModel', () => {
  test('sends an un-routed general-purpose spawn to the mid tier instead of inheriting', () => {
    expect(routeModel({ subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' }, 'normal')).toBe('sonnet')
  })

  test('sends an un-routed Explore spawn to the cheap tier', () => {
    expect(routeModel({ subagentType: 'Explore', parentModel: 'claude-opus-5-5' }, 'normal')).toBe('haiku')
  })

  test('leaves relay agents and other plugins alone when the budget is normal', () => {
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'opus' }, 'normal')).toBeUndefined()
    expect(routeModel({ subagentType: 'other:agent', parentModel: 'opus' }, 'normal')).toBeUndefined()
  })

  test('caps Opus-class models to mid when the budget is tight, except the architect', () => {
    expect(routeModel({ subagentType: 'relay:implementer-deep', parentModel: 'opus' }, 'tight')).toBe('sonnet')
    expect(routeModel({ subagentType: 'general-purpose', model: 'opus', parentModel: 'opus' }, 'tight')).toBe('sonnet')
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'opus' }, 'tight')).toBeUndefined()
  })

  test('caps the architect too when the budget is critical', () => {
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'opus' }, 'critical')).toBe('sonnet')
  })

  test('classifies model aliases and ids by tier', () => {
    expect(tierOfModel('claude-opus-5-5')).toBe('strong')
    expect(tierOfModel('fable')).toBe('strong')
    expect(tierOfModel('sonnet')).toBe('mid')
    expect(tierOfModel('claude-haiku-5-5')).toBe('cheap')
  })
})

describe('agent.spawn through the engine', () => {
  test('rewrites the model of an un-routed spawn', async ($, on) => {
    on('agent.spawn', ($, e) => ({ model: e.model ?? 'inherited', agentId: 'a1' }))
    const started = await $.agent.spawn(spawnInput('general-purpose'))
    expect(started.model).toBe('sonnet')
  })

  test('refuses new implementers once the budget is critical', async ($, on) => {
    on('agent.spawn', ($, e) => ({ model: e.model ?? 'inherited', agentId: 'a2' }))
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.measure({
      context: CONTEXT,
      rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-19T18:00:00Z' }],
      changed: ['rateLimits'],
    })
    const started = await $.agent.spawn(spawnInput('relay:implementer'))
    expect('deny' in started && typeof started.deny === 'string').toBe(true)
  })
})

const BOARD: Board = {
  slug: 'billing-export',
  status: 'running',
  green: 2,
  currentWave: 1,
  waveCount: 2,
  updatedAt: '2026-10-20T10:00:00.000Z',
  totals: { tasks: 6, working: 2, blocked: 0 },
  rulings: [],
  waves: [
    {
      wave: 1,
      state: 'working',
      light: 'yellow',
      lanes: [
        {
          id: 'a',
          state: 'working',
          light: 'yellow',
          note: 'fix round 2/5',
          tasks: [
            { id: 'T1', title: 'Export schema', state: 'done', light: 'green' },
            { id: 'T2', title: 'CSV writer', state: 'working', light: 'yellow' },
          ],
        },
      ],
    },
  ],
}

describe('the board', () => {
  test('summarizes the run and shows the band while it runs and for an hour after', () => {
    expect(boardSummary(BOARD)).toBe('2/6 green · wave 1/2')
    expect(boardSummary({ ...BOARD, totals: { ...BOARD.totals, blocked: 1 }, status: 'blocked' })).toBe('2/6 green · wave 1/2 · 1 blocked')
    const t = Date.parse(BOARD.updatedAt)
    expect(showsBand(BOARD, t)).toBe(true)
    expect(showsBand({ ...BOARD, status: 'complete' }, t + 30 * 60_000)).toBe(true)
    expect(showsBand({ ...BOARD, status: 'complete' }, t + 2 * 3_600_000)).toBe(false)
    expect(showsBand({ ...BOARD, status: 'planned' }, t)).toBe(false)
    expect(showsBand(undefined, t)).toBe(false)
  })

  test('draws the band and the pane from .relay/board.json', async ($, on) => {
    on('command.register', () => ({ value: { command: 'relay-board' } }))
    on('session.root', () => ({ value: '/repo' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
    on('fs.read', () => ({ value: JSON.stringify({ ...BOARD, updatedAt: new Date().toISOString() }) }))
    on('clock.every', () => ({ value: undefined }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const band = await $.ui.mount({
      plugin: 'relay',
      component: 'AbovePrompt',
      requestId: 'band',
      surface: 'terminal',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect((await band.find({ type: 'Text', text: /relay · billing-export/ }))?.text).toBe('relay · billing-export')
    expect((await band.find({ type: 'Text', text: /green/ }))?.text).toBe('2/6 green · wave 1/2')
    await band.unmount()

    const pane = await $.ui.mount({
      plugin: 'relay',
      component: 'Pane',
      requestId: 'relay-board',
      surface: 'desktop',
      props: { title: 'relay', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: /CSV writer/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /fix round 2\/5/ })).toBeTruthy()
    await pane.unmount()
  })
})

describe('the team', () => {
  test('a spawn is working, steps add tokens, complete is done, and the band shows the avatar', async ($, on) => {
    // pure tracking, on a local map (the mod's own state lives in the engine's module instance)
    const local = new Map()
    trackSpawn(local, { agentId: 'p1', name: 'lane-a', subagentType: 'relay:implementer', model: 'sonnet' }, 1000)
    trackStep(local, 'p1', { input: 100, output: 20, cacheRead: 1000, cacheWrite: 5 })
    trackStep(local, 'p1', { input: 50, output: 10, cacheRead: 2000, cacheWrite: 0 })
    const pure = local.get('p1')
    expect(pure.role).toBe('implementer')
    expect(pure.lane).toBe('a')
    expect(pure.avatar).toBe('SE')
    expect(pure.state).toBe('working')
    expect(pure.tokens).toEqual({ input: 150, output: 30, cacheRead: 3000, cacheWrite: 5 })
    trackComplete(local, 'p1', 5000)
    expect(local.get('p1').state).toBe('done')
    expect(local.get('p1').endedAt).toBe(5000)
    expect(workingAgents(local)).toEqual([])

    // through the engine: spawn, two steps, complete, observed in the mounted band and pane
    const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    on('agent.spawn', ($, e) => ({ model: e.model ?? 'sonnet', agentId: 'team-1' }))
    on('turn.step', async function* ($, e) {
      yield { kind: 'stop', stopReason: 'end_turn', usage: e.index === 0 ? usage(1000, 200) : usage(500, 100) }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
    })
    on('turn.complete', ($, e) => ({ text: '' }))
    on('command.register', () => ({ value: { command: 'relay-team' } }))
    on('session.root', () => ({ value: '/repo' }))
    on('fs.stat', () => ({ value: undefined }))
    on('clock.every', () => ({ value: undefined }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await $.agent.spawn(spawnInput('relay:implementer', { name: 'lane-a' }))
    for (const index of [0, 1]) {
      for await (const _chunk of $.turn.step({ turnId: 't1', index, messageCount: 1, agentId: 'team-1', model: 'sonnet' })) {
        // drain
      }
    }

    const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
    const paneProps = { title: 'relay · team', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }
    const band = await $.ui.mount({ plugin: 'relay', component: 'AbovePrompt', requestId: 'band', surface: 'terminal', props: bandProps })
    expect((await band.find({ type: 'Text', text: /^SE$/ }))?.text).toBe('SE')
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'relay', component: 'Pane', requestId: 'relay-team', surface: 'desktop', props: paneProps })
    expect(await pane.find({ type: 'Text', text: /lane a/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /1\.8k tok/ })).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /working/ })).toBeTruthy()
    await pane.unmount()

    await $.turn.complete({ turnId: 't1', agentId: 'team-1', answer: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
    const done = await $.ui.mount({ plugin: 'relay', component: 'Pane', requestId: 'relay-team', surface: 'desktop', props: paneProps })
    expect(await done.find({ type: 'Text', text: /done/ })).toBeTruthy()
    expect(await done.find({ type: 'Text', text: /working/ })).toBeUndefined()
    await done.unmount()
  })
})

describe('model profiles', () => {
  const fable = profileFor('claude-fable-5-2')
  const calm = () => remember([{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 10 }])

  test('a Fable session has the fable-lead profile; Opus, Sonnet and Haiku sessions have none', () => {
    expect(fable?.route).toBe('fable-lead')
    expect(profileFor('fable')?.id).toBe(fable?.id)
    expect(profileFor('claude-opus-5-5')).toBeUndefined()
    expect(profileFor('sonnet')).toBeUndefined()
    expect(profileFor(undefined)).toBeUndefined()
  })

  test('fable-lead sends the architect and the round-6 fix agent to Fable and leaves the other roles alone', () => {
    calm()
    const spawn = (subagentType: string, name?: string) => routeModel({ subagentType, parentModel: 'claude-fable-5-2', name }, 'normal', fable)
    expect(spawn('relay:architect')).toBe('fable')
    expect(spawn('relay:implementer-deep', 'lane-a-r6')).toBe('fable')
    expect(spawn('relay:implementer-deep', 'lane-a-r4')).toBeUndefined()
    expect(spawn('relay:implementer', 'lane-a')).toBeUndefined()
    expect(spawn('relay:conductor')).toBeUndefined()
    expect(spawn('Explore')).toBe('haiku')
  })

  test('without a profile the architect keeps its own model, as before', () => {
    calm()
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'claude-opus-5-5' }, 'normal', undefined)).toBeUndefined()
  })

  test('Fable work falls back to Opus above the frontier cap and to Sonnet at a critical budget', () => {
    remember([{ kind: 'five_hour', percentUsed: 55 }])
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'fable' }, 'normal', fable)).toBe('opus')
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'fable' }, 'tight', fable)).toBe('opus')
    expect(routeModel({ subagentType: 'relay:architect', parentModel: 'fable' }, 'critical', fable)).toBe('sonnet')
    calm()
  })

  test('a model the caller named explicitly is not replaced by the profile', () => {
    calm()
    expect(routeModel({ subagentType: 'relay:architect', model: 'opus', parentModel: 'fable' }, 'normal', fable)).toBeUndefined()
  })

  test('lead skills get the finishing text only below high effort; other skills get nothing', () => {
    expect(leadOverlay(fable, 'relay:relay-run', 'medium')).toContain('Finish the work')
    expect(leadOverlay(fable, 'relay:relay-run', 'medium')).toContain('subagent starts with an empty context')
    expect(leadOverlay(fable, 'relay-plan', 'high')).not.toContain('Finish the work')
    expect(leadOverlay(fable, 'relay-plan', 'high')).toContain('subagent starts with an empty context')
    expect(leadOverlay(fable, 'relay:relay-budget', 'medium')).toBe('')
    expect(leadOverlay(undefined, 'relay:relay-run', 'medium')).toBe('')
  })

  test('only an agent that actually runs on Fable gets the frontier text', () => {
    expect(spawnOverlay(fable, 'frontier', 'fable')).toContain('a reader who saw none of the work')
    expect(spawnOverlay(fable, 'escalation', 'fable')).toContain('Finish the work')
    expect(spawnOverlay(fable, 'frontier', 'opus')).toBe('')
    expect(spawnOverlay(undefined, 'frontier', 'fable')).toBe('')
  })

  test('cache share is the part of the input read from the cache', () => {
    expect(cacheShare({ input: 100, output: 50, cacheRead: 300, cacheWrite: 100 })).toBe(60)
    expect(cacheShare({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
  })
})

describe('model profiles through the engine', () => {
  test('in a Fable session the architect spawns on Fable with the frontier text in its brief', async ($, on) => {
    let brief = ''
    on('agent.spawn', ($, e) => {
      brief = e.prompt
      return { model: e.model ?? 'inherited', agentId: 'arch-1' }
    })
    const started = await $.agent.spawn({ ...spawnInput('relay:architect'), parentModel: 'claude-fable-5-2' })
    expect(started.model).toBe('fable')
    expect(brief.startsWith('do the task')).toBe(true)
    expect(brief).toContain('<relay-profile id="fable-5.2">')
  })

  test('in a Fable session a lead skill gets the profile text and an unrelated skill does not', async ($, on) => {
    on('session.model', () => ({ value: 'claude-fable-5-2' }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200_000, percent: 0 }, rateLimits: [], cost: 0 } }))
    let context: readonly string[] = []
    on('prompt.submit', ($, e) => {
      context = e.context ?? []
      return { text: e.text }
    })
    on('skill.prompt', ($, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'run the plan' } as never)
    expect(context.some(line => line.startsWith('[relay profile] fable-5.2 (route fable-lead)'))).toBe(true)
    const lead = await $.skill.prompt({ skill: 'relay:relay-run', text: 'Run the plan.', pluginName: 'relay' } as never)
    expect(lead.text.startsWith('Run the plan.')).toBe(true)
    expect(lead.text).toContain('Finish the work')
    const other = await $.skill.prompt({ skill: 'commit', text: 'Commit.' } as never)
    expect(other.text).toBe('Commit.')
  })
})
