import { describe, expect, test } from 'vitest'
import { startedFromBranch, startedFromMain } from './started-from.js'

describe('the branch a run started from', () => {
  test('told one, or a subagent with its main agent\'s: the name on its card, whatever origin\'s default is', () => {
    expect(startedFromBranch({ base: 'feature/x', baseCommit: 'abc' }, 'main')).toBe('feature/x')
    expect(startedFromMain({ base: 'feature/x', baseCommit: 'abc' })).toBe(false)
  })

  test('it made its own branch and was told none: origin\'s default branch, once its name is read', () => {
    expect(startedFromMain({ baseCommit: 'abc' })).toBe(true)
    expect(startedFromBranch({ baseCommit: 'abc' }, 'trunk')).toBe('trunk')
    expect(startedFromBranch({ baseCommit: 'abc' }, null)).toBeUndefined()
  })

  test('nothing to vouch for it, an old card or a run given a branch that exists: no name, even with origin\'s default known', () => {
    expect(startedFromMain({})).toBe(false)
    expect(startedFromBranch({}, 'main')).toBeUndefined()
    expect(startedFromBranch(undefined, 'main')).toBeUndefined()
  })
})
