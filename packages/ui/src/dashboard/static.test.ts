import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serveClientBundle } from './static.js'

// The bundle's caching rule: only the fingerprinted files under `assets/` may be cached as
// immutable, the host files a module imports among them (`/assets/host/*-<hash>.js`). `index.html`,
// whose import map names them, always revalidates, so a dashboard upgrade reaches a browser that
// kept the old page.

async function bundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openagent-static-'))
  await mkdir(join(dir, 'assets'))
  await mkdir(join(dir, 'assets', 'host'))
  await writeFile(join(dir, 'index.html'), '<html></html>')
  await writeFile(join(dir, 'assets', 'app-abc123.js'), 'export {}')
  await writeFile(join(dir, 'assets', 'host', 'module-def456.js'), 'export {}')
  return dir
}

test('only fingerprinted assets are immutable, the host modules among them; index.html always revalidates', async () => {
  const dir = await bundle()
  const server = createServer((req, res) => void serveClientBundle(req, res, dir))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const cache = async (path: string) => (await fetch(base + path)).headers.get('cache-control')
    assert.equal(await cache('/assets/app-abc123.js'), 'public, max-age=31536000, immutable')
    assert.equal(await cache('/assets/host/module-def456.js'), 'public, max-age=31536000, immutable')
    assert.equal(await cache('/index.html'), 'no-cache')
    assert.equal(await cache('/tickets/some-project/some-file'), 'no-cache', 'the app shell for a client route')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
