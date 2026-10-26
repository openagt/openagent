import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, realpath, stat } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { sendStop, sendMessage, sendChoice, sendRemoveWorktree, sendOpenPullRequest } from './control.js'
import { onRetainedWorktrees, onAgents, onRecentAgents, onAgent } from './reads.js'
import { asArrived } from './relay-agent.js'
import { dispatchRelayRpc } from './relay-dispatch.js'
import { addProject, projectId as idFor } from '../registry.js'
import { DATA_BRANCH, fileBranchPath, nodeGitRunner } from '@openagt/agent-data'
import { worktreePath, addWorktree, agentBranchName } from '@openagt/skill-branches'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { RUN_INBOX_FILE } from '../dashboard/run-inbox.js'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'
import { provideTestContext } from './test-context.js'

// #749, #1774: what is addressed at a RUN has to resolve the run's own checkout, not the project:
// the run's card is there, and so is the inbox its tool reads. Addressed at the project root, a
// message reaches a file nobody reads.
//
// These run against the real registry, pointed at a temp $XDG_CONFIG_HOME so the user's own
// registry is never touched.

const QUESTION = { kind: 'question', title: 'Which way?', options: [{ id: 'a', label: 'Left' }, { id: 'b', label: 'Right' }] }

/** A project with one run in a checkout of its own. Returns its ids and the two candidate inbox paths. */
async function projectWithWorktreeAgent(
  owner: { pid: number; host: string } = { pid: 0, host: 'elsewhere' },
  run: { status?: string; diary?: unknown[]; hooks?: string } = {},
): Promise<{
  dir: string
  projectId: string
  agentId: string
  agentInbox: string
  rootInbox: string
  restore: () => void
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-addressing-')))
  const agentId = '2026-07-19T10-00-00-000Z'
  // A real repository with a real checkout: the project's branches provider lists the checkouts (#1774).
  const git = nodeGitRunner()
  await git(['init', '-q'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await writeFile(join(dir, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-q', '-m', 'init'], dir)
  await addWorktree(dir, { agentId, branch: agentBranchName(agentId) }, git)
  const worktree = worktreePath(dir, agentId)
  await mkdir(join(worktree, OPENAGENT_DIR), { recursive: true })
  // The run's card is what readLiveMetas discovers, and its id is what the caller addresses.
  await writeFile(
    join(worktree, OPENAGENT_DIR, `${agentId}.json`),
    JSON.stringify({ id: agentId, startedAt: '2026-07-19T10:00:00.000Z', status: run.status ?? 'running', caller: owner }),
  )
  await writeFile(join(worktree, OPENAGENT_DIR, `${agentId}.jsonl`), (run.diary ?? []).map(line => JSON.stringify(line) + '\n').join(''))
  if (run.hooks !== undefined) {
    await mkdir(join(dir, OPENAGENT_DIR), { recursive: true })
    await writeFile(join(dir, PROJECT_HOOKS_FILE), run.hooks)
  }

  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  await addProject(dir, new Date().toISOString())
  // The context every RPC reads (D3). In tests it is a global that outlives an await,
  // unlike the request-scoped one a real serve() provides.
  provideTestContext()

  return {
    dir,
    projectId: idFor(dir),
    agentId,
    agentInbox: join(worktree, OPENAGENT_DIR, RUN_INBOX_FILE),
    rootInbox: join(dir, OPENAGENT_DIR, RUN_INBOX_FILE),
    restore: () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
    },
  }
}

/** A resume line that writes down what it was handed and answers the run's id. */
const RESUME_HOOK = `resume: 'printf "%s|%s|%s\\n" "$RUN_ID" "\${TEXT-}" "\${ANSWER-}" >> resumed.txt; echo "{\\"id\\":\\"$RUN_ID\\"}"'\n`

const entries = async (path: string): Promise<unknown[]> =>
  (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)

// Stop is a signal to the process the run's card names, whoever runs the agent. The card here
// names this test process, whose handler catches it.
test('sendStop signals the pid the run\'s card names, and writes nothing', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() })
  // A signal watcher does not keep the event loop alive: a bound timer holds it open until the
  // signal lands, and fails the test rather than letting the process drain with the wait pending.
  let signalled!: () => void
  const caught = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no SIGINT within 5s')), 5000)
    signalled = () => {
      clearTimeout(timer)
      resolve()
    }
  })
  const onSignal = (): void => signalled()
  process.on('SIGINT', onSignal)
  try {
    await sendStop(ctx.projectId, ctx.agentId)
    await caught
    assert.deepEqual(await entries(ctx.agentInbox), [], 'a stop is not an inbox line')
    assert.deepEqual(await entries(ctx.rootInbox), [])
  } finally {
    process.off('SIGINT', onSignal)
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('sendStop leaves an agent alone whose process is not this machine\'s, or is gone', async () => {
  const elsewhere = await projectWithWorktreeAgent({ pid: process.pid, host: 'another-box' })
  try {
    const onSignal = (): void => assert.fail('signalled a pid on another host')
    process.on('SIGINT', onSignal)
    try {
      await sendStop(elsewhere.projectId, elsewhere.agentId)
      await new Promise(r => setTimeout(r, 50))
    } finally {
      process.off('SIGINT', onSignal)
    }
  } finally {
    elsewhere.restore()
    await rm(elsewhere.dir, { recursive: true, force: true })
  }
  // A dead pid on this host: nothing to signal, and nothing thrown.
  const dead = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() })
  try {
    await sendStop(dead.projectId, dead.agentId)
  } finally {
    dead.restore()
    await rm(dead.dir, { recursive: true, force: true })
  }
})

test('a message and an answer to a working run are lines in the inbox of the run\'s own checkout (#749/#1774)', async () => {
  // The card names this test process, so the run reads as working; its diary holds the question.
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { diary: [QUESTION], hooks: RESUME_HOOK })
  try {
    assert.deepEqual(await sendMessage(ctx.projectId, '  also add tests ', ctx.agentId), { ok: true })
    assert.deepEqual(await sendChoice(ctx.projectId, 'await-choices', 'b', ctx.agentId), { ok: true })
    assert.deepEqual(await entries(ctx.agentInbox), [
      { kind: 'message', text: 'also add tests' },
      { kind: 'answer', question: 'Which way?', answer: 'Right' },
    ])
    assert.deepEqual(await entries(ctx.rootInbox), [])
    assert.equal(await readFile(join(ctx.dir, 'resumed.txt'), 'utf8').catch(() => ''), '', 'a working run is not resumed')
    assert.deepEqual(await sendMessage(ctx.projectId, '   ', ctx.agentId), { ok: true }, 'an empty message is dropped')
    assert.equal((await entries(ctx.agentInbox)).length, 2)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a message and an answer to an ended run go through the project\'s resume hook; without the hook they are refused in words (#1774)', async () => {
  const waiting = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() }, { status: 'waiting', diary: [QUESTION, { kind: 'ended', status: 'waiting' }], hooks: RESUME_HOOK })
  try {
    assert.deepEqual(await sendChoice(waiting.projectId, 'await-choices', 'a', waiting.agentId), { ok: true })
    assert.deepEqual(await sendMessage(waiting.projectId, 'go on', waiting.agentId), { ok: true })
    assert.equal(await readFile(join(waiting.dir, 'resumed.txt'), 'utf8'), `${waiting.agentId}||Left\n${waiting.agentId}|go on|\n`)
    assert.deepEqual(await entries(waiting.agentInbox), [], 'nothing waits in an inbox nobody reads')
  } finally {
    waiting.restore()
    await rm(waiting.dir, { recursive: true, force: true })
  }
  const noHook = await projectWithWorktreeAgent({ pid: 2 ** 22 - 1, host: hostname() }, { status: 'done' })
  try {
    assert.deepEqual(await sendMessage(noHook.projectId, 'go on', noHook.agentId), { ok: false, error: 'this project has no resume hook' })
  } finally {
    noHook.restore()
    await rm(noHook.dir, { recursive: true, force: true })
  }
})

test('an answer must be to the question the run\'s diary holds open, by its own options (#1774)', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: process.pid, host: hostname() }, { diary: [QUESTION, { kind: 'said', text: 'going on' }] })
  try {
    // The agent went on after the question: it is no longer open.
    assert.deepEqual(await sendChoice(ctx.projectId, 'await-choices', 'a', ctx.agentId), { ok: false, error: 'that question is no longer open' })
    await writeFile(join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.jsonl`), JSON.stringify(QUESTION) + '\n')
    assert.deepEqual(await sendChoice(ctx.projectId, 'await-choices', 'zzz', ctx.agentId), { ok: false, error: 'every pick must be one of the question\'s options' })
    assert.deepEqual(await sendChoice(ctx.projectId, 'await-choices', ['a', 'b'], ctx.agentId), { ok: false, error: 'pick exactly one option' })
    assert.deepEqual(await entries(ctx.agentInbox), [])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a message with no run, or an unsafe run id, is refused (#749)', async () => {
  const ctx = await projectWithWorktreeAgent()
  try {
    assert.deepEqual(await sendMessage(ctx.projectId, 'one'), { ok: false, error: 'unknown session' })
    assert.deepEqual(await sendMessage(ctx.projectId, 'two', '../escape'), { ok: false, error: 'unknown session' })
    assert.deepEqual(await sendMessage('no-such-project', 'three', ctx.agentId), { ok: false, error: 'unknown session' })
    assert.deepEqual(await entries(ctx.rootInbox), [])
    assert.deepEqual(await entries(ctx.agentInbox), [], 'the run is left alone')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #737: a failed agent keeps its worktree for inspection, so removing one is an explicit action —
// and must never yank the checkout out from under an agent that is still going.

test('sendRemoveWorktree refuses while that run is still live (#737)', async () => {
  const ctx = await projectWithWorktreeAgent() // its card says `running`
  try {
    const result = await sendRemoveWorktree(ctx.projectId, ctx.agentId)
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /still going/)
    assert.ok(await readFile(join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.json`), 'utf8'), 'the worktree is untouched')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('sendRemoveWorktree rejects an unsafe run id before touching anything (#737)', async () => {
  const ctx = await projectWithWorktreeAgent()
  try {
    const result = await sendRemoveWorktree(ctx.projectId, '../../etc')
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /invalid session id/)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #982: the dashboard's Remove and the sweep are now one implementation, so the
// button gets the commit-first removal and the checks the CLI already had. Before that it went
// straight to a forcing removeWorktree, which deleted the very diff a retained checkout was kept
// for, and reported success for a session that had no worktree at all.

/** A registered project whose retained worktree holds an uncommitted edit, in a real git repo. */
async function projectWithDirtyWorktree(): Promise<{
  dir: string
  projectId: string
  agentId: string
  worktree: string
  branch: string
  restore: () => void
}> {
  const git = nodeGitRunner()
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-remove-')))
  await git(['init'], dir)
  await git(['config', 'user.email', 't@t'], dir)
  await git(['config', 'user.name', 't'], dir)
  await writeFile(join(dir, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], dir)
  await git(['commit', '-m', 'init'], dir)
  // A real bare `origin`, as a project has: an agent's branch starts from its default branch.
  await git(['init', '-q', '--bare', join(dir, 'origin.git')], dir)
  await git(['remote', 'add', 'origin', join(dir, 'origin.git')], dir)

  const agentId = 'run1'
  const { path, branch } = await addWorktree(dir, { agentId, branch: agentBranchName(agentId) }, git)
  await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')

  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
  await addProject(dir, new Date().toISOString())
  // The context every RPC reads (D3). In tests it is a global that outlives an await,
  // unlike the request-scoped one a real serve() provides.
  provideTestContext()

  return {
    dir,
    projectId: idFor(dir),
    agentId,
    worktree: path,
    branch,
    restore: () => {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previous
    },
  }
}

test('the dashboard Remove keeps a checkout holding uncommitted work, and says so (#982/E5/#1638)', async () => {
  const ctx = await projectWithDirtyWorktree()
  try {
    const result = await sendRemoveWorktree(ctx.projectId, ctx.agentId)
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /uncommitted work/)
    const git = nodeGitRunner()
    assert.match(await readFile(join(ctx.worktree, 'index.html'), 'utf8'), /Welcome!/, 'the edit is still in the checkout, uncommitted')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${ctx.branch}`], ctx.dir), 'and nothing reached the remote')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('the dashboard Remove takes away a checkout whose agent committed, keeps its branch and pushes nothing (#982/E5)', async () => {
  const ctx = await projectWithDirtyWorktree()
  try {
    const git = nodeGitRunner()
    await git(['config', 'user.email', 't@t'], ctx.worktree)
    await git(['config', 'user.name', 't'], ctx.worktree)
    await git(['add', '-A'], ctx.worktree)
    await git(['commit', '-q', '-m', 'work'], ctx.worktree)
    assert.deepEqual(await sendRemoveWorktree(ctx.projectId, ctx.agentId), { ok: true })
    assert.match(await git(['show', `${ctx.branch}:index.html`], ctx.dir), /Welcome!/, 'the committed edit survived on the run branch')
    await assert.rejects(() => stat(ctx.worktree), 'the checkout is gone')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${ctx.branch}`], ctx.dir), 'and nothing reached the remote: publishing is the person\'s call')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('the dashboard Remove reports an unknown session instead of claiming success (#982)', async () => {
  const ctx = await projectWithWorktreeAgent()
  try {
    const result = await sendRemoveWorktree(ctx.projectId, 'nosuchrun')
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /no checkout for agent nosuchrun/)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('onRetainedWorktrees hides a live run, and lists one that has finished (#737)', async () => {
  const ctx = await projectWithWorktreeAgent()
  try {
    assert.deepEqual(await onRetainedWorktrees(ctx.projectId), [], 'a running run has nothing to offer removing')
    // Once it is no longer running, its retained checkout is listed.
    await writeFile(
      join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.json`),
      JSON.stringify({ id: ctx.agentId, startedAt: '2026-07-19T10:00:00.000Z', status: 'failed' }),
    )
    assert.deepEqual(await onRetainedWorktrees(ctx.projectId), [ctx.agentId])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

// #768: a resumed run has a record from its first leg AND is going again in its checkout. The
// dedup used to keep the record and drop the live copy, so the dashboard showed a running agent as
// finished.
test('a resumed run reads as running, not as its recorded first leg (#768)', async () => {
  const ctx = await projectWithWorktreeAgent() // its checkout's card says `running`
  try {
    // Its first leg was recorded on the data branch when it ended.
    const recorded = join(await fileBranchPath(ctx.dir, DATA_BRANCH), 'agents', 'someone@example.com')
    await mkdir(recorded, { recursive: true })
    await writeFile(join(recorded, `${ctx.agentId}.json`), JSON.stringify({ id: ctx.agentId, startedAt: '2026-07-19T10:00:00.000Z', status: 'waiting' }))
    const agents = (await onAgents(ctx.projectId)) as { id: string; status: string }[]
    const mine = agents.filter(agent => agent.id === ctx.agentId)
    assert.equal(mine.length, 1, 'still one row, not two')
    assert.equal(mine[0]?.status, 'running', 'and it reads as live, not as the recorded first leg')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

/** A git host package that writes down each call and answers no pull request yet, then the one it opened. */
const GIT_HOST_PROVIDER = `
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(join(__dirname, 'calls.log'), args.join(' ') + '\\n')
if (args[0] === 'requests') process.stdout.write('[]')
else if (args[0] === 'open') process.stdout.write(JSON.stringify({ ok: true, request: { number: 9, url: 'https://x/pull/9' }, existing: false }))
`

// "Create draft PR" on the agent's page: the page sends `{ draft: true }`, and the call has to hand
// it on to the project's git host, or the pull request opens ready for review.
test('sendOpenPullRequest opens the pull request as a draft when asked to, and as a ready one otherwise', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'elsewhere' }, { status: 'done' })
  try {
    const git = nodeGitRunner()
    // The agent's work, committed on its branch, and a remote to push it to.
    const worktree = worktreePath(ctx.dir, ctx.agentId)
    // The run's own files are kept out of git, as a real run keeps them: the checkout is clean.
    await writeFile(join(ctx.dir, '.git', 'info', 'exclude'), `${OPENAGENT_DIR}/\n`)
    await writeFile(join(worktree, 'index.html'), '<h1>Hello, there!</h1>\n')
    await git(['commit', '-q', '-am', 'Say hello'], worktree)
    const remote = join(ctx.dir, 'remote.git')
    await git(['init', '-q', '--bare', remote], ctx.dir)
    await git(['remote', 'add', 'origin', remote], ctx.dir)
    // The project's git host: a package the project installed, which declares the command.
    await writeFile(join(ctx.dir, 'package.json'), JSON.stringify({ devDependencies: { host: '*' } }))
    const host = join(ctx.dir, 'node_modules', 'host')
    await mkdir(host, { recursive: true })
    await writeFile(join(host, 'package.json'), JSON.stringify({ name: 'host', bin: { host: 'provider.cjs' }, openagent: { 'git-host': 'host' } }))
    await writeFile(join(host, 'provider.cjs'), GIT_HOST_PROVIDER)
    const opens = async (): Promise<string[]> => (await readFile(join(host, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(line => line.startsWith('open '))

    assert.deepEqual(await sendOpenPullRequest(ctx.projectId, ctx.agentId, { draft: true }), { ok: true, url: 'https://x/pull/9', number: 9 })
    assert.equal((await opens()).length, 1)
    assert.match((await opens())[0]!, / --draft$/)

    assert.deepEqual(await sendOpenPullRequest(ctx.projectId, ctx.agentId), { ok: true, url: 'https://x/pull/9', number: 9 })
    assert.equal((await opens()).length, 2)
    assert.doesNotMatch((await opens())[1]!, /--draft/)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a run on a saved machine reads the same in the project\'s list and in every project\'s, by the machine\'s name; and a message typed on it goes to the machine, not to this computer\'s resume line', async () => {
  // Its record came through the project's shared records: started on the machine's own page, this computer never sent it.
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'server-box' }, { status: 'waiting', hooks: RESUME_HOOK })
  // The machine: it takes the calls about its run.
  const got: { fn: string; args: unknown[]; project: string }[] = []
  const machine = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk)).on('end', () => {
      got.push(JSON.parse(body) as { fn: string; args: unknown[]; project: string })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result: { ok: true } }))
    })
  })
  await new Promise<void>(resolve => machine.listen(0, '127.0.0.1', resolve))
  const target = { url: `http://127.0.0.1:${(machine.address() as AddressInfo).port}`, key: 'id.key', project: 'github.com/acme/shop' }
  // A run this computer sent there, which lives in its memory only.
  const sent = { status: 'running' as const, id: '2026-07-19T11-00-00-000Z', startedAt: '2026-07-19T11:00:00.000Z', updatedAt: '2026-07-19T11:00:00.000Z', target: 'remote' as const, remoteLabel: 'Server' }
  const asked: string[] = []
  provideTestContext({
    remote: {
      target: () => undefined,
      // And one followed by a record that was deleted since: it is listed no longer.
      list: projectId => (projectId === ctx.projectId ? [sent, { ...sent, id: 'followed-by-a-record-that-is-gone' }] : []),
      working: () => false,
      rekey: () => {},
      sent: agentId => agentId !== 'followed-by-a-record-that-is-gone',
      home: async (projectId, agentId) => {
        asked.push(`${projectId} ${agentId}`)
        return projectId === ctx.projectId && agentId === ctx.agentId ? target : undefined
      },
      follow: async () => {},
      machineNames: async () => host => (host === 'server-box' ? { label: 'Server', url: 'https://server.example' } : undefined),
      machineRuns: async () => [],
      followRuns: () => () => {},
    },
  })
  try {
    const where = (rows: { id: string; target?: string; remoteLabel?: string; otherHost?: boolean }[]) => rows.map(row => [row.id, row.target, row.remoteLabel, row.otherHost])
    const both = [[sent.id, 'remote', 'Server', undefined], [ctx.agentId, 'remote', 'Server', undefined]]
    assert.deepEqual(where(await onAgents(ctx.projectId)), both)
    assert.deepEqual(where((await onRecentAgents()).filter(row => row.projectId === ctx.projectId).map(row => row.agent)), both)

    assert.deepEqual(await sendMessage(ctx.projectId, 'go on', ctx.agentId), { ok: true })
    assert.deepEqual(asked, [`${ctx.projectId} ${ctx.agentId}`])
    assert.deepEqual(got, [{ fn: 'sendMessage', args: [ctx.projectId, 'go on', ctx.agentId], project: 'github.com/acme/shop' }])
    // This computer's own resume line was not run, and nothing was put in an inbox here.
    await assert.rejects(stat(join(ctx.dir, 'resumed.txt')), { code: 'ENOENT' })
    await assert.rejects(stat(ctx.agentInbox), { code: 'ENOENT' })
  } finally {
    ctx.restore()
    machine.closeAllConnections()
    machine.close()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a call that arrived from another computer is run here whatever the run\'s record says; with the machine down a read is answered from the record, and a message is not delivered here in its place', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'server-box' }, { status: 'waiting', hooks: RESUME_HOOK, diary: [{ kind: 'said', text: 'kept in the record' }] })
  // A machine nobody answers at.
  const down = { url: 'http://127.0.0.1:1', key: 'id.key', project: 'github.com/acme/shop' }
  let asked = 0
  provideTestContext({
    remote: {
      target: () => undefined,
      list: () => [],
      working: () => false,
      rekey: () => {},
      sent: agentId => agentId !== 'followed-by-a-record-that-is-gone',
      home: async () => (asked++, down),
      follow: async () => {},
      machineNames: async () => () => ({ label: 'Server', url: 'https://server.example' }),
      machineRuns: async () => [],
      followRuns: () => () => {},
    },
  })
  try {
    // The machine cannot be asked: what this computer holds of the run is read, and nothing is done to the run here.
    const events = await onAgent(ctx.projectId, ctx.agentId)
    assert.equal(JSON.stringify(events).includes('kept in the record'), true)
    assert.deepEqual(await sendMessage(ctx.projectId, 'go on', ctx.agentId), { ok: false, error: 'could not reach the machine' })
    await assert.rejects(stat(join(ctx.dir, 'resumed.txt')), { code: 'ENOENT' })
    assert.equal(asked, 2)

    // The same message, come in from another computer: this one is the run's, and no machine is asked.
    assert.deepEqual(await asArrived(() => sendMessage(ctx.projectId, 'go on', ctx.agentId)), { ok: true })
    assert.deepEqual(await dispatchRelayRpc(ctx.projectId, 'sendMessage', ['their-id-for-the-project', 'and on', ctx.agentId]), { ok: true })
    assert.equal(asked, 2)
    assert.equal(await readFile(join(ctx.dir, 'resumed.txt'), 'utf8'), `${ctx.agentId}|go on|\n${ctx.agentId}|and on|\n`)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a run another computer started, which is no saved machine, is not continued from here: a message and an answer are refused with where it runs, and nothing is resumed', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'ubuntu-s-1vcpu-2gb-fra1' }, { status: 'waiting', hooks: RESUME_HOOK, diary: [QUESTION, { kind: 'ended', status: 'waiting' }] })
  try {
    const refused = { ok: false, error: 'This run is on ubuntu-s-1vcpu-2gb-fra1. Continue it there.' }
    assert.deepEqual(await sendMessage(ctx.projectId, 'go on', ctx.agentId), refused)
    assert.deepEqual(await sendChoice(ctx.projectId, 'await-choices', 'a', ctx.agentId), refused)
    await assert.rejects(stat(join(ctx.dir, 'resumed.txt')), { code: 'ENOENT' })
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a machine that refuses what would change a run, and says why, is answered in its own words; nothing is done here in its place', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'server-box' }, { status: 'waiting', hooks: RESUME_HOOK, diary: [{ kind: 'said', text: 'kept in the record' }] })
  // A computer that only lets its server watch: it refuses a call that acts, in words for the person.
  const WHY = 'This computer only lets its server watch. Turn on "From anywhere" through this server in its Settings, under Devices.'
  const machine = createServer((req, res) => {
    req.resume()
    res.writeHead(403, { 'content-type': 'text/plain' }).end(WHY)
  })
  await new Promise<void>(resolve => machine.listen(0, '127.0.0.1', resolve))
  const target = { url: `http://127.0.0.1:${(machine.address() as AddressInfo).port}`, key: 'id.key', project: 'github.com/acme/shop' }
  provideTestContext({
    remote: { target: () => undefined, list: () => [], working: () => false, rekey: () => {}, sent: () => true, home: async () => target, follow: async () => {}, machineNames: async () => () => undefined, machineRuns: async () => [], followRuns: () => () => {} },
  })
  try {
    assert.deepEqual(await sendMessage(ctx.projectId, 'go on', ctx.agentId), { ok: false, error: WHY })
    assert.deepEqual(await sendOpenPullRequest(ctx.projectId, ctx.agentId), { ok: false, error: WHY })
    // A stop has no words to answer with: it is not done, and says nothing.
    assert.equal(await sendStop(ctx.projectId, ctx.agentId), undefined)
    await assert.rejects(stat(join(ctx.dir, 'resumed.txt')), { code: 'ENOENT' })
    await assert.rejects(stat(ctx.agentInbox), { code: 'ENOENT' })
  } finally {
    ctx.restore()
    machine.closeAllConnections()
    machine.close()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a record that calls its own run a saved machine\'s is not believed: the row says whose computer it is', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'their-laptop', target: 'remote', remoteLabel: 'Server' } as unknown as { pid: number; host: string }, { status: 'waiting' })
  try {
    const [row] = (await onAgents(ctx.projectId)) as { target?: string; remoteLabel?: string; otherHost?: boolean; host?: string }[]
    assert.deepEqual([row!.target, row!.remoteLabel, row!.otherHost, row!.host], [undefined, undefined, true, 'their-laptop'])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a project\'s list of runs and all projects\' together mark a run\'s row alike: work it left uncommitted shows in both', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: hostname() }, { status: 'done' })
  try {
    // Ended, its branch recorded on its card, a file it never committed left in its checkout.
    const card = join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.json`)
    await writeFile(card, JSON.stringify({ ...JSON.parse(await readFile(card, 'utf8')), branch: agentBranchName(ctx.agentId) }))
    await writeFile(join(worktreePath(ctx.dir, ctx.agentId), 'draft.md'), 'not committed\n')
    const marks = (rows: { id: string; uncommitted?: number; unpublished?: number }[]) => rows.filter(row => row.id === ctx.agentId).map(row => [row.uncommitted, row.unpublished])
    const own = marks(await onAgents(ctx.projectId))
    assert.equal(own.length, 1)
    assert.ok((own[0]![0] ?? 0) > 0, 'the uncommitted file is marked')
    assert.deepEqual(marks((await onRecentAgents()).filter(row => row.projectId === ctx.projectId).map(row => row.agent)), own)
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test("a saved machine's run is listed as the machine says it, and is never going while the machine does not answer", async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'laptop' }, { status: 'running' })
  const unrecorded = { id: '2026-07-19T12-00-00-000Z', startedAt: '2026-07-19T12:00:00.000Z', updatedAt: '2026-07-19T12:00:00.000Z', status: 'running' as const, host: 'laptop', person: 'me@laptop' }
  let answered = true
  provideTestContext({
    remote: {
      target: () => undefined,
      list: () => [],
      working: () => false,
      rekey: () => {},
      sent: () => true,
      home: async () => undefined,
      follow: async () => {},
      machineNames: async () => host => (host === 'laptop' ? { label: 'Laptop', url: 'http://127.0.0.1:4310' } : undefined),
      machineRuns: async () => [{ host: 'laptop', answered, runs: answered ? [unrecorded] : [], seenAt: '2026-07-19T12:30:00.000Z' }],
      followRuns: () => () => {},
    },
  })
  try {
    const rows = (all: { id: string; status: string; remoteLabel?: string; seenAt?: string; person?: string }[]) => all.map(row => [row.id, row.status, row.remoteLabel, row.seenAt, row.person])
    // Online: its run with no record here yet is listed, by its machine's name; the run whose
    // record says it goes, which the machine did not say, is unknown.
    assert.deepEqual(rows(await onAgents(ctx.projectId)), [
      [unrecorded.id, 'running', 'Laptop', undefined, 'me@laptop'],
      [ctx.agentId, 'unknown', 'Laptop', '2026-07-19T12:30:00.000Z', undefined],
    ])
    // Offline: nothing of it is going, in a project's list and in all projects' together.
    answered = false
    assert.deepEqual(rows(await onAgents(ctx.projectId)), [[ctx.agentId, 'unknown', 'Laptop', '2026-07-19T12:30:00.000Z', undefined]])
    assert.deepEqual(rows((await onRecentAgents()).filter(row => row.projectId === ctx.projectId).map(row => row.agent)), [[ctx.agentId, 'unknown', 'Laptop', '2026-07-19T12:30:00.000Z', undefined]])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a computer answers another one over the relay with its own runs only, each with whose it is', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: hostname() }, { status: 'running' })
  try {
    const first = (await dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['their-id-for-it', null])) as { at: string; runs: { id: string; person?: string }[]; ids: string[] }
    // Its own live run, by the project's git user, as its record will be kept.
    assert.deepEqual(first.runs.map(run => [run.id, run.person]), [[ctx.agentId, 't@t']])
    assert.deepEqual(first.ids, [ctx.agentId])
    // Asked again from that answer: nothing changed, nothing is sent.
    const again = (await dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['their-id-for-it', first.at])) as { runs: unknown[]; ids: string[] }
    assert.deepEqual(again.runs, [])
    assert.deepEqual(again.ids, [ctx.agentId])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('a computer holds the call of another one that waits for its runs, and answers it when a run changes how it stands', async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: hostname() }, { status: 'running' })
  const card = join(worktreePath(ctx.dir, ctx.agentId), OPENAGENT_DIR, `${ctx.agentId}.json`)
  const write = (status: string, more: Record<string, unknown> = {}): Promise<void> =>
    writeFile(card, JSON.stringify({ id: ctx.agentId, startedAt: '2026-07-19T10:00:00.000Z', status, caller: { pid: 0, host: hostname() }, ...more }))
  try {
    const first = (await dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['x', null, 5_000])) as { at: string }
    // Nothing a list shows changes while it waits: the run's step (its cost) goes with the answer at the end of the wait.
    const started = Date.now()
    const held = dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['x', first.at, 1_500]) as Promise<{ at: string; runs: { cost?: number }[] }>
    await new Promise(resolve => setTimeout(resolve, 300))
    await write('running', { cost: 0.5 })
    const quiet = await held
    assert.ok(Date.now() - started >= 1_400, 'it answered before the wait was up with nothing a list shows changed')
    assert.deepEqual(quiet.runs.map(run => run.cost), [0.5])
    // The run waits on the person: answered at once.
    const asked = Date.now()
    const waiting = dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['x', quiet.at, 10_000]) as Promise<{ runs: { status: string }[] }>
    await new Promise(resolve => setTimeout(resolve, 300))
    await write('waiting', { cost: 0.5 })
    assert.deepEqual((await waiting).runs.map(run => run.status), ['waiting'])
    assert.ok(Date.now() - asked < 3_000, 'it waited past the change')
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test("another computer's run is not answered as this one's", async () => {
  const ctx = await projectWithWorktreeAgent({ pid: 0, host: 'elsewhere' }, { status: 'running' })
  try {
    const said = (await dispatchRelayRpc(ctx.projectId, 'onOwnRuns', ['x', null])) as { runs: unknown[]; ids: string[] }
    assert.deepEqual([said.runs, said.ids], [[], []])
  } finally {
    ctx.restore()
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
