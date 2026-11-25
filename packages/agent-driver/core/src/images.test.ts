import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasImage, imageFile, imageMediaType, imagesDir, isImageName, keepImage, refusedImages } from './images.js'

// The image store: the images a person's messages go with, kept on this computer, readable by that
// user only, under names that are their content's hash and say nothing else.

/** The smallest PNG there is: one pixel. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function home(): Promise<{ env: NodeJS.ProcessEnv; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-driver-images-'))
  return { env: { HOME: dir }, dir }
}

test('an image is kept once under its hash, in a folder of the user’s beside OpenAgent’s others, readable by them alone', async () => {
  const { env, dir } = await home()
  try {
    assert.equal(imagesDir(env), join(dir, '.openagent-images'))
    assert.equal(imagesDir({ HOME: dir, XDG_CONFIG_HOME: join(dir, 'config') }), join(dir, 'config', 'openagent-images'))
    const kept = await keepImage('image/png', PNG, env)
    assert.ok(kept.ok)
    assert.match(kept.name, /^[0-9a-f]{64}\.png$/)
    assert.deepEqual(await readFile(imageFile(kept.name, env)), PNG)
    assert.equal((await stat(imagesDir(env))).mode & 0o777, 0o700)
    assert.equal((await stat(imageFile(kept.name, env))).mode & 0o777, 0o600)
    assert.equal(imageMediaType(kept.name), 'image/png')
    assert.ok(await hasImage(kept.name, env))
    // The same image again is the same name, and no second file.
    assert.deepEqual(await keepImage('image/png', PNG, env), kept)
    assert.deepEqual(await readdir(imagesDir(env)), [kept.name])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('what is not an image of its kind, or is more than the agents take, is not kept', async () => {
  const { env, dir } = await home()
  try {
    assert.deepEqual(await keepImage('image/svg+xml', Buffer.from('<svg/>'), env), { ok: false, error: 'The agent reads PNG, JPEG, GIF and WebP images' })
    assert.deepEqual(await keepImage('image/jpeg', PNG, env), { ok: false, error: 'This is not a JPG image' })
    const huge = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])
    assert.deepEqual(await keepImage('image/png', huge, env), { ok: false, error: 'The image is larger than the agent takes' })
    assert.equal(await stat(imagesDir(env)).then(() => true, () => false), false, 'nothing was written')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('only a name the store gives names an image: no path, no other kind', () => {
  const hash = 'c'.repeat(64)
  for (const name of [`${hash}.png`, `${hash}.jpg`, `${hash}.gif`, `${hash}.webp`]) assert.ok(isImageName(name), name)
  for (const name of [`${hash}.svg`, `../${hash}.png`, `/tmp/${hash}.png`, `${hash.slice(1)}.png`, `${hash.toUpperCase()}.png`, 3, undefined]) assert.equal(isImageName(name), false, String(name))
  assert.throws(() => imageFile('../../etc/passwd'), /not an image's name/)
})

test('a message or a Start goes with the images kept here, a message\'s worth at most; any other name is refused in words', async () => {
  const { env, dir } = await home()
  try {
    const kept = await keepImage('image/png', PNG, env)
    assert.ok(kept.ok)
    assert.equal(await refusedImages(undefined, env), undefined)
    assert.equal(await refusedImages([kept.name], env), undefined)
    assert.equal(await refusedImages(['/etc/passwd'], env), 'Images are named by the names the dashboard kept them under.')
    assert.equal(await refusedImages(kept.name, env), 'Images are named by the names the dashboard kept them under.', 'a name alone is no list of them')
    assert.equal(await refusedImages(Array.from({ length: 21 }, () => kept.name), env), 'Images are named by the names the dashboard kept them under.')
    assert.equal(await refusedImages([`${'f'.repeat(64)}.png`], env), 'An image is no longer on this computer. Take it out and add it again.')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
