import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onMachines, onMachinesReachable, sendAddMachine, sendRemoveMachine } from './machines.js'
import { setDashboardContext } from './context.js'
import { testDashboardContext } from './test-context.js'
import { REGISTRY_FILE } from '../registry.js'

/** Until `check` holds: what is not waited for (a key taken out of a machine) lands a moment later. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 20))
}

// These run against the real registry, pointed at a temp $XDG_CONFIG_HOME so the person's own
// home file is never read or written.
async function withHome(run: (file: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'oa-machines-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    await run(join(dir, REGISTRY_FILE))
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

const ENTER = '/_remote-access/enter'

/**
 * What another machine opened to the network, as far as this computer meets it: a code lets a
 * computer in once and answers a key, a key takes its computer out again, and a ping is answered
 * only to a key that is in.
 */
async function machine(codes: string[] = []): Promise<{ url: string; link: (code: string) => string; in: Map<string, string>; close: () => Promise<void> }> {
  const good = new Set(codes)
  const inside = new Map<string, string>()
  let made = 0
  const srv: Server = createServer((req, res) => {
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (req.url === '/_relay/ping') return void res.writeHead(key && inside.has(key) ? 200 : 401).end()
    if (req.url !== ENTER) return void res.writeHead(404).end()
    if (req.method === 'DELETE') {
      const was = key !== undefined && inside.delete(key)
      return void res.writeHead(was ? 200 : 401).end()
    }
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const { code, computer } = JSON.parse(raw) as { code: string; computer: string }
      if (!good.delete(code)) return void res.writeHead(403).end('this code no longer works')
      const fresh = `d${++made}.key-${code}`
      inside.set(fresh, computer)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, key: fresh }))
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return { url, link: code => `${url}${ENTER}#${code}`, in: inside, close: () => new Promise<void>(r => srv.close(() => r())) }
}

test('a pasted link lets this computer in on the machine, under its name, and the machine is saved with the key it answered', async () => {
  await withHome(async file => {
    const studio = await machine(['c0de'])
    try {
      const added = await sendAddMachine(`  ${studio.link('c0de')}  `, ' Studio ')
      assert.deepEqual(added, { ok: true, machine: { id: studio.url, label: 'Studio', url: studio.url } })
      const listed = await onMachines()
      assert.deepEqual(listed, [{ id: studio.url, label: 'Studio', url: studio.url }])
      // The browser is answered without the key, and without the code that was spent for it.
      assert.equal(/key-|c0de/.test(JSON.stringify([added, listed])), false)
      // The key is where the daemon reads it: the person's own file, with where to take itself out.
      const saved = JSON.parse(await readFile(file, 'utf8')).machines[0]
      assert.equal(saved.key, 'd1.key-c0de')
      assert.equal(saved.door, `${studio.url}${ENTER}`)
      // The machine lists this computer by a name, not by nothing.
      assert.ok(studio.in.get('d1.key-c0de'))
    } finally {
      await studio.close()
    }
  })
})

test('a paste that is no link, a link with no code, and a link that was used before are refused, and nothing is saved', async () => {
  await withHome(async () => {
    const studio = await machine(['once'])
    try {
      for (const pasted of ['not a link', `${studio.url}${ENTER}`, `${studio.url}/`, 42 as never]) {
        const refused = await sendAddMachine(pasted)
        assert.equal(refused.ok, false)
        assert.match(refused.ok ? '' : refused.error, /Settings, find Devices, and press Add device/)
      }
      const spent = await sendAddMachine(studio.link('used-before'))
      assert.equal(spent.ok, false)
      assert.match(spent.ok ? '' : spent.error, /no longer works/)
      const nobody = await sendAddMachine(`http://127.0.0.1:1${ENTER}#abc`)
      assert.match(nobody.ok ? '' : nobody.error, /did not answer/)
      assert.deepEqual(await onMachines(), [])
    } finally {
      await studio.close()
    }
  })
})

test('adding a machine again, with a new link, replaces its key, and the old key is taken out there', async () => {
  await withHome(async file => {
    const studio = await machine(['first', 'second'])
    try {
      await sendAddMachine(studio.link('first'), 'Studio')
      await sendAddMachine(studio.link('second'))
      assert.deepEqual((await onMachines()).map(saved => saved.id), [studio.url])
      assert.equal(JSON.parse(await readFile(file, 'utf8')).machines[0].key, 'd2.key-second')
      // The first key is of no use to anyone: this computer took it out. That call is not waited for.
      await until(() => studio.in.size === 1)
      assert.deepEqual([...studio.in.keys()], ['d2.key-second'])
    } finally {
      await studio.close()
    }
  })
})

test('a removed machine is off the list, and this computer is out of it; one that does not answer is removed all the same', async () => {
  await withHome(async () => {
    const studio = await machine(['a'])
    const office = await machine(['b'])
    try {
      await sendAddMachine(studio.link('a'))
      await sendAddMachine(office.link('b'))
      assert.deepEqual(await sendRemoveMachine(studio.url), { ok: true })
      assert.deepEqual((await onMachines()).map(saved => saved.id), [office.url])
      await until(() => studio.in.size === 0)
      assert.equal(studio.in.size, 0) // its key there stopped working
      assert.equal(office.in.size, 1)
      await office.close()
      assert.deepEqual(await sendRemoveMachine(office.url), { ok: true })
      assert.deepEqual(await onMachines(), [])
      assert.deepEqual(await sendRemoveMachine('http://10.9.9.9:4201'), { ok: true }) // never saved: nothing to do
    } finally {
      await studio.close()
    }
  })
})

test('a machine a run is at work on is not removed and not added again: the key that run is read with stays', async () => {
  await withHome(async file => {
    const studio = await machine(['first', 'second'])
    const rekeyed: string[][] = []
    let working = true
    setDashboardContext(testDashboardContext({ remote: { target: () => undefined, list: () => [], working: url => working && url === studio.url, rekey: (url, key, pin) => void rekeyed.push([url, key, ...(pin ? [pin] : [])]) } }))
    try {
      await sendAddMachine(studio.link('first'), 'Studio')
      assert.deepEqual(rekeyed, [[studio.url, 'd1.key-first']])
      assert.deepEqual(await sendRemoveMachine(studio.url), { ok: false, error: 'An agent is working on Studio. Stop it, or wait until it ends, then remove the machine.' })
      const again = await sendAddMachine(studio.link('second'))
      assert.deepEqual(again, { ok: false, error: 'An agent is working on Studio. Stop it, or wait until it ends, then add the machine again.' })
      // Nothing changed on either side, and the second link was not spent for nothing.
      assert.equal(JSON.parse(await readFile(file, 'utf8')).machines[0].key, 'd1.key-first')
      assert.deepEqual([...studio.in.keys()], ['d1.key-first'])

      // The run ended: the machine is added again, the runs kept from before are read with the new key.
      working = false
      assert.equal((await sendAddMachine(studio.link('second'))).ok, true)
      assert.deepEqual(rekeyed[1], [studio.url, 'd2.key-second'])
      assert.deepEqual(await sendRemoveMachine(studio.url), { ok: true })
    } finally {
      setDashboardContext(testDashboardContext())
      await studio.close()
    }
  })
})

test('each saved machine is asked with this computer\'s own key there, and the answer says which ones are there (#1072)', async () => {
  await withHome(async () => {
    const up = await machine(['a'])
    const removedThere = await machine(['b'])
    const gone = await machine(['c'])
    try {
      await sendAddMachine(up.link('a'))
      await sendAddMachine(removedThere.link('b'))
      await sendAddMachine(gone.link('c'))
      removedThere.in.clear() // the other machine took this computer out
      await gone.close() // nothing listening
      assert.deepEqual(await onMachinesReachable(), { [up.url]: true, [removedThere.url]: false, [gone.url]: false })
    } finally {
      await up.close()
      await removedThere.close()
    }
  })
})

test('with no saved machine nothing is asked', async () => {
  await withHome(async () => {
    assert.deepEqual(await onMachinesReachable(), {})
  })
})
