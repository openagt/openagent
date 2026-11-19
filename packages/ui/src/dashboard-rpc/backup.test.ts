import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, writeRemoteAccount, type ProvidedCommand } from '@openagt/agent-data'
import { loginsWiring } from './logins.js'
import { provideTestContext } from './test-context.js'
import { onBackup } from './backup.js'
import { sendSavePersonName, sendSyncPersonFromGitHub } from './person.js'

// What is not backed up, through the dashboard's calls: the personal folder under a temp
// $XDG_CONFIG_HOME, synced with a repository at GitHub with no account of OpenAgent's named. No
// talk with GitHub happens: with no account, git is never asked to go.

async function withComputer(body: (folder: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-backup-rpc-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...loginsWiring }
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  Object.assign(loginsWiring, {
    home: () => dir,
    gitHost: async () => ({ package: '@openagt/skill-github', command: 'github', dir }) as unknown as ProvidedCommand,
    run: async (_root: string, _command: ProvidedCommand, args: readonly string[]) => {
      if (args[0] === 'accounts') return { ok: true, output: { ok: true, host: 'github.com', name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts: [] } }
      if (args[0] === 'profile' && args[1] === 'ada') return { ok: true, output: { ok: true, login: 'ada', name: 'Ada Lovelace', avatar: 'https://avatars.githubusercontent.com/u/1' } }
      return { ok: false, error: `no answer for ${args.join(' ')}` }
    },
  })
  try {
    await body(join(process.env.XDG_CONFIG_HOME, 'openagent'))
  } finally {
    Object.assign(loginsWiring, before)
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

const git = nodeGitRunner()

test('a folder only on this computer, or backed up as an account of OpenAgent, is no gap; one at GitHub with none is, with what waits', async () => {
  await withComputer(async folder => {
    assert.deepEqual(await sendSavePersonName('Ada'), { ok: true })
    assert.deepEqual(await onBackup(), { gaps: [] })

    await git(['remote', 'add', 'origin', 'https://github.com/ada/agent.git'], folder)
    // The bug the notice is for: a change made with no account named is made, not failed.
    const synced = await sendSyncPersonFromGitHub('ada')
    assert.deepEqual(synced, { ok: true, changed: true, login: 'ada' })
    assert.match(readFileSync(join(folder, 'person.json'), 'utf8'), /Ada Lovelace/)
    const { gaps } = await onBackup()
    assert.equal(gaps.length, 1)
    assert.deepEqual({ ...gaps[0], waiting: undefined }, { kind: 'personal', address: 'github.com/ada/agent', url: 'https://github.com/ada/agent', host: 'github.com', waiting: undefined })
    assert.ok((gaps[0]!.waiting ?? 0) >= 1, 'the profile change waits')

    await writeRemoteAccount(folder, { login: 'ada-agent', host: 'github.com', config: [] }, git)
    assert.deepEqual(await onBackup(), { gaps: [] })
  })
})
