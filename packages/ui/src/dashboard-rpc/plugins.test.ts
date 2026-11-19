import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '@openagt/agent-data'
import { addProject } from '../registry.js'
import { packagesOf } from '../distribution-packages.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { onComputerPlugins, onProjectPlugins, sendSwitchPlugin } from './plugins.js'
import { provideTestContext } from './test-context.js'

handDownTestDistribution()
provideTestContext()

test("Settings › Plugins lists the distribution's plugins with their rows, the ones kept per project in a project and the others in the first group, and switches each where it is kept", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-plugins-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const shop = join(dir, 'shop')
    await mkdir(shop)
    await addProject(shop, '2026-09-19T00:00:00.000Z')
    const id = projectId(shop)
    const rows = await onProjectPlugins(id)
    assert.deepEqual(
      rows?.map(row => `${row.name} ${row.on ? 'on' : 'off'}`),
      ['ask on', 'logs off', 'tickets off', 'queue off', 'browser off', 'scheduled-agents off', 'discord off', 'plan off', 'plan-tickets off', 'github-auto-reply off', 'triage off', 'update-tickets off', 'work-queue off'],
      'in the distribution\'s order, ask on as it starts',
    )
    assert.ok(rows!.every(row => row.scope === 'project' && row.description.length > 0), 'each says what it is')
    assert.deepEqual((await onComputerPlugins()).map(row => `${row.name} ${row.scope} ${row.on ? 'on' : 'off'}`), ['store-git-repository computer off'])

    assert.deepEqual(await sendSwitchPlugin('tickets', true, id), { ok: true })
    assert.equal((await onProjectPlugins(id))?.find(row => row.name === 'tickets')?.on, true)
    assert.ok((await packagesOf(shop)).some(pkg => pkg.name === '@openagt/skill-tickets'), 'its package is the project\'s')
    assert.deepEqual(await sendSwitchPlugin('ask', false, id), { ok: true })
    assert.equal((await onProjectPlugins(id))?.find(row => row.name === 'ask')?.on, false)

    assert.deepEqual(await sendSwitchPlugin('tickets', true), { ok: false, error: 'tickets is switched in a project.' })
    assert.deepEqual(await sendSwitchPlugin('tickets', true, 'nowhere-1'), { ok: false, error: 'That project is not on this computer.' })
    assert.deepEqual(await sendSwitchPlugin('github', false, id), { ok: false, error: 'github is a core module, always on' })
    assert.deepEqual(await sendSwitchPlugin('nothing', true), { ok: false, error: 'No module is named nothing' })
    assert.equal(await onProjectPlugins('nowhere-1'), null)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
