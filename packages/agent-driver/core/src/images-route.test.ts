import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computerRpcHost } from '@openagt/hooks/testing'
import { imageAddress } from './image-bounds.js'
import { imagesRoute } from './images-route.js'
import { keepImage } from './server.js'

// What the message box's keep and its tiles reach (`composer.images`): the server part keeps an
// image sent as base64, and the route serves a kept one by its name, to this computer's pages.

/** The smallest PNG there is: one pixel. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('an image sent as base64 is kept and served at its address for good; another site\'s page, a name that is none and an image not here are refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-driver-route-'))
  const before = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = dir
  const server = createServer((req, res) => void imagesRoute.handle(req, res))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const at = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`
  try {
    const kept = await keepImage(computerRpcHost(), { type: 'image/png', data: PNG })
    assert.ok(kept.ok)
    assert.deepEqual(await keepImage(computerRpcHost(), { type: 'image/jpeg', data: PNG }), { ok: false, error: 'This is not a JPG image' })
    assert.deepEqual(await keepImage(computerRpcHost(), { type: 'image/png', data: 'not base64!' }), { ok: false, error: 'An image is sent as its kind and its bytes in base64.' })

    const served = await fetch(at(imageAddress(kept.name)))
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.match(served.headers.get('cache-control') ?? '', /immutable/)
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), Buffer.from(PNG, 'base64'))
    assert.equal((await fetch(at(imageAddress(kept.name)), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
    assert.equal((await fetch(at(imageAddress(`${'f'.repeat(64)}.png`)))).status, 404)
    assert.equal((await fetch(at('/_images/..%2F..%2Fetc%2Fpasswd'))).status, 404)
    assert.equal((await fetch(at(imageAddress(kept.name)), { method: 'POST' })).status, 405)
  } finally {
    await new Promise(resolve => server.close(resolve))
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    await rm(dir, { recursive: true, force: true })
  }
})
