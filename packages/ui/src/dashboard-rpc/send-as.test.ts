import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, readRemoteAccount, type ProvidedCommand } from '@openagt/agent-data'
import { loginsWiring } from './logins.js'
import { provideTestContext } from './test-context.js'
import { sendPersonalFolderAs, sendSyncPersonalFolder } from './personal-folder.js'
import { originAccountOf, remoteAccount } from './send-as.js'

// The account OpenAgent sends a repository as, through the dashboard's calls: GitHub's accounts and
// the settings for one as the host's package would answer them.

const CONFIG: [string, string][] = [['credential.https://github.com.helper', '!echo octo-agent']]

async function withComputer(body: (dir: string, asked: string[][]) => Promise<void>, logins: string[] = ['octo', 'octo-agent']): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-send-as-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...loginsWiring }
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  const asked: string[][] = []
  Object.assign(loginsWiring, {
    home: () => dir,
    gitHost: async () => ({ package: '@openagt/skill-github', command: 'github', dir }) as unknown as ProvidedCommand,
    run: async (_root: string, _command: ProvidedCommand, args: readonly string[]) => {
      asked.push([...args])
      if (args[0] === 'accounts') return { ok: true, output: { ok: true, host: 'github.com', name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts: logins.map((login, i) => ({ login, runs: i === 0, ok: true })) } }
      if (args[0] === 'git-config' && logins.includes(args[2]!)) return { ok: true, output: { ok: true, login: args[2], host: 'github.com', config: CONFIG } }
      return { ok: false, error: `OpenAgent has no GitHub account ${args[2]} on this computer` }
    },
  })
  try {
    await body(dir, asked)
  } finally {
    Object.assign(loginsWiring, before)
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test("an account is what its git host's package says of it; none named, or none the package has, is refused in words", () =>
  withComputer(async (_dir, asked) => {
    assert.deepEqual(await remoteAccount('github.com', 'octo-agent'), { ok: true, account: { login: 'octo-agent', host: 'github.com', config: CONFIG } })
    assert.deepEqual(asked.at(-1), ['git-config', '--user', 'octo-agent'])
    const none = await remoteAccount('github.com', undefined)
    assert.equal(none.ok, false)
    assert.match((none as { error: string }).error, /OpenAgent sends nothing to github\.com as your own login.*Permissions/)
    assert.equal((await remoteAccount('github.com', 'stranger')).ok, false)
  }))

test("a repository's branches are pushed as the account kept at its Share switch, else the one runs use; a folder remote needs none", () =>
  withComputer(async dir => {
    const git = nodeGitRunner()
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    await git(['init', '-q'], repo)
    assert.deepEqual(await originAccountOf(repo), { ok: true }, 'no origin')
    await git(['remote', 'add', 'origin', join(dir, 'origin.git')], repo)
    assert.deepEqual(await originAccountOf(repo), { ok: true }, 'a folder on this disk asks no login')
    await git(['remote', 'set-url', 'origin', 'git@github.com:me/shop.git'], repo)
    assert.deepEqual(await originAccountOf(repo), { ok: true, account: { login: 'octo', host: 'github.com', config: CONFIG } }, 'the one runs use')
  }))

test("with no account of OpenAgent's at the host, the personal folder is not synced, and keeps no remote", () =>
  withComputer(async () => {
    // A GitHub address: the repository there is never reached as the person's own login.
    const refused = await sendSyncPersonalFolder('github.com/me/agent', undefined)
    assert.equal(refused.ok, false)
    assert.match((refused as { error: string }).error, /as your own login.*add one in Permissions/, 'refused before the repository is asked, saying where an account is added')
    assert.deepEqual(await sendPersonalFolderAs('octo-agent'), { ok: false, error: 'Your folder syncs with no repository on a git host.' })
    assert.equal(await readRemoteAccount(join(process.env.XDG_CONFIG_HOME!, 'openagent')).catch(() => undefined), undefined)
  }, []))
