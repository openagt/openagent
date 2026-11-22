import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver } from '../fake.js'
import { findRun } from '../record-store.js'
import { accountsPath, addAccount } from '../accounts/accounts.js'
import { PROFILES, RunOrder, chainStore, settingsIn, type DistributionEntry, type RunContext, type AccountRotation, type Driver, type DriverTurn } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { markerCard, writeMarker } from './records.js'
import { runCommand } from './run.js'
import { ACCOUNT_ENV, GIT_ACCOUNT_ENV, detachResume, detachRun, driverFor, readyToRun, resumeArgs, resumeProject, runArgs } from './runner.js'
import { PLUGINS_WITHOUT_ENV, PROFILE_ENV, PROJECT_SKILLS_ENV } from '@openagt/agent-data'
import { handDownAgents, removeRepo, testRepo } from './test-repo.js'
import { fakeGithub, testAgent, testModules } from './run-test-support.js'
import { NAME_FILE_ENV, TITLE_SYSTEM } from './title.js'

// The detached start, with the spawn faked: the process asked for, the id answered. The marker is
// the run's process's to write: pushing it takes seconds, and the page waits on the id.

const NOW = new Date('2026-09-17T20:00:00.000Z')

test('run --detach spawns the run with its id, to write its own marker, and answers the id at once', async () => {
  const repo = await testRepo()
  try {
    const spawned: unknown[] = []
    const started = await detachRun(repo, { prompt: '/work-queue now', now: () => NOW }, { spawn: async (_repo, run) => { spawned.push(run) } })
    assert.deepEqual(started, { id: '2026-09-17T20-00-00-000Z' })
    assert.deepEqual(spawned, [{ id: started.id, prompt: '/work-queue now', mark: true }], 'no coding agent and no model named: the run is on the first of its distribution, on its own default model')
    assert.equal(await findRun(repo, started.id), undefined, 'nothing written before the id is answered')
    const modelled: unknown[] = []
    await detachRun(repo, { prompt: 'Read the docs', model: 'opus', now: () => new Date(NOW.getTime() + 1000) }, { spawn: async (_repo, run) => { modelled.push(run) } })
    assert.deepEqual(modelled, [{ id: '2026-09-17T20-00-01-000Z', prompt: 'Read the docs', model: 'opus', mark: true }])
    // Started from another branch: it reaches the spawned run.
    const based: unknown[] = []
    const onBranch = await detachRun(repo, { prompt: 'Do task one', base: 'agent-plan', now: () => new Date(NOW.getTime() + 2000) }, { spawn: async (_repo, run) => { based.push(run) } })
    assert.deepEqual(based, [{ id: onBranch.id, prompt: 'Do task one', mark: true, base: 'agent-plan' }])
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
    // The images a text goes with, each by its name in the image store: one flag apiece.
    const images = [`${'a'.repeat(64)}.png`, `${'b'.repeat(64)}.jpg`]
    assert.deepEqual(resumeArgs({ id: 'r1', text: 'and these?', images }), ['run', '--resume', 'r1', 'and these?', '--image', images[0], '--image', images[1]])
    assert.deepEqual(runArgs({ id: 'r1', prompt: 'what does it say?', images }), ['run', 'what does it say?', '--id', 'r1', '--image', images[0], '--image', images[1]])
  } finally {
    await removeRepo(repo)
  }
})

test('run --detach on Codex: the spawned run names Codex, no model unless one is given, and its follow-up', async () => {
  const repo = await testRepo()
  try {
    const spawned: unknown[] = []
    const started = await detachRun(repo, { prompt: '/work-queue', driver: 'codex', now: () => NOW }, { spawn: async (_repo, run) => { spawned.push(run) } })
    assert.deepEqual(started, { id: '2026-09-17T20-00-00-000Z' })
    assert.deepEqual(spawned, [{ id: started.id, prompt: '/work-queue', mark: true, driver: 'codex' }])
    const modelled: unknown[] = []
    await detachRun(repo, { prompt: '/work-queue', driver: 'codex', model: 'gpt-5', now: () => new Date(NOW.getTime() + 1000) }, { spawn: async (_repo, run) => { modelled.push(run) } })
    assert.deepEqual(modelled, [{ id: '2026-09-17T20-00-01-000Z', prompt: '/work-queue', driver: 'codex', model: 'gpt-5', mark: true }], 'a model given by hand is passed on')
    const levelled: unknown[] = []
    const withLevel = await detachRun(repo, { prompt: 'Fix the typo', publish: 'merge', now: () => new Date(NOW.getTime() + 3000) }, { spawn: async (_repo, run) => { levelled.push(run) } })
    assert.deepEqual(levelled, [{ id: withLevel.id, prompt: 'Fix the typo', mark: true, publish: 'merge' }], 'the publish level a person picked reaches the run')
    const handed: unknown[] = []
    const withText = await detachRun(repo, { prompt: '/answer-comments', attached: 'Found:\n[1]', now: () => new Date(NOW.getTime() + 4000) }, { spawn: async (_repo, run) => { handed.push(run) } })
    assert.deepEqual(handed, [{ id: withText.id, prompt: '/answer-comments', mark: true, attached: 'Found:\n[1]' }], 'a text attached to the prompt reaches the run')
  } finally {
    await removeRepo(repo)
  }
})

test("a run's driver is its coding agent's own, built with the run's id in its environment and this machine's setup parts as they are", () => {
  const personal = { memory: true, connectors: false, skills: false }
  const codex = testAgent('codex', { accounts: 'codex' })
  driverFor(codex, 'run-1', personal)
  assert.equal(codex.built[0]?.env['AGENT_ID'], 'run-1')
  assert.deepEqual(codex.built[0]?.personal, personal)
  assert.ok(codex.built[0]?.accounts, 'its turns go on its list of accounts')
  // A session that only names a run is for no run's agent.
  driverFor(codex, undefined, personal)
  assert.equal(codex.built[1]?.env['AGENT_ID'], undefined)
  // An agent with no list of accounts runs on its own login.
  const own = testAgent('own')
  driverFor(own, 'run-1', personal)
  assert.equal(own.built[0]?.accounts, undefined)
})

test("a run's agent gets none of the picks its process was started with: a dashboard it starts in its checkout runs on its own, and continues its runs", () => {
  const picks = { [ACCOUNT_ENV]: 'Dani', [GIT_ACCOUNT_ENV]: 'octo-agent', [PROFILE_ENV]: 'p1', [PLUGINS_WITHOUT_ENV]: 'discord', [PROJECT_SKILLS_ENV]: 'all', [NAME_FILE_ENV]: '/tmp/name.json' }
  const before = Object.fromEntries(Object.keys(picks).map(name => [name, process.env[name]]))
  Object.assign(process.env, picks)
  try {
    const codex = testAgent('codex', { accounts: 'codex' })
    driverFor(codex, 'run-1', { memory: true, connectors: true, skills: true })
    const env = codex.built[0]!.env
    assert.deepEqual(Object.keys(picks).filter(name => env[name] !== undefined), [])
    assert.equal(env['AGENT_ID'], 'run-1', 'the run its claims name')
    assert.equal(env['PATH'], process.env['PATH'], 'the rest of the environment as it is')
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('a run goes on its accounts, starting on the one whoever started it named, on Claude and on Codex alike', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runner-accounts-'))
  // The person's own login is there, in the environment: without one, a run takes the added accounts.
  const env = { XDG_CONFIG_HOME: dir, CLAUDE_CODE_OAUTH_TOKEN: 'own', CODEX_API_KEY: 'own' }
  for (const agent of ['claude', 'codex'] as const) {
    addAccount('Dani', 'x', accountsPath(agent, env))
    addAccount('Rom', 'y', accountsPath(agent, env))
  }
  /** The account a turn of the driver the agent was built last is run on, in this test's lists. */
  const takes = async (agent: ReturnType<typeof testAgent>): Promise<string> => {
    let on = ''
    const rotation: AccountRotation | undefined = agent.built.at(-1)?.accounts
    assert.ok(rotation)
    await rotation.turn(env, {
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
  const codex = testAgent('codex', { accounts: 'codex' })
  const claude = testAgent('claude-code', { accounts: 'claude' })
  const on = async (agent: ReturnType<typeof testAgent>): Promise<string> => {
    driverFor(agent, 'run-1', personal)
    return takes(agent)
  }
  const before = process.env[ACCOUNT_ENV]
  try {
    delete process.env[ACCOUNT_ENV]
    assert.equal(await on(codex), 'This computer')
    assert.equal(await on(claude), 'This computer')
    process.env[ACCOUNT_ENV] = ' Dani '
    assert.equal(await on(codex), 'Dani')
    assert.equal(await on(claude), 'Dani')
  } finally {
    if (before === undefined) delete process.env[ACCOUNT_ENV]
    else process.env[ACCOUNT_ENV] = before
    await rm(dir, { recursive: true, force: true })
  }
})

test('a resumed run continues on the tool its record names, and a Codex run with no model resumes with none', async () => {
  const repo = await testRepo()
  try {
    const startedWith: Array<{ model?: string; token?: string }> = []
    const codex = (turn: string): Driver => ({
      id: 'codex',
      namingModel: 'gpt-5.6-luna',
      start: opts => {
        // The session that names the run is its own, on the small model (`title.ts`): not one of
        // the run's own, so it is not counted here.
        if (opts.system !== TITLE_SYSTEM) startedWith.push({ ...(opts.model !== undefined ? { model: opts.model } : {}), ...(opts.env?.['GH_TOKEN'] !== undefined ? { token: opts.env['GH_TOKEN'] } : {}) })
        return new FakeDriver({ turns: [{ text: turn }], sessionId: 's-codex' }).start(opts)
      },
    })
    // The run is on a profile, kept with the person through the store: the record keeps its id, and the resume goes on with its accounts as this computer has them.
    const home = await mkdtemp(join(tmpdir(), 'runner-profile-'))
    const homeBefore = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = home
    try {
      const store = memoryStore()
      await settingsIn(chainStore([store])).set(PROFILES, [{ id: 'reviewer', name: 'Reviewer', options: { github: { account: 'octo-one' }, 'agent-driver': { claude: ['Dani', 'Nobody'] } } }])
      addAccount('Dani', 'x', accountsPath('claude'))
      // The computer's own account at GitHub is another one by the time the run resumes.
      const github = fakeGithub({ 'octo-computer': { GH_TOKEN: 'tok-computer' }, 'octo-one': { GH_TOKEN: 'tok-one' } })
      const modules: DistributionEntry[] = testModules({ github, store })
      const first = await runCommand(repo, { prompt: 'Read the docs', driver: codex('Read.'), host: 'this-box', pid: 4242, now: () => NOW, modules, gitAccount: 'octo-one', profile: 'reviewer', pluginsWithout: ['ask'], projectSkills: 'none' })
      assert.equal(first.status, 'done')
      assert.equal((await findRun(repo, first.id))?.caller?.['profile'], 'reviewer')
      assert.deepEqual((await findRun(repo, first.id))?.caller?.['pluginsWithout'], ['ask'], "the session's picks are on the record")
      assert.equal((await findRun(repo, first.id))?.caller?.['projectSkills'], 'none')
      const asked: string[] = []
      const second = await resumeProject(repo, { id: first.id, text: 'And the tests?' }, { driverFor: (agent, _id, setup, only) => { asked.push(`${agent.id} ${JSON.stringify(setup)} ${JSON.stringify(only)}`); return codex('Read too.') }, modules })
      assert.equal(second.status, 'done')
      assert.deepEqual(asked, ['codex {"memory":true,"connectors":true,"skills":true} undefined'], "no config on this machine: the run loads the person's setup, on every Codex account this computer has: the profile names only Claude accounts")
      assert.deepEqual(github.workedAs, ['octo-one', 'octo-one'], 'the resume goes on as the account the record names, not whatever the computer\'s pick is by then')
      assert.equal((await findRun(repo, first.id))?.caller?.['gitAccount'], 'octo-one')
      assert.equal((await findRun(repo, first.id))?.caller?.['profile'], 'reviewer', 'the profile stays on the record')
      assert.deepEqual((await findRun(repo, first.id))?.caller?.['pluginsWithout'], ['ask'], 'and so do the picks')
      assert.equal((await findRun(repo, first.id))?.caller?.['projectSkills'], 'none')
    } finally {
      if (homeBefore === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = homeBefore
      await rm(home, { recursive: true, force: true })
    }
    assert.deepEqual(startedWith, [{ token: 'tok-one' }, { token: 'tok-one' }], 'no model named at the start nor at the resume: Codex runs on its own default')
  } finally {
    await removeRepo(repo)
  }
})

test("a run goes without the plugins its profile leaves out, where the session picked none; the session's pick goes over them, none of them too", async () => {
  const repo = await testRepo()
  try {
    const store = memoryStore()
    await settingsIn(chainStore([store])).set(PROFILES, [{ id: 'quiet', name: 'Quiet', options: { plugins: { without: ['logs'] } } }])
    const seen: { without: readonly string[] | undefined; skills: string[] }[] = []
    const looking = { name: 'looking', hooks: { 'run.step': [{ order: RunOrder.CONTEXT, name: 'look', run: (ctx: RunContext) => void seen.push({ without: ctx.options.plugins?.without, skills: ctx.skills.map(skill => skill.name) }) }] } }
    const modules = testModules({ store, also: [looking] })
    const codex = (): Driver => ({ id: 'codex', namingModel: 'gpt-5.6-luna', start: opts => new FakeDriver({ turns: [{ text: 'Read.' }], sessionId: 's-codex' }).start(opts) })
    // Started as `runProject` starts it, on the profile's options as the store keeps them.
    const run = (at: number, picks: { pluginsWithout?: string[] }) =>
      runCommand(repo, { prompt: 'Read the docs', driver: codex(), host: 'this-box', pid: 4242, now: () => new Date(NOW.getTime() + at), modules, profile: 'quiet', profileOptions: { plugins: { without: ['logs'] } }, ...picks })
    const onProfile = await run(0, {})
    const none = await run(1000, { pluginsWithout: [] })
    const ask = await run(2000, { pluginsWithout: ['ask'] })
    // A resume reads the profile its record names through the store.
    await resumeProject(repo, { id: onProfile.id, text: 'And the tests?' }, { driverFor: codex, modules })
    assert.deepEqual(
      seen.map(({ without, skills }) => ({ without, logs: skills.includes('logs'), ask: skills.includes('ask') })),
      [
        { without: ['logs'], logs: false, ask: true },
        { without: [], logs: true, ask: true },
        { without: ['ask'], logs: true, ask: false },
        { without: ['logs'], logs: false, ask: true },
      ],
    )
    assert.equal((await findRun(repo, onProfile.id))?.caller?.['pluginsWithout'], undefined, "the profile's, not the session's: its record names no pick")
    assert.deepEqual((await findRun(repo, none.id))?.caller?.['pluginsWithout'], [], 'the pick of none is on the record')
    assert.deepEqual((await findRun(repo, ask.id))?.caller?.['pluginsWithout'], ['ask'])
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
  assert.deepEqual(runArgs({ id: 'r1', prompt: 'Do task one', base: 'agent-p1' }), ['run', 'Do task one', '--id', 'r1', '--base', 'agent-p1'])
  assert.deepEqual(runArgs({ id: 'r1', prompt: '/reply', branch: 'dark-mode', for: 'https://github.com/o/r/pull/6' }), ['run', '/reply', '--id', 'r1', '--branch', 'dark-mode', '--for', 'https://github.com/o/r/pull/6'])
})

test("ready to run: what the run's coding agent says, asked with this machine's setup parts and whether an account was added to its own list", async () => {
  const repo = await testRepo()
  const config = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = join(repo, 'config')
  const gitHostEnv = async () => ({ ok: true as const, env: {} })
  try {
    const loggedOut = { problems: ['`claude` is logged out: run `claude auth login`'], warnings: [] }
    const claude = testAgent('claude-code', { accounts: 'claude', ready: asked => (asked.addedAccount ? { problems: [], warnings: [], ownLoggedOut: true } : loggedOut) })
    const codex = testAgent('codex', { accounts: 'codex' })
    assert.deepEqual(await readyToRun(repo, 'claude-code', { agent: claude, gitHostEnv }), loggedOut)
    addAccount('Dani', 'sk-ant-oat01-dani', accountsPath('claude'))
    assert.deepEqual(await readyToRun(repo, 'claude-code', { agent: claude, gitHostEnv }), { problems: [], warnings: [], ownLoggedOut: true })
    await readyToRun(repo, 'codex', { agent: codex, gitHostEnv })
    assert.deepEqual(claude.asked.map(asked => asked.addedAccount), [false, true])
    assert.deepEqual(codex.asked.map(asked => asked.addedAccount), [false], "each agent's own list: a Claude account is none of Codex's")
    assert.deepEqual(claude.asked[0]?.personal, { memory: true, connectors: true, skills: true }, "no config on this machine: the person's own setup")
    await mkdir(join(repo, '.agent-runner'), { recursive: true })
    await writeFile(join(repo, '.agent-runner', 'config.yml'), 'personal:\n  skills: off\n')
    await readyToRun(repo, 'codex', { agent: codex, gitHostEnv })
    assert.equal(codex.asked[1]?.personal.skills, false, "this machine's config turns a part off")
  } finally {
    if (config === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = config
    await removeRepo(repo)
  }
})

test('ready to run on a coding agent the distribution does not have is refused, naming the ones it has', async () => {
  const repo = await testRepo()
  const handBack = await handDownAgents(repo)
  try {
    await assert.rejects(readyToRun(repo, 'cursor'), /No coding agent is named cursor: the coding agents are claude-code and codex\./)
  } finally {
    handBack()
    await removeRepo(repo)
  }
})

test('ready to run: the computer\u2019s account at the git host, or the one picked for the session; no account, or one the git host cannot give, stops the run before it starts', async () => {
  const repo = await testRepo()
  try {
    const agent = testAgent('claude-code', { accounts: 'claude' })
    const asked: (string | undefined)[] = []
    const gitHostEnv = async (_repo: string, user?: string) => {
      asked.push(user)
      return user === 'stranger' ? { ok: false as const, error: 'gh knows no account stranger' } : { ok: true as const, env: { GH_TOKEN: `tok-${user ?? 'computer'}` }, login: user ?? 'computer-login' }
    }
    assert.deepEqual(await readyToRun(repo, 'claude-code', { agent, gitHostEnv }), { problems: [], warnings: [] })
    assert.deepEqual(asked, [undefined], 'no account named: the computer\u2019s is asked for')
    // OpenAgent has no account there: refused, in the git host's words, never the person's own login.
    const none = async () => ({ ok: false as const, error: "OpenAgent has no GitHub account: add one in OpenAgent's Permissions" })
    assert.deepEqual((await readyToRun(repo, 'claude-code', { agent, gitHostEnv: none })).problems, ["OpenAgent has no GitHub account: add one in OpenAgent's Permissions"])

    // The account picked for this session: asked for by its login.
    assert.deepEqual(await readyToRun(repo, 'claude-code', { agent, gitHostEnv, login: 'octo-agent' }), { problems: [], warnings: [] })
    assert.deepEqual(asked, [undefined, 'octo-agent'])

    // One this computer cannot use stops the run, naming it.
    const out = await readyToRun(repo, 'claude-code', { agent, gitHostEnv, login: 'stranger' })
    assert.match(out.problems[0]!, /works as @stranger at the git host.*gh knows no account stranger/)
  } finally {
    await removeRepo(repo)
  }
})
