import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRun } from '@openagt/skill-logs'
import { FakeDriver, type AccountRotation, type Driver, type DriverTurn } from '@openagt/agent-driver'
import { ClaudeCodeDriver } from '@openagt/agent-driver-claude'
import { CodexDriver } from '@openagt/agent-driver-codex'
import { accountsPath, addAccount } from '@openagt/skill-account-rotation'
import { writeAgent } from '@openagt/agent-data'
import { markerCard, writeMarker } from './records.js'
import { runCommand } from './run.js'
import { ACCOUNT_ENV, detachResume, detachRun, driverFor, readyToRun, resumeArgs, resumeProject, runArgs, workAs } from './runner.js'
import { removeRepo, testRepo } from './test-repo.js'
import { noGitHost } from './run-test-support.js'
import { TITLE_SYSTEM } from './title.js'

// The detached start, with the spawn faked: the process asked for, the id answered. The marker is
// the run's process's to write: pushing it takes seconds, and the page waits on the id.

const NOW = new Date('2026-09-17T20:00:00.000Z')

test('run --detach spawns the run with its id, to write its own marker, and answers the id at once', async () => {
  const repo = await testRepo()
  try {
    const spawned: unknown[] = []
    const started = await detachRun(repo, { prompt: '/work-queue now', now: () => NOW }, { spawn: async (_repo, run) => { spawned.push(run) } })
    assert.deepEqual(started, { id: '2026-09-17T20-00-00-000Z', driver: 'claude-code' }, 'no model given: the coding agent starts on its own default')
    assert.deepEqual(spawned, [{ id: started.id, prompt: '/work-queue now', mark: true, driver: 'claude-code' }])
    assert.equal(await findRun(repo, started.id), undefined, 'nothing written before the id is answered')
    const named = await detachRun(repo, { prompt: 'Read the docs', model: 'opus', now: () => new Date(NOW.getTime() + 1000) }, { spawn: async () => {} })
    assert.equal(named.model, 'opus')
    // Started for another run, from that run's branch: both reach the spawned run.
    const children: unknown[] = []
    const child = await detachRun(repo, { prompt: 'Do task one', parent: started.id, base: 'agent-plan', now: () => new Date(NOW.getTime() + 2000) }, { spawn: async (_repo, run) => { children.push(run) } })
    assert.deepEqual(children, [{ id: child.id, prompt: 'Do task one', mark: true, driver: 'claude-code', parent: started.id, base: 'agent-plan' }])
  } finally {
    await removeRepo(repo)
  }
})

test('run --detach --resume spawns the resume of a recorded run and answers its id at once; an unknown run is refused', async () => {
  const repo = await testRepo()
  try {
    const id = '2026-09-17T20-00-00-000Z'
    await writeMarker(repo, markerCard({ id, startedAt: NOW.toISOString(), prompt: '/work-queue', driver: 'claude-code', mark: { host: 'this-box' } }))
    const spawned: unknown[] = []
    const spawn = async (_repo: string, run: unknown): Promise<void> => { spawned.push(run) }
    assert.deepEqual(await detachResume(repo, { id, answer: 'Yes' }, { spawn }), { id })
    assert.deepEqual(spawned, [{ id, answer: 'Yes' }])
    await assert.rejects(detachResume(repo, { id: 'no-such-run', text: 'go on' }, { spawn }), /no run no-such-run in this project/)
    assert.equal(spawned.length, 1)
    assert.deepEqual(resumeArgs({ id: 'r1', text: 'go on' }), ['run', '--resume', 'r1', 'go on'])
    assert.deepEqual(resumeArgs({ id: 'r1', answer: 'Yes', model: 'opus' }), ['run', '--resume', 'r1', '--answer', 'Yes', '--model', 'opus'])
    assert.deepEqual(resumeArgs({ id: 'r1', text: 'ship it', publish: 'pr' }), ['run', '--resume', 'r1', 'ship it', '--publish', 'pr'])
    assert.deepEqual(resumeArgs({ id: 'r1', text: 'keep it', publish: 'nothing' }), ['run', '--resume', 'r1', 'keep it', '--publish', 'nothing'])
    assert.deepEqual(resumeArgs({ id: 'r1', text: '/reply', by: 'reply' }), ['run', '--resume', 'r1', '/reply', '--by', 'reply'])
  } finally {
    await removeRepo(repo)
  }
})

test('run --detach on Codex: the spawned run names Codex, no model unless one is given, and its follow-up', async () => {
  const repo = await testRepo()
  try {
    const spawned: unknown[] = []
    const started = await detachRun(repo, { prompt: '/work-queue', driver: 'codex', now: () => NOW }, { spawn: async (_repo, run) => { spawned.push(run) } })
    assert.deepEqual(started, { id: '2026-09-17T20-00-00-000Z', driver: 'codex' })
    assert.deepEqual(spawned, [{ id: started.id, prompt: '/work-queue', mark: true, driver: 'codex' }])
    const named = await detachRun(repo, { prompt: '/work-queue', driver: 'codex', model: 'gpt-5', now: () => new Date(NOW.getTime() + 1000) }, { spawn: async () => {} })
    assert.equal(named.model, 'gpt-5', 'a model given by hand is passed on')
    const levelled: unknown[] = []
    const withLevel = await detachRun(repo, { prompt: 'Fix the typo', publish: 'merge', now: () => new Date(NOW.getTime() + 3000) }, { spawn: async (_repo, run) => { levelled.push(run) } })
    assert.deepEqual(levelled, [{ id: withLevel.id, prompt: 'Fix the typo', mark: true, driver: 'claude-code', publish: 'merge' }], 'the publish level a person picked reaches the run')
    const handed: unknown[] = []
    const withText = await detachRun(repo, { prompt: '/answer-comments', attached: 'Found:\n[1]', now: () => new Date(NOW.getTime() + 4000) }, { spawn: async (_repo, run) => { handed.push(run) } })
    assert.deepEqual(handed, [{ id: withText.id, prompt: '/answer-comments', mark: true, driver: 'claude-code', attached: 'Found:\n[1]' }], 'a text attached to the prompt reaches the run')
  } finally {
    await removeRepo(repo)
  }
})

test('a run\'s coding agent is unrestricted, has the run\'s id, and gets this machine\'s setup parts as they are', () => {
  const personal = { memory: true, connectors: false, skills: false }
  const optsOf = (driver: Driver) => (driver as unknown as { opts: { sandbox?: string; permissionMode?: string; env?: NodeJS.ProcessEnv; personal?: unknown } }).opts
  const codex = driverFor('codex', 'run-1', personal)
  assert.ok(codex instanceof CodexDriver)
  assert.equal(optsOf(codex).sandbox, 'danger-full-access')
  assert.equal(optsOf(codex).env?.['AGENT_ID'], 'run-1')
  assert.deepEqual(optsOf(codex).personal, personal)
  const claude = driverFor('claude-code', 'run-1', personal)
  assert.ok(claude instanceof ClaudeCodeDriver)
  assert.equal(optsOf(claude).permissionMode, 'bypassPermissions')
  assert.equal(optsOf(claude).env?.['AGENT_ID'], 'run-1')
  assert.deepEqual(optsOf(claude).personal, personal)
})

test('a run goes on its agent\'s accounts, starting on the one whoever started it named, on Claude and on Codex alike', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runner-accounts-'))
  // The person's own login is there, in the environment: without one, a run takes the added accounts.
  const env = { XDG_CONFIG_HOME: dir, CLAUDE_CODE_OAUTH_TOKEN: 'own', CODEX_API_KEY: 'own' }
  for (const agent of ['claude', 'codex'] as const) {
    addAccount('Dani', 'x', accountsPath(agent, env))
    addAccount('Rom', 'y', accountsPath(agent, env))
  }
  /** The account a turn of the driver's sessions is run on, in this test's lists. */
  const takes = async (driver: Driver): Promise<string> => {
    let on = ''
    await (driver as unknown as { opts: { accounts: AccountRotation } }).opts.accounts.turn(env, {
      current: {},
      text: 'go',
      opts: {},
      emit: () => {},
      stopped: () => false,
      continueFrom: () => {},
      run: async account => {
        on = account.name
        return { turn: { text: '', sessionId: 's' } as DriverTurn, limited: false }
      },
    })
    return on
  }
  const personal = { memory: true, connectors: true, skills: true }
  const before = process.env[ACCOUNT_ENV]
  try {
    delete process.env[ACCOUNT_ENV]
    assert.equal(await takes(driverFor('codex', 'run-1', personal)), 'This computer')
    assert.equal(await takes(driverFor('claude-code', 'run-1', personal)), 'This computer')
    process.env[ACCOUNT_ENV] = ' Dani '
    assert.equal(await takes(driverFor('codex', 'run-1', personal)), 'Dani')
    assert.equal(await takes(driverFor('claude-code', 'run-1', personal)), 'Dani')
  } finally {
    if (before === undefined) delete process.env[ACCOUNT_ENV]
    else process.env[ACCOUNT_ENV] = before
    await rm(dir, { recursive: true, force: true })
  }
})

test('a resumed run continues on the tool its record names, and a Codex run with no model resumes with none', async () => {
  const repo = await testRepo()
  try {
    const startedWith: Array<{ model?: string }> = []
    const codex = (turn: string): Driver => ({
      id: 'codex',
      start: opts => {
        // The session that names the run is its own, on the small model (`title.ts`): not one of
        // the run's own, so it is not counted here.
        if (opts.system !== TITLE_SYSTEM) startedWith.push({ ...(opts.model !== undefined ? { model: opts.model } : {}) })
        return new FakeDriver({ turns: [{ text: turn }], sessionId: 's-codex' }).start(opts)
      },
    })
    // The run is on an agent: the record keeps it, and the resume goes on with its accounts as this computer has them.
    const home = await mkdtemp(join(tmpdir(), 'runner-agent-'))
    const homeBefore = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = home
    try {
      await writeAgent({ id: 'reviewer', name: 'Reviewer', skills: ['ask'], accounts: { github: 'octo-one', claude: ['Dani', 'Nobody'] }, projectSkills: true })
      addAccount('Dani', 'x', accountsPath('claude'))
      const first = await runCommand(repo, { prompt: 'Read the docs', driver: codex('Read.'), host: 'this-box', pid: 4242, now: () => NOW, gitHost: noGitHost, gitAccount: 'octo-one', agent: 'reviewer', skillsOff: ['ask'], projectSkills: 'none' })
      assert.equal(first.status, 'done')
      assert.equal((await findRun(repo, first.id))?.caller?.['agent'], 'reviewer')
      assert.deepEqual((await findRun(repo, first.id))?.caller?.['skillsOff'], ['ask'], 'the session\'s picks of skills are on the record')
      assert.equal((await findRun(repo, first.id))?.caller?.['projectSkills'], 'none')
      const asked: string[] = []
      const workedAs: (string | undefined)[] = []
      const second = await resumeProject(repo, { id: first.id, text: 'And the tests?' }, { driverFor: (name, _id, setup, as) => { asked.push(`${name} ${JSON.stringify(setup)} ${JSON.stringify(as)}`); return codex('Read too.') }, workAs: async (_repo, login) => (workedAs.push(login), login) })
      assert.equal(second.status, 'done')
      assert.deepEqual(asked, ['codex {"memory":true,"connectors":true,"skills":true} {"claude":["Dani"]}'], 'no config on this machine: the run loads the person\'s setup, on the agent\'s accounts this computer has')
      assert.deepEqual(workedAs, ['octo-one'], 'the resume goes on as the account the record names, not whatever the computer\'s pick is by then')
      assert.equal((await findRun(repo, first.id))?.caller?.['gitAccount'], 'octo-one')
      assert.equal((await findRun(repo, first.id))?.caller?.['agent'], 'reviewer', 'the agent stays on the record')
      assert.deepEqual((await findRun(repo, first.id))?.caller?.['skillsOff'], ['ask'], 'and so do the picks')
      assert.equal((await findRun(repo, first.id))?.caller?.['projectSkills'], 'none')
    } finally {
      if (homeBefore === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = homeBefore
      await rm(home, { recursive: true, force: true })
    }
    assert.deepEqual(startedWith, [{}, {}], 'no model named at the start nor at the resume: Codex runs on its own default')
  } finally {
    await removeRepo(repo)
  }
})

test('a spawned run is told its tool, and its model only when it has one', () => {
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', model: 'opus' }), ['run', '/work-queue', '--id', 'r1', '--model', 'opus'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', driver: 'codex' }), ['run', '/work-queue', '--id', 'r1', '--driver', 'codex'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', prBase: 'login-page' }), ['run', '/work-queue', '--id', 'r1', '--pr-base', 'login-page'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', publish: 'merge' }), ['run', '/work-queue', '--id', 'r1', '--publish', 'merge'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', mark: true }), ['run', '/work-queue', '--id', 'r1', '--mark'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', startedAt: '2026-10-09T10:00:00.000Z' }), ['run', '/work-queue', '--id', 'r1', '--started', '2026-10-09T10:00:00.000Z'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', publish: 'commit', attached: 'Found:\n["one entry"]' }), ['run', '/work-queue', '--id', 'r1', '--publish', 'commit', '--attach=Found:\n["one entry"]'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/work-queue', attached: '- one entry' }), ['run', '/work-queue', '--id', 'r1', '--attach=- one entry'], 'a text that opens with a dash stays the flag\'s own text')
  assert.deepEqual(runArgs({ id: 'r1', prompt: 'Do task one', parent: 'p1', base: 'agent-p1' }), ['run', 'Do task one', '--id', 'r1', '--parent', 'p1', '--base', 'agent-p1'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/reply', branch: 'dark-mode', for: 'https://github.com/o/r/pull/6' }), ['run', '/reply', '--id', 'r1', '--branch', 'dark-mode', '--for', 'https://github.com/o/r/pull/6'])
})

test('ready to run: the coding agent\'s problems stop a run; nothing else is probed, the git host only for a project that names its own account there', async () => {
  const notRoot = () => false
  const probed: string[] = []
  const answers = (loggedIn: boolean) => async (bin: string, args: readonly string[]) => {
    probed.push(bin)
    return { ok: true, output: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn }) }
  }
  const repo = await testRepo()
  try {
    assert.deepEqual(await readyToRun(repo, 'claude-code', { probe: answers(true), isRoot: notRoot }), { problems: [], warnings: [] })
    assert.deepEqual(await readyToRun(repo, 'codex', { probe: answers(true), isRoot: notRoot, agentsSkills: join(repo, 'no-such-dir') }), { problems: [], warnings: [] })
    assert.ok(probed.every(bin => bin === 'claude' || bin === 'codex'), `only the coding agent's CLI is asked, not ${probed.join(', ')}`)

    // Whether the person added an account is read off their files: here, none of the real ones.
    const config = process.env['XDG_CONFIG_HOME']
    process.env['XDG_CONFIG_HOME'] = join(repo, 'config')
    try {
      const out = await readyToRun(repo, 'claude-code', { probe: answers(false), isRoot: notRoot })
      assert.match(out.problems[0]!, /claude auth login/)
      addAccount('Dani', 'sk-ant-oat01-dani', accountsPath('claude'))
      assert.deepEqual(await readyToRun(repo, 'claude-code', { probe: answers(false), isRoot: notRoot }), { problems: [], warnings: [], ownLoggedOut: true })
    } finally {
      if (config === undefined) delete process.env['XDG_CONFIG_HOME']
      else process.env['XDG_CONFIG_HOME'] = config
    }
  } finally {
    await removeRepo(repo)
  }
})

test('ready to run with the CLI logged out: an account added beside it is a login runs use, on each agent\'s own list', async () => {
  const repo = await testRepo()
  const dir = await mkdtemp(join(tmpdir(), 'runner-added-'))
  const before = process.env['XDG_CONFIG_HOME']
  const probe = async (_bin: string, args: readonly string[]) => ({ ok: true, output: args[0] === '--version' ? '1.0.0' : JSON.stringify({ loggedIn: false }) })
  const codexProbe = async (_bin: string, args: readonly string[]) => ({ ok: args[0] === '--version', output: args[0] === '--version' ? '1.0.0' : 'Not logged in' })
  const deps = { isRoot: () => false, agentsSkills: join(repo, 'no-such-dir') }
  try {
    process.env['XDG_CONFIG_HOME'] = dir
    assert.equal((await readyToRun(repo, 'claude-code', { ...deps, probe })).problems.length, 1)
    assert.equal((await readyToRun(repo, 'codex', { ...deps, probe: codexProbe })).problems.length, 1)
    addAccount('Dani', 'x', accountsPath('claude'))
    assert.deepEqual((await readyToRun(repo, 'claude-code', { ...deps, probe })).problems, [])
    assert.equal((await readyToRun(repo, 'codex', { ...deps, probe: codexProbe })).problems.length, 1)
    addAccount('Dani', 'codex-dani', accountsPath('codex'))
    assert.deepEqual((await readyToRun(repo, 'codex', { ...deps, probe: codexProbe })).problems, [])
  } finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    await rm(dir, { recursive: true, force: true })
    await removeRepo(repo)
  }
})

test('ready to run on Codex: skills in ~/.agents/skills are no warning while runs load the person\'s skills, and a warning once this machine turns them off', async () => {
  const repo = await testRepo()
  try {
    const agentsSkills = join(repo, 'agents-skills')
    await mkdir(join(agentsSkills, 'my-skill'), { recursive: true })
    const deps = { probe: async (_bin: string, args: readonly string[]) => ({ ok: true, output: args[0] === '--version' ? '0.144.4' : 'Logged in' }), isRoot: () => false, agentsSkills }
    assert.deepEqual(await readyToRun(repo, 'codex', deps), { problems: [], warnings: [] })
    await mkdir(join(repo, '.agent-runner'), { recursive: true })
    await writeFile(join(repo, '.agent-runner', 'config.yml'), 'personal:\n  skills: off\n')
    const out = await readyToRun(repo, 'codex', deps)
    assert.deepEqual(out.problems, [])
    assert.match(out.warnings[0]!, /no switch/)
  } finally {
    await removeRepo(repo)
  }
})

test('ready to run, and the run: the computer\u2019s account at the git host, or the one picked for the session; no account, or one the git host cannot give, stops the run before it starts', async () => {
  const repo = await testRepo()
  try {
    const probe = async (_bin: string, args: readonly string[]) => ({ ok: true, output: args[0] === '--version' ? '2.1.0' : JSON.stringify({ loggedIn: true }) })
    const asked: (string | undefined)[] = []
    const gitHostEnv = async (_repo: string, user?: string) => {
      asked.push(user)
      return user === 'stranger' ? { ok: false as const, error: 'gh knows no account stranger' } : { ok: true as const, env: { GH_TOKEN: `tok-${user ?? 'computer'}` }, login: user ?? 'computer-login' }
    }
    assert.deepEqual(await readyToRun(repo, 'claude-code', { probe, isRoot: () => false, gitHostEnv }), { problems: [], warnings: [] })
    assert.deepEqual(asked, [undefined], 'no account named: the computer\u2019s is asked for')
    // No account named: the computer's.
    const env: NodeJS.ProcessEnv = {}
    assert.equal(await workAs(repo, undefined, { gitHostEnv, env }), 'computer-login')
    assert.equal(env['GH_TOKEN'], 'tok-computer')
    // OpenAgent has no account there: refused, in the git host's words, never the person's own login.
    const none = async () => ({ ok: false as const, error: "OpenAgent has no GitHub account: add one in OpenAgent's Permissions" })
    assert.deepEqual((await readyToRun(repo, 'claude-code', { probe, isRoot: () => false, gitHostEnv: none })).problems, ["OpenAgent has no GitHub account: add one in OpenAgent's Permissions"])
    await assert.rejects(workAs(repo, undefined, { gitHostEnv: none, env: {} }), /no GitHub account/)

    // The account picked for this session: asked for by its login, and the run goes as it.
    assert.deepEqual(await readyToRun(repo, 'claude-code', { probe, isRoot: () => false, gitHostEnv, login: 'octo-agent' }), { problems: [], warnings: [] })
    assert.equal(await workAs(repo, 'octo-agent', { gitHostEnv, env }), 'octo-agent')
    assert.equal(env['GH_TOKEN'], 'tok-octo-agent')

    // One this computer cannot use stops the run, naming it.
    const out = await readyToRun(repo, 'claude-code', { probe, isRoot: () => false, gitHostEnv, login: 'stranger' })
    assert.match(out.problems[0]!, /works as @stranger at the git host.*gh knows no account stranger/)
    await assert.rejects(workAs(repo, 'stranger', { gitHostEnv, env: {} }), /works as @stranger/)
  } finally {
    await removeRepo(repo)
  }
})
