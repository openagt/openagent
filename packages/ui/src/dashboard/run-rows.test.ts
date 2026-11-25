import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { markOtherHost, withPrStates } from './run-rows.js'
import type { AgentMeta } from '../store/index.js'

test('a run another machine\'s daemon started is handed to the dashboard as from another host (#1648)', () => {
  const run = (host?: string): AgentMeta => ({ status: 'done', id: 'r', startedAt: '', updatedAt: '', ...(host ? { host } : {}) }) as AgentMeta
  assert.equal(markOtherHost(run('rom-thinkpad-x280'), 'suleiman-mbp').otherHost, true)
  assert.equal(markOtherHost(run('suleiman-mbp'), 'suleiman-mbp').otherHost, undefined)
  // A record from before the host field was written says nothing about where it ran.
  assert.equal(markOtherHost(run(), 'suleiman-mbp').otherHost, undefined)
})

test('each run with a pull request is marked with how it stands and its title, as its module last read it; one with no request, or one no module read, is left as it was', () => {
  const run = (id: string, pr?: number): AgentMeta => ({ id, status: 'done', startedAt: '2026-10-18T13:00:00.000Z', updatedAt: '2026-10-18T13:00:00.000Z', ...(pr !== undefined ? { pr: { number: pr, url: `https://example.com/pull/${pr}` } } : {}) })
  const read = new Map([['https://example.com/pull/7', { state: 'merged' as const, title: 'Dark mode' }], ['https://example.com/pull/8', { state: 'draft' as const, title: 'Login page' }]])
  const states = { get: (url: string) => read.get(url) }
  const marked = withPrStates([run('a', 7), run('b', 8), run('c'), run('d', 99)], states)
  assert.deepEqual(marked.map(agent => [agent.id, agent.prState, agent.prTitle]), [['a', 'merged', 'Dark mode'], ['b', 'draft', 'Login page'], ['c', undefined, undefined], ['d', undefined, undefined]])
  assert.ok(!('prState' in marked[2]!) && !('prState' in marked[3]!))
  // The requests a run opened before its last one are marked the same way.
  const [moved] = withPrStates([{ ...run('f', 8), earlierPrs: [{ number: 7, url: 'https://example.com/pull/7' }, { number: 99, url: 'https://example.com/pull/99' }] }], states)
  assert.deepEqual(moved!.earlierPrs, [{ number: 7, url: 'https://example.com/pull/7', state: 'merged' }, { number: 99, url: 'https://example.com/pull/99' }])
})
