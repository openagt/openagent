import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GhRunner } from './gh.js'
import { ghState, installCommand, jobState, loginUnderWay, runEnv, runsAccount, startJob, useForRuns, type GhAccount } from './accounts.js'
import { runCli, type CliDeps } from './cli.js'

// The accounts gh knows and the one runs use: picked once from the terminal's, kept from then on,
// changed only here; a run gets the picked one's token, for gh and for git.

const STATUS = {
  hosts: {
    'github.com': [
      { state: 'success', active: true, host: 'github.com', login: 'octo', tokenSource: 'keyring' },
      { state: 'success', active: false, host: 'github.com', login: 'octo-agent', tokenSource: 'keyring' },
    ],
  },
}

/** gh as scripted: the token of each account is `tok-<login>`, and GitHub says it is that account's unless `whose` says another. */
const ghWith =
  (status: unknown, asked: string[][] = [], whose: Record<string, string> = {}): GhRunner =>
  async (args, _cwd, env) => {
    asked.push(args)
    if (args[0] === '--version') return 'gh version 2.93.0\n'
    if (args[0] === 'auth' && args[1] === 'status') return JSON.stringify(status)
    if (args[0] === 'auth' && args[1] === 'token') return `tok-${args[args.indexOf('--user') + 1]}\n`
    if (args[0] === 'api' && args[1] === 'user') {
      const login = env?.['GH_TOKEN']?.slice('tok-'.length) ?? ''
      return `${whose[login] ?? login}\n`
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

async function run(argv: string[], deps: CliDeps): Promise<{ code: number; out: Record<string, unknown>; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { cwd: '/r', stdout: line => out.push(line), stderr: line => err.push(line) }, deps)
  return { code, out: JSON.parse(out.join('\n')) as Record<string, unknown>, err: err.join('\n') }
}

test('ghState: no gh is not installed; its accounts with which is the terminal’s; a gh that cannot say is no account', async () => {
  assert.deepEqual(await ghState('/r', async () => Promise.reject(new Error('spawn gh ENOENT'))), { installed: false })
  assert.deepEqual(await ghState('/r', ghWith(STATUS)), {
    installed: true,
    accounts: [
      { login: 'octo', terminal: true, ok: true },
      { login: 'octo-agent', terminal: false, ok: true },
    ],
  })
  assert.deepEqual(await ghState('/r', ghWith({ hosts: {} })), { installed: true, accounts: [] })
})

test(
  'runsAccount: the terminal’s is picked the first time and kept; a switch in the terminal does not move it; a pick gh forgot falls back',
  withDir(dir => {
    const path = join(dir, 'picks.json')
    const accounts: GhAccount[] = [
      { login: 'octo', terminal: true, ok: true },
      { login: 'octo-agent', terminal: false, ok: true },
    ]
    assert.equal(runsAccount(accounts, path), 'octo')
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { runs: { 'github.com': 'octo' } })
    // The terminal switched: runs stay.
    assert.equal(runsAccount([{ ...accounts[0]!, terminal: false }, { ...accounts[1]!, terminal: true }], path), 'octo')
    useForRuns('octo-agent', accounts, path)
    assert.equal(runsAccount(accounts, path), 'octo-agent')
    assert.throws(() => useForRuns('stranger', accounts, path), /knows no account stranger/)
    // gh logged octo-agent out: the terminal's is the runs' again.
    assert.equal(runsAccount([accounts[0]!], path), 'octo')
    assert.equal(runsAccount([], join(dir, 'none.json')), undefined)
  }),
)

test('runEnv: git asks the token of the helper set here alone, ssh addresses go over https, settings already given are kept', () => {
  const env = runEnv('tok', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.x', GIT_CONFIG_VALUE_0: 'y' })
  assert.equal(env['GH_TOKEN'], 'tok')
  assert.equal(env['GIT_CONFIG_COUNT'], '5')
  assert.equal(env['GIT_CONFIG_KEY_0'], undefined, 'the one given stays as it was')
  assert.equal(env['GIT_CONFIG_KEY_1'], 'credential.https://github.com.helper')
  assert.equal(env['GIT_CONFIG_VALUE_1'], '')
  // The real git: whatever helper the person's own config has, this one answers.
  const said = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    env: { ...process.env, ...runEnv('tok-123'), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    encoding: 'utf8',
  })
  assert.match(said, /^password=tok-123$/m)
  const url = execFileSync('git', ['ls-remote', '--get-url', 'git@github.com:o/r.git'], { env: { ...process.env, ...runEnv('t') }, encoding: 'utf8' })
  assert.equal(url.trim(), 'https://github.com/o/r.git')
})

test('installCommand: Homebrew where it is, else GitHub’s build for this computer into ~/.local/bin; none where GitHub makes none', () => {
  assert.equal(installCommand(true), 'brew install gh')
  const mac = installCommand(false, 'darwin', 'arm64')!
  assert.match(mac, /releases\/download\/v\$v\/gh_\$\{v\}_macOS_arm64\.zip/)
  assert.match(mac, /unzip -q/)
  assert.match(mac, /mv "\$d"\/gh_\*\/bin\/gh ~\/\.local\/bin\//)
  assert.match(installCommand(false, 'linux', 'x64')!, /linux_amd64\.tar\.gz.*tar -xzf/)
  assert.equal(installCommand(false, 'win32', 'x64'), undefined)
})

test('the install, run for real in a home of its own, puts a working gh in its ~/.local/bin', { skip: process.env['OPENAGENT_NETWORK_TESTS'] !== '1' && 'reaches GitHub: OPENAGENT_NETWORK_TESTS=1' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'gh-home-'))
  try {
    execFileSync('sh', ['-c', installCommand(false)!], { env: { ...process.env, HOME: home } })
    assert.match(execFileSync(join(home, '.local', 'bin', 'gh'), ['--version'], { encoding: 'utf8' }), /^gh version/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test(
  'accounts: the card’s facts, the runs’ account marked; another host refused; no gh is not installed with the command that installs it',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const said = await run(['accounts'], { gh: ghWith(STATUS), env, hasBrew: async () => true, installing: () => undefined, underWay: () => undefined })
    assert.equal(said.code, 0)
    assert.equal(said.out['name'], 'GitHub')
    assert.equal(said.out['requestWord'], 'pull request')
    assert.equal(said.out['installed'], true)
    assert.equal(said.out['install'], undefined, 'nothing to install while gh is here')
    assert.match(String(said.out['logo']), /^<svg/)
    assert.deepEqual(said.out['accounts'], [
      { login: 'octo', terminal: true, ok: true, runs: true },
      { login: 'octo-agent', terminal: false, ok: true, runs: false },
    ])
    const other = await run(['accounts', '--host', 'gitlab.com'], { gh: ghWith(STATUS), env })
    assert.equal(other.code, 1)
    assert.equal(other.out['reason'], 'not-mine')
    const none = await run(['accounts'], { gh: async () => Promise.reject(new Error('spawn gh ENOENT')), env, hasBrew: async () => false, installing: () => ({ running: false, failed: 'no network', said: '' }), underWay: () => undefined })
    assert.equal(none.out['installed'], false)
    assert.match(String(none.out['install']), /releases\/download/)
    assert.equal(none.out['installFailed'], 'no network')
    const going = await run(['accounts'], { gh: async () => Promise.reject(new Error('spawn gh ENOENT')), env, hasBrew: async () => false, installing: () => ({ running: true, said: '' }), underWay: () => undefined })
    assert.equal(going.out['installing'], true)
    assert.deepEqual(none.out['accounts'], [])
    const busy = await run(['accounts'], { gh: ghWith(STATUS), env, hasBrew: async () => true, installing: () => undefined, underWay: () => ({ code: 'ABCD-1234', url: 'https://github.com/login/device' }) })
    assert.deepEqual(busy.out['loggingIn'], { code: 'ABCD-1234', url: 'https://github.com/login/device' })
  }),
)

test(
  'use, then env: a run gets the picked account’s token; --user names another; an account gh does not know is refused',
  withDir(async dir => {
    const env = { XDG_CONFIG_HOME: dir }
    const asked: string[][] = []
    const gh = ghWith(STATUS, asked)
    assert.equal((await run(['env'], { gh, env })).out['login'], 'octo')
    assert.equal((await run(['use', 'octo-agent'], { gh, env })).code, 0)
    const picked = await run(['env'], { gh, env })
    assert.equal(picked.out['login'], 'octo-agent')
    assert.equal((picked.out['env'] as Record<string, string>)['GH_TOKEN'], 'tok-octo-agent')
    assert.deepEqual(asked.at(-2), ['auth', 'token', '--hostname', 'github.com', '--user', 'octo-agent'])
    assert.equal(((await run(['env', '--user', 'octo'], { gh, env })).out['env'] as Record<string, string>)['GH_TOKEN'], 'tok-octo')
    const stranger = await run(['env', '--user', 'stranger'], { gh, env })
    assert.equal(stranger.code, 1)
    assert.equal(stranger.out['reason'], 'no-account')
    assert.match(stranger.err, /Settings › Git hosts/)
    assert.equal((await run(['use', 'stranger'], { gh, env })).out['reason'], 'no-account')
    // A login gh keeps under one name that GitHub says is another account's: never handed to a run.
    const mixed = await run(['env', '--user', 'octo-agent'], { gh: ghWith(STATUS, [], { 'octo-agent': 'octo' }), env })
    assert.equal(mixed.code, 1)
    assert.equal(mixed.out['reason'], 'not-that-account')
    assert.match(mixed.err, /the login gh keeps for octo-agent is octo's on GitHub/)
    // Nobody logged in: nothing changes for the run.
    assert.deepEqual((await run(['env'], { gh: ghWith({ hosts: {} }), env: { XDG_CONFIG_HOME: join(dir, 'x') } })).out, { ok: true, env: {} })
  }),
)

test('login: the terminal’s account is handed over to be given back; install runs the declared command and says it on a failure', async () => {
  let back: string | undefined = 'unset'
  const said = await run(['login'], {
    gh: ghWith(STATUS),
    login: async terminal => {
      back = terminal
      return { code: 'ABCD-1234', url: 'https://github.com/login/device' }
    },
  })
  assert.deepEqual(said.out, { ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
  assert.equal(back, 'octo')
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

test('a job goes on after the command answered, says how it ended, and a failed one its last lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-job-'))
  try {
    const files = { log: join(dir, 'j.log'), pid: join(dir, 'j.pid'), exit: join(dir, 'j.exit') }
    assert.equal(jobState(files), undefined)
    await startJob(files, 'echo "one-time code: ABCD-1234"; sleep 0.3; echo "$1"', ['done'])
    assert.equal(jobState(files)?.running, true)
    await new Promise(resolve => setTimeout(resolve, 900))
    assert.deepEqual(jobState(files), { running: false, said: 'one-time code: ABCD-1234\ndone\n' })
    await startJob(files, 'echo "curl: could not resolve"; exit 6')
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.deepEqual(jobState(files), { running: false, failed: 'curl: could not resolve', said: 'curl: could not resolve\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
