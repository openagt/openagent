import { describe, expect, test } from 'vitest'
import { agentOptions, modelEfforts, modelName } from './models.js'

const CLAUDE = { id: 'claude-code', label: 'Claude Code', list: 'claude', models: { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5', efforts: ['low', 'medium', 'high'] }, { id: 'haiku', name: 'Haiku 5.5' }] } }

describe('modelName', () => {
  test('a listed model is named as its agent names it, by its id or the full id it runs today', () => {
    expect(modelName(CLAUDE, 'opus')).toBe('Opus 5.5')
    expect(modelName(CLAUDE, 'claude-opus-5-5')).toBe('Opus 5.5')
  })

  test('a model the agent does not list, or an agent not answered yet, is named by its id', () => {
    expect(modelName(CLAUDE, 'fable')).toBe('fable')
    expect(modelName(undefined, 'opus')).toBe('opus')
    expect(modelName({ ...CLAUDE, models: { models: [], error: 'not logged in' } }, 'opus')).toBe('opus')
  })
})

describe('agentOptions', () => {
  test('every coding agent, in the order the distribution has them, with the models it listed by its own names, or why there are none', () => {
    const options = agentOptions([CLAUDE, { id: 'codex', label: 'Codex', models: { models: [], error: 'not logged in' } }])
    expect(options.map(o => [o.value, o.label, o.list, o.models.map(m => m.label), o.models.length ? undefined : o.modelsNote])).toEqual([
      ['claude-code', 'Claude Code', 'claude', ['Opus 5.5', 'Haiku 5.5'], undefined],
      ['codex', 'Codex', undefined, [], 'not logged in'],
    ])
  })

  test('an agent whose program is not on the computer is said not installed', () => {
    const [codex] = agentOptions([{ id: 'codex', label: 'Codex', models: { models: [], error: '`codex` could not start: spawn codex ENOENT', missing: true } }])
    expect([codex?.modelsNote, codex?.missing]).toEqual(['Codex is not installed.', true])
  })

  test('before the agents answer, there are none', () => {
    expect(agentOptions(undefined)).toEqual([])
  })
})

describe('modelEfforts', () => {
  test('the levels the picked model offers, by its own id or the full id it runs', () => {
    expect(modelEfforts(CLAUDE, 'opus')).toEqual(['low', 'medium', 'high'])
    expect(modelEfforts(CLAUDE, 'claude-opus-5-5')).toEqual(['low', 'medium', 'high'])
  })

  test('a model that offers none, no model, and an agent not answered yet all offer none', () => {
    expect(modelEfforts(CLAUDE, 'haiku')).toEqual([])
    expect(modelEfforts(CLAUDE, undefined)).toEqual([])
    expect(modelEfforts(undefined, 'opus')).toEqual([])
  })
})
