import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseMachineUrl } from './machine-url.js'

test('the address and the key come out of the line a machine prints', () => {
  assert.deepEqual(parseMachineUrl('  http://192.168.1.5:4200/?token=abc  '), { url: 'http://192.168.1.5:4200', token: 'abc' })
  assert.deepEqual(parseMachineUrl('https://box.tail.net/some/page?token=x%2By'), { url: 'https://box.tail.net', token: 'x+y' })
})

test('an address with no token has an empty key', () => {
  assert.deepEqual(parseMachineUrl('http://192.168.1.5:4200/'), { url: 'http://192.168.1.5:4200', token: '' })
})

test('what is not a web address is null', () => {
  for (const pasted of ['', 'not a url', 'localhost:4200/?token=abc', 'ftp://host/?token=abc']) assert.equal(parseMachineUrl(pasted), null, pasted)
})
