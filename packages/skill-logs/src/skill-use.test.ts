import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RecordsReader } from './people.js'
import { skillUseOf } from './skill-use.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-25T12:00:00.000Z')
const idAt = (ms: number): string => new Date(ms).toISOString().replace(/:/g, '-').replace('.', '-')

/** One person's runs in memory: each its ask and the skills its agent loaded; each read counted. */
function records(runs: { at: number; intent?: string; loaded: string[] }[]): RecordsReader & { reads: string[] } {
  const files = new Map<string, string>()
  for (const run of runs) {
    const id = idAt(run.at)
    files.set(`agents/ada@x.dev/${id}.json`, JSON.stringify({ id, startedAt: new Date(run.at).toISOString(), status: 'done', ...(run.intent ? { intent: run.intent } : {}) }))
    files.set(`agents/ada@x.dev/${id}.jsonl`, [{ kind: 'start', prompt: run.intent ?? '' }, ...run.loaded.map(skill => ({ kind: 'action', label: 'Skill', detail: skill, at: new Date(run.at + 1000).toISOString() })), { kind: 'action', label: 'Bash', detail: 'ls' }].map(line => JSON.stringify(line)).join('\n'))
  }
  const reads: string[] = []
  return {
    reads,
    list: async dir => [...new Set([...files.keys()].filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]!))],
    read: async path => (reads.push(path), files.get(path)),
  }
}

test('each skill the agents loaded or a run was started with, the most used first, in how many runs; only the days asked for are read', async () => {
  const reader = records([
    { at: NOW - 1 * DAY, intent: '/work-queue', loaded: ['queue', 'tickets'] },
    { at: NOW - 2 * DAY, intent: 'fix the login page', loaded: ['tickets', 'tickets'] },
    { at: NOW - 40 * DAY, loaded: ['browser'] },
  ])
  const used = await skillUseOf(reader, 'agents', NOW - 30 * DAY)
  assert.deepEqual(
    used.map(use => [use.skill, use.uses, use.runs]),
    [
      ['tickets', 3, 2],
      // A tie: the one used last first; the queue was loaded a second after the run was started with /work-queue.
      ['queue', 1, 1],
      ['work-queue', 1, 1],
    ],
  )
  assert.equal(used[0]!.lastAt, new Date(NOW - DAY + 1000).toISOString())
  // The run of 40 days ago is not read.
  assert.equal(reader.reads.length, 4)
})
