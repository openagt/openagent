import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Heard, announcement, asksFor, lookingFor, parse, SERVICE } from './wifi.js'

const studio = { name: "Studio Mac's", version: '0.36.0', port: 4201, address: '192.168.1.5' }

test('a door says its name, its version and its port; what another computer hears is where to ask it', () => {
  const heard = new Heard()
  heard.add(announcement(studio), '192.168.1.5')
  heard.add(announcement({ name: 'Dani’s iMac', port: 4301, address: '192.168.1.9' }), '192.168.1.9')
  assert.deepEqual(heard.found(), [
    { name: "Studio Mac's", version: '0.36.0', url: 'http://192.168.1.5:4201' },
    { name: 'Dani’s iMac', url: 'http://192.168.1.9:4301' },
  ])
})

test('the number an answer comes from counts over the one it says: the network may have handed it another', () => {
  const heard = new Heard()
  heard.add(announcement(studio), '192.168.1.77')
  assert.equal(heard.found()[0]!.url, 'http://192.168.1.77:4201')
})

test('a door that closes says so, and is not listed', () => {
  const heard = new Heard()
  heard.add(announcement(studio), '192.168.1.5')
  heard.add(announcement(studio, true), '192.168.1.5')
  assert.deepEqual(heard.found(), [])
})

test('a door answers a computer that looks for OpenAgent, and nothing else; a question is no answer', () => {
  assert.equal(asksFor(lookingFor(), studio), true)
  assert.equal(asksFor(announcement(studio), studio), false)
  const heard = new Heard()
  heard.add(lookingFor(), '192.168.1.5')
  assert.deepEqual(heard.found(), [])
  assert.deepEqual(parse(lookingFor()).questions, [{ name: SERVICE, type: 12 }])
})

test('a packet that is no packet, or whose names point in a loop, is passed over', () => {
  const loop = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12, 0, 12, 0, 1, 0, 0, 0, 120, 0, 0])
  assert.throws(() => parse(loop))
  const heard = new Heard()
  for (const bad of [Buffer.alloc(3), loop, Buffer.from('not a packet at all, but long enough')]) heard.add(bad, '192.168.1.5')
  assert.equal(asksFor(loop, studio), false)
  assert.deepEqual(heard.found(), [])
})
