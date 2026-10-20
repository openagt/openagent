import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunCard } from '@openagt/skill-logs'
import type { GhRunner } from './gh.js'
import { WHOLE_READ_EVERY_MS, listReplies, parseOpenRequests, repliesArgs, repliesFor, seenArgs, watchedRequests } from './replies.js'

// What came on this machine's agents' pull requests since each ended: which pull requests are
// watched, what of GitHub's answer counts, and the one read.

const ENDED = '2026-10-19T10:00:00.250Z'
const BEFORE = '2026-10-19T09:00:00Z'
const AFTER = '2026-10-19T11:00:00Z'

/** A run's record on branch `b<n>`, the branch of pull request n in {@link pr}; none with no number. */
function card(id: string, branch: number | undefined, over: Partial<RunCard> = {}, host = 'this-box'): RunCard {
  return { id, startedAt: '2026-10-19T08:00:00.000Z', endedAt: ENDED, status: 'done', ...(branch !== undefined ? { branch: `b${branch}` } : {}), caller: { host, runner: { host } }, ...over }
}

/** A pull request as GitHub answers it, with nothing on it unless said. */
function pr(number: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { number, url: `https://github.com/o/r/pull/${number}`, headRefName: `b${number}`, isCrossRepository: false, mergeable: 'MERGEABLE', baseRef: { name: 'main', target: { committedDate: BEFORE } }, comments: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...over }
}

const answer = (...prs: Record<string, unknown>[]): unknown => ({ data: { repository: { pullRequests: { nodes: prs } } } })

const comment = (login: string, body: string, createdAt: string, association = 'OWNER', id = `C-${login}`) => ({ id, author: { login }, authorAssociation: association, body, createdAt, url: `https://github.com/o/r/pull/1#c-${login}` })

test("a branch is watched for the run that last worked on it, when that run is this machine's and has ended; one a run still works on is left to it; a run with no branch is none", () => {
  const cards = [
    card('r1', 1),
    // A later run on the same branch, a follow-up: it is the one told.
    card('r1b', 1, { endedAt: '2026-10-19T10:30:00.000Z' }),
    card('r2', 2, {}, 'other-box'),
    card('r3', 3),
    (({ endedAt: _endedAt, ...going }) => ({ ...going, status: 'running' as const }))(card('r3b', 3, {}, 'other-box')),
    card('r4', undefined),
  ]
  assert.deepEqual(watchedRequests(cards, 'this-box'), [{ branch: 'b1', run: 'r1b', endedAt: '2026-10-19T10:30:00.000Z' }])
})

test("a pull request is the run's whose branch it is: one the run's record never learned, opened by its agent with no git host behind the run, is answered; a fork's of the same branch name is not", () => {
  const open = parseOpenRequests(
    answer(
      pr(8, { headRefName: 'agent-footer', isCrossRepository: true, comments: { nodes: [comment('rom', 'From a fork.', AFTER)] } }),
      pr(7, { headRefName: 'agent-footer', comments: { nodes: [comment('rom', 'Make it bold.', AFTER)] } }),
    ),
  )
  const watched = watchedRequests([card('r7', undefined, { branch: 'agent-footer' })], 'this-box')
  assert.deepEqual(repliesFor(watched, open).map(r => r.text), ['On your pull request #7 (https://github.com/o/r/pull/7), since you ended:\n- @rom commented (https://github.com/o/r/pull/1#c-rom):\nMake it bold.'])
})

test("what counts on a pull request: a maintainer's comment, review and line comment, a request for changes with no words, a red check, a conflict; not someone else's words, not an agent's, not an approval with none, not a green check", () => {
  const [read] = parseOpenRequests(
    answer(
      pr(1, {
        mergeable: 'CONFLICTING',
        baseRef: { name: 'main', target: { committedDate: AFTER } },
        comments: { nodes: [comment('rom', 'Why this name?', AFTER), comment('passer-by', 'Nice!', AFTER, 'NONE'), comment('rom', '🤖 *automated*\nRenamed it.', AFTER), comment('rom', '**Claude Code finished the task in 22s**\n\nRenamed it.\n\n<!-- openagent -->', AFTER)] },
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

test('a run is told only what came after it ended, oldest first, under the pull request of its branch; a pull request with nothing new, or a branch with none open, tells nothing', () => {
  const open = parseOpenRequests(
    answer(
      pr(1, { comments: { nodes: [comment('rom', 'Second.', '2026-10-19T12:00:00Z'), comment('rom', 'Seen before it ended.', BEFORE), comment('rom', 'First.', AFTER)] } }),
      pr(2, { comments: { nodes: [comment('rom', 'Old news.', BEFORE)] }, mergeable: 'CONFLICTING' }),
    ),
  )
  const watched = [
    { branch: 'b1', run: 'r1', endedAt: ENDED },
    { branch: 'b2', run: 'r2', endedAt: ENDED },
    { branch: 'b9', run: 'r9', endedAt: ENDED },
  ]
  assert.deepEqual(repliesFor(watched, open), [
    {
      run: 'r1',
      text: ['On your pull request #1 (https://github.com/o/r/pull/1), since you ended:', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\nFirst.', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\nSecond.'].join('\n'),
      seen: ['C-rom', 'C-rom'],
    },
  ])
})

test('the comments and reviews a run is told, by their ids, for their 👀: a line comment and a review too; a red check is none', () => {
  const open = parseOpenRequests(
    answer(
      pr(1, {
        comments: { nodes: [comment('rom', 'First.', AFTER, 'OWNER', 'IC_1'), comment('dani', 'Seen before it ended.', BEFORE, 'COLLABORATOR', 'IC_0')] },
        reviews: { nodes: [{ id: 'PRR_1', author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: 'One thing.', state: 'COMMENTED', submittedAt: AFTER, url: 'u-r', comments: { nodes: [{ ...comment('dani', 'Off by one.', AFTER, 'COLLABORATOR', 'PRRC_1'), path: 'a.ts', line: 3 }] } }] },
      }),
      pr(2, { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', completedAt: AFTER, detailsUrl: 'u-test' }] } } } }] } }),
    ),
  )
  const replies = repliesFor([{ branch: 'b1', run: 'r1', endedAt: ENDED }, { branch: 'b2', run: 'r2', endedAt: ENDED }], open)
  assert.deepEqual(replies.map(r => [r.run, r.seen]), [['r1', ['IC_1', 'PRR_1', 'PRRC_1']], ['r2', []]])
  assert.deepEqual(seenArgs(['IC_1', 'PRR_1']), ['api', 'graphql', '-f', 'query=mutation { r0: addReaction(input: { subjectId: "IC_1", content: EYES }) { clientMutationId } r1: addReaction(input: { subjectId: "PRR_1", content: EYES }) { clientMutationId } }'])
})

test('a look asks first whether a comment changed, then reads every pull request in one GitHub call, in the repository the working directory is in, and gives what it hands a run 👀 in one more; nothing to watch asks GitHub nothing; GitHub that cannot answer throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replies-cache-'))
  try {
    const cache = join(dir, 'replies.json')
    const calls: string[][] = []
    const gh: GhRunner = async args => {
      calls.push(args)
      if (args[1] === 'graphql' && args[3]!.startsWith('query=mutation')) return '{}'
      return args[1] === 'graphql' ? JSON.stringify(answer(pr(1, { comments: { nodes: [comment('rom', 'Why?', AFTER)] } }))) : 'HTTP/2.0 200 OK\nEtag: W/"e1"\n\n[]'
    }
    const replies = await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r1', 1), card('r2', 2)], cache })
    assert.deepEqual(replies, [{ run: 'r1', text: 'On your pull request #1 (https://github.com/o/r/pull/1), since you ended:\n- @rom commented (https://github.com/o/r/pull/1#c-rom):\nWhy?' }], 'the run and its words, as the scheduler reads them')
    assert.deepEqual(calls.map(c => c.slice(0, 3)), [['api', '--include', 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=1'], ['api', '--include', 'repos/{owner}/{repo}/pulls/comments?sort=updated&direction=desc&per_page=1'], repliesArgs().slice(0, 3), seenArgs(['C-rom']).slice(0, 3)])
    assert.deepEqual(calls[3], seenArgs(['C-rom']))

    // A 👀 that could not be put leaves the answer to come.
    const noReaction: GhRunner = async args => (args[1] === 'graphql' && args[3]!.startsWith('query=mutation') ? Promise.reject(new Error('gh: Forbidden')) : gh(args, '/repo'))
    assert.deepEqual((await listReplies('/repo', { gh: noReaction, host: 'this-box', runs: async () => [card('r1', 1)], cache: join(dir, 'other.json') })).map(r => r.run), ['r1'])
    assert.deepEqual(repliesArgs().slice(0, 6), ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}'])

    calls.length = 0
    assert.deepEqual(await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r2', 2, {}, 'other-box')], cache }), [])
    assert.deepEqual(calls, [])
    await assert.rejects(listReplies('/repo', { gh: async () => { throw new Error('gh: not logged in') }, host: 'this-box', runs: async () => [card('r1', 1)], cache }), /not logged in/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('when no comment changed, a look reads nothing more, but for the whole read once a minute; a changed comment is read at once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replies-cache-'))
  try {
    const cache = join(dir, 'replies.json')
    let changed = true
    const calls: string[][] = []
    const gh: GhRunner = async args => {
      calls.push(args)
      if (args[1] === 'graphql') return JSON.stringify(answer(pr(1, { comments: { nodes: [comment('rom', 'Why?', AFTER)] } })))
      if (!changed && args.includes('If-None-Match: W/"e1"')) throw new Error('gh: HTTP 304')
      return 'HTTP/2.0 200 OK\nEtag: W/"e1"\n\n[]'
    }
    let now = 1_000_000
    const look = () => listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r1', 1)], cache, now: () => now })
    assert.equal((await look()).length, 1, 'the first look reads it all')
    changed = false
    calls.length = 0
    now += 15_000
    assert.deepEqual(await look(), [], 'nothing changed: nothing read')
    assert.deepEqual(calls.map(c => c[1]), ['--include', '--include'], 'two free questions, each with the answer it last had')
    assert.ok(calls.every(c => c.includes('If-None-Match: W/"e1"')))
    now += WHOLE_READ_EVERY_MS
    calls.length = 0
    assert.equal((await look()).length, 1, 'a minute on: the whole read, for reviews, checks and conflicts')
    assert.equal(calls.at(-1)?.[1], 'graphql')
    changed = true
    now += 5_000
    calls.length = 0
    await look()
    assert.equal(calls.at(-1)?.[1], 'graphql', 'a changed comment is read at once')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
