import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHooks, DISTRIBUTION_ENV, LOCAL_HOST, distributionItems, loadHandedDown, packageDirOf } from '@openagt/hooks'

const DISTRIBUTION = fileURLToPath(new URL('./distribution.js', import.meta.url))

test("the distribution's modules load from its own install, the store's and the run pipeline's, and this computer's host is agent-driver's; ask is the one plugin it starts on, devices and notifications-command among those off, and the git stores are on as their repositories say", async () => {
  const modules = await loadHandedDown({ [DISTRIBUTION_ENV]: DISTRIBUTION })
  assert.deepEqual(modules?.map(entry => entry.module.name), [
    'store-filesystem',
    'store-git-repository',
    'store-git-branch',
    'git-branches',
    'github',
    'skills',
    'agent-driver',
    'devices',
    'notifications-command',
    'ask',
    'logs',
    'tickets',
    'queue',
    'browser',
    'scheduled-agents',
    'discord',
    'github-auto-reply',
  ])
  // #2394: ask starts on, every other plugin off; a git store keeps its own row, how its repository stands.
  assert.deepEqual(modules!.filter(entry => entry.module.plugin && entry.on).map(entry => entry.module.name), ['ask'])
  assert.deepEqual(modules!.find(entry => entry.module.name === 'devices')?.module.plugin, { scope: 'computer' }, 'devices is kept per computer')
  assert.deepEqual(modules!.find(entry => entry.module.name === 'notifications-command')?.module.plugin, { scope: 'computer' }, 'so is notifications-command')
  assert.deepEqual(modules!.filter(entry => entry.module.plugin?.row).map(entry => entry.module.name), ['store-git-repository', 'store-git-branch'])
  assert.deepEqual((await createHooks(modules!).hosts()).map(host => host.id), [LOCAL_HOST])
})

test('every package the distribution lists is one of its own dependencies, installed beside it', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
  for (const item of await distributionItems(DISTRIBUTION)) {
    if ('module' in item) continue
    assert.ok(Object.hasOwn(pkg.dependencies, item.package), `${item.package} is a dependency`)
    assert.ok(await packageDirOf(DISTRIBUTION, item.package))
  }
})

test("openagent is the dashboard's command serving this distribution: the version it says is this package's", async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./bin.js', import.meta.url)), '--version'])
  assert.equal(stdout.trim(), pkg.version)
})
