import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DISTRIBUTION_ENV, LOCAL_HOST } from '@openagt/hooks'
import { loadHooks, localHostOf } from '../distribution-hooks.js'
import { handDownDistribution } from './distribution.js'

const DEMO = fileURLToPath(new URL('../e2e/distribution.js', import.meta.url))

test("the distribution handed down is the file of the command's own distribution, in place of one the process inherited", () => {
  const env: NodeJS.ProcessEnv = { [DISTRIBUTION_ENV]: '/a/run/before/distribution.js' }
  handDownDistribution(env, '/dashboard/dist/distribution.js')
  assert.equal(env[DISTRIBUTION_ENV], '/dashboard/dist/distribution.js')
})

test("the dashboard runs the modules of the distribution handed down, and this computer's host is its agent-driver's; with none, it runs none", async () => {
  const hooks = await loadHooks({ [DISTRIBUTION_ENV]: DEMO })
  assert.deepEqual(hooks.modules.map(module => module.name), [
    'store-filesystem',
    'store-git-repository',
    'store-git-branch',
    'projects',
    'git-branches',
    'github',
    'skills',
    'agent-driver-claude-code',
    'agent-driver-codex',
    // The plugins, ask and notifications-browser on until a person switches them off: those kept per computer or per person first.
    'notifications-command',
    'notifications-browser',
    'ui-renderer-mermaid',
    'host-claude-web',
    'ask',
    'logs',
    'tickets',
    'queue',
    'browser',
    'scheduled-agents',
    'discord',
    'github-auto-reply',
    'host-github-actions',
    'agent-driver',
  ])
  assert.equal((await localHostOf(hooks)).id, LOCAL_HOST)
  await assert.rejects(loadHooks({}), /none was handed to it \(OPENAGENT_DISTRIBUTION\)/)
})
