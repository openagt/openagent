import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { adoptCloudWork, startCloudWorkAdoption, CLOUD_ADOPTION_WINDOW_MS, type CloudWorkDeps, type CloudWorkResult } from './cloud-work.js'
import type { AgentMeta } from './store/index.js'
import type { LinkedPr } from './dashboard/pull-requests.js'

const sh = promisify(execFile)

// #1601: a web run's work lands on the cloud session's own `claude/*` branch, which this pass
// recognizes by ancestry from the run's hand-off anchor and records onto the run's archive.

const CWD = '/repo'
const AT = '2026-08-20T10:00:00.000Z'
const ID = '2026-08-20T10-00-00-000Z'
const NOW = Date.parse(AT) + 60 * 60 * 1000 // an hour after the run started
const ANCHOR = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)

function webRun(over: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: ID,
    status: 'done',
    startedAt: AT,
    updatedAt: AT,
    target: 'web',
    branch: `agent-${ID}`,
    cloudAnchor: ANCHOR,
    ...over,
  }
}

/**
 * A git runner speaking just enough of the pass's dialect: `fetch` succeeds, and `for-each-ref
 * --contains=<anchor>` answers with the `heads` whose sha is listed under that anchor in
 * `descends`, formatted as the remote-tracking refs the fetch would have written.
 */
function fakeGit(heads: { ref: string; sha: string }[], descends: Record<string, string[]> = { [ANCHOR]: [HEAD_SHA] }) {
  const calls: string[][] = []
  const run = async (args: string[], _cwd: string): Promise<string> => {
    calls.push([...args])
    if (args[0] === 'fetch') return ''
    if (args[0] === 'for-each-ref') {
      const anchor = /^--contains=(.+)$/.exec(args[1] ?? '')?.[1] ?? ''
      return heads
        .filter(h => descends[anchor]?.includes(h.sha))
        .map(h => `${h.sha} refs/remotes/origin/${h.ref}`)
        .join('\n')
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  return { calls, run }
}

interface Recorded {
  branches: { agentId: string; branch: string }[]
  prs: { agentId: string; number: number }[]
  opened: string[]
}

function deps(agents: AgentMeta[], git = fakeGit([{ ref: 'claude/fix-it', sha: HEAD_SHA }]), prs: LinkedPr[] = []) {
  const recorded: Recorded = { branches: [], prs: [], opened: [] }
  const d: CloudWorkDeps = {
    git: git.run,
    agents: async () => agents,
    prs: async () => prs,
    patch: async (_cwd, agentId, patch) => {
      if (patch.branch !== undefined) recorded.branches.push({ agentId, branch: patch.branch })
      if (patch.pr !== undefined) recorded.prs.push({ agentId, number: patch.pr.number })
      return true
    },
    openPr: async (_cwd, _agent, branch) => {
      recorded.opened.push(branch)
      return { ok: true, url: 'https://x/pull/7', number: 7 }
    },
    now: () => NOW,
  }
  return { d, recorded, git }
}

test('the head descending from the run anchor is adopted as its branch, with the PR the session opened (#1601)', async () => {
  const pr: LinkedPr = { number: 42, url: 'https://x/pull/42', state: 'OPEN', title: 't', createdAt: new Date(NOW).toISOString() }
  const { d, recorded } = deps([webRun()], fakeGit([{ ref: 'claude/fix-it', sha: HEAD_SHA }]), [pr])
  const result = await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [{ agentId: ID, branch: 'claude/fix-it' }])
  assert.deepEqual(recorded.prs, [{ agentId: ID, number: 42 }])
  assert.deepEqual(recorded.opened, [], 'the session already opened its PR, so none is opened here')
  assert.deepEqual(result.adopted, [{ agentId: ID, branch: 'claude/fix-it', pr: { number: 42, url: 'https://x/pull/42' } }])
})

test('a run armed for a PR the session never opened gets its draft PR opened and recorded (#1601)', async () => {
  const { d, recorded } = deps([webRun()])
  const result = await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.opened, ['claude/fix-it'])
  assert.deepEqual(recorded.prs, [{ agentId: ID, number: 7 }])
  assert.equal(result.adopted[0]?.opened, true)
})

test('an unarmed run gets its branch recorded and nothing opened (#1601)', async () => {
  const { d, recorded } = deps([webRun({ handoff: { push: true, pr: false } })])
  await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [{ agentId: ID, branch: 'claude/fix-it' }])
  assert.deepEqual(recorded.opened, [])
  assert.deepEqual(recorded.prs, [])
})

test('a head that is just the anchor gets no PR: the session pushed nothing beyond the hand-off (#1601)', async () => {
  const { d, recorded } = deps([webRun()], fakeGit([{ ref: 'claude/empty', sha: ANCHOR }], { [ANCHOR]: [ANCHOR] }))
  await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [{ agentId: ID, branch: 'claude/empty' }])
  assert.deepEqual(recorded.opened, [], 'a PR over nothing helps nobody')
})

test('zero or two matching heads adopt nothing: unmatched is the normal waiting state (#1601)', async () => {
  const none = deps([webRun()], fakeGit([{ ref: 'claude/other', sha: HEAD_SHA }], { [ANCHOR]: [] }))
  assert.deepEqual((await adoptCloudWork(CWD, none.d)).adopted, [])
  assert.deepEqual(none.recorded.branches, [])

  const two = deps(
    [webRun()],
    fakeGit(
      [
        { ref: 'claude/one', sha: HEAD_SHA },
        { ref: 'claude/two', sha: 'c'.repeat(40) },
      ],
      { [ANCHOR]: [HEAD_SHA, 'c'.repeat(40)] },
    ),
  )
  assert.deepEqual((await adoptCloudWork(CWD, two.d)).adopted, [], 'ancestry alone cannot arbitrate two descendants')
})

test('runs outside the pass: non-web, still running, no anchor, already adopted, too old (#1601)', async () => {
  const settled = [
    webRun({ target: 'local' }),
    webRun({ status: 'running' }),
    // No anchor recorded (the pre-hand-off push failed): nothing to match by.
    (({ cloudAnchor: _drop, ...rest }) => rest)(webRun()),
    // Adopted with its PR recorded: fully answered.
    webRun({ branch: 'claude/done', pr: { number: 1, url: 'u' } }),
    // Adopted, unarmed: the branch was the whole answer.
    webRun({ branch: 'claude/done', handoff: { push: true, pr: false } }),
    // Older than the window: no longer asked about.
    webRun({ startedAt: new Date(NOW - CLOUD_ADOPTION_WINDOW_MS - 1000).toISOString() }),
  ]
  const git = fakeGit([{ ref: 'claude/fix-it', sha: HEAD_SHA }])
  const { d, recorded } = deps(settled, git)
  await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [])
  assert.deepEqual(git.calls, [], 'nothing waiting means not even a fetch')
})

test('the archive is only asked for the window, so an old history costs no reads (#1607)', async () => {
  // The pass runs on a cadence forever while the archive only grows, so the window has to reach
  // the store rather than being applied after every record has already been parsed.
  const asked: number[] = []
  const { d } = deps([webRun()])
  await adoptCloudWork(CWD, {
    ...d,
    agents: async (_cwd, since) => (asked.push(since), [webRun()]),
  })
  assert.deepEqual(asked, [NOW - CLOUD_ADOPTION_WINDOW_MS])
})

test('a run already adopted but still owed its armed PR keeps being asked about (#1601)', async () => {
  // The session pushed its branch but had not opened a PR when the branch was adopted; a later
  // pass finds the PR (or opens the armed draft) without re-recording the branch.
  const { d, recorded } = deps([webRun({ branch: 'claude/fix-it' })])
  await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [], 'the branch is already on the record')
  assert.deepEqual(recorded.opened, ['claude/fix-it'])
})

test('no remote, or a remote that cannot be reached, adopts nothing and never throws (#1601)', async () => {
  const git = {
    run: async (args: string[]): Promise<string> => {
      if (args[0] === 'fetch') throw new Error('no remote')
      throw new Error('unexpected')
    },
  }
  const { d } = deps([webRun()])
  const result = await adoptCloudWork(CWD, { ...d, git: git.run })
  assert.deepEqual(result, { adopted: [], failed: [] })
})

test('startCloudWorkAdoption says adoptions out loud and joins overlapping ticks (#1601)', async () => {
  const lines: string[] = []
  let calls = 0
  const adoption = startCloudWorkAdoption({
    projects: async () => [{ path: CWD }],
    log: line => lines.push(line),
    adopt: async (): Promise<CloudWorkResult> => {
      calls++
      return {
        adopted: [{ agentId: ID, branch: 'claude/fix-it', pr: { number: 7, url: 'https://x/pull/7' }, opened: true }],
        failed: [{ agentId: 'other', error: 'boom' }],
      }
    },
  })
  await Promise.all([adoption.tick(), adoption.tick()])
  assert.equal(calls, 1, 'overlapping ticks join the pass already running')
  assert.ok(lines.some(l => l.includes('claude/fix-it') && l.includes(ID) && l.includes('draft PR')))
  assert.ok(lines.some(l => l.includes('boom')))
  adoption.stop()
  await adoption.tick()
  assert.equal(calls, 1, 'a stopped pass runs nothing')
})

test('a PR listing that fails records the branch but opens nothing: "none" and "could not tell" must not look alike (#1601)', async () => {
  // A transient gh failure used to read as "the session opened no PR" and open a second draft on
  // a branch that already had one.
  const { d, recorded } = deps([webRun()])
  d.prs = async () => {
    throw new Error('gh: rate limited')
  }
  const result = await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [{ agentId: ID, branch: 'claude/fix-it' }], 'the branch is a fact regardless')
  assert.deepEqual(recorded.opened, [], 'no PR is opened on a listing this pass could not read')
  assert.deepEqual(recorded.prs, [])
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0]!.error, /could not list the PRs/)
})

test('a run whose record names another branch of its own, not a cloud session\'s, is adopted all the same: the anchor\'s descent is the proof, and the record then names the branch the pull request lives on (#1601/#1774)', async () => {
  const { d, recorded } = deps([webRun({ branch: 'agent-renamed-by-hand' })])
  const result = await adoptCloudWork(CWD, d)
  assert.deepEqual(recorded.branches, [{ agentId: ID, branch: 'claude/fix-it' }])
  assert.deepEqual(result.adopted.map(a => a.branch), ['claude/fix-it'])
})

/**
 * A real repo standing in for the daemon's checkout, plus a separate clone standing in for the
 * cloud VM. The `claude/*` branches are pushed only from the clone, so the daemon's checkout has
 * never seen them — which is the whole point: a fixture that pushed them from the checkout under
 * test would already hold the remote-tracking refs `git push` writes, and the pass's fetch would
 * have nothing left to prove.
 */
async function repoWithCloudHeads(): Promise<{
  project: string
  anchor: string
  strandedAnchor: string
  cleanup: () => Promise<void>
}> {
  const origin = await mkdtemp(join(tmpdir(), 'openagent-cloud-work-origin-'))
  const project = await mkdtemp(join(tmpdir(), 'openagent-cloud-work-'))
  const session = await mkdtemp(join(tmpdir(), 'openagent-cloud-work-session-'))
  const identify = async (cwd: string) => {
    for (const cfg of [
      ['user.email', 'test@example.com'],
      ['user.name', 'Test'],
      ['commit.gpgsign', 'false'],
    ]) {
      await sh('git', ['config', ...cfg], { cwd })
    }
  }
  await sh('git', ['init', '-q', '--bare'], { cwd: origin })
  await sh('git', ['init', '-q', '-b', 'main'], { cwd: project })
  await identify(project)
  await sh('git', ['remote', 'add', 'origin', origin], { cwd: project })

  const git = (...args: string[]) => sh('git', args, { cwd: project })
  const head = async () => (await git('rev-parse', 'HEAD')).stdout.trim()
  await writeFile(join(project, 'a.txt'), 'base')
  await git('add', '-A')
  await git('commit', '-qm', 'base')
  const base = await head()
  await git('push', '-q', 'origin', 'main')

  // The two hand-off anchors the driver pushes from this checkout: one the session will build
  // on, one whose session never pushes anything at all.
  await git('checkout', '-q', '-b', 'run', base)
  await git('commit', '-q', '--allow-empty', '-m', 'hand-off anchor')
  const anchor = await head()
  await git('push', '-q', 'origin', 'HEAD:refs/heads/agent-run')
  await git('checkout', '-q', '-b', 'stranded', base)
  await git('commit', '-q', '--allow-empty', '-m', 'hand-off anchor 2')
  const strandedAnchor = await head()
  await git('push', '-q', 'origin', 'HEAD:refs/heads/agent-stranded')
  await git('checkout', '-q', 'main')

  // The cloud VM: a different clone, which is where every `claude/*` branch is pushed from.
  await sh('git', ['clone', '-q', origin, session])
  await identify(session)
  const vm = (...args: string[]) => sh('git', args, { cwd: session })
  await vm('checkout', '-q', '-b', 'work', anchor)
  await vm('commit', '-q', '--allow-empty', '-m', 'session work')
  await vm('push', '-q', 'origin', 'HEAD:refs/heads/claude/this-run')
  // And a `claude/*` branch forked before the anchor exists: ancestry must rule it out.
  await vm('checkout', '-q', '-b', 'unrelated', base)
  await vm('commit', '-q', '--allow-empty', '-m', 'someone else')
  await vm('push', '-q', 'origin', 'HEAD:refs/heads/claude/not-this-run')

  return {
    project,
    anchor,
    strandedAnchor,
    cleanup: async () => {
      for (const dir of [project, origin, session]) await rm(dir, { recursive: true, force: true })
    },
  }
}

test('against real git: the anchor picks out its own `claude/*` head and no other (#1601/#1607)', async () => {
  // The other tests speak to a fake git, which will agree with whatever commands the pass sends
  // it. This one runs the real ones, so a wrong refspec or a wrong ancestry query is caught here.
  const { project, anchor, strandedAnchor, cleanup } = await repoWithCloudHeads()
  try {
    // Nothing local knows about the session's branches yet: the fetch has to go and get them.
    const before = await sh('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/claude/'], { cwd: project })
    assert.equal(before.stdout.trim(), '', 'the checkout under test has never seen a `claude/*` head')

    const recorded: { agentId: string; branch: string }[] = []
    const seams = (cloudAnchor: string): CloudWorkDeps => ({
      agents: async () => [webRun({ cloudAnchor, handoff: { push: true, pr: false } })],
      prs: async () => [],
      patch: async (_cwd, agentId, patch) => {
        if (patch.branch !== undefined) recorded.push({ agentId, branch: patch.branch })
        return true
      },
      now: () => NOW,
    })

    const matched = await adoptCloudWork(project, seams(anchor))
    assert.deepEqual(
      matched.adopted.map(a => a.branch),
      ['claude/this-run'],
      'the branch descending from the anchor, and not the one forked before it',
    )
    assert.deepEqual(recorded, [{ agentId: ID, branch: 'claude/this-run' }])
    assert.deepEqual(matched.failed, [])

    // The fetch wrote remote-tracking refs rather than leaving the objects reachable only from
    // `FETCH_HEAD`, which is what keeps the next garbage collection from throwing them away.
    const after = (await sh('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/claude/'], { cwd: project })).stdout
    assert.match(after, /refs\/remotes\/origin\/claude\/this-run/)

    // A run whose session pushed nothing matches nothing, and is left for the next pass.
    recorded.length = 0
    const stranded = await adoptCloudWork(project, seams(strandedAnchor))
    assert.deepEqual(stranded.adopted, [], 'no head descends from that anchor')
    assert.deepEqual(recorded, [])
  } finally {
    await cleanup()
  }
})
