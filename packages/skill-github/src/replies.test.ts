import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunCard } from '@openagt/skill-logs'
import type { GhRunner } from './gh.js'
import { listReplies, parseOpenRequests, repliesArgs, repliesFor, watchedRequests } from './replies.js'

// What came on this machine's agents' pull requests since each ended: which pull requests are
// watched, what of GitHub's answer counts, and the one read.

const ENDED = '2026-10-19T10:00:00.250Z'
const BEFORE = '2026-10-19T09:00:00Z'
const AFTER = '2026-10-19T11:00:00Z'

function card(id: string, pr: number | undefined, over: Partial<RunCard> = {}, host = 'this-box'): RunCard {
  return { id, startedAt: '2026-10-19T08:00:00.000Z', endedAt: ENDED, status: 'done', ...(pr !== undefined ? { pr: { number: pr, url: `https://github.com/o/r/pull/${pr}` } } : {}), caller: { host, runner: { host } }, ...over }
}

/** A pull request as GitHub answers it, with nothing on it unless said. */
function pr(number: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { number, url: `https://github.com/o/r/pull/${number}`, mergeable: 'MERGEABLE', baseRef: { name: 'main', target: { committedDate: BEFORE } }, comments: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...over }
}

const answer = (...prs: Record<string, unknown>[]): unknown => ({ data: { repository: { pullRequests: { nodes: prs } } } })

const comment = (login: string, body: string, createdAt: string, association = 'OWNER') => ({ author: { login }, authorAssociation: association, body, createdAt, url: `https://github.com/o/r/pull/1#c-${login}` })

test("a pull request is watched for the run that last worked on it, when that run is this machine's and has ended; one a run still works on is left to it; a run with no pull request is none", () => {
  const cards = [
    card('r1', 1),
    // A later run on the same pull request, a follow-up: it is the one told.
    card('r1b', 1, { endedAt: '2026-10-19T10:30:00.000Z' }),
    card('r2', 2, {}, 'other-box'),
    card('r3', 3),
    (({ endedAt: _endedAt, ...going }) => ({ ...going, status: 'running' as const }))(card('r3b', 3, {}, 'other-box')),
    card('r4', undefined),
  ]
  assert.deepEqual(watchedRequests(cards, 'this-box'), [{ number: 1, run: 'r1b', endedAt: '2026-10-19T10:30:00.000Z' }])
})

test("what counts on a pull request: a maintainer's comment, review and line comment, a request for changes with no words, a red check, a conflict; not someone else's words, not an agent's, not an approval with none, not a green check", () => {
  const [read] = parseOpenRequests(
    answer(
      pr(1, {
        mergeable: 'CONFLICTING',
        baseRef: { name: 'main', target: { committedDate: AFTER } },
        comments: { nodes: [comment('rom', 'Why this name?', AFTER), comment('passer-by', 'Nice!', AFTER, 'NONE'), comment('rom', '🤖 *automated*\nRenamed it.', AFTER)] },
        reviews: {
          nodes: [
            { author: { login: 'rom' }, authorAssociation: 'MEMBER', body: '', state: 'CHANGES_REQUESTED', submittedAt: AFTER, url: 'u-r1', comments: { nodes: [{ ...comment('rom', 'Off by one.', AFTER, 'MEMBER'), path: 'src/a.ts', line: 12 }] } },
            { author: { login: 'rom' }, authorAssociation: 'MEMBER', body: '', state: 'APPROVED', submittedAt: AFTER, url: 'u-r2', comments: { nodes: [] } },
            { author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: 'Looks fine, one question.', state: 'COMMENTED', submittedAt: AFTER, url: 'u-r3', comments: { nodes: [] } },
          ],
        },
        commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', completedAt: AFTER, detailsUrl: 'u-test' }, { __typename: 'CheckRun', name: 'lint', conclusion: 'SUCCESS', completedAt: AFTER, detailsUrl: 'u-lint' }, { __typename: 'StatusContext', context: 'ci/old', state: 'ERROR', createdAt: AFTER, targetUrl: 'u-old' }] } } } }] },
      }),
    ),
  )
  assert.deepEqual(
    read!.came.map(c => c.line),
    [
      '@rom commented (https://github.com/o/r/pull/1#c-rom):\nWhy this name?',
      '@rom requested changes (u-r1).',
      '@rom on src/a.ts line 12 (https://github.com/o/r/pull/1#c-rom):\nOff by one.',
      '@dani reviewed (u-r3):\nLooks fine, one question.',
      'The check "test" failed (u-test).',
      'The check "ci/old" failed (u-old).',
      'It conflicts with main, which moved since.',
    ],
  )
  assert.deepEqual(parseOpenRequests({ errors: [{ message: 'no' }] }), [])
})

test('a run is told only what came after it ended, oldest first, under the pull request it is on; a pull request with nothing new, or no longer open, tells nothing', () => {
  const open = parseOpenRequests(
    answer(
      pr(1, { comments: { nodes: [comment('rom', 'Second.', '2026-10-19T12:00:00Z'), comment('rom', 'Seen before it ended.', BEFORE), comment('rom', 'First.', AFTER)] } }),
      pr(2, { comments: { nodes: [comment('rom', 'Old news.', BEFORE)] }, mergeable: 'CONFLICTING' }),
    ),
  )
  const watched = [
    { number: 1, run: 'r1', endedAt: ENDED },
    { number: 2, run: 'r2', endedAt: ENDED },
    { number: 9, run: 'r9', endedAt: ENDED },
  ]
  assert.deepEqual(repliesFor(watched, open), [
    {
      run: 'r1',
      text: ['On your pull request #1 (https://github.com/o/r/pull/1), since you ended:', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\nFirst.', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\nSecond.'].join('\n'),
    },
  ])
})

test('the read is one GitHub call for every pull request, in the repository the working directory is in; nothing to watch asks GitHub nothing; GitHub that cannot answer throws', async () => {
  const calls: string[][] = []
  const gh: GhRunner = async args => (calls.push(args), JSON.stringify(answer(pr(1, { comments: { nodes: [comment('rom', 'Why?', AFTER)] } }))))
  const replies = await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r1', 1), card('r2', 2)] })
  assert.deepEqual(replies.map(r => r.run), ['r1'])
  assert.deepEqual(calls, [repliesArgs()])
  assert.deepEqual(repliesArgs().slice(0, 6), ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}'])

  calls.length = 0
  assert.deepEqual(await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r2', 2, {}, 'other-box')] }), [])
  assert.deepEqual(calls, [])
  await assert.rejects(listReplies('/repo', { gh: async () => { throw new Error('gh: not logged in') }, host: 'this-box', runs: async () => [card('r1', 1)] }), /not logged in/)
})
