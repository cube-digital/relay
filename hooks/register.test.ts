import { describe, expect, test } from 'claude-code/testing'
import { routeModel, tierOfModel } from './register.ts'

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
