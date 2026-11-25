import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configFile } from './private-files.js'
import { IMAGE_MAX_BYTES, IMAGES_PER_MESSAGE } from './image-bounds.js'

// The images a person's messages go with, kept on this computer only: one folder of the user's,
// `$XDG_CONFIG_HOME/openagent-images` or `~/.openagent-images`, beside OpenAgent's other files and
// readable by that user only. Not in a run's checkout, which its work is pushed from, nor in the
// personal folder or a project's agent data, which are pushed too. A message, a run's record and
// every hop between name an image by the name it is kept under, its content's hash and its kind
// (`<sha256>.png`); only a driver, as it hands the image to its agent, reads the file.

/** The kinds of image the coding agents read, by the extension the store gives each. */
const KINDS = {
  png: { type: 'image/png', is: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { type: 'image/jpeg', is: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { type: 'image/gif', is: (b: Buffer) => b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
  webp: { type: 'image/webp', is: (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
} as const

type Kind = keyof typeof KINDS

/** The media types the store takes. */
export type ImageMediaType = (typeof KINDS)[Kind]['type']

const NAME = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/

/** The folder the images are kept in, for the user `env` is. */
export function imagesDir(env: NodeJS.ProcessEnv = process.env): string {
  return configFile('openagent-images', env)
}

/** Whether `name` is one the store gives an image: nothing else, a path least of all, names one. */
export function isImageName(name: unknown): name is string {
  return typeof name === 'string' && NAME.test(name)
}

/** The image `name`'s media type. */
export function imageMediaType(name: string): ImageMediaType {
  return KINDS[imageKind(name)].type
}

/** The file the image `name` is kept in. Throws for anything that is not an image's name. */
export function imageFile(name: string, env: NodeJS.ProcessEnv = process.env): string {
  imageKind(name)
  return join(imagesDir(env), name)
}

/** The image `name`'s bytes. Rejects when it is not kept on this computer. */
export function readImage(name: string, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  return readFile(imageFile(name, env))
}

/** Whether the image `name` is kept on this computer. */
export async function hasImage(name: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!isImageName(name)) return false
  return stat(imageFile(name, env)).then(found => found.isFile(), () => false)
}

/**
 * Keep `bytes`, an image of the media type `type`, and answer the name it is kept under: the same
 * name for the same image, kept once. Refused, with why, when the bytes are not an image of that
 * kind or are more than the agents take.
 */
export async function keepImage(type: string, bytes: Buffer, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const kind = (Object.keys(KINDS) as Kind[]).find(one => KINDS[one].type === type)
  if (kind === undefined) return { ok: false, error: 'The agent reads PNG, JPEG, GIF and WebP images' }
  if (!KINDS[kind].is(bytes)) return { ok: false, error: `This is not a ${kind.toUpperCase()} image` }
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, error: 'The image is larger than the agent takes' }
  const name = `${createHash('sha256').update(bytes).digest('hex')}.${kind}`
  const dir = imagesDir(env)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const file = join(dir, name)
  if (!(await hasImage(name, env))) {
    // Written whole to a file of its own, then moved into place: a reader never sees half of it.
    const next = `${file}.${process.pid}.${Date.now()}.new`
    await writeFile(next, bytes, { mode: 0o600 })
    await rename(next, file)
  }
  return { ok: true, name }
}

/**
 * Why the images a message or a Start names cannot go with it, in words for the person: more than
 * one message goes with, a name that is no image's, or one no longer kept on this computer. None
 * when they can.
 */
export async function refusedImages(images: unknown, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (images === undefined) return undefined
  if (!Array.isArray(images) || images.length > IMAGES_PER_MESSAGE || !images.every(isImageName)) return 'Images are named by the names the dashboard kept them under.'
  if (!(await Promise.all(images.map(name => hasImage(name, env)))).every(Boolean)) return 'An image is no longer on this computer. Take it out and add it again.'
  return undefined
}

/** The kind the name `name` says. Throws for anything that is not an image's name. */
function imageKind(name: string): Kind {
  if (!isImageName(name)) throw new Error(`not an image's name: ${JSON.stringify(name)}`)
  return name.slice(name.lastIndexOf('.') + 1) as Kind
}
