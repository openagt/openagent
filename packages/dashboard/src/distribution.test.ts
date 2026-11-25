import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHooks, DISTRIBUTION_ENV, LOCAL_HOST, distributionItems, loadHandedDown, packageDirOf } from '@openagt/hooks'

const DISTRIBUTION = fileURLToPath(new URL('./distribution.js', import.meta.url))

test("the distribution's modules load from its own install, the store's and the run pipeline's, and this computer's host is agent-driver's; ask and notifications-browser are the plugins it starts on, notifications-command, ui-renderer-mermaid, host-claude-web and host-github-actions among those off, and the git stores are on as their repositories say", async () => {
  const modules = await loadHandedDown({ [DISTRIBUTION_ENV]: DISTRIBUTION })
  assert.deepEqual(modules?.map(entry => entry.module.name), [
    'store-filesystem',
    'store-git-repository',
    'store-git-branch',
    'projects',
    'git-branches',
    'github',
    'skills',
    'agent-driver',
    'agent-driver-claude-code',
    'agent-driver-codex',
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
  ])
  // #2394: ask and the browser's notifications start on, every other plugin off; a git store keeps its own row, how its repository stands.
  assert.deepEqual(modules!.filter(entry => entry.module.plugin && entry.on).map(entry => entry.module.name), ['notifications-browser', 'ask'])
  assert.deepEqual(modules!.find(entry => entry.module.name === 'notifications-command')?.module.plugin, { scope: 'computer' }, 'notifications-command is kept per computer')
  assert.deepEqual(modules!.find(entry => entry.module.name === 'notifications-browser')?.module.plugin, { scope: 'person' }, 'notifications-browser is kept per person')
  assert.deepEqual(modules!.find(entry => entry.module.name === 'ui-renderer-mermaid')?.module.plugin, { scope: 'person' }, 'so is ui-renderer-mermaid')
  assert.deepEqual(modules!.find(entry => entry.module.name === 'host-claude-web')?.module.plugin, { scope: 'computer' }, 'host-claude-web is kept per computer: its browser and its token are this computer\'s')
  assert.deepEqual(modules!.find(entry => entry.module.name === 'host-github-actions')?.module.plugin, { scope: 'project' }, 'host-github-actions is kept per project')
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

test("openagent --uninstall is the install's: its help says what it takes off, and touches nothing", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./bin.js', import.meta.url)), '--uninstall', '--help'])
  assert.match(stdout, /^Usage: openagent --uninstall$/m)
  assert.match(stdout, /the `openagent`\s+command too/)
})

test("openagent is the dashboard's command serving this distribution: the version it says is this package's", async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./bin.js', import.meta.url)), '--version'])
  assert.equal(stdout.trim(), pkg.version)
})
