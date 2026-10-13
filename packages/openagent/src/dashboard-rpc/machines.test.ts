import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onMachineVersions, onMachines, onMachinesReachable, onProjectOnMachine, sendAddMachine, sendProjectToMachine, sendRemoveMachine } from './machines.js'
import { openagentVersion } from '../version.js'
import { setDashboardContext } from './context.js'
import { testDashboardContext } from './test-context.js'
import { REGISTRY_FILE, addMachine, addProject, projectId } from '../registry.js'

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
 * only to a key that is in, with the OpenAgent the machine runs when it says.
 */
async function machine(codes: string[] = [], version?: string): Promise<{ url: string; link: (code: string) => string; in: Map<string, string>; close: () => Promise<void> }> {
  const good = new Set(codes)
  const inside = new Map<string, string>()
  let made = 0
  const srv: Server = createServer((req, res) => {
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (req.url === '/_relay/ping') return void res.writeHead(key && inside.has(key) ? 200 : 401).end(version === undefined ? '' : JSON.stringify({ version }))
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
    setDashboardContext(testDashboardContext({ remote: { target: () => undefined, list: () => [], working: url => working && url === studio.url, rekey: (url, key, pin) => void rekeyed.push([url, key, ...(pin ? [pin] : [])]), sent: () => true, home: async () => undefined, follow: async () => {}, machineNames: async () => () => undefined } }))
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

test('the saved machines are told with the OpenAgent each runs, beside this computer\'s own; one that does not answer, or does not say, has none', async () => {
  await withHome(async () => {
    const behind = await machine(['a'], '0.0.1')
    const silent = await machine(['b'])
    const gone = await machine(['c'], '9.9.9')
    try {
      await sendAddMachine(behind.link('a'), 'Behind')
      await sendAddMachine(silent.link('b'), 'Silent')
      await sendAddMachine(gone.link('c'), 'Gone')
      await gone.close()
      // A key as a door hands one out: the id the machine lists this computer under, a dot, the secret.
      const door = 'http://127.0.0.1:9'
      await addMachine({ url: door, key: 'a1b2c3d4e5f6.s3cret-of-the-door', door: `${door}${ENTER}`, label: 'Door' })
      const told = await onMachineVersions()
      assert.equal(told.version, openagentVersion())
      // Never this computer's key there: a page reads this. The id it is listed under there is no key.
      assert.deepEqual(
        [...told.machines].sort((a, b) => a.label.localeCompare(b.label)),
        [
          { id: behind.url, label: 'Behind', url: behind.url, version: '0.0.1' },
          { id: door, label: 'Door', url: door, device: 'a1b2c3d4e5f6' },
          { id: gone.url, label: 'Gone', url: gone.url },
          { id: silent.url, label: 'Silent', url: silent.url },
        ],
      )
      assert.doesNotMatch(JSON.stringify(told), /s3cret|key-/)
    } finally {
      await behind.close()
      await silent.close()
    }
  })
})

test('with no saved machine nothing is asked', async () => {
  await withHome(async () => {
    assert.deepEqual(await onMachinesReachable(), {})
  })
})

test('a saved machine is asked to clone a project of this computer\'s, by the project\'s address, and what it answers is told in words that name the machine', async () => {
  await withHome(async () => {
    const shop = await realpath(await mkdtemp(join(tmpdir(), 'oa-machines-shop-')))
    const notes = await realpath(await mkdtemp(join(tmpdir(), 'oa-machines-notes-')))
    execFileSync('git', ['init', '-q'], { cwd: shop })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Acme/Shop.git'], { cwd: shop })
    execFileSync('git', ['config', '--local', 'agent-data.share', 'true'], { cwd: shop })
    execFileSync('git', ['init', '-q'], { cwd: notes })
    const calls: { method?: string | undefined; url?: string | undefined; body: unknown }[] = []
    let answer: { status?: number; said?: unknown } = { said: { state: 'coming' } }
    const srv: Server = createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        calls.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
        res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(answer.said ?? {}))
      })
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
    try {
      const at = new Date().toISOString()
      await addProject(shop, at)
      await addProject(notes, at)
      await addMachine({ url, key: 'd1.key', door: `${url}${ENTER}`, label: 'Studio' })
      const name = shop.split('/').at(-1)!

      assert.deepEqual(await sendProjectToMachine(projectId(shop), url), { ok: true, there: false })
      // This computer's own answer on the records, and its spelling of the address, ride the ask.
      assert.deepEqual(calls[0], { method: 'POST', url: '/_relay/project', body: { project: 'github.com/acme/shop', share: true, from: 'github.com/Acme/Shop' } })
      assert.deepEqual(await onProjectOnMachine(projectId(shop), url), { ok: true, there: false })
      assert.deepEqual(calls[1], { method: 'GET', url: '/_relay/project?project=github.com%2Facme%2Fshop', body: null })
      answer = { said: { state: 'there' } }
      assert.deepEqual(await onProjectOnMachine(projectId(shop), url), { ok: true, there: true })

      // The machine's own words say "this computer" of itself: the page says whose words they are.
      answer = { said: { state: 'failed', error: 'This computer has no login that can read github.com/acme/shop.' } }
      assert.deepEqual(await onProjectOnMachine(projectId(shop), url), { ok: false, error: `${name} could not be cloned on Studio. Studio says: This computer has no login that can read github.com/acme/shop.` })
      answer = { said: { state: 'missing' } }
      assert.deepEqual(await onProjectOnMachine(projectId(shop), url), { ok: false, error: `Studio is no longer cloning ${name}. Send again.` })
      answer = { status: 404 }
      assert.deepEqual(await sendProjectToMachine(projectId(shop), url), { ok: false, error: `Studio could not be asked for ${name}: it runs an older OpenAgent, which cannot clone a project by itself. Update it, or add the project there.` })

      // Nothing is asked for a project with no address, an unknown project, or a machine that is not saved.
      const asked = calls.length
      assert.deepEqual(await sendProjectToMachine(projectId(notes), url), { ok: false, error: 'This project has no repository address, so it cannot be sent to another machine.' })
      assert.deepEqual(await sendProjectToMachine('nope', url), { ok: false, error: 'unknown project: nope' })
      assert.deepEqual(await sendProjectToMachine(projectId(shop), 'http://127.0.0.1:1'), { ok: false, error: 'That machine is no longer saved. Pick another place to run.' })
      assert.equal(calls.length, asked)
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
      await rm(shop, { recursive: true, force: true })
      await rm(notes, { recursive: true, force: true })
    }
  })
})
