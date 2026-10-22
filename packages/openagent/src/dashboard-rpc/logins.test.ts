import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProvidedCommand } from '@openagt/agent-data'
import { addAccount } from '@openagt/agent-driver-claude'
import { addProject, listProjects } from '../registry.js'
import { readProvider, remoteHost } from '../dashboard/git-hosts.js'
import { accountsWiring } from './accounts.js'
import { loginsWiring, onAgentState, onGitHosts, onProjectAccounts, sendAgentFix, sendGitHostLogin, sendProjectAccounts, sendUseGitHostAccount } from './logins.js'
import { provideTestContext } from './test-context.js'

// Settings › Git hosts, the agent's own fix, and a project's own accounts: drawn from what the
// git host's package and the agent's package answer, never naming either.

const GITHUB: ProvidedCommand = { name: 'github', bin: '/pkg/github', package: '@openagt/skill-github' } as ProvidedCommand

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
  Object.assign(accountsWiring, { path: () => join(dir, 'claude-accounts.json'), claudeJson: () => join(dir, 'none.json') })
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
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

test('the agent: what is in the way and the fix its package declared; a press runs that fix, never a command from the page, and says why it failed', async () => {
  const before = { ...loginsWiring }
  let ready = false
  const ran: string[] = []
  let finish: (err?: Error) => void = () => {}
  Object.assign(loginsWiring, {
    ready: async () => (ready ? { problems: [], warnings: [] } : { problems: ['`claude` is not logged in.'], warnings: [], fix: { kind: 'log-in', command: 'claude auth login' } }),
    fix: (command: string) => {
      ran.push(command)
      return new Promise<void>((resolve, reject) => {
        finish = err => (err ? reject(err) : resolve())
      })
    },
  })
  try {
    assert.deepEqual(await onAgentState('claude-code'), { driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' } })
    assert.equal((await sendAgentFix('claude-code')).ok, true)
    assert.equal((await onAgentState('claude-code')).fixing, 'log-in')
    assert.equal((await sendAgentFix('claude-code')).ok, false, 'one at a time')
    finish(new Error('No yes came from the browser.'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await onAgentState('claude-code')).failed, 'No yes came from the browser.')
    assert.deepEqual(ran, ['claude auth login'])
    ready = true
    assert.deepEqual(await onAgentState('claude-code'), { driver: 'claude-code', ready: true })
    assert.deepEqual(await sendAgentFix('claude-code'), { ok: false, error: 'Nothing to fix by a press: see the line it says.' })
    assert.equal((await sendAgentFix('rm -rf')).ok, false)
  } finally {
    Object.assign(loginsWiring, before)
  }
})

test('a project’s own accounts: offered for a kind the computer has two or more of; saved in its runner config, never in the repository; an account the computer does not know is refused', () =>
  withProjects(async dirs => {
    const id = (await listProjects()).find(p => p.path === dirs.github)!.id
    let view = await onProjectAccounts(id)
    assert.deepEqual(view?.gitHost, { host: 'github.com', name: 'GitHub', requestWord: 'pull request', accounts: ['octo', 'octo-agent'], computer: 'octo' })
    assert.equal(view?.claude, undefined, 'one Claude account: nothing to pick')

    addAccount('Dani', 'sk-ant-oat01-dani', accountsWiring.path())
    assert.deepEqual((await sendProjectAccounts(id, { gitHost: 'octo-agent', claude: ['Dani'] })).ok, true)
    assert.match(readFileSync(join(dirs.github, '.agent-runner', 'config.yml'), 'utf8'), /git-host: octo-agent/)
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dirs.github, encoding: 'utf8' }), '', 'git sees nothing of it')
    view = await onProjectAccounts(id)
    assert.equal(view?.gitHost?.project, 'octo-agent')
    assert.deepEqual(view?.claude?.project, ['Dani'])

    assert.equal((await sendProjectAccounts(id, { gitHost: 'stranger' })).ok, false)
    assert.equal((await sendProjectAccounts(id, { claude: ['Nobody'] })).ok, false)
    assert.equal((await sendProjectAccounts(id, { gitHost: null, claude: null })).ok, true)
    view = await onProjectAccounts(id)
    assert.equal(view?.gitHost?.project, undefined)
  }))

test('a project’s own git host account is not offered while the computer has one account there', () =>
  withProjects(
    async dirs => {
      const id = (await listProjects()).find(p => p.path === dirs.github)!.id
      assert.deepEqual(await onProjectAccounts(id), {})
    },
    [{ login: 'octo', terminal: true, runs: true }],
  ))
