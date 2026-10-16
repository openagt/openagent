import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FRAME, jpegSize, MAX_PART, MAX_SMALL, MAX_STATE, MAX_URL, readActed, readCursor, readState, STATE, streamPart, streamReader } from './stream.js'

const bytes = (...values: number[]) => new Uint8Array(values)

test('the messages of a stream are read whatever the size of the pieces it arrives in', () => {
  const whole = new Uint8Array([...streamPart(FRAME, bytes(1, 2, 3)), ...streamPart(STATE, new TextEncoder().encode('{"url":"http://a/","title":"A"}')), ...streamPart(FRAME, bytes())])
  for (const size of [1, 2, 5, 7, whole.length]) {
    const read = streamReader()
    const parts = []
    for (let at = 0; at < whole.length; at += size) parts.push(...read(whole.subarray(at, at + size)))
    assert.deepEqual(parts.map(part => part.kind), [FRAME, STATE, FRAME], `in pieces of ${size}`)
    assert.deepEqual([...parts[0]!.bytes], [1, 2, 3])
    assert.deepEqual(readState(parts[1]!.bytes), { url: 'http://a/', title: 'A' })
    assert.equal(parts[2]!.bytes.length, 0)
  }
})

test('a message longer than any picture is no message of a screen', () => {
  const head = new Uint8Array(5)
  head[0] = FRAME
  new DataView(head.buffer).setUint32(1, MAX_PART + 1)
  assert.throws(() => streamReader()(head), /not a screen/)
})

test('what the address bar says is read only when it is what a screen says', () => {
  const said = (text: string) => readState(new TextEncoder().encode(text))
  assert.equal(said('not json'), undefined)
  assert.equal(said('null'), undefined)
  assert.equal(said('{"url":1,"title":"A"}'), undefined)
  assert.deepEqual(said('{"url":"","title":""}'), { url: '', title: '' })
})

test('a message sent a few bytes at a time is read whole, and fast', () => {
  const picture = new Uint8Array(MAX_PART).fill(7)
  const whole = streamPart(FRAME, picture)
  const read = streamReader()
  const started = Date.now()
  const parts = []
  for (let at = 0; at < whole.length; at += 64) parts.push(...read(whole.subarray(at, at + 64)))
  assert.equal(parts.length, 1)
  assert.equal(parts[0]!.bytes.length, MAX_PART)
  assert.ok(parts[0]!.bytes.every(byte => byte === 7))
  assert.ok(Date.now() - started < 2_000, 'joined once, not copied at every piece')
})

test('what the address bar says is bounded: an address is cut, and a message too long for one says nothing', () => {
  const said = (value: object) => readState(new TextEncoder().encode(JSON.stringify(value)))
  assert.equal(said({ url: `http://a/${'x'.repeat(5000)}`, title: 'A' })?.url.length, MAX_URL)
  assert.equal(said({ url: 'http://a/', title: 'x'.repeat(MAX_STATE) }), undefined)
})

test('the cursor a screen passes on is a CSS keyword and nothing a page made up', () => {
  const said = (value: unknown) => readCursor(new TextEncoder().encode(JSON.stringify(value)))
  assert.equal(said({ cursor: 'pointer' }), 'pointer')
  assert.equal(said({ cursor: 'grabbing' }), 'grabbing')
  // A page naming a picture of its own would have whoever watches fetch it: no cursor at all.
  assert.equal(said({ cursor: 'url(http://a.test/x.png), pointer' }), undefined)
  assert.equal(said({ cursor: 'expression(alert(1))' }), undefined)
  assert.equal(said({ cursor: 1 }), undefined)
  assert.equal(said(null), undefined)
  assert.equal(readCursor(new TextEncoder().encode('not json')), undefined)
  assert.equal(said({ cursor: 'pointer', pad: 'x'.repeat(MAX_SMALL) }), undefined, 'longer than a cursor ever is')
})

test('where the agent acted is read only when it is a point of a picture', () => {
  const said = (value: unknown) => readActed(new TextEncoder().encode(JSON.stringify(value)))
  assert.deepEqual(said({ x: 12, y: 34, act: 'click' }), { x: 12, y: 34, act: 'click' })
  assert.deepEqual(said({ x: 0, y: 0, act: 'type' }), { x: 0, y: 0, act: 'type' })
  assert.equal(said({ x: -1, y: 0, act: 'click' }), undefined)
  assert.equal(said({ x: 1e6, y: 0, act: 'click' }), undefined)
  assert.equal(said({ x: 1, y: Number.NaN, act: 'click' }), undefined)
  assert.equal(said({ x: '1', y: 2, act: 'click' }), undefined)
  assert.equal(said({ x: 1, y: 2, act: 'press' }), undefined)
  assert.equal(said(null), undefined)
})

test('a JPEG says how large its picture is before anyone decodes it', () => {
  const header = (width: number, height: number, before: number[] = []) =>
    new Uint8Array([0xff, 0xd8, ...before, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03])
  assert.deepEqual(jpegSize(header(1280, 800)), { width: 1280, height: 800 })
  // The segments before the start of the frame are stepped over: an APP0, and a table whose marker is in the frame's range.
  assert.deepEqual(jpegSize(header(640, 400, [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc4, 0x00, 0x03, 0x00])), { width: 640, height: 400 })
  assert.deepEqual(jpegSize(header(65_535, 65_535)), { width: 65_535, height: 65_535 })
  assert.equal(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), undefined, 'a PNG is no JPEG')
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])), undefined, 'the data began before any size was said')
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11])), undefined, 'cut short')
  assert.equal(jpegSize(new Uint8Array([])), undefined)
})
