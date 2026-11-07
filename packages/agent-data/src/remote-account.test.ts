import { strict as assert } from 'node:assert'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nodeGitRunner, type GitRunner } from './git.js'
import { NoRemoteAccountError, accountGit, readRemoteAccount, remoteHostOf, writeRemoteAccount, type RemoteAccount } from './remote-account.js'

const ACCOUNT: RemoteAccount = {
  login: 'octo-agent',
  host: 'github.com',
  config: [
    ['credential.https://github.com.helper', '!f() { GH_CONFIG_DIR=/x gh auth git-credential "$@"; }; f'],
    ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ],
}

/** git as a fake: origin is `url`, the account kept is `kept`; every other call is written down. */
function fakeGit(url: string, kept?: RemoteAccount): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const git: GitRunner = async args => {
    if (args.join(' ') === 'remote get-url origin') return `${url}\n`
    if (args[0] === 'config') {
      const key = args.at(-1)
      if (!kept) throw new Error('unset')
      if (key === 'agent-data.account') return kept.login
      if (key === 'agent-data.host') return kept.host
      if (key === 'agent-data.config') return kept.config.map(([k, v]) => `${k}=${v}`).join('\n')
    }
    calls.push(args)
    return ''
  }
  return { git, calls }
}

test("a push to a repository at a host goes as the account kept for it: the person's credential helpers dropped, the account's settings in their place", async () => {
  const { git, calls } = fakeGit('git@github.com:me/agent.git', ACCOUNT)
  await accountGit(git)(['push', '-q', 'origin', 'HEAD:refs/heads/main'], '/repo')
  assert.deepEqual(calls, [['-c', 'credential.helper=', '-c', `credential.https://github.com.helper=${ACCOUNT.config[0]![1]}`, '-c', 'url.https://github.com/.insteadOf=git@github.com:', 'push', '-q', 'origin', 'HEAD:refs/heads/main']])
})

test('with no account kept, a talk with a repository at a host is refused, and git is never asked to go', async () => {
  for (const args of [['push', 'origin', 'main'], ['fetch', '-q', 'origin', 'main'], ['ls-remote', '--heads', 'origin']]) {
    const { git, calls } = fakeGit('https://github.com/me/agent.git')
    await assert.rejects(accountGit(git)(args, '/repo'), (err: unknown) => err instanceof NoRemoteAccountError && /OpenAgent sends nothing to github\.com as your own login/.test(err.message))
    assert.deepEqual(calls, [])
  }
})

test('an account at another host is refused too; a repository in a folder on this disk asks no login and goes as it is; other commands are untouched', async () => {
  const elsewhere = fakeGit('https://gitlab.com/me/agent.git', ACCOUNT)
  await assert.rejects(accountGit(elsewhere.git)(['push', 'origin', 'main'], '/repo'), /@octo-agent is at github\.com/)
  const folder = fakeGit('/Users/me/agent.git')
  await accountGit(folder.git)(['push', 'origin', 'main'], '/repo')
  await accountGit(folder.git)(['commit', '-m', 'x'], '/repo')
  assert.deepEqual(folder.calls, [['push', 'origin', 'main'], ['commit', '-m', 'x']])
  // An account handed in is used without asking the repository's config.
  const given = fakeGit('https://github.com/me/agent.git')
  await accountGit(given.git, ACCOUNT)(['fetch', 'origin'], '/repo')
  assert.equal(given.calls[0]?.[1], 'credential.helper=')
})

test("the account is kept in the repository's own config, and read back whole", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'remote-account-')))
  try {
    const git = nodeGitRunner()
    await git(['init', '-q'], repo)
    assert.equal(await readRemoteAccount(repo, git), undefined)
    await writeRemoteAccount(repo, ACCOUNT, git)
    assert.deepEqual(await readRemoteAccount(repo, git), ACCOUNT)
    await writeRemoteAccount(repo, { login: 'other', host: 'github.com', config: [['a.b', 'c=d']] }, git)
    assert.deepEqual(await readRemoteAccount(repo, git), { login: 'other', host: 'github.com', config: [['a.b', 'c=d']] }, 'in place of the one before')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('the host of a remote: scp-like, ssh and https addresses; none for a folder or a file address', () => {
  assert.equal(remoteHostOf('git@github.com:me/a.git'), 'github.com')
  assert.equal(remoteHostOf('ssh://git@GitHub.com:22/me/a'), 'github.com')
  assert.equal(remoteHostOf('https://github.com/me/a.git'), 'github.com')
  assert.equal(remoteHostOf('/Users/me/a.git'), undefined)
  assert.equal(remoteHostOf('file:///Users/me/a.git'), undefined)
})
