import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveComputerModuleFile, serveModuleFile, computerModuleUrl, moduleUrl, COMPUTER_MODULES_PREFIX, MODULES_PREFIX } from './module-serve.js'
import type { ProjectsProvider } from './projects.js'

test('module files are served per project and package, and nothing outside the module\'s own directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-module-serve-')))
  const dir = join(root, 'node_modules', '@acme', 'logs')
  await mkdir(join(dir, 'dist'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@acme/logs': '1', plain: '1' } }))
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@acme/logs', exports: { './dashboard': './dist/dashboard.js' } }))
  await writeFile(join(dir, 'dist', 'dashboard.js'), 'export default {}')
  await writeFile(join(dir, 'dist', 'dashboard.css'), '.a{}')
  await mkdir(join(root, 'node_modules', 'plain'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'plain', 'package.json'), JSON.stringify({ name: 'plain' }))
  await writeFile(join(root, 'node_modules', 'plain', 'index.js'), 'secret')

  const projects: ProjectsProvider = { list: async () => [], resolvePath: async id => (id === 'app-abc' ? root : undefined) }
  const server = createServer((req, res) => void serveModuleFile(req, res, new URL(req.url ?? '/', 'http://x').pathname, projects))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const url = moduleUrl('app-abc', { package: '@acme/logs', entry: 'dashboard.js' })
    assert.equal(url, `${MODULES_PREFIX}/app-abc/%40acme%2Flogs/dashboard.js`)
    const response = await fetch(base + url)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /javascript/)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.equal(await response.text(), 'export default {}')
    assert.equal((await fetch(`${base}${MODULES_PREFIX}/app-abc/%40acme%2Flogs/dashboard.css`)).status, 200)

    for (const path of [
      `${MODULES_PREFIX}/app-abc/%40acme%2Flogs/..%2Fpackage.json`, // out of the module's directory
      `${MODULES_PREFIX}/app-abc/plain/index.js`, // a dependency that brings no module
      `${MODULES_PREFIX}/other-xyz/%40acme%2Flogs/dashboard.js`, // an unknown project
      `${MODULES_PREFIX}/app-abc/%40acme%2Flogs`, // no file
      `${MODULES_PREFIX}/app-abc/%zz/dashboard.js`, // a malformed escape
    ])
      assert.equal((await fetch(base + path)).status, 404, path)
    assert.equal((await fetch(base + url, { method: 'POST' })).status, 405)
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('the computer\'s module files are served by their package alone, with no project, and no other package\'s are', async () => {
  const server = createServer((req, res) => void serveComputerModuleFile(req, res, new URL(req.url ?? '/', 'http://x').pathname))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const url = computerModuleUrl({ package: '@openagt/devices', entry: 'dashboard.js' })
    assert.equal(url, `${COMPUTER_MODULES_PREFIX}/%40openagt%2Fdevices/dashboard.js`)
    const response = await fetch(base + url)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /javascript/)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.equal((await fetch(`${base}${COMPUTER_MODULES_PREFIX}/%40openagt%2Fdevices/dashboard.css`)).status, 200)

    for (const path of [
      `${COMPUTER_MODULES_PREFIX}/%40openagt%2Ffiles/dashboard.js`, // every project's, not the computer's
      `${COMPUTER_MODULES_PREFIX}/%40openagt%2Fdevices/..%2F..%2Fpackage.json`, // out of the module's directory
      `${COMPUTER_MODULES_PREFIX}/%40openagt%2Fdevices/..%2Fcli.js`, // the package's own code, not its browser part
      `${COMPUTER_MODULES_PREFIX}/%40openagt%2Fdevices`, // no file
      `${COMPUTER_MODULES_PREFIX}/%zz/dashboard.js`, // a malformed escape
    ])
      assert.equal((await fetch(base + path)).status, 404, path)
    assert.equal((await fetch(base + url, { method: 'POST' })).status, 405)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
