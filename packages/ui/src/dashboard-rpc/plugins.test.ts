import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '../project-id.js'
import { listTestProject } from '../test-projects.js'
import { packagesOf } from '../distribution-packages.js'
import { handDownTestDistribution } from '../test-distribution.js'
import { onComputerPlugins, onProjectPlugins, sendSwitchPlugin } from './plugins.js'
import { provideTestContext } from './test-context.js'

handDownTestDistribution()
provideTestContext()

test("Settings › Plugins lists the distribution's plugins with their rows, the ones kept per project in a project and the others in the first group, and switches each where it is kept; a git store, which keeps its own row, on its own entry", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-plugins-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const shop = join(dir, 'shop')
    await mkdir(shop)
    await listTestProject(shop, '2026-09-19T00:00:00.000Z')
    const id = projectId(shop)
    const rows = await onProjectPlugins(id)
    assert.deepEqual(
      rows?.map(row => `${row.name} ${row.on ? 'on' : 'off'}`),
      ['store-git-branch off', 'ask on', 'logs off', 'tickets off', 'queue off', 'browser off', 'scheduled-agents off', 'discord off', 'github-auto-reply off', 'host-github-actions off'],
      'in the distribution\'s order, ask on as it starts, and the project\'s data not shared',
    )
    assert.ok(rows!.every(row => row.scope === 'project' && row.description.length > 0), 'each says what it is')
    assert.deepEqual(rows!.flatMap(row => (row.settings ? [`${row.name} ${row.settings}`] : [])), ['store-git-branch project-agent-data'], 'a git store is switched on its own entry')
    assert.deepEqual(
      (await onComputerPlugins()).map(row => `${row.name} ${row.scope} ${row.on ? 'on' : 'off'} ${row.settings}`),
      ['store-git-repository computer off agent-data', 'notifications-command computer off undefined', 'notifications-browser person on undefined', 'ui-renderer-mermaid person off undefined', 'host-claude-web computer off undefined'],
      'the folder syncs with no repository yet, notifications-command, ui-renderer-mermaid and host-claude-web start off, and notifications-browser on',
    )

    assert.deepEqual(await sendSwitchPlugin('tickets', true, id), { ok: true })
    assert.equal((await onProjectPlugins(id))?.find(row => row.name === 'tickets')?.on, true)
    assert.ok((await packagesOf(shop)).some(pkg => pkg.name === '@openagt/tickets'), 'its package is the project\'s')
    assert.deepEqual(await sendSwitchPlugin('ask', false, id), { ok: true })
    assert.equal((await onProjectPlugins(id))?.find(row => row.name === 'ask')?.on, false)
    assert.deepEqual(await sendSwitchPlugin('notifications-command', true), { ok: true })
    assert.equal((await onComputerPlugins()).find(row => row.name === 'notifications-command')?.on, true, 'one kept per computer is switched with no project')

    assert.deepEqual(await sendSwitchPlugin('tickets', true), { ok: false, error: 'tickets is switched in a project.' })
    assert.deepEqual(await sendSwitchPlugin('tickets', true, 'nowhere-1'), { ok: false, error: 'That project is not on this computer.' })
    assert.deepEqual(await sendSwitchPlugin('github', false, id), { ok: false, error: 'github is a core module, always on' })
    assert.deepEqual(await sendSwitchPlugin('store-git-branch', true, id), { ok: false, error: 'store-git-branch keeps its own row: it is switched on its Settings entry' })
    assert.deepEqual(await sendSwitchPlugin('store-git-repository', true), { ok: false, error: 'store-git-repository keeps its own row: it is switched on its Settings entry' })
    assert.deepEqual(await sendSwitchPlugin('nothing', true), { ok: false, error: 'No module is named nothing' })
    assert.equal(await onProjectPlugins('nowhere-1'), null)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
