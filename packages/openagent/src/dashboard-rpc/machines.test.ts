import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { onComputersThrough, onMachineStartCheck, onMachineVersions, onMachines, onMachinesReachable, onProjectHere, onProjectOnMachine, sendAddComputerThrough, sendAddMachine, sendLetMachineIn, sendProjectHere, sendProjectToMachine, sendRemoveMachine, sendRenameMachine } from './machines.js'
import { elsewhereId, type OwnProject } from '../dashboard/elsewhere.js'
import type { BringProject } from '../dashboard/remote-run.js'
import { openagentVersion } from '../version.js'
import { setDashboardContext } from './context.js'
import { NO_ELSEWHERE, testDashboardContext } from './test-context.js'
import { REGISTRY_FILE, addMachine, addProject, projectId, useLoginsOn } from '../registry.js'

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

const ENTER = '/_devices/enter'

/**
 * What another machine opened to the network, as far as this computer meets it: a code lets a
 * computer in once and answers a key, a key takes its computer out again, and a ping is answered
 * only to a key that is in, with the OpenAgent the machine runs when it says.
 */
async function machine(codes: string[] = [], version?: string, computers?: unknown[], listed?: unknown): Promise<{ url: string; link: (code: string) => string; in: Map<string, string>; saved: unknown[]; close: () => Promise<void> }> {
  const good = new Set(codes)
  const inside = new Map<string, string>()
  let made = 0
  // What its OpenAgent was asked to save, as its page would add a machine: the link and the name, to a key that is in.
  const saved: unknown[] = []
  const srv: Server = createServer((req, res) => {
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (req.url === '/_relay/ping') return void res.writeHead(key && inside.has(key) ? 200 : 401).end(version === undefined ? '' : JSON.stringify({ version, ...(listed !== undefined ? { listed } : {}) }))
    if (req.url === '/_rpc/sendAddMachine') {
      if (!key || !inside.has(key)) return void res.writeHead(401).end()
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        saved.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ret: { ok: true } }))
      })
      return
    }
    // A server's door lists the computers on a line there, to a key that is in.
    if (req.url === '/_devices/computers' && computers) return void (key && inside.has(key) ? res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ computers })) : res.writeHead(401).end())
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
  return { url, link: code => `${url}${ENTER}#${code}`, in: inside, saved, close: () => new Promise<void>(r => srv.close(() => r())) }
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
      assert.match(spent.ok ? '' : spent.error, /That code doesn't work/)
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
    setDashboardContext(testDashboardContext({ remote: { ...NO_ELSEWHERE, target: () => undefined, list: () => [], working: url => working && url === studio.url, rekey: (url, key, pin) => void rekeyed.push([url, key, ...(pin ? [pin] : [])]), sent: () => true, home: async () => undefined, follow: async () => {}, machineNames: async () => () => undefined, machineRuns: async () => [], followRuns: () => () => {} } }))
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

test('a saved machine says the ids it is listed under at the doors it saved: they are told with it, kept for when it does not answer, and anything that is no id is left out', async () => {
  await withHome(async () => {
    const studio = await machine(['a'], '1.0.0', undefined, ['k3y1d0000001', 'NOT AN ID', 7, 'a'.repeat(40)])
    const quiet = await machine(['b'], '1.0.0', undefined, 'k3y1d0000002')
    try {
      await sendAddMachine(studio.link('a'), 'Studio')
      await sendAddMachine(quiet.link('b'), 'Quiet')
      const told = await onMachineVersions()
      assert.deepEqual(told.machines.find(m => m.label === 'Studio')?.listed, ['k3y1d0000001'])
      assert.equal(told.machines.find(m => m.label === 'Quiet')?.listed, undefined)
      // Gone quiet, it is known by what it said last: a computer that is off is still one row on a page.
      await studio.close()
      const later = await onMachineVersions()
      assert.equal(later.machines.find(m => m.label === 'Studio')?.version, undefined)
      assert.deepEqual(later.machines.find(m => m.label === 'Studio')?.listed, ['k3y1d0000001'])
    } finally {
      await studio.close()
      await quiet.close()
    }
  })
})

test('a saved machine is renamed; an empty name and a machine not saved are refused', async () => {
  await withHome(async () => {
    const studio = await machine(['a'])
    try {
      await sendAddMachine(studio.link('a'), 'Studio')
      assert.deepEqual(await sendRenameMachine(studio.url, 'Studio Mac'), { ok: true, machine: { id: studio.url, label: 'Studio Mac', url: studio.url } })
      assert.deepEqual((await onMachines()).map(m => m.label), ['Studio Mac'])
      assert.deepEqual(await sendRenameMachine(studio.url, '  '), { ok: false, error: 'Give it a name.' })
      assert.deepEqual(await sendRenameMachine('http://10.0.0.9:4201', 'X'), { ok: false, error: 'That machine is no longer saved.' })
    } finally {
      await studio.close()
    }
  })
})

test('a saved machine is asked to save this computer with a link of its door, as its page would add a machine; no link, no saved machine and a computer through a server are refused, and nothing is asked', async () => {
  await withHome(async () => {
    const studio = await machine(['a'])
    try {
      await sendAddMachine(studio.link('a'), 'Studio')
      const here = 'http://192.168.1.7:4201/_devices/enter#c0de'
      assert.deepEqual(await sendLetMachineIn(studio.url, here), { ok: true })
      assert.deepEqual(studio.saved, [[here, hostname().replace(/\.local$/i, '') || 'another computer']])
      assert.deepEqual(await sendLetMachineIn(studio.url, 'no link'), { ok: false, error: 'That is no link of this computer\'s door.' })
      assert.deepEqual(await sendLetMachineIn('http://10.0.0.9:4201', here), { ok: false, error: 'That machine is no longer saved.' })
      const through = `${studio.url}/_devices/via/abc123def456`
      await addMachine({ url: through, key: 'd9.k', door: `${studio.url}${ENTER}`, label: 'Home PC' })
      assert.deepEqual(await sendLetMachineIn(through, here), { ok: false, error: 'Home PC is reached through a server: its runs come here through that server.' })
      assert.equal(studio.saved.length, 1)
    } finally {
      await studio.close()
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
      // Named as its repository is, whatever its folder here is called.
      const name = 'Shop'

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

test('a saved machine is asked whether a run would start there, from its own copy of the project, with the agent picked; what does not read as an answer, or no answer, says nothing', async () => {
  await withHome(async () => {
    const shop = await realpath(await mkdtemp(join(tmpdir(), 'oa-machines-shop-')))
    execFileSync('git', ['init', '-q'], { cwd: shop })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Acme/Shop.git'], { cwd: shop })
    const calls: { url?: string | undefined; auth?: string | undefined; body: unknown }[] = []
    let answer: { status?: number; said?: unknown } = {}
    const srv: Server = createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        calls.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null })
        const said = req.url?.endsWith('/_relay/machine') ? cloning : answer
        res.writeHead(said.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(said.said ?? {}))
      })
    })
    // What the machine says of a clone of the project, asked when it does not have it: an older OpenAgent knows no such call.
    let cloning: { status?: number; said?: unknown } = { status: 500, said: { error: 'unknown machine rpc: onCloneCheck' } }
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/_devices/via/c1`
    try {
      await addProject(shop, new Date().toISOString())
      await addMachine({ url, key: 'd1.key', door: `${url}${ENTER}`, label: 'experiment' })
      const line = '`claude` is not logged in. Run `claude auth login`, then start again.'
      const readiness = { problems: [line], warnings: [], fix: { kind: 'log-in', command: 'claude auth login', problem: line } }
      answer = { said: { result: readiness } }
      assert.deepEqual(await onMachineStartCheck(projectId(shop), url, 'claude-code'), readiness)
      // Asked by the relay, so a computer through a server is asked as a server is; the machine reads its own project for the first argument.
      assert.deepEqual(calls[0], { url: '/_devices/via/c1/_relay/rpc', auth: 'Bearer d1.key', body: { fn: 'onStartCheck', args: [projectId(shop), 'claude-code'], project: 'github.com/acme/shop' } })
      // No pick is no argument, never a null one.
      await onMachineStartCheck(projectId(shop), url)
      assert.deepEqual((calls[1]!.body as { args: unknown[] }).args, [projectId(shop)])

      // A machine without the project yet, one that runs an older OpenAgent, an answer that is no check, and none: nothing to say.
      for (const said of [{ status: 404, said: 'no such project on this machine' }, { status: 500, said: 'unknown relay rpc: onStartCheck' }, { said: { result: { problems: 'all' } } }, { said: { result: null } }]) {
        answer = said
        assert.equal(await onMachineStartCheck(projectId(shop), url, 'claude-code'), null, JSON.stringify(said))
      }
      assert.equal(await onMachineStartCheck(projectId(shop), 'http://127.0.0.1:1'), null)

      // A machine without the project yet says what its clone and the run would hit, asked by the repository's address and its name here.
      const unreadable = 'experiment has no login that can read github.com/acme/shop, or there is no such repository: a private one needs a login. git said: Repository not found.'
      answer = { status: 404, said: 'no such project on this machine' }
      cloning = { said: { result: { problems: [unreadable], warnings: [] } } }
      calls.length = 0
      assert.deepEqual(await onMachineStartCheck(projectId(shop), url, 'codex'), { problems: [unreadable], warnings: [] })
      assert.deepEqual(calls[1], { url: '/_devices/via/c1/_relay/machine', auth: 'Bearer d1.key', body: { fn: 'onCloneCheck', args: ['github.com/acme/shop', 'codex', 'experiment'] } })
      // One that has it is not asked about a clone, whatever it says.
      answer = { said: { result: null } }
      calls.length = 0
      assert.equal(await onMachineStartCheck(projectId(shop), url, 'codex'), null)
      assert.equal(calls.length, 1)
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
      await rm(shop, { recursive: true, force: true })
    }
  })
})

test("another computer's project is named to that computer as it knows it, and to any other by its address; this computer clones it from its spelling, with its records' answer", async () => {
  await withHome(async () => {
    const calls: { url?: string | undefined; body: unknown }[] = []
    const srv: Server = createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        calls.push({ url: req.url, body: raw ? JSON.parse(raw) : null })
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.url?.endsWith('/_relay/project') ? { state: 'coming' } : { result: { problems: [], warnings: [] } }))
      })
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    const laptop = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
    const studio = `${laptop}/studio`
    const shop: OwnProject = { id: 'shop-1abc', name: 'shop', path: '/Users/me/shop', address: 'github.com/acme/shop', spelling: 'github.com/Acme/Shop', share: false, gitHost: true, activated: true }
    const notes: OwnProject = { id: 'notes-2def', name: 'notes', path: '/Users/me/notes', share: true, gitHost: false, activated: true }
    const brought: [string, BringProject | undefined][] = []
    const base = testDashboardContext()
    setDashboardContext(
      testDashboardContext({
        remote: {
          ...base.remote,
          ...NO_ELSEWHERE,
          elsewhereHome: async id => (id === elsewhereId(shop.id, laptop) ? { machine: laptop, project: shop } : id === elsewhereId(notes.id, laptop) ? { machine: laptop, project: notes } : undefined),
          bringHere: async (address, bring) => {
            brought.push([address, bring])
            return { state: bring ? 'coming' : 'there' }
          },
        },
      }),
    )
    try {
      await addMachine({ url: laptop, key: 'd1.laptop', door: `${laptop}${ENTER}`, label: 'MacBook' })
      await addMachine({ url: studio, key: 'd1.studio', door: `${studio}${ENTER}`, label: 'Studio' })
      const shopHere = elsewhereId(shop.id, laptop)
      const notesHere = elsewhereId(notes.id, laptop)

      await onMachineStartCheck(shopHere, laptop, 'codex')
      await onMachineStartCheck(notesHere, laptop)
      await onMachineStartCheck(shopHere, studio)
      assert.deepEqual(
        calls.map(call => (call.body as { project: string }).project),
        // Its own computer by its address, or its id there when it has none; another by its address.
        ['github.com/acme/shop', '#notes-2def', 'github.com/acme/shop'],
      )
      // A project with no address goes to no other computer.
      assert.equal(await onMachineStartCheck(notesHere, studio), null)
      assert.equal(calls.length, 3)

      // Another computer clones it as it would one of this computer's: from its spelling, with its records' answer.
      assert.deepEqual(await sendProjectToMachine(shopHere, studio), { ok: true, there: false })
      assert.deepEqual(calls[3], { url: '/studio/_relay/project', body: { project: 'github.com/acme/shop', share: false, from: 'github.com/Acme/Shop' } })

      // And this computer the same way.
      assert.deepEqual(await sendProjectHere(shopHere), { ok: true, there: false })
      assert.deepEqual(await onProjectHere(shopHere), { ok: true, there: true })
      assert.deepEqual(brought, [
        ['github.com/acme/shop', { share: false, from: 'github.com/Acme/Shop' }],
        ['github.com/acme/shop', undefined],
      ])
      assert.deepEqual(await sendProjectHere(notesHere), { ok: false, error: 'notes has no repository address, so it cannot be cloned here.' })
      assert.deepEqual(await sendProjectHere(projectId('/somewhere/shop')), { ok: false, error: `unknown project: ${projectId('/somewhere/shop')}` })
      assert.equal(brought.length, 2)
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
    }
  })
})

test('a saved server\'s computers on a line are listed, and one is saved as a machine reached through the server with this computer\'s key there; it follows the server when that is saved again or removed', async () => {
  await withHome(async file => {
    const server = await machine(['first', 'second'], undefined, [{ id: 'abc123def456', name: 'Studio', online: true }, { id: '../../_rpc', name: 'Sneaky', online: true }, { id: 'def456abc123', name: ' ', online: false }])
    try {
      await sendAddMachine(server.link('first'), 'Box')
      assert.deepEqual(await onComputersThrough(server.url), { ok: true, computers: [{ id: 'abc123def456', name: 'Studio', online: true, added: false }] })
      const through = `${server.url}/_devices/via/abc123def456`
      assert.deepEqual(await sendAddComputerThrough(server.url, 'abc123def456'), { ok: true, machine: { id: through, label: 'Studio (through Box)', url: through } })
      assert.deepEqual(await sendAddComputerThrough(server.url, 'nobody123456'), { ok: false, error: 'Box has no such computer on a line now.' })
      assert.deepEqual((await onComputersThrough(server.url)).ok && (await onComputersThrough(server.url) as { computers: { added: boolean }[] }).computers.map(computer => computer.added), [true])
      // A computer saved through a server is no server of its own.
      assert.deepEqual(await onComputersThrough(through), { ok: true, computers: [] })
      const keyOf = async (url: string): Promise<string> => (JSON.parse(await readFile(file, 'utf8')).machines as { url: string; key: string }[]).find(saved => saved.url === url)!.key
      assert.equal(await keyOf(through), await keyOf(server.url))

      // Saved again, as every install there ends, an update too: the person's word that it uses this computer's logins stays.
      const loginsOf = async (url: string): Promise<unknown> => (JSON.parse(await readFile(file, 'utf8')).machines as { url: string; logins?: true }[]).find(saved => saved.url === url)!.logins
      assert.equal(await useLoginsOn(through, true), true)
      assert.deepEqual(await sendAddComputerThrough(server.url, 'abc123def456'), { ok: true, machine: { id: through, label: 'Studio (through Box)', url: through } })
      assert.equal(await loginsOf(through), true)
      // One that never said so is saved again without it.
      await useLoginsOn(through, false)
      await sendAddComputerThrough(server.url, 'abc123def456')
      assert.equal(await loginsOf(through), undefined)

      // The server saved again, with a new key: the computer through it takes the new one.
      await sendAddMachine(server.link('second'))
      assert.equal(await keyOf(through), 'd2.key-second')
      // The server removed: the computer reached through it goes with it.
      assert.deepEqual(await sendRemoveMachine(server.url), { ok: true })
      assert.deepEqual(await onMachines(), [])
    } finally {
      await server.close()
    }
  })
})

test('a machine that is no server has no computers through it, and one whose key is out says so', async () => {
  await withHome(async () => {
    const plain = await machine(['a'])
    try {
      await sendAddMachine(plain.link('a'))
      assert.deepEqual(await onComputersThrough(plain.url), { ok: true, computers: [] })
      assert.deepEqual(await onComputersThrough('http://10.9.9.9:4201'), { ok: false, error: 'That machine is no longer saved.' })
    } finally {
      await plain.close()
    }
  })
})
