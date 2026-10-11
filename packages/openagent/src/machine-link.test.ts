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

test('a link with no code, and a line that is no web address, are no link', () => {
  assert.equal(parseMachineLink('http://studio.local:4201/_remote-access/enter'), null)
  assert.equal(parseMachineLink('http://studio.local:4201/_remote-access/enter#'), null)
  assert.equal(parseMachineLink('studio.local:4201/_remote-access/enter#abc'), null)
  assert.equal(parseMachineLink('not a link'), null)
  assert.equal(parseMachineLink(''), null)
})
