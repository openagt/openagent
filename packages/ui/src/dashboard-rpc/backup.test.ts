import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, writeRemoteAccount, type ProvidedCommand } from '@openagt/agent-data'
import { loginsWiring } from './logins.js'
import { provideTestContext } from './test-context.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { onBackup } from './backup.js'
import { callModule } from './module-calls.js'

handDownTestDistribution()

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

/** Settings › Profile's save of the person's name, as the page makes it: a change saved with the person, in their folder. */
const saveName = (name: string) => callModule(null, '@openagt/user-info', 'saveName', { name })

test('a folder only on this computer, or backed up as an account of OpenAgent, is no gap; one at GitHub with none is, with what waits', async () => {
  await withComputer(async folder => {
    assert.deepEqual(await saveName('Ada'), { ok: true, output: null })
    assert.deepEqual(await onBackup(), { gaps: [] })

    await git(['remote', 'add', 'origin', 'https://github.com/ada/agent.git'], folder)
    // The bug the notice is for: a change made with no account named is made, not failed.
    assert.deepEqual(await saveName('Ada Lovelace'), { ok: true, output: null })
    assert.match(readFileSync(join(folder, 'person', 'settings.json'), 'utf8'), /Ada Lovelace/)
    const { gaps } = await onBackup()
    assert.equal(gaps.length, 1)
    assert.deepEqual({ ...gaps[0], waiting: undefined }, { kind: 'personal', address: 'github.com/ada/agent', url: 'https://github.com/ada/agent', host: 'github.com', waiting: undefined })
    assert.ok((gaps[0]!.waiting ?? 0) >= 1, 'the profile change waits')

    await writeRemoteAccount(folder, { login: 'ada-agent', host: 'github.com', config: [] }, git)
    assert.deepEqual(await onBackup(), { gaps: [] })
  })
})
