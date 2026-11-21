import { inflateRawSync } from 'node:zlib'

// A minimal zip reader, for one job: the GitHub artifact download API always returns a zip,
// even for a single file, and that is the only REST-readable channel out of an Actions run
// (#610). Node ships deflate but no zip, and the package has no runtime dependencies worth
// adding for ~60 lines. Reading only, and only what upload-artifact writes: stored or
// deflated entries, no zip64, no encryption.

/**
 * One file inside a zip.
 *
 * @internal Implementation detail of the Actions driver, not product API. It reached the published
 * surface once through the driver barrel, which is a one-way door: an accidental export cannot be
 * taken back after a release without a breaking change.
 */
export interface ZipEntry {
  /** Path as recorded in the archive, e.g. `"execution.json"`. */
  name: string
  /** The decompressed bytes. */
  data: Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** End-of-central-directory record, without a trailing comment. */
const EOCD_SIZE = 22

/**
 * Read every entry out of a zip archive.
 *
 * Walks the central directory rather than scanning for local headers: the central
 * directory is the authoritative listing, and a local header may declare sizes of 0
 * and defer them to a data descriptor, which the central copy never does.
 *
 * Throws on anything it does not recognize rather than returning a partial archive —
 * a silently-short transcript would read as an agent that said less than it did.
 *
 * @internal Implementation detail of the Actions driver, not product API. Imported by the driver
 * and its own test, both by module path; nothing reaches it through a barrel.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let cursor = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error(`zip: bad central directory entry at ${cursor}`)
    const method = buf.readUInt16LE(cursor + 10)
    const compressedSize = buf.readUInt32LE(cursor + 20)
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    entries.push({ name, data: readLocalEntry(buf, localOffset, method, compressedSize, name) })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** The bytes of one entry, found via its local header (whose extra field may differ from the central one). */
function readLocalEntry(buf: Buffer, offset: number, method: number, compressedSize: number, name: string): Buffer {
  if (buf.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error(`zip: bad local header for ${name}`)
  const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28)
  const raw = buf.subarray(start, start + compressedSize)
  if (method === 0) return Buffer.from(raw) // Stored: upload-artifact does this for tiny files.
  if (method === 8) return inflateRawSync(raw)
  throw new Error(`zip: unsupported compression method ${method} for ${name}`)
}

/**
 * Locate the end-of-central-directory record. It sits at the very end unless the archive
 * carries a comment, so try the common case first and only then scan backwards.
 */
function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_SIZE) throw new Error('zip: too short to be an archive')
  const flush = buf.length - EOCD_SIZE
  if (buf.readUInt32LE(flush) === EOCD_SIGNATURE) return flush
  // A comment can be at most 0xffff bytes, so the record cannot be further back than that.
  const floor = Math.max(0, buf.length - 0xffff - EOCD_SIZE)
  for (let i = flush - 1; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('zip: no end-of-central-directory record (not a zip archive?)')
}
