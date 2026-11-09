import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { machineKind, reachedByLine } from './reached-by-line.js'

test('a saved machine at a loopback origin is a computer reached by its line, and one at an address on a network is not', () => {
  for (const url of ['http://127.0.0.1:4210', 'http://localhost:4210', 'http://[::1]:4210']) assert.equal(reachedByLine(url), true, url)
  for (const url of ['https://165.245.244.10', 'http://studio.local:4201', 'http://192.168.1.5:4200', 'http://127.evil.com:4210', 'https://127.0.0.1:4210', 'not an address', '']) {
    assert.equal(reachedByLine(url), false, url)
  }
})

test('a machine reached by its line is a computer, unless it said it is a server: then it is a server at home', () => {
  const line = { label: 'experiment', url: 'http://127.0.0.1:4210' }
  assert.equal(machineKind(line).kind, 'computer')
  assert.deepEqual(machineKind({ ...line, server: true }), { kind: 'home', place: 'Server at home' })
  // Another person's computer stays theirs, and a server reached directly stays a server.
  assert.equal(machineKind({ ...line, server: true, owner: 'Dani' }).kind, 'shared')
  // Another person's computer is said as theirs, shared with this person: through a server, or at its own door.
  assert.deepEqual(machineKind({ label: 'dani-pc', url: 'https://dani-pc.tail1234.ts.net', owner: 'Dani' }), { kind: 'shared', place: "Dani's, shared with you" })
  assert.deepEqual(machineKind({ label: 'rom-box (through 165.245.244.10)', url: 'https://165.245.244.10/_devices/via/abc123', owner: 'Rom' }), { kind: 'shared', place: "Rom's, shared with you, through 165.245.244.10" })
  assert.equal(machineKind({ label: 'vps', url: 'https://165.245.244.10', server: true }).kind, 'server')
})
