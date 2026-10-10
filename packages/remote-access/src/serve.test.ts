import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { doorPort, serve } from './serve.js'
import { readFile, writeFile } from 'node:fs/promises'
import { DEVICE_COOKIE } from './door.js'
import { addCode, enter, readStore, removeDevice, storePath, update, type Store } from './store.js'
import { testHome } from './test-home.js'

/** Wait until the file reads as `until` wants, looking often; fails after five seconds. */
async function fileSays(env: NodeJS.ProcessEnv, until: (store: Store) => boolean): Promise<Store> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const store = await readStore(env)
    if (until(store)) return store
    if (Date.now() > deadline) assert.fail(`the file never said so: ${JSON.stringify(store)}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const turn = (env: NodeJS.ProcessEnv, on: boolean): Promise<void> =>
  update(env, store => {
    store.on = on
  })

test('the door is on the port after OpenAgent\'s own', () => {
  assert.equal(doorPort('http://127.0.0.1:4200'), 4201)
  assert.equal(doorPort('http://127.0.0.1:4311'), 4312)
})

test('the process follows the switch: on opens the door, off closes it, and its end closes it too', async () => {
  const home = await testHome()
  const stop = new AbortController()
  const running = serve({ env: home.env, target: 'http://127.0.0.1:1', port: 0, host: '127.0.0.1', signal: stop.signal, pollMs: 20 })
  try {
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal((await readStore(home.env)).listening, undefined, 'off: it listens on nothing and writes nothing')

    await turn(home.env, true)
    const open = await fileSays(home.env, store => store.listening !== undefined)
    assert.equal(open.listening!.pid, process.pid)
    const at = `http://127.0.0.1:${open.listening!.port}/`
    assert.equal((await fetch(at)).status, 401, 'the door answers')

    await turn(home.env, false)
    await fileSays(home.env, store => store.listening === undefined)
    await assert.rejects(fetch(at), 'nothing listens')

    await turn(home.env, true)
    const again = await fileSays(home.env, store => store.listening !== undefined)
    stop.abort()
    await running
    assert.equal((await readStore(home.env)).listening, undefined, 'the file no longer says it listens')
    assert.equal((await readStore(home.env)).on, true, 'the switch is the person\'s: it stays as it was set')
    await assert.rejects(fetch(`http://127.0.0.1:${again.listening!.port}/`))
  } finally {
    stop.abort()
    await running
    await home.remove()
  }
})

test('a port another program holds is said, and the door opens once the port is free', async () => {
  const home = await testHome()
  const squatter = createServer()
  await new Promise<void>(resolve => squatter.listen(0, '127.0.0.1', resolve))
  const port = (squatter.address() as AddressInfo).port
  const stop = new AbortController()
  await turn(home.env, true)
  const running = serve({ env: home.env, target: 'http://127.0.0.1:1', port, host: '127.0.0.1', signal: stop.signal, pollMs: 20, retryMs: 50 })
  try {
    const stuck = await fileSays(home.env, store => store.problem !== undefined)
    assert.equal(stuck.problem, `Port ${port} is taken by another program on this computer.`)
    assert.equal(stuck.listening, undefined)
    await new Promise<void>(resolve => squatter.close(() => resolve()))
    const open = await fileSays(home.env, store => store.listening !== undefined)
    assert.equal(open.problem, undefined)
    assert.equal(open.listening!.port, port)
  } finally {
    stop.abort()
    await running
    squatter.close()
    await home.remove()
  }
})

test('switching off clears a problem that was said', async () => {
  const home = await testHome()
  const squatter = createServer()
  await new Promise<void>(resolve => squatter.listen(0, '127.0.0.1', resolve))
  const stop = new AbortController()
  await turn(home.env, true)
  const running = serve({ env: home.env, target: 'http://127.0.0.1:1', port: (squatter.address() as AddressInfo).port, host: '127.0.0.1', signal: stop.signal, pollMs: 20 })
  try {
    await fileSays(home.env, store => store.problem !== undefined)
    await turn(home.env, false)
    await fileSays(home.env, store => store.problem === undefined)
  } finally {
    stop.abort()
    await running
    await new Promise<void>(resolve => squatter.close(() => resolve()))
    await home.remove()
  }
})

test('a device taken out of the file loses the live feed it held open, without anyone telling the door', async () => {
  const home = await testHome()
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first\n\n')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const stop = new AbortController()
  await turn(home.env, true)
  const running = serve({ env: home.env, target: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, port: 0, host: '127.0.0.1', signal: stop.signal, pollMs: 20 })
  try {
    const { listening } = await fileSays(home.env, store => store.listening !== undefined)
    const entry = (await enter(home.env, (await addCode(home.env)).code, 'a phone'))!
    const feed = await fetch(`http://127.0.0.1:${listening!.port}/_rpc/events`, { headers: { cookie: `${DEVICE_COOKIE}=${entry.id}.${entry.key}` } })
    const reader = feed.body!.getReader()
    await reader.read()
    await removeDevice(home.env, entry.id)
    const cut = await Promise.race([reader.read().then(() => 'still open', () => 'cut'), new Promise(resolve => setTimeout(() => resolve('still open'), 3_000))])
    assert.equal(cut, 'cut')
  } finally {
    stop.abort()
    await running
    upstream.closeAllConnections()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
    await home.remove()
  }
})

test('a file a person broke by hand is left as it is: nobody gets in, and once corrected the door and every device are as before', async () => {
  const home = await testHome()
  const upstream = createServer((_req, res) => res.end('the dashboard'))
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const stop = new AbortController()
  await turn(home.env, true)
  const said: string[] = []
  const running = serve({ env: home.env, target: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, port: 0, host: '127.0.0.1', signal: stop.signal, pollMs: 20, log: line => said.push(line) })
  try {
    const { listening } = await fileSays(home.env, store => store.listening !== undefined)
    const entry = (await enter(home.env, (await addCode(home.env)).code, 'a phone'))!
    const ask = (): Promise<number> => fetch(`http://127.0.0.1:${listening!.port}/`, { headers: { cookie: `${DEVICE_COOKIE}=${entry.id}.${entry.key}` } }).then(answer => answer.status)
    assert.equal(await ask(), 200)

    const good = await readFile(storePath(home.env), 'utf8')
    const broken = good.replace('"on": true,', '"on": true,,')
    await writeFile(storePath(home.env), broken)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await readFile(storePath(home.env), 'utf8'), broken, 'not written over')
    assert.equal(await ask(), 401, 'nobody gets in on a doubt')
    assert.ok(said.some(line => line.includes('cannot be read')))

    await writeFile(storePath(home.env), good)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(await ask(), 200)
  } finally {
    stop.abort()
    await running
    await new Promise<void>(resolve => upstream.close(() => resolve()))
    await home.remove()
  }
})
