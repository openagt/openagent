import { describe, expect, test } from 'vitest'
import type { OpenAgentEvent } from '../../src/index.js'
import { inCheckout, inProject, turnChanges } from './turn-changes.js'

const WS = '/repo/.branches/agent-1'
const prompt = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: text } })
const said: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'Done.' } }
const edit = (path: string, added: number, removed: number, created = false): OpenAgentEvent => ({
  kind: 'driver',
  event: { type: 'output', id: `call-${path}-${added}`, text: 'ok', changed: [{ path, added, removed, ...(created ? { created: true as const } : {}) }] },
})
const printed: OpenAgentEvent = { kind: 'driver', event: { type: 'output', id: 'cmd', text: '12 passed' } }

describe('inCheckout', () => {
  test('a path inside the checkout is said from the checkout; any other is left as it is', () => {
    expect(inCheckout(`${WS}/docs/A.md`, WS)).toBe('docs/A.md')
    expect(inCheckout(`${WS}/docs/A.md`, `${WS}/`)).toBe('docs/A.md')
    expect(inCheckout('/elsewhere/A.md', WS)).toBe('/elsewhere/A.md')
    expect(inCheckout(`${WS}-other/A.md`, WS)).toBe(`${WS}-other/A.md`)
    expect(inCheckout('/x/A.md', undefined)).toBe('/x/A.md')
  })
})

describe('inProject', () => {
  test('a file the agent wrote outside its checkout is no change of the run\'s; a relative path and an unknown checkout are kept', () => {
    expect(inProject(`${WS}/docs/A.md`, WS)).toBe(true)
    // What the orchestration skill tells every main agent to write: its plan, outside the checkout.
    expect(inProject('/tmp/agent-2026-10-16T15-21-13-205Z-plan.md', WS)).toBe(false)
    expect(inProject(`${WS}-other/A.md`, WS)).toBe(false)
    expect(inProject('docs/A.md', WS)).toBe(true)
    expect(inProject('/tmp/A.md', undefined)).toBe(true)
  })

  test('a turn drops what was written outside the checkout and keeps the rest', () => {
    const events = [prompt('go'), edit('/tmp/agent-1-plan.md', 63, 0, true), edit(`${WS}/index.html`, 21, 0), said]
    const { last } = turnChanges(events, WS)
    expect(last?.map(file => file.name)).toEqual(['index.html'])
  })
})

describe('turnChanges', () => {
  test('each turn\'s files are under the prompt that ended it, the last turn\'s apart; a turn that changed none has no entry', () => {
    const second = prompt('more')
    const third = prompt('again')
    const events = [prompt('go'), edit(`${WS}/A.md`, 2, 1), said, second, said, third, edit(`${WS}/src/b.ts`, 5, 0), said]
    const { ended, last } = turnChanges(events, WS)
    expect([...ended.keys()]).toEqual([second])
    expect(ended.get(second)).toEqual([{ path: 'A.md', name: 'A.md', added: 2, removed: 1, created: false }])
    expect(last).toEqual([{ path: 'src/b.ts', name: 'b.ts', added: 5, removed: 0, created: false }])
  })

  test('a file edited several times in a turn is one file, its edits summed, in the order first changed', () => {
    const { last } = turnChanges([prompt('go'), edit(`${WS}/A.md`, 2, 1), edit(`${WS}/B.md`, 1, 0), edit(`${WS}/A.md`, 3, 2)], WS)
    expect(last.map(file => [file.path, file.added, file.removed])).toEqual([['A.md', 5, 3], ['B.md', 1, 0]])
  })

  test('a file the turn made holds its lines added less the ones removed again, and removed none', () => {
    const { last } = turnChanges([prompt('go'), edit(`${WS}/NEW.md`, 3, 0, true), edit(`${WS}/NEW.md`, 2, 1)], WS)
    expect(last).toEqual([{ path: 'NEW.md', name: 'NEW.md', added: 4, removed: 0, created: true }])
  })

  test('a file made in an earlier turn is a file that was there: a later turn sums its edits as they are', () => {
    const second = prompt('more')
    const { ended, last } = turnChanges([prompt('go'), edit(`${WS}/NEW.md`, 3, 0, true), second, edit(`${WS}/NEW.md`, 2, 1)], WS)
    expect(ended.get(second)).toEqual([{ path: 'NEW.md', name: 'NEW.md', added: 3, removed: 0, created: true }])
    expect(last).toEqual([{ path: 'NEW.md', name: 'NEW.md', added: 2, removed: 1, created: false }])
  })

  test('an output that changed no file, and a log with no edit, give nothing', () => {
    expect(turnChanges([prompt('go'), printed, said], WS)).toEqual({ ended: new Map(), last: [] })
    expect(turnChanges([], WS)).toEqual({ ended: new Map(), last: [] })
  })

  test('edits before any prompt belong to the turn the first prompt ends', () => {
    const first = prompt('go')
    const { ended } = turnChanges([edit(`${WS}/A.md`, 1, 0), first], WS)
    expect(ended.get(first)?.map(file => file.path)).toEqual(['A.md'])
  })
})
