import { strict as assert } from 'node:assert'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { RPC_HANDLERS } from './index.js'

// The page calls the daemon by name (`dashboard/rpc/*.ts`): a name the daemon does not list answers
// "no such RPC", which no type catches, as an RPC added to its file but not to the list once did.

test('every RPC the page calls is one the daemon answers', async () => {
  // From dist-test/dashboard-rpc or src/dashboard-rpc alike: the package's own dashboard/rpc.
  const dir = fileURLToPath(new URL('../../dashboard/rpc/', import.meta.url))
  const names: string[] = []
  for (const file of (await readdir(dir)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')))
    for (const match of (await readFile(dir + file, 'utf8')).matchAll(/rpc<[^>]*>\('([A-Za-z]+)'\)/g)) names.push(match[1]!)
  assert.ok(names.length > 50, 'the page calls are found')
  assert.deepEqual(names.filter(name => !(name in RPC_HANDLERS)), [])
})
