import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProvidedCommand } from '@openagt/agent-data'
import { addProject } from '../registry.js'
import { readProvider, remoteHost } from '../dashboard/git-hosts.js'
import { accountsWiring } from './accounts.js'
import { loginsWiring, onAgentState, onGitHosts, runningFixes, type GitHostsView, sendAgentFix, sendForgetGitHostAccount, sendGitHostLogin, sendUseGitHostAccount } from './logins.js'
import { provideTestContext } from './test-context.js'
import { accountsPath, addAccount } from '@openagt/agent-driver'
import { claudeLogins } from '@openagt/agent-driver-claude-code'
import { codexLogins } from '@openagt/agent-driver-codex'

/** The real readiness question, before a test swaps it. */
const realReady = loginsWiring.ready
/** The real way a fix runs. */
const realFix = loginsWiring.fix

// The Permissions page, the agent's own fix, and a project's own accounts: drawn from what the
// git host's package and the agent's package answer, never naming either.

const GITHUB: ProvidedCommand = { name: 'github', bin: '/pkg/github', package: '@openagt/github' } as ProvidedCommand

const card = (accounts: { login: string; terminal?: boolean; runs?: boolean }[]) => ({
  ok: true,
  host: 'github.com',
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg viewBox="0 0 24 24"></svg>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts: accounts.map(a => ({ terminal: false, runs: false, ok: true, ...a })),
})

/** Three projects: one on GitHub, one on a host no package answers for, one with no remote. */
async function withProjects(body: (dirs: { github: string; gitlab: string; local: string }, asked: { root: string; args: string[] }[]) => Promise<void>, accounts = [{ login: 'octo', terminal: true, runs: true }, { login: 'octo-agent' }]): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-logins-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const dirs = { github: join(dir, 'site'), gitlab: join(dir, 'tool'), local: join(dir, 'notes') }
  const remotes: Record<string, string | undefined> = { [dirs.github]: 'git@github.com:o/site.git', [dirs.gitlab]: 'https://gitlab.example.com/o/tool.git', [dirs.local]: undefined }
  for (const path of Object.values(dirs)) {
    mkdirSync(path)
    execFileSync('git', ['init', '-q'], { cwd: path })
    if (remotes[path]) execFileSync('git', ['remote', 'add', 'origin', remotes[path]!], { cwd: path })
    await addProject(path, '2026-10-22T00:00:00.000Z')
  }
  const asked: { root: string; args: string[] }[] = []
  const before = { ...loginsWiring }
  const accountsBefore = { ...accountsWiring }
  // No Claude Code here knows who the person is, and no Codex login is here.
  Object.assign(accountsWiring, {
    path: (agent: string) => join(dir, `${agent}-accounts.json`),
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'no-claude'), CODEX_HOME: join(dir, 'codex') },
    logins: async () => [claudeLogins(), codexLogins({ who: async () => ({}) })],
    codexOwnHome: () => join(dir, 'codex'),
    codexUsage: async () => [],
    computer: () => 'Studio',
  })
  provideTestContext()
  Object.assign(loginsWiring, {
    gitHost: async () => GITHUB,
    run: async (root: string, _command: ProvidedCommand, args: readonly string[]) => {
      asked.push({ root, args: [...args] })
      if (args[0] === 'accounts') return args[2] === 'github.com' ? { ok: true, output: card(accounts) } : { ok: false, error: 'this package answers for github.com' }
      if (args[0] === 'login') return { ok: true, output: { ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' } }
      return { ok: true, output: { ok: true } }
    },
  })
  try {
    await body(dirs, asked)
  } finally {
    Object.assign(loginsWiring, before)
    Object.assign(accountsWiring, accountsBefore)
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a remote’s host: scp form, ssh, https with a login in it; none for a local path', () => {
  assert.equal(remoteHost('git@github.com:o/r.git'), 'github.com')
  assert.equal(remoteHost('ssh://git@GitLab.Example.com:2222/o/r.git'), 'gitlab.example.com')
  assert.equal(remoteHost('https://x:tok@github.com/o/r'), 'github.com')
  assert.equal(remoteHost('/srv/git/r.git'), undefined)
  assert.equal(remoteHost('file:///srv/git/r.git'), undefined)
})

test('a package’s answer: a logo that is no SVG and a login page off https are dropped; an answer that is no card is none', () => {
  const read = readProvider({ ...card([{ login: 'octo' }]), logo: '<img src=x onerror=alert(1)>', loggingIn: { code: 'ABCD-1234', url: 'javascript:alert(1)' } })
  assert.equal(read?.logo, undefined)
  assert.equal(read?.loggingIn, undefined)
  assert.equal(readProvider({ ok: false, reason: 'not-mine' }), undefined)
  assert.equal(readProvider('nope'), undefined)
})

test('Git hosts: one row per host the remotes are on, with its projects; a host no package answers for has no card; no remote, no row; a press goes to the package', () =>
  withProjects(async (dirs, asked) => {
    const { hosts } = await onGitHosts()
    assert.deepEqual(
      hosts.map(h => [h.host, h.projects, h.provider?.name]),
      [
        ['github.com', ['site'], 'GitHub'],
        ['gitlab.example.com', ['tool'], undefined],
      ],
    )
    assert.deepEqual(hosts[0]!.provider?.accounts.map(a => [a.login, a.runs]), [
      ['octo', true],
      ['octo-agent', false],
    ])
    assert.equal((await sendUseGitHostAccount('github.com', 'octo-agent')).ok, true)
    assert.deepEqual(asked.at(-1), { root: dirs.github, args: ['use', 'octo-agent'] })
    assert.deepEqual(await sendGitHostLogin('github.com'), { ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    assert.deepEqual(await sendUseGitHostAccount('gitlab.example.com', 'x'), { ok: false, error: 'No package answers for gitlab.example.com.' })
  }))

test('Git hosts: an account is taken off this computer by its package; the one runs use is not, until another is picked', () =>
  withProjects(async (dirs, asked) => {
    assert.deepEqual(await sendForgetGitHostAccount('github.com', 'octo-agent'), { ok: true })
    assert.deepEqual(asked.at(-1), { root: dirs.github, args: ['forget', 'octo-agent'] })
    const before = asked.length
    assert.deepEqual(await sendForgetGitHostAccount('github.com', 'octo'), { ok: false, error: 'Runs use @octo: pick another account for runs first.' })
    assert.equal(asked.slice(before).some(call => call.args[0] === 'forget'), false)
    assert.deepEqual(await sendForgetGitHostAccount('gitlab.example.com', 'x'), { ok: false, error: 'No package answers for gitlab.example.com.' })
  }))

test('Git hosts: the last answer comes at once while the hosts are read again behind it; after a press, the next answer is a fresh one', () => {
  const accounts: { login: string; terminal?: boolean; runs?: boolean }[] = [{ login: 'octo', terminal: true, runs: true }]
  return withProjects(async () => {
    const logins = (view: { hosts: { provider?: { accounts: { login: string }[] } }[] }) => view.hosts[0]!.provider?.accounts.map(a => a.login)
    assert.equal((await sendUseGitHostAccount('github.com', 'octo')).ok, true)
    assert.deepEqual(logins(await onGitHosts()), ['octo'])
    accounts.push({ login: 'octo-agent' })
    assert.deepEqual(logins(await onGitHosts()), ['octo'])
    let next = await onGitHosts()
    for (let tries = 0; tries < 50 && logins(next)?.length !== 2; tries++) next = await new Promise(resolve => setTimeout(() => resolve(onGitHosts()), 10))
    assert.deepEqual(logins(next), ['octo', 'octo-agent'])
    accounts.pop()
    assert.equal((await sendUseGitHostAccount('github.com', 'octo')).ok, true)
    assert.deepEqual(logins(await onGitHosts()), ['octo'])
  }, accounts)
})

test('Git hosts: a read under way when a press is made answers no one after it, nor is it the last answer when it lands', () => {
  const accounts: { login: string; terminal?: boolean; runs?: boolean }[] = [{ login: 'octo', terminal: true, runs: true }]
  return withProjects(async () => {
    const logins = (view: GitHostsView) => view.hosts[0]!.provider?.accounts.map(a => a.login)
    assert.equal((await sendUseGitHostAccount('github.com', 'octo')).ok, true)
    assert.deepEqual(logins(await onGitHosts()), ['octo'])
    // The read behind the next answer has the card's answer, and is held there, as GitHub's tool takes its time.
    const run = loginsWiring.run
    let read!: () => void
    const answered = new Promise<void>(resolve => (read = resolve))
    let letGo!: () => void
    const held = new Promise<void>(resolve => (letGo = resolve))
    loginsWiring.run = async (...call) => {
      const said = await run(...call)
      if (call[2][0] === 'accounts') {
        read()
        await held
      }
      return said
    }
    assert.deepEqual(logins(await onGitHosts()), ['octo'])
    await answered
    accounts.push({ login: 'octo-agent' })
    assert.equal((await sendUseGitHostAccount('github.com', 'octo-agent')).ok, true)
    const after = onGitHosts()
    letGo()
    assert.deepEqual(logins(await after), ['octo', 'octo-agent'])
    assert.deepEqual(logins(await onGitHosts()), ['octo', 'octo-agent'])
  }, accounts)
})

test('the agent: what is in the way and the fix its package declared; a press runs its install, never a command from the page, and says why it failed', async () => {
  const before = { ...loginsWiring }
  const INSTALL = { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash' }
  let ready = false
  const ran: string[] = []
  let finish: (err?: Error) => void = () => {}
  Object.assign(loginsWiring, {
    ready: async () => (ready ? { problems: [], warnings: [] } : { problems: ['`claude` not found'], warnings: [], fix: INSTALL }),
    fix: (command: string) => {
      ran.push(command)
      return new Promise<void>((resolve, reject) => {
        finish = err => (err ? reject(err) : resolve())
      })
    },
  })
  try {
    assert.deepEqual(await onAgentState('claude-code'), { driver: 'claude-code', ready: false, problem: '`claude` not found', fix: INSTALL })
    assert.equal((await sendAgentFix('claude-code')).ok, true)
    assert.equal((await onAgentState('claude-code')).fixing, 'install')
    assert.equal((await sendAgentFix('claude-code')).ok, false, 'one at a time')
    finish(new Error('curl: (6) Could not resolve host: claude.ai'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await onAgentState('claude-code')).failed, 'curl: (6) Could not resolve host: claude.ai')
    assert.deepEqual(ran, [INSTALL.command])
    ready = true
    assert.deepEqual(await onAgentState('claude-code'), { driver: 'claude-code', ready: true })
    assert.deepEqual(await sendAgentFix('claude-code'), { ok: false, error: 'Nothing to install: see the line it says.' })
    assert.equal((await sendAgentFix('rm -rf')).ok, false)
  } finally {
    Object.assign(loginsWiring, before)
  }
})

test('an agent that is installed and has no account is no press of the dashboard: its log-in is said, and never run here', async () => {
  const before = { ...loginsWiring }
  const ran: string[] = []
  const fix = { kind: 'log-in', command: 'codex login' }
  Object.assign(loginsWiring, {
    ready: async () => ({ problems: ['`codex` is not logged in.'], warnings: [], fix }),
    fix: async (command: string) => void ran.push(command),
  })
  try {
    assert.deepEqual(await onAgentState('codex'), { driver: 'codex', ready: false, problem: '`codex` is not logged in.', fix })
    assert.deepEqual(await sendAgentFix('codex'), { ok: false, error: 'Nothing to install: see the line it says.' })
    assert.deepEqual(ran, [])
  } finally {
    Object.assign(loginsWiring, before)
  }
})

test('an install the dashboard started ends as it stops, with what it started: nothing of it outlives the dashboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const said = join(dir, 'pid')
  try {
    const fixing = realFix(`sleep 60 & echo $! > ${said}; wait`)
    const pidOf = (): number => {
      try {
        return Number(readFileSync(said, 'utf8'))
      } catch {
        return 0
      }
    }
    let sleeper = pidOf()
    while (!sleeper) {
      await new Promise(resolve => setTimeout(resolve, 20))
      sleeper = pidOf()
    }
    runningFixes.end()
    await assert.rejects(fixing)
    const alive = (): boolean => {
      try {
        process.kill(sleeper, 0)
        return true
      } catch {
        return false
      }
    }
    for (let tries = 0; alive() && tries < 40; tries++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(alive(), false, 'the sleep the fix started is gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an install whose download fails fails, with what the download said, though the shell it is piped to read nothing, and on an sh without pipefail', async () => {
  const download = `sh -c 'echo "curl: (6) Could not resolve host: chatgpt.com" >&2; exit 6' | sh`
  await assert.rejects(realFix(download), { message: 'curl: (6) Could not resolve host: chatgpt.com' })
  // An `sh` without `pipefail`, as Debian 12's and Ubuntu 22.04's are: bash with its `set` turned off, first on the PATH.
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const path = process.env.PATH
  try {
    writeFileSync(join(dir, 'no-set'), 'unset BASH_ENV\nenable -n set\n')
    writeFileSync(join(dir, 'sh'), `#!/bin/bash\nBASH_ENV=${join(dir, 'no-set')} exec "$BASH" "$@"\n`, { mode: 0o755 })
    process.env.PATH = `${dir}:${path}`
    assert.equal(execFileSync('sh', ['-c', 'command set -o pipefail 2>/dev/null || echo none'], { encoding: 'utf8' }), 'none\n')
    await assert.rejects(realFix(download), { message: 'curl: (6) Could not resolve host: chatgpt.com' })
  } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an install needs no bash: on a computer with only sh, its command runs there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const path = process.env.PATH
  try {
    symlinkSync('/bin/sh', join(dir, 'sh'))
    writeFileSync(join(dir, 'codex'), '#!/bin/sh\necho logged-in\n', { mode: 0o755 })
    process.env.PATH = dir
    await realFix('codex login')
  } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the real readiness question: with the CLI logged out, an account added on that agent\'s own list is a login runs use', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-ready-'))
  const before = { PATH: process.env['PATH'], XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'] }
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\nif [ "$1" = --version ]; then echo 2.1.0; else echo \'{"loggedIn":false}\'; fi\n', { mode: 0o755 })
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\nif [ "$1" = --version ]; then echo 0.1.0; else echo "Not logged in"; exit 1; fi\n', { mode: 0o755 })
  try {
    process.env['PATH'] = `${dir}:/usr/bin:/bin`
    process.env['XDG_CONFIG_HOME'] = dir
    assert.equal((await realReady('claude-code')).problems.length, 1)
    assert.equal((await realReady('codex')).problems.length, 1)
    addAccount('Dani', 'x', accountsPath('claude'))
    assert.equal((await realReady('claude-code')).ownLoggedOut, true)
    assert.equal((await realReady('codex')).problems.length, 1)
    addAccount('Dani', 'codex-dani', accountsPath('codex'))
    assert.equal((await realReady('codex')).ownLoggedOut, true)
  } finally {
    process.env['PATH'] = before.PATH
    if (before.XDG_CONFIG_HOME === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before.XDG_CONFIG_HOME
    rmSync(dir, { recursive: true, force: true })
  }
})
