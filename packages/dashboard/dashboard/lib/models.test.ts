import { describe, expect, test } from 'vitest'
import { driverOptions, modelName, modelEfforts } from './models.js'

describe('modelName', () => {
  const claude = { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }] }

  test('a listed model is named as its agent names it', () => {
    expect(modelName(claude, 'opus')).toBe('Opus 5.5')
  })

  test('the full id an alias runs today is named as the alias is: what a run\'s card says it ran', () => {
    expect(modelName(claude, 'claude-opus-5-5')).toBe('Opus 5.5')
  })

  test('a model the agent does not list, or a list not answered yet, is named by its id', () => {
    expect(modelName(claude, 'fable')).toBe('fable')
    expect(modelName(claude, 'claude-opus-5')).toBe('claude-opus-5')
    expect(modelName(undefined, 'opus')).toBe('opus')
    expect(modelName({ models: [], error: 'not logged in' }, 'opus')).toBe('opus')
  })
})

describe('driverOptions', () => {
  test('every coding agent, with the models it listed by its own names, or why there are none', () => {
    const options = driverOptions({
      'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }] },
      codex: { models: [], error: 'not logged in' },
    })
    expect(options.map(o => [o.value, o.label, o.models, o.models.length ? undefined : o.modelsNote])).toEqual([
      ['claude-code', 'Claude Code', [{ value: 'opus', label: 'Opus 5.5' }], undefined],
      ['codex', 'Codex', [], 'not logged in'],
    ])
  })

  test('an agent whose CLI is not on the computer is said not installed, on the computer the models are of', () => {
    const models = { 'claude-code': { models: [] as [], error: 'not logged in' }, codex: { models: [] as [], error: '`codex` could not start: spawn codex ENOENT', missing: true as const } }
    expect(driverOptions(models).map(o => o.modelsNote)).toEqual(['not logged in', 'Codex is not installed.'])
    expect(driverOptions(models, 'experiment').map(o => o.modelsNote)).toEqual(['not logged in', 'Codex is not installed on experiment.'])
  })

  test('before the daemon answers, each agent says it is being asked', () => {
    expect(driverOptions(undefined).map(o => o.modelsNote)).toEqual(['Asking Claude Code…', 'Asking Codex…'])
  })
})

describe('modelEfforts', () => {
  const models = {
    'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5', efforts: ['low', 'medium', 'high'] }, { id: 'haiku', name: 'Haiku 5.5' }] },
    codex: { models: [{ id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', efforts: ['low', 'medium'] }] },
  }
  test("the levels the picked model offers, by its own id or the full id it runs", () => {
    expect(modelEfforts(models, 'claude-code', 'opus')).toEqual(['low', 'medium', 'high'])
    expect(modelEfforts(models, 'claude-code', 'claude-opus-5-5')).toEqual(['low', 'medium', 'high'])
    expect(modelEfforts(models, 'codex', 'gpt-5.6-luna')).toEqual(['low', 'medium'])
  })

  test('a model that offers none, an agent that listed none, and a list not answered yet all offer none', () => {
    expect(modelEfforts(models, 'claude-code', 'haiku')).toEqual([])
    expect(modelEfforts(models, 'claude-code', undefined)).toEqual([])
    expect(modelEfforts(undefined, 'claude-code', 'opus')).toEqual([])
  })
})
