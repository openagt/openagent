import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunCard } from '@openagt/skill-logs'
import type { GhRunner } from './gh.js'
import { WHOLE_READ_EVERY_MS, answersFor, listReplies, parseThreads, repliesArgs, seenArgs } from './replies.js'

// What came on the project's open issues and pull requests for this machine's agents: which run a
// thread is, what of GitHub's answer counts, the threads a new run is started for, and the one read.

const ENDED = '2026-10-19T10:00:00.250Z'
const BEFORE = '2026-10-19T09:00:00Z'
const AFTER = '2026-10-19T11:00:00Z'
/** When the row was switched on: what came before starts no run. */
const SINCE = '2026-10-19T10:30:00Z'

/** A run's record on branch `b<n>`, the branch of pull request n in {@link pr}; none with no number. */
function card(id: string, branch: number | undefined, over: Partial<RunCard> = {}, host = 'this-box'): RunCard {
  return { id, startedAt: '2026-10-19T08:00:00.000Z', endedAt: ENDED, status: 'done', ...(branch !== undefined ? { branch: `b${branch}` } : {}), caller: { host, runner: { host } }, ...over }
}

/** A run's record started for the thread at `url`, as the runner writes it beside the host. */
const forThread = (id: string, url: string, over: Partial<RunCard> = {}, host = 'this-box'): RunCard => card(id, undefined, { branch: `agent-${id}`, caller: { host, for: url, runner: { host, for: url } }, ...over }, host)

/** A pull request as GitHub answers it, with nothing on it unless said. */
function pr(number: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `PR_${number}`, number, title: `Request ${number}`, url: `https://github.com/o/r/pull/${number}`, author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: 'A change.', createdAt: BEFORE, headRefName: `b${number}`, isCrossRepository: false, mergeable: 'MERGEABLE', baseRef: { name: 'main', target: { committedDate: BEFORE } }, comments: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...over }
}

/** An issue as GitHub answers it, with nothing on it unless said. */
function issue(number: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: `I_${number}`, number, title: `Issue ${number}`, url: `https://github.com/o/r/issues/${number}`, author: { login: 'rom' }, authorAssociation: 'OWNER', body: 'Something.', createdAt: BEFORE, comments: { nodes: [] }, ...over }
}

const answer = (prs: Record<string, unknown>[], issues: Record<string, unknown>[] = []): unknown => ({ data: { repository: { issues: { nodes: issues }, pullRequests: { nodes: prs } } } })

const comment = (login: string, body: string, createdAt: string, association = 'OWNER', id = `C-${login}`) => ({ id, author: { login }, authorAssociation: association, body, createdAt, url: `https://github.com/o/r/pull/1#c-${login}` })

const RED_CHECK = { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', completedAt: AFTER, detailsUrl: 'u-test' }] } } } }] } }

/** The run each answer continues, or what a new run is for. */
const who = (answers: { run?: string; for?: string }[]): string[] => answers.map(a => a.run ?? `new: ${a.for}`)

test("a pull request is the run's that last worked on its branch, when that run is this machine's and has ended; one a run still works on, on any machine, is left to it", () => {
  const threads = parseThreads(answer([1, 2, 3].map(n => pr(n, { comments: { nodes: [comment('rom', '/agent Why?', AFTER)] } }))))
  const cards = [
    card('r1', 1),
    // A later run on the same branch, a follow-up: it is the one told.
    card('r1b', 1, { endedAt: '2026-10-19T10:30:00.000Z' }),
    card('r2', 2, {}, 'other-box'),
    card('r3', 3),
    (({ endedAt: _endedAt, ...going }) => ({ ...going, status: 'running' as const }))(card('r3b', 3, {}, 'other-box')),
    card('r4', undefined),
  ]
  assert.deepEqual(who(answersFor(threads, cards, 'this-box')), ['r1b'])
})

test("a pull request is the run's whose branch it is: one the run's record never learned, opened by its agent with no git host behind the run, is answered; a fork's of the same branch name is not", () => {
  const threads = parseThreads(
    answer([
      pr(8, { headRefName: 'agent-footer', isCrossRepository: true, comments: { nodes: [comment('rom', '/agent From a fork.', AFTER)] } }),
      pr(7, { headRefName: 'agent-footer', comments: { nodes: [comment('rom', '/agent Make it bold.', AFTER)] } }),
    ]),
  )
  assert.deepEqual(
    answersFor(threads, [card('r7', undefined, { branch: 'agent-footer' })], 'this-box').map(a => a.text),
    ['On your pull request #7 (https://github.com/o/r/pull/7), since you ended:\n- @rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent Make it bold.'],
  )
})

test("what counts on a pull request: its text, a maintainer's comment, review and line comment that call the agent with /agent, when written or edited; a red check, a conflict; not words without it, not someone else's, not an agent's, not a green check", () => {
  const [read] = parseThreads(
    answer([
      pr(1, {
        body: '/agent Have a look.',
        mergeable: 'CONFLICTING',
        baseRef: { name: 'main', target: { committedDate: AFTER } },
        comments: {
          nodes: [
            comment('rom', '/agent Why this name?', AFTER),
            comment('rom', 'Nice name, though.', AFTER),
            comment('rom', 'See src/agent and the /agents folder, or foo/agent.', AFTER),
            comment('rom', 'Ask `/agent`, it knows.', AFTER),
            comment('passer-by', '/agent Nice!', AFTER, 'NONE'),
            comment('rom', '🤖 *automated*\n/agent Renamed it.', AFTER),
            comment('rom', '<logo> sonnet-5-5\n\n/agent Renamed it.\n\n<!-- openagent -->', AFTER),
            { ...comment('rom', '/agent Edited in.', BEFORE), lastEditedAt: '2026-10-19T12:00:00Z' },
          ],
        },
        reviews: {
          nodes: [
            { author: { login: 'rom' }, authorAssociation: 'MEMBER', body: '/agent the loop is wrong', state: 'CHANGES_REQUESTED', submittedAt: AFTER, url: 'u-r1', comments: { nodes: [{ ...comment('rom', '/agent Off by one.', AFTER, 'MEMBER'), path: 'src/a.ts', line: 12 }, { ...comment('rom', 'Nit.', AFTER, 'MEMBER'), path: 'src/a.ts', line: 14 }] } },
            { author: { login: 'rom' }, authorAssociation: 'MEMBER', body: '', state: 'CHANGES_REQUESTED', submittedAt: AFTER, url: 'u-r2', comments: { nodes: [] } },
            { author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: 'Looks fine, one question.', state: 'COMMENTED', submittedAt: AFTER, url: 'u-r3', comments: { nodes: [] } },
            { author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: 'Looks fine. /agent, one question.', state: 'COMMENTED', submittedAt: AFTER, url: 'u-r4', comments: { nodes: [] } },
          ],
        },
        commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', completedAt: AFTER, detailsUrl: 'u-test' }, { __typename: 'CheckRun', name: 'lint', conclusion: 'SUCCESS', completedAt: AFTER, detailsUrl: 'u-lint' }, { __typename: 'StatusContext', context: 'ci/old', state: 'ERROR', createdAt: AFTER, targetUrl: 'u-old' }] } } } }] },
      }),
    ]),
  )
  assert.deepEqual(
    read!.calls.map(c => [c.at, c.line]),
    [
      [BEFORE, '@dani opened it (https://github.com/o/r/pull/1):\n/agent Have a look.'],
      [AFTER, '@rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent Why this name?'],
      [AFTER, '@rom commented (https://github.com/o/r/pull/1#c-rom):\nAsk `/agent`, it knows.'],
      ['2026-10-19T12:00:00Z', '@rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent Edited in.'],
      [AFTER, '@rom requested changes (u-r1):\n/agent the loop is wrong'],
      [AFTER, '@rom on src/a.ts line 12 (https://github.com/o/r/pull/1#c-rom):\n/agent Off by one.'],
      [AFTER, '@dani reviewed (u-r4):\nLooks fine. /agent, one question.'],
    ],
  )
  assert.deepEqual(read!.broken.map(c => c.line), ['The check "test" failed (u-test).', 'The check "ci/old" failed (u-old).', 'It conflicts with main, which moved since.'])
  assert.deepEqual(parseThreads({ errors: [{ message: 'no' }] }), [])
})

test("what counts on an issue: its text and its maintainers' comments that call the agent, as on a pull request", () => {
  const [read] = parseThreads(answer([], [issue(5, { body: '/agent add a README', comments: { nodes: [comment('rom', '/agent in English.', AFTER), comment('rom', 'Thanks.', AFTER), comment('someone', '/agent please', AFTER, 'NONE')] } })]))
  assert.deepEqual(read, {
    kind: 'issue',
    number: 5,
    url: 'https://github.com/o/r/issues/5',
    title: 'Issue 5',
    calls: [
      { at: BEFORE, line: '@rom opened it (https://github.com/o/r/issues/5):\n/agent add a README', seen: 'I_5' },
      { at: AFTER, line: '@rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent in English.', seen: 'C-rom' },
    ],
    broken: [],
  })
})

test('a run is told only what came after it ended, oldest first, under its thread; a thread with nothing new tells nothing', () => {
  const threads = parseThreads(
    answer([
      pr(1, { comments: { nodes: [comment('rom', '/agent Second.', '2026-10-19T12:00:00Z'), comment('rom', '/agent Seen before it ended.', BEFORE), comment('rom', '/agent First.', AFTER)] } }),
      pr(2, { comments: { nodes: [comment('rom', '/agent Old news.', BEFORE)] } }),
    ]),
  )
  assert.deepEqual(answersFor(threads, [card('r1', 1), card('r2', 2), card('r9', 9)], 'this-box'), [
    {
      run: 'r1',
      text: ['On your pull request #1 (https://github.com/o/r/pull/1), since you ended:', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent First.', '- @rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent Second.'].join('\n'),
      seen: ['C-rom', 'C-rom'],
    },
  ])
})

test("a run started for a thread is that thread's: an issue's call continues it, and so does its own pull request's red check; on a person's pull request it was called on, only a call does", () => {
  const issueUrl = 'https://github.com/o/r/issues/5'
  const threads = parseThreads(
    answer(
      [
        // The issue's run opened this one from its own branch: the agent's own.
        pr(31, { headRefName: 'agent-ri', ...RED_CHECK }),
        // Dani's, which an agent was called on: its run works on Dani's branch.
        pr(30, { headRefName: 'dark-mode', ...RED_CHECK, mergeable: 'CONFLICTING', baseRef: { name: 'main', target: { committedDate: AFTER } } }),
        pr(32, { headRefName: 'light-mode', ...RED_CHECK, comments: { nodes: [comment('rom', '/agent fix the test', AFTER)] } }),
      ],
      [issue(5, { comments: { nodes: [comment('rom', '/agent in English please.', AFTER)] } })],
    ),
  )
  const cards = [forThread('ri', issueUrl), forThread('rp', 'https://github.com/o/r/pull/30', { branch: 'dark-mode' }), forThread('rq', 'https://github.com/o/r/pull/32', { branch: 'light-mode' })]
  assert.deepEqual(
    answersFor(threads, cards, 'this-box').map(a => [who([a])[0], a.text.split('\n')[0]]),
    [
      ['ri', 'On issue #5 (https://github.com/o/r/issues/5), since you ended:'],
      ['ri', 'On your pull request #31 (https://github.com/o/r/pull/31), since you ended:'],
      ['rq', 'On pull request #32 (https://github.com/o/r/pull/32), since you ended:'],
    ],
  )
  assert.deepEqual(answersFor(threads, cards, 'this-box').find(a => 'run' in a && a.run === 'rq')?.text.split('\n').slice(1), ['- @rom commented (https://github.com/o/r/pull/1#c-rom):', '/agent fix the test'], "a person's red check is none of the agent's")
})

test("a thread no run was ever on, where a maintainer called the agent since the row was switched on: a new run for it, on a pull request's branch; a fork's is worked on from no branch; nothing before then, nothing without a time", () => {
  const threads = parseThreads(
    answer(
      [
        pr(30, { headRefName: 'dark-mode', comments: { nodes: [comment('rom', '/agent the button is unreadable', AFTER)] } }),
        pr(40, { headRefName: 'main', isCrossRepository: true, body: '/agent please review', createdAt: AFTER, author: { login: 'rom' }, authorAssociation: 'OWNER' }),
        pr(41, { comments: { nodes: [comment('rom', '/agent before it was on', BEFORE)] } }),
        pr(42, { comments: { nodes: [comment('passer-by', '/agent do it', AFTER, 'NONE')] } }),
      ],
      [issue(5, { body: '/agent add a README', createdAt: AFTER }), issue(6, { body: '/agent another', createdAt: AFTER })],
    ),
  )
  // Issue 6 has a run still at work, on another machine: it is that run's.
  const cards = [(({ endedAt: _endedAt, ...going }) => ({ ...going, status: 'running' as const }))(forThread('r6', 'https://github.com/o/r/issues/6', {}, 'other-box'))]
  const answers = answersFor(threads, cards, 'this-box', SINCE)
  assert.deepEqual(answers, [
    { for: 'https://github.com/o/r/issues/5', text: 'You are called on issue #5 (https://github.com/o/r/issues/5), "Issue 5":\n- @rom opened it (https://github.com/o/r/issues/5):\n/agent add a README', seen: ['I_5'] },
    { for: 'https://github.com/o/r/pull/30', branch: 'dark-mode', text: 'You are called on pull request #30 (https://github.com/o/r/pull/30), "Request 30", on its branch dark-mode:\n- @rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent the button is unreadable', seen: ['C-rom'] },
    { for: 'https://github.com/o/r/pull/40', text: 'You are called on pull request #40 (https://github.com/o/r/pull/40), "Request 40", from a fork: you are not on its branch, and cannot push to it:\n- @rom opened it (https://github.com/o/r/pull/40):\n/agent please review', seen: ['PR_40'] },
  ])
  assert.deepEqual(answersFor(threads, cards, 'this-box'), [], 'no time: no new run')
})

test("a thread whose run is another machine's is left to it, a call there too; one that ended here is continued, never started again", () => {
  const threads = parseThreads(answer([], [issue(5, { comments: { nodes: [comment('rom', '/agent go on', AFTER)] } })]))
  assert.deepEqual(answersFor(threads, [forThread('r5', 'https://github.com/o/r/issues/5', {}, 'other-box')], 'this-box', SINCE), [])
  assert.deepEqual(who(answersFor(threads, [forThread('r5', 'https://github.com/o/r/issues/5')], 'this-box', SINCE)), ['r5'])
})

test('the words a run is told, by their ids, for their 👀: a thread\'s text, a line comment and a review too; a red check is none', () => {
  const threads = parseThreads(
    answer([
      pr(1, {
        body: '/agent look',
        createdAt: AFTER,
        comments: { nodes: [comment('rom', '/agent First.', AFTER, 'OWNER', 'IC_1'), comment('dani', '/agent Seen before it ended.', BEFORE, 'COLLABORATOR', 'IC_0')] },
        reviews: { nodes: [{ id: 'PRR_1', author: { login: 'dani' }, authorAssociation: 'COLLABORATOR', body: '/agent One thing.', state: 'COMMENTED', submittedAt: AFTER, url: 'u-r', comments: { nodes: [{ ...comment('dani', '/agent Off by one.', AFTER, 'COLLABORATOR', 'PRRC_1'), path: 'a.ts', line: 3 }] } }] },
      }),
      pr(2, RED_CHECK),
    ]),
  )
  const answers = answersFor(threads, [card('r1', 1), card('r2', 2)], 'this-box')
  assert.deepEqual(answers.map(a => [who([a])[0], a.seen]), [['r1', ['PR_1', 'IC_1', 'PRR_1', 'PRRC_1']], ['r2', []]])
  assert.deepEqual(seenArgs(['IC_1', 'PRR_1']), ['api', 'graphql', '-f', 'query=mutation { r0: addReaction(input: { subjectId: "IC_1", content: EYES }) { clientMutationId } r1: addReaction(input: { subjectId: "PRR_1", content: EYES }) { clientMutationId } }'])
})

test('a look asks first whether anything changed, then reads every issue and pull request in one GitHub call, in the repository the working directory is in, and gives what it hands a run 👀 in one more; nothing to continue and no time asks GitHub nothing; GitHub that cannot answer throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replies-cache-'))
  try {
    const cache = join(dir, 'replies.json')
    const calls: string[][] = []
    const gh: GhRunner = async args => {
      calls.push(args)
      if (args[1] === 'graphql' && args[3]!.startsWith('query=mutation')) return '{}'
      return args[1] === 'graphql' ? JSON.stringify(answer([pr(1, { comments: { nodes: [comment('rom', '/agent Why?', AFTER)] } })])) : 'HTTP/2.0 200 OK\nEtag: W/"e1"\n\n[]'
    }
    const replies = await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r1', 1), card('r2', 2)], cache })
    assert.deepEqual(replies, [{ run: 'r1', text: 'On your pull request #1 (https://github.com/o/r/pull/1), since you ended:\n- @rom commented (https://github.com/o/r/pull/1#c-rom):\n/agent Why?' }], 'the run and its words, as the scheduler reads them')
    assert.deepEqual(calls.map(c => c.slice(0, 3)), [
      ['api', '--include', 'repos/{owner}/{repo}/issues?state=all&sort=updated&direction=desc&per_page=1'],
      ['api', '--include', 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=1'],
      ['api', '--include', 'repos/{owner}/{repo}/pulls/comments?sort=updated&direction=desc&per_page=1'],
      repliesArgs().slice(0, 3),
      seenArgs(['C-rom']).slice(0, 3),
    ])
    assert.deepEqual(calls[4], seenArgs(['C-rom']))

    // A 👀 that could not be put leaves the answer to come.
    const noReaction: GhRunner = async args => (args[1] === 'graphql' && args[3]!.startsWith('query=mutation') ? Promise.reject(new Error('gh: Forbidden')) : gh(args, '/repo'))
    assert.deepEqual(who(await listReplies('/repo', { gh: noReaction, host: 'this-box', runs: async () => [card('r1', 1)], cache: join(dir, 'other.json') })), ['r1'])
    assert.deepEqual(repliesArgs().slice(0, 6), ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}'])

    calls.length = 0
    assert.deepEqual(await listReplies('/repo', { gh, host: 'this-box', runs: async () => [card('r2', 2, {}, 'other-box')], cache }), [])
    assert.deepEqual(calls, [])
    // With a time, a look is made with no run at all: a thread may call the agent.
    assert.deepEqual(who(await listReplies('/repo', { gh, host: 'this-box', runs: async () => [], cache: join(dir, 'third.json'), since: SINCE })), ['new: https://github.com/o/r/pull/1'])
    await assert.rejects(listReplies('/repo', { gh: async () => { throw new Error('gh: not logged in') }, host: 'this-box', runs: async () => [card('r1', 1)], cache }), /not logged in/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('when nothing changed, a look reads nothing more, but for the whole read once a minute; a change is read at once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'replies-cache-'))
  try {
    const cache = join(dir, 'replies.json')
    let changed = true
    const calls: string[][] = []
    const gh: GhRunner = async args => {
      calls.push(args)
      if (args[1] === 'graphql') return JSON.stringify(answer([pr(1, { comments: { nodes: [comment('rom', '/agent Why?', AFTER)] } })]))
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
    assert.deepEqual(calls.map(c => c[1]), ['--include', '--include', '--include'], 'three free questions, each with the answer it last had')
    assert.ok(calls.every(c => c.includes('If-None-Match: W/"e1"')))
    now += WHOLE_READ_EVERY_MS
    calls.length = 0
    assert.equal((await look()).length, 1, 'a minute on: the whole read, for reviews, checks and conflicts')
    assert.equal(calls.at(-1)?.[1], 'graphql')
    changed = true
    now += 5_000
    calls.length = 0
    await look()
    assert.equal(calls.at(-1)?.[1], 'graphql', 'a change is read at once')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
