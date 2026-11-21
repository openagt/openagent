import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { readZip } from './actions-zip.js'

/**
 * Assemble a real zip archive, since Node can read deflate but neither write nor read a zip,
 * and shelling out to `zip` would not survive Windows. Byte-for-byte what upload-artifact
 * produces for a small directory, including the CRCs the reader ignores.
 */
function makeZip(files: { name: string; body: string; store?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const raw = Buffer.from(file.body, 'utf8')
    const data = file.store ? raw : deflateRawSync(raw)
    const name = Buffer.from(file.name, 'utf8')
    const method = file.store ? 0 : 8
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + data.length
  }

  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

test('readZip reads the deflated entries an artifact download contains (#610)', () => {
  const zip = makeZip([
    { name: 'execution.json', body: '[{"type":"result","result":"done"}]' },
    { name: 'meta.json', body: '{"branch":"claude/x"}' },
  ])
  const entries = readZip(zip)
  assert.deepEqual(
    entries.map(e => e.name),
    ['execution.json', 'meta.json'],
  )
  assert.equal(entries[0]!.data.toString('utf8'), '[{"type":"result","result":"done"}]')
  assert.equal(entries[1]!.data.toString('utf8'), '{"branch":"claude/x"}')
})

test('readZip reads stored entries, which is what tiny files get (#610)', () => {
  const entries = readZip(makeZip([{ name: 'meta.json', body: '{}', store: true }]))
  assert.equal(entries[0]!.data.toString('utf8'), '{}')
})

test('readZip survives a transcript larger than one deflate block (#610)', () => {
  // A real transcript is tens of thousands of lines; a fixture that fits in a single
  // block would not exercise the inflate path the way an actual agent does.
  const body = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ type: 'assistant', i })))
  const entries = readZip(makeZip([{ name: 'execution.json', body }]))
  assert.equal(entries[0]!.data.toString('utf8'), body)
})

test('readZip refuses anything that is not an archive rather than reading it short (#610)', () => {
  // A short read would look like an agent that said less than it did, so it must throw.
  assert.throws(() => readZip(Buffer.from('not a zip at all, just some bytes')), /no end-of-central-directory/)
  assert.throws(() => readZip(Buffer.alloc(4)), /too short/)
})

test('readZip finds the record even when the archive carries a comment (#610)', () => {
  const zip = makeZip([{ name: 'meta.json', body: '{"branch":"b"}' }])
  const comment = Buffer.from('uploaded by actions/upload-artifact', 'utf8')
  const withComment = Buffer.concat([zip, comment])
  withComment.writeUInt16LE(comment.length, withComment.length - comment.length - 2)
  assert.equal(readZip(withComment)[0]!.data.toString('utf8'), '{"branch":"b"}')
})
