import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { reachedByLine } from './reached-by-line.js'

test('a saved machine at a loopback origin is a computer reached by its line, and one at an address on a network is not', () => {
  for (const url of ['http://127.0.0.1:4210', 'http://localhost:4210', 'http://[::1]:4210']) assert.equal(reachedByLine(url), true, url)
  for (const url of ['https://165.245.244.10', 'http://studio.local:4201', 'http://192.168.1.5:4200', 'http://127.evil.com:4210', 'https://127.0.0.1:4210', 'not an address', '']) {
    assert.equal(reachedByLine(url), false, url)
  }
})
