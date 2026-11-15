import { strict as assert } from 'node:assert'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { RPC_HANDLERS } from './index.js'
import { MACHINE_RPC_NAMES, RELAY_RPC_NAMES } from './relay-dispatch.js'

// The page calls the daemon by name (`dashboard/rpc/*.ts`): a name the daemon does not list answers
// "no such RPC", which no type catches, as an RPC added to its file but not to the list once did.

/** The names the page calls, from its typed stubs. */
async function pageCalls(): Promise<string[]> {
  // From dist-test/dashboard-rpc or src/dashboard-rpc alike: the package's own dashboard/rpc.
  const dir = fileURLToPath(new URL('../../dashboard/rpc/', import.meta.url))
  const names: string[] = []
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')))
    for (const match of (await readFile(dir + file, 'utf8')).matchAll(/rpc<[^>]*>\('([A-Za-z]+)'\)/g)) names.push(match[1]!)
  return names
}

test('every RPC the page calls is one the daemon answers', async () => {
  const names = await pageCalls()
  assert.ok(names.length > 50, 'the page calls are found')
  assert.deepEqual(names.filter(name => !(name in RPC_HANDLERS)), [])
})

test('every RPC the daemon answers is one something calls: the page, the relay, or another computer by its path', async () => {
  // The table is every function the RPC modules export, so a helper one of them exports for a
  // neighbour or a test is answered as a call too: one more way into the daemon, for nobody.
  // Another computer calls a few by their path through this computer's door (remote-run.ts).
  const sources = fileURLToPath(new URL('../', import.meta.url))
  const byPath: string[] = []
  for (const file of await readdir(sources, { recursive: true })) {
    if (!/\.(ts|js)$/.test(file) || /\.test\.|\.d\.ts$/.test(file)) continue
    for (const match of (await readFile(sources + file, 'utf8')).matchAll(/\/_rpc\/([A-Za-z]+)/g)) byPath.push(match[1]!)
  }
  // The devices package asks these of the daemon by name, for a server it sets up (servers/shared.ts).
  const byPackages = ['sendMachineLineLink', 'sendMachineLogins']
  const called = new Set([...(await pageCalls()), ...RELAY_RPC_NAMES, ...MACHINE_RPC_NAMES, ...byPath, ...byPackages])
  assert.deepEqual(Object.keys(RPC_HANDLERS).filter(name => !called.has(name)), [])
})
