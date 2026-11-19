import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createHooks, DISTRIBUTION_ENV, LOCAL_HOST, loadHandedDown } from '@openagt/hooks'

const DISTRIBUTION = fileURLToPath(new URL('./distribution.js', import.meta.url))

test("the distribution's modules load from its own install, the run pipeline's, and this computer's host is agent-driver's", async () => {
  const modules = await loadHandedDown({ [DISTRIBUTION_ENV]: DISTRIBUTION })
  assert.deepEqual(
    modules?.map(entry => entry.module.name),
    ['git-branches', 'github', 'agent-driver'],
  )
  assert.deepEqual((await createHooks(modules!).hosts()).map(host => host.id), [LOCAL_HOST])
})

test("openagent is the dashboard's command serving this distribution: the version it says is this package's", async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./bin.js', import.meta.url)), '--version'])
  assert.equal(stdout.trim(), pkg.version)
})
