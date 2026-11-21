import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { rpcKind } from '@openagt/hooks/rpc'
import * as server from './server.js'

test("the server part is the card's three reads, each a read, and changes go through the command", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(server).map(([name, fn]) => [name, rpcKind(fn)])), { list: 'read', usage: 'read', adding: 'read' })
})
