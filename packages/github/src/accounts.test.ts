import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { GhRunner } from './gh.js'
import { accountLogins, ghState, isAccountDir, loginUnderWay, runEnv, runsAccount, settleAdded, startLogin, stopLogin, useForRuns } from './accounts.js'
import { jobState, startJob } from './job.js'
import { gitDirsOf } from './module.js'
import { sessionFolder, sessionsHome } from '@openagt/agent-data'
import { runCli, type CliDeps } from './cli.js'

// OpenAgent's own GitHub accounts, one gh folder each, and the one runs use: the person's own gh,
// git and keychain are never read or changed. A run gets its account's folder, token and name.

/**
 * gh as scripted: it works as the account whose folder it is given (GH_CONFIG_DIR), or as the
 * token it is given; each account's token is `tok-<login>`, and GitHub says a token is that
 * account's unless `whose` says another. `revoked` accounts GitHub no longer takes.
 */
const ghWith =
  (asked: { args: string[]; env?: Record<string, string>; input?: string }[] = [], opts: { whose?: Record<string, string>; revoked?: string[] } = {}): GhRunner =>
  async (args, _cwd, env, input) => {
    asked.push({ args, ...(env ? { env } : {}), ...(input !== undefined ? { input } : {}) })
    const folder = env?.['GH_CONFIG_DIR'] ? basename(env['GH_CONFIG_DIR']) : ''
    if (args[0] === '--version') return 'gh version 2.93.0\n'
    if (args[0] === 'auth' && args[1] === 'status') return opts.revoked?.includes(folder) ? Promise.reject(new Error('token is invalid')) : ''
    if (args[0] === 'auth' && args[1] === 'token') return `tok-${folder}\n`
    if (args[0] === 'auth' && args[1] === 'login') {
      writeFileSync(join(env!['GH_CONFIG_DIR']!, 'hosts.yml'), 'github.com: {}\n')
      return ''
    }
    if (args[0] === 'api' && args.includes('user')) {
      const token = env?.['GH_TOKEN'] || ''
      const login = token ? token.slice('tok-'.length) : folder
      const who = opts.whose?.[login] ?? login
      if (args.some(arg => arg.includes('avatar'))) return JSON.stringify({ login: who, name: 'Octo Cat', avatar: null })
      return args.includes('.login') ? `${who}\n` : `${who}\t42\tOcto Cat\n`
    }
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }

const withDir = (go: (dir: string) => Promise<void> | void) => async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-accounts-'))
  try {
    await go(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** An account OpenAgent has: its folder, with gh's file in it. */
function account(root: string, login: string, facts?: { id: number; name?: string }): string {
  const dir = join(root, login)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'hosts.yml'), 'github.com: {}\n')
  if (facts) writeFileSync(join(dir, 'account.json'), JSON.stringify({ login, ...facts }))
  return dir
}

async function run(argv: string[], deps: CliDeps): Promise<{ code: number; out: Record<string, unknown>; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { cwd: '/r', stdout: line => out.push(line), stderr: line => err.push(line) }, deps)
  return { code, out: (out.length ? JSON.parse(out.join('\n')) : {}) as Record<string, unknown>, err: err.join('\n') }
}

test(
  'ghState: no gh is not installed; OpenAgent\u2019s accounts are its own folders, each asked of GitHub as itself',
  withDir(async root => {
    assert.deepEqual(await ghState(root, '/r', async () => Promise.reject(new Error('spawn gh ENOENT'))), { installed: false })
    assert.deepEqual(await ghState(root, '/r', ghWith()), { installed: true, accounts: [] })
    account(root, 'octo-agent')
    account(root, 'octo')
    mkdirSync(join(root, '.adding'))
    mkdirSync(join(root, 'empty'))
    const asked: { args: string[]; env?: Record<string, string> }[] = []
    assert.deepEqual(await ghState(root, '/r', ghWith(asked, { revoked: ['octo-agent'] })), {
      installed: true,
      accounts: [
        { login: 'octo', ok: true },
        { login: 'octo-agent', ok: false },
      ],
    })
    // Each is asked with its own folder, and no token from the environment.
    const status = asked.filter(a => a.args[1] === 'status')
    assert.deepEqual(
      status.map(a => [a.env?.['GH_CONFIG_DIR'], a.env?.['GH_TOKEN']]),
      [
        [join(root, 'octo'), ''],
        [join(root, 'octo-agent'), ''],
      ],
    )
    assert.deepEqual(accountLogins(root), ['octo', 'octo-agent'])
    assert.ok(isAccountDir(root, join(root, 'octo')))
    assert.ok(!isAccountDir(root, root) && !isAccountDir(root, join(root, '..', 'gh')) && !isAccountDir(root, '/home/me/.config/gh'))
  }),
)

test(
  'runsAccount: the first is picked and kept; a pick is changed only here; one OpenAgent forgot falls back',
  withDir(dir => {
    const path = join(dir, 'picks.json')
    const accounts = [
      { login: 'octo', ok: true },
      { login: 'octo-agent', ok: true },
    ]
    assert.equal(runsAccount(accounts, path), 'octo')
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { runs: { 'github.com': 'octo' } })
    useForRuns('octo-agent', accounts, path)
    assert.equal(runsAccount(accounts, path), 'octo-agent')
    assert.throws(() => useForRuns('stranger', accounts, path), /has no GitHub account stranger/)
    assert.equal(runsAccount([accounts[0]!], path), 'octo')
    assert.equal(runsAccount([], join(dir, 'none.json')), undefined)
  }),
)

test('runEnv: the account\u2019s folder for gh; git asks the token of the helper set here alone, ssh addresses go over https, settings already given are kept', () => {
  const env = runEnv('tok', '/cfg/openagent-github/octo', { login: 'octo', id: 42, name: 'Octo Cat' }, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.x', GIT_CONFIG_VALUE_0: 'y' })
  assert.equal(env['GH_TOKEN'], 'tok')
  assert.equal(env['GH_CONFIG_DIR'], '/cfg/openagent-github/octo')
  assert.equal(env['GIT_CONFIG_COUNT'], '5')
  assert.equal(env['GIT_CONFIG_KEY_0'], undefined, 'the one given stays as it was')
  assert.equal(env['GIT_CONFIG_KEY_1'], 'credential.https://github.com.helper')
  assert.equal(env['GIT_CONFIG_VALUE_1'], '')
  // The real git: whatever helper the person's own config has, this one answers.
  const said = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    env: { ...process.env, ...runEnv('tok-123', '/d', undefined), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    encoding: 'utf8',
  })
  assert.match(said, /^password=tok-123$/m)
  const url = execFileSync('git', ['ls-remote', '--get-url', 'git@github.com:o/r.git'], { env: { ...process.env, ...runEnv('t', '/d', undefined) }, encoding: 'utf8' })
  assert.equal(url.trim(), 'https://github.com/o/r.git')
})

test(
  'runEnv: the account\u2019s name is on the commits of the run\u2019s project and its worktrees, or of its session\u2019s folder, and on no other repository\u2019s: a test\u2019s own commits keep the user it gave them',
  withDir(async dir => {
    // The environment as a run's agent has it, less any author or git settings a run this test runs in was given.
    const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_(AUTHOR|COMMITTER|CONFIG)_/.test(name) && name !== 'GIT_CONFIG_COUNT'))
    let working: Record<string, string> = {}
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...gitEnv, ...working } }).trim()
    const project = join(dir, 'shop')
    mkdirSync(project)
    git(project, 'init', '-q')
    git(project, '-c', 'user.name=p', '-c', 'user.email=p@p', 'commit', '-q', '--allow-empty', '-m', 'init')
    git(project, 'worktree', 'add', '-q', join(project, '.branches', 'agent-x'), '-b', 'agent-x')
    const tests = join(dir, 'tmp', 'fixture')
    mkdirSync(tests, { recursive: true })
    git(tests, 'init', '-q')
    git(tests, 'config', 'user.name', 'Tester')
    git(tests, 'config', 'user.email', 'tester@example.com')
    const author = (cwd: string) => git(cwd, 'var', 'GIT_AUTHOR_IDENT').replace(/ \d+ [+-]\d{4}$/, '')
    const committer = (cwd: string) => git(cwd, 'var', 'GIT_COMMITTER_IDENT').replace(/ \d+ [+-]\d{4}$/, '')
    const account = join(dir, 'openagent-github', 'octo')
    const facts = { login: 'octo', id: 42, name: 'Octo "the" Cat' }
    working = runEnv('tok', account, facts, gitEnv, await gitDirsOf({ project }))
    const octo = 'Octo "the" Cat <42+octo@users.noreply.github.com>'
    assert.deepEqual([author(project), author(join(project, '.branches', 'agent-x')), committer(join(project, '.branches', 'agent-x'))], [octo, octo, octo])
    assert.deepEqual([author(tests), committer(tests)], ['Tester <tester@example.com>', 'Tester <tester@example.com>'])
    assert.equal(Object.keys(working).filter(name => /^GIT_(AUTHOR|COMMITTER)_/.test(name)).length, 0, 'no author for every repository')
    // A session with no project: the copies of its repos in its folder, which is made after its account is picked.
    const session = await gitDirsOf({ session: '2026-11-21T19-02-26-646Z' })
    const folder = sessionFolder(sessionsHome(), '2026-11-21T19-02-26-646Z')
    working = runEnv('tok', account, { login: 'octo', id: 42 }, gitEnv, session)
    execFileSync('git', ['clone', '-q', project, join(folder, 'shop')], { env: gitEnv })
    assert.deepEqual([author(join(folder, 'shop')), author(tests)], ['octo <42+octo@users.noreply.github.com>', 'Tester <tester@example.com>'], 'no name: the login')
    // A run in a project with copies of repos: its commits there are the account's too.
    working = runEnv('tok', account, facts, gitEnv, await gitDirsOf({ project, session: '2026-11-21T19-02-26-646Z' }))
    assert.deepEqual([author(join(folder, 'shop')), author(project), author(tests)], [octo, octo, 'Tester <tester@example.com>'])
    rmSync(folder, { recursive: true, force: true })
    // No facts kept, or nowhere given: git signs as it would.
    assert.equal(runEnv('tok', account, undefined, gitEnv, session)['GIT_CONFIG_COUNT'], '4')
    assert.equal(runEnv('tok', account, facts, gitEnv)['GIT_CONFIG_COUNT'], '4')
  }),
)

test(
  'accounts: the card\u2019s facts, the runs\u2019 account marked; another host refused; no gh is not installed with the command that installs it',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    account(join(dir, 'openagent-github'), 'octo')
    account(join(dir, 'openagent-github'), 'octo-agent')
    const said = await run(['accounts'], { gh: ghWith(), env, hasBrew: async () => true, installing: () => undefined, underWay: () => undefined })
    assert.equal(said.code, 0)
    assert.equal(said.out['name'], 'GitHub')
    assert.equal(said.out['requestWord'], 'pull request')
    assert.equal(said.out['installed'], true)
    assert.equal(said.out['install'], undefined, 'nothing to install while gh is here')
    assert.match(String(said.out['logo']), /^<svg/)
    assert.deepEqual(said.out['accounts'], [
      { login: 'octo', ok: true, runs: true, avatar: 'https://github.com/octo.png?size=64' },
      { login: 'octo-agent', ok: true, runs: false, avatar: 'https://github.com/octo-agent.png?size=64' },
    ])
    const other = await run(['accounts', '--host', 'gitlab.com'], { gh: ghWith(), env })
    assert.equal(other.code, 1)
    assert.equal(other.out['reason'], 'not-mine')
    const none = await run(['accounts'], { gh: async () => Promise.reject(new Error('spawn gh ENOENT')), env, hasBrew: async () => false, installing: () => ({ running: false, failed: 'no network', said: '' }), underWay: () => undefined })
    assert.equal(none.out['installed'], false)
    assert.match(String(none.out['install']), /releases\/download/)
    assert.equal(none.out['installFailed'], 'no network')
    const going = await run(['accounts'], { gh: async () => Promise.reject(new Error('spawn gh ENOENT')), env, hasBrew: async () => false, installing: () => ({ running: true, said: '' }), underWay: () => undefined })
    assert.equal(going.out['installing'], true)
    assert.deepEqual(none.out['accounts'], [])
    const busy = await run(['accounts'], { gh: ghWith(), env, hasBrew: async () => true, installing: () => undefined, underWay: () => ({ code: 'ABCD-1234', url: 'https://github.com/login/device' }) })
    assert.deepEqual(busy.out['loggingIn'], { code: 'ABCD-1234', url: 'https://github.com/login/device' })
  }),
)

test(
  'use, then env: a run gets the picked account\u2019s folder and token; --user names another; no account, or one OpenAgent does not have, is refused, never the person\u2019s gh',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const root = join(dir, 'openagent-github')
    // No account yet: refused, with where one is added.
    const none = await run(['env'], { gh: ghWith(), env })
    assert.equal(none.code, 1)
    assert.equal(none.out['reason'], 'no-account')
    assert.match(none.err, /Permissions/)
    account(root, 'octo', { id: 1 })
    account(root, 'octo-agent', { id: 42, name: 'Octo Agent' })
    const gh = ghWith()
    assert.equal((await run(['env'], { gh, env })).out['login'], 'octo')
    assert.equal((await run(['use', 'octo-agent'], { gh, env })).code, 0)
    const picked = await run(['env'], { gh, env })
    assert.equal(picked.out['login'], 'octo-agent')
    const given = picked.out['env'] as Record<string, string>
    assert.deepEqual([given['GH_TOKEN'], given['GH_CONFIG_DIR'], given['GIT_AUTHOR_EMAIL']], ['tok-octo-agent', join(root, 'octo-agent'), undefined], 'no author: its fetches and pushes make no commit')
    assert.equal(((await run(['env', '--user', 'octo'], { gh, env })).out['env'] as Record<string, string>)['GH_TOKEN'], 'tok-octo')
    const stranger = await run(['env', '--user', 'stranger'], { gh, env })
    assert.equal(stranger.code, 1)
    assert.equal(stranger.out['reason'], 'no-account')
    assert.equal((await run(['use', 'stranger'], { gh, env })).out['reason'], 'no-account')
    // A login kept under one name that GitHub says is another account's: never handed to a run.
    const mixed = await run(['env', '--user', 'octo-agent'], { gh: ghWith([], { whose: { 'octo-agent': 'octo' } }), env })
    assert.equal(mixed.code, 1)
    assert.equal(mixed.out['reason'], 'not-that-account')
    assert.match(mixed.err, /the login OpenAgent keeps for octo-agent is octo's on GitHub/)
  }),
)

test(
  'git-config: the settings that make git go as an account of OpenAgent\u2019s, gh asked in that account\u2019s folder only, no token in them; no account is refused',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const root = join(dir, 'openagent-github')
    assert.equal((await run(['git-config'], { gh: ghWith(), env })).out['reason'], 'no-account')
    account(root, 'octo-agent', { id: 42 })
    const said = await run(['git-config'], { gh: ghWith(), env })
    assert.equal(said.code, 0)
    assert.equal(said.out['login'], 'octo-agent')
    assert.equal(said.out['host'], 'github.com')
    const config = said.out['config'] as [string, string][]
    assert.deepEqual(config[0], ['credential.https://github.com.helper', ''], 'every helper before it dropped')
    assert.match(config[1]![1], new RegExp(`GH_TOKEN= GITHUB_TOKEN= GH_CONFIG_DIR='${join(root, 'octo-agent')}' gh auth git-credential get`))
    assert.deepEqual(config.slice(2).map(([, value]) => value), ['git@github.com:', 'ssh://git@github.com/'])
    assert.doesNotMatch(JSON.stringify(said.out), /tok-/, 'no token')
    assert.equal((await run(['git-config', '--user', 'stranger'], { gh: ghWith(), env })).out['reason'], 'no-account')
  }),
)

test(
  'repos: an owner\u2019s repositories as an account of OpenAgent\u2019s sees them, newest pushed first; the account\u2019s own by default; no account, or no owner word, is refused',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const root = join(dir, 'openagent-github')
    const asked: { args: string[]; env?: Record<string, string> }[] = []
    const base = ghWith(asked)
    const gh: GhRunner = async (args, cwd, given, input) => {
      if (args[0] !== 'repo') return base(args, cwd, given, input)
      asked.push({ args, ...(given ? { env: given } : {}) })
      return JSON.stringify([
        { nameWithOwner: `${args[2]}/old`, url: `https://github.com/${args[2]}/old`, isPrivate: false, pushedAt: '2026-01-01T00:00:00Z', description: '' },
        { nameWithOwner: `${args[2]}/new`, url: `https://github.com/${args[2]}/new`, isPrivate: true, pushedAt: '2026-11-01T00:00:00Z', description: 'The new one' },
        { nameWithOwner: '../evil', url: 'javascript:x' },
      ])
    }
    assert.equal((await run(['repos'], { gh, env })).out['reason'], 'no-account')
    account(root, 'octo', { id: 1 })
    account(root, 'octo-agent', { id: 42 })
    const own = await run(['repos', '--user', 'octo-agent'], { gh, env })
    assert.equal(own.code, 0)
    assert.deepEqual(own.out, {
      ok: true,
      login: 'octo-agent',
      owner: 'octo-agent',
      repos: [
        { address: 'github.com/octo-agent/new', url: 'https://github.com/octo-agent/new', private: true, pushedAt: '2026-11-01T00:00:00Z', description: 'The new one' },
        { address: 'github.com/octo-agent/old', url: 'https://github.com/octo-agent/old', private: false, pushedAt: '2026-01-01T00:00:00Z' },
      ],
    })
    assert.equal(asked.find(a => a.args[0] === 'repo')?.env?.['GH_CONFIG_DIR'], join(root, 'octo-agent'), 'as that account, never the person\u2019s gh')
    const org = await run(['repos', '--owner', 'vikejs'], { gh, env })
    assert.deepEqual([org.out['login'], org.out['owner']], ['octo', 'vikejs'], 'an organization, as the account runs use')
    assert.equal((await run(['repos', '--owner', '../x'], { gh, env })).out['reason'], 'no-owner')
  }),
)

test(
  'a command that talks to GitHub works as OpenAgent\u2019s account: a run\u2019s own; else the runs\u2019 one, its token for git too; with none it is refused before gh is asked',
  withDir(async dir => {
    const root = join(dir, 'openagent-github')
    const asked: { args: string[]; env?: Record<string, string> }[] = []
    const gh = ghWith(asked)
    const people = ['people', 'a@x.dev']
    const commits = (): { args: string[]; env?: Record<string, string> } | undefined => asked.find(a => a.args[0] === 'api' && a.args[1]!.startsWith('repos/'))
    const none = await run(people, { gh, env: { XDG_CONFIG_HOME: dir } })
    assert.equal(none.out['reason'], 'no-account')
    assert.ok(!asked.some(a => a.args[0] === 'api'), 'the person\u2019s gh is never asked')
    account(root, 'octo', { id: 1 })
    asked.length = 0
    await run(people, { gh, env: { XDG_CONFIG_HOME: dir } })
    const api = commits()!
    assert.deepEqual([api.env?.['GH_CONFIG_DIR'], api.env?.['GH_TOKEN'], api.env?.['GIT_CONFIG_COUNT']], [join(root, 'octo'), 'tok-octo', '4'])
    // Inside a run: the account it was given, as it is. A gh folder of the person's own is not one.
    account(root, 'octo-agent', { id: 42 })
    asked.length = 0
    await run(people, { gh, env: { XDG_CONFIG_HOME: dir, GH_CONFIG_DIR: join(root, 'octo-agent') } })
    assert.equal(commits()?.env?.['GH_CONFIG_DIR'], join(root, 'octo-agent'))
    asked.length = 0
    await run(people, { gh, env: { XDG_CONFIG_HOME: dir, GH_CONFIG_DIR: '/home/me/.config/gh' } })
    assert.equal(commits()?.env?.['GH_CONFIG_DIR'], join(root, 'octo'))
  }),
)

test(
  'forget: forgetting an account takes only OpenAgent\u2019s copy, and the runs\u2019 pick that named it',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const root = join(dir, 'openagent-github')
    account(root, 'octo-agent')
    assert.equal((await run(['use', 'octo-agent'], { gh: ghWith(), env })).code, 0)
    assert.deepEqual((await run(['forget', 'octo-agent'], { gh: ghWith(), env })).out, { ok: true, login: 'octo-agent' })
    assert.ok(!existsSync(join(root, 'octo-agent')))
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'openagent-github.json'), 'utf8')), { runs: {} })
    assert.deepEqual((await run(['forget', 'stranger'], { gh: ghWith(), env })).out, { ok: true, login: 'stranger' })
    assert.equal((await run(['forget', '../x'], { gh: ghWith(), env })).code, 2)
  }),
)

test('login: started into OpenAgent\u2019s accounts\u2019 folder; install runs the declared command and says it on a failure', async () => {
  let into = ''
  const said = await run(['login'], {
    gh: ghWith(),
    env: { XDG_CONFIG_HOME: '/cfg' },
    login: async root => {
      into = root
      return { code: 'ABCD-1234', url: 'https://github.com/login/device' }
    },
  })
  assert.deepEqual(said.out, { ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
  assert.equal(into, '/cfg/openagent-github')
  assert.equal((await run(['login'], { gh: async () => Promise.reject(new Error('spawn gh ENOENT')) })).out['reason'], 'not-installed')

  const ran: string[] = []
  assert.deepEqual((await run(['install'], { hasBrew: async () => true, shell: async command => void ran.push(command) })).out, { ok: true, started: true, command: 'brew install gh' })
  assert.deepEqual(ran, ['brew install gh'])
  const failed = await run(['install'], { hasBrew: async () => true, shell: async () => Promise.reject(new Error('no network')) })
  assert.equal(failed.out['reason'], 'install-failed')
  assert.match(failed.err, /no network/)
})

test('the code of a login, as each gh says it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-code-'))
  try {
    const files = { log: join(dir, 'l.log'), pid: join(dir, 'l.pid'), exit: join(dir, 'l.exit') }
    for (const said of ['! First copy your one-time code: 5BAA-3444', '! One-time code (3F1C-6E36) copied to clipboard']) {
      await startJob(files, `echo "${said}"; echo "Open this URL to continue in your web browser: https://github.com/login/device"; sleep 1`)
      await new Promise(resolve => setTimeout(resolve, 200))
      assert.deepEqual(loginUnderWay(files), { code: /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(said)![1], url: 'https://github.com/login/device' })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a login given up: its gh stops waiting, and nothing of it is kept, not even as a failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-stop-'))
  try {
    const files = { log: join(dir, 'l.log'), pid: join(dir, 'l.pid'), exit: join(dir, 'l.exit') }
    mkdirSync(join(dir, '.adding'))
    await startJob(files, 'echo "one-time code: ABCD-1234"; sleep 30')
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.deepEqual(loginUnderWay(files), { code: 'ABCD-1234', url: 'https://github.com/login/device' })
    const pid = Number(readFileSync(files.pid, 'utf8'))
    stopLogin(dir, files)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.throws(() => process.kill(pid, 0), 'its shell is gone')
    assert.equal(jobState(files), undefined)
    assert.equal(loginUnderWay(files), undefined)
    assert.equal(existsSync(join(dir, '.adding')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a login gh could not start is refused in one line holding every line gh said: a refusal is told by its last line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-login-'))
  const kept = process.env['PATH']
  writeFileSync(join(dir, 'gh'), ['#!/bin/sh', 'echo "error connecting to github.com" >&2', 'echo "check your internet connection or https://githubstatus.com" >&2', 'exit 1', ''].join('\n'))
  chmodSync(join(dir, 'gh'), 0o755)
  process.env['PATH'] = `${dir}:${kept}`
  try {
    const root = join(dir, 'accounts')
    mkdirSync(root)
    const files = { log: join(dir, 'l.log'), pid: join(dir, 'l.pid'), exit: join(dir, 'l.exit') }
    await assert.rejects(startLogin(root, files), { message: 'error connecting to github.com; check your internet connection or https://githubstatus.com' })
  } finally {
    process.env['PATH'] = kept
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A browser login run for real, with a stand-in `gh` that writes down what it is asked and
 * where: it logs in when `login` says `ok`, writing its file into the folder it is given, as gh does.
 */
async function loggedIn(login: 'ok' | 'no'): Promise<{ asked: string[]; root: string; dir: string; state: ReturnType<typeof jobState> }> {
  const dir = mkdtempSync(join(tmpdir(), 'gh-login-'))
  const kept = process.env['PATH']
  const log = join(dir, 'asked')
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/bin/sh',
      `echo "GH_CONFIG_DIR=$GH_CONFIG_DIR GH_TOKEN=\${GH_TOKEN-unset} $*" >> '${log}'`,
      'case "$1 $2" in',
      `  "auth login") echo "! First copy your one-time code: ABCD-1234"; sleep 0.3; [ ${login} = ok ] && echo "github.com: {}" > "$GH_CONFIG_DIR/hosts.yml" ;;`,
      `  "api --hostname") printf 'octo\t42\tOcto Cat\n' ;;`,
      'esac',
      '',
    ].join('\n'),
  )
  chmodSync(join(dir, 'gh'), 0o755)
  process.env['PATH'] = `${dir}:${kept}`
  try {
    const root = join(dir, 'accounts')
    mkdirSync(root)
    const files = { log: join(dir, 'l.log'), pid: join(dir, 'l.pid'), exit: join(dir, 'l.exit') }
    process.env['GH_TOKEN'] = 'the-persons-token'
    assert.deepEqual(await startLogin(root, files), { code: 'ABCD-1234', url: 'https://github.com/login/device' })
    delete process.env['GH_TOKEN']
    for (let waited = 0; jobState(files)?.running && waited < 10_000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
    const { execFile } = await import('node:child_process')
    const realGh: GhRunner = (args, cwd, env) =>
      new Promise((resolve, reject) => execFile('gh', args, { cwd, env: { ...process.env, ...env } }, (err, out) => (err ? reject(err) : resolve(String(out)))))
    await settleAdded(root, realGh, dir, files)
    return { asked: readFileSync(log, 'utf8').trim().split('\n'), root, dir, state: jobState(files) }
  } finally {
    process.env['PATH'] = kept
    delete process.env['GH_TOKEN']
  }
}

test('a browser login goes into a folder of its own, with no token from the environment, and is named by its account once GitHub said yes', async () => {
  const { asked, root, dir, state } = await loggedIn('ok')
  try {
    assert.equal(state?.running, false)
    assert.equal(asked[0], `GH_CONFIG_DIR=${join(root, '.adding')} GH_TOKEN=unset auth login --hostname github.com --web --insecure-storage --skip-ssh-key`)
    assert.deepEqual(accountLogins(root), ['octo'])
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'octo', 'account.json'), 'utf8')), { login: 'octo', id: 42, name: 'Octo Cat' })
    assert.ok(!existsSync(join(root, '.adding')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a browser login GitHub did not say yes to leaves no account', async () => {
  const { root, dir, state } = await loggedIn('no')
  try {
    assert.ok(state && 'failed' in state && state.failed !== undefined)
    assert.deepEqual(accountLogins(root), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
