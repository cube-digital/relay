import { describe, expect, test } from 'claude-code/testing'
import { boardSummary, routeModel, showsBand, tierOfModel } from './register.ts'
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
