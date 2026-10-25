import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { membersOf, nameOf, peopleOf, peopleWithRuns, readCommitLines, startOfId, type RecordsReader } from './people.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-25T12:00:00.000Z')
const idAt = (ms: number): string => new Date(ms).toISOString().replace(/:/g, '-').replace('.', '-')

/** Records in memory: a person's folder of cards, each read counted. */
function records(people: Record<string, { at: number; status: string; cost?: number }[]>): RecordsReader & { reads: string[] } {
  const files = new Map<string, string>()
  for (const [person, runs] of Object.entries(people))
    for (const run of runs) {
      const id = idAt(run.at)
      files.set(`agents/${person}/${id}.json`, JSON.stringify({ id, startedAt: new Date(run.at).toISOString(), status: run.status, ...(run.cost !== undefined ? { cost: run.cost } : {}) }))
      files.set(`agents/${person}/${id}.jsonl`, '')
    }
  const reads: string[] = []
  return {
    reads,
    list: async dir => [...new Set([...files.keys()].filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0]!))],
    read: async path => {
      reads.push(path)
      return files.get(path)
    },
  }
}

test("a run's id says when it started", () => {
  assert.equal(startOfId('2026-10-25T00-36-42-115Z'), Date.parse('2026-10-25T00:36:42.115Z'))
})

test('each person who started runs, the busiest first: the runs of the last days, their cost, those going now, the last one; the person at this computer marked', async () => {
  const reader = records({
    'ada@x.dev': [
      { at: NOW - 1 * DAY, status: 'done', cost: 0.5 },
      { at: NOW - 2 * DAY, status: 'running', cost: 0.25 },
      { at: NOW - 30 * DAY, status: 'done', cost: 9 },
    ],
    'rom@y.dev': [{ at: NOW - 40 * DAY, status: 'done' }],
  })
  const people = await peopleOf(reader, 'agents', NOW - 7 * DAY, 'ADA@x.dev')
  assert.deepEqual(people, [
    { person: 'ada@x.dev', runs: 2, running: 1, cost: 0.75, commits: 0, lastAt: new Date(NOW - DAY).toISOString(), you: true },
    { person: 'rom@y.dev', runs: 0, running: 0, cost: 0, commits: 0, lastAt: new Date(NOW - 40 * DAY).toISOString() },
  ])
  // Only the cards of those days are read: the older ones are passed over by their ids.
  assert.equal(reader.reads.length, 2)
})

test('the same person in several projects is one member, their runs added up; whoever has a run going comes first', () => {
  const ada = { person: 'ada@x.dev', runs: 2, running: 0, cost: 0.5, commits: 0, lastAt: '2026-10-24T00:00:00.000Z' }
  const rom = { person: 'rom@y.dev', runs: 1, running: 1, cost: 0.1, commits: 0, lastAt: '2026-10-20T00:00:00.000Z' }
  const members = membersOf([
    { project: 'alpha', people: [ada, rom] },
    { project: 'beta', people: [{ ...ada, person: 'ADA@x.dev', runs: 3, cost: 0.25, lastAt: '2026-10-25T00:00:00.000Z', you: true }] },
  ])
  assert.deepEqual(members.map(member => [member.person, member.runs, member.cost, member.lastAt, member.you ?? false, member.projects]), [
    ['rom@y.dev', 1, 0.1, '2026-10-20T00:00:00.000Z', false, ['alpha']],
    ['ada@x.dev', 5, 0.75, '2026-10-25T00:00:00.000Z', true, ['alpha', 'beta']],
  ])
})

test("a person goes by the name git knows, else their email's name, or its domain where the name is a generic word", () => {
  assert.equal(nameOf({ person: 'suleiman@averotech.com' }), 'suleiman')
  assert.equal(nameOf({ person: 'git@brillout.com' }), 'brillout')
  assert.equal(nameOf({ person: 'someone' }), 'someone')
  // The name git knows them by comes first.
  assert.equal(nameOf({ person: 'git@brillout.com', name: 'Romuald Brillout' }), 'Romuald Brillout')
})

test('whoever committed to the main branch is a member too, by the name of their newest commit; a bot is no one; commits before the days asked for give a name only', async () => {
  const reader = records({ 'git@brillout.com': [{ at: NOW - 60 * DAY, status: 'done' }] })
  const commits = readCommitLines(
    [
      `git@brillout.com\tRomuald Brillout\t${(NOW - 2 * DAY) / 1000}`,
      `noreply@anthropic.com\tClaude\t${(NOW - 2 * DAY) / 1000}`,
      `new@z.dev\tNew Person\t${(NOW - 3 * DAY) / 1000}`,
      `git@brillout.com\tRom\t${(NOW - 5 * DAY) / 1000}`,
      `old@w.dev\tGone\t${(NOW - 90 * DAY) / 1000}`,
      'not a commit line',
    ].join('\n'),
  )
  const people = await peopleOf(reader, 'agents', NOW - 30 * DAY, undefined, commits)
  assert.deepEqual(people.map(person => [person.person, person.name, person.commits, person.lastAt]), [
    ['git@brillout.com', 'Romuald Brillout', 2, new Date(NOW - 2 * DAY).toISOString()],
    ['new@z.dev', 'New Person', 1, new Date(NOW - 3 * DAY).toISOString()],
  ])
})

test("a project's people with their runs counted as the dashboard lists them: their commits and names kept, a person only the dashboard knows added, older runs and runs of no one left out", () => {
  const recorded = [{ person: 'S@a.dev', name: 'Suleiman', runs: 1, running: 1, cost: 0.5, commits: 2, lastAt: new Date(NOW - 5 * DAY).toISOString(), you: true as const }]
  const at = (days: number): string => new Date(NOW - days * DAY).toISOString()
  const people = peopleWithRuns(
    recorded,
    [
      { person: 's@a.dev', startedAt: at(1), status: 'unknown', cost: 0.5 },
      { person: 's@a.dev', startedAt: at(0), status: 'running', cost: 0.25 },
      { person: 's@a.dev', startedAt: at(40), status: 'done', cost: 9 },
      { person: 'rom@b.dev', startedAt: at(2), status: 'done', cost: 1 },
      { startedAt: at(0), status: 'running' },
    ],
    NOW - 30 * DAY,
  )
  assert.deepEqual(
    people.map(person => [person.person, person.name, person.runs, person.running, person.cost, person.commits, person.lastAt, person.you]),
    [
      ['S@a.dev', 'Suleiman', 2, 1, 0.75, 2, at(0), true],
      ['rom@b.dev', undefined, 1, 0, 1, 0, at(2), undefined],
    ],
  )
})
