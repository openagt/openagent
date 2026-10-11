import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMachineLink } from './machine-link.js'

test('a link is read as where the machine answers, where this computer is let in, and the code', () => {
  assert.deepEqual(parseMachineLink('  http://studio.local:4201/_remote-access/enter#abc123  '), {
    url: 'http://studio.local:4201',
    door: 'http://studio.local:4201/_remote-access/enter',
    code: 'abc123',
  })
  assert.deepEqual(parseMachineLink('https://203.0.113.5/_remote-access/enter?x=1#c-_9'), {
    url: 'https://203.0.113.5',
    door: 'https://203.0.113.5/_remote-access/enter',
    code: 'c-_9',
  })
})

test('a server\'s link also says what its key is known by, after the code', () => {
  assert.deepEqual(parseMachineLink('https://203.0.113.5/_remote-access/enter#c0de.Zm9vYmFy_-0'), {
    url: 'https://203.0.113.5',
    door: 'https://203.0.113.5/_remote-access/enter',
    code: 'c0de',
    pin: 'Zm9vYmFy_-0',
  })
  assert.equal(parseMachineLink('https://203.0.113.5/_remote-access/enter#.Zm9v'), null) // no code
  assert.equal('pin' in parseMachineLink('https://203.0.113.5/_remote-access/enter#c0de.')!, false)
  // A link that names a key and is not HTTPS is no link: its machine would be called with no key to know it by.
  assert.equal(parseMachineLink('http://203.0.113.5/_remote-access/enter#c0de.Zm9v'), null)
})

test('a link with no code, and a line that is no web address, are no link', () => {
  assert.equal(parseMachineLink('http://studio.local:4201/_remote-access/enter'), null)
  assert.equal(parseMachineLink('http://studio.local:4201/_remote-access/enter#'), null)
  assert.equal(parseMachineLink('studio.local:4201/_remote-access/enter#abc'), null)
  assert.equal(parseMachineLink('not a link'), null)
  assert.equal(parseMachineLink(''), null)
})
