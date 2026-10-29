import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { hostname } from 'node:os'
import { CHALLENGE_PREFIX, LETS_ENCRYPT } from './acme.js'
import { numberAddress, onOwnNetwork, plainAddress, urlHost, type AddressDeps } from './address.js'
import { keepCertificate, type KeepOptions, type Keeper, type Secured } from './certificate.js'
import { openDoor, type Door } from './door.js'
import { linePorts, openLines, tellOpenAgent, whomToTell } from './line-in.js'
import { askMe, keepLine, type MeThere, type Route } from './line-out.js'
import { startPersonWork } from './persons.js'
import { announce, type Announcing } from './wifi.js'
import { servedAt, serveDoor, stopServing, tailscaleRun, type TailscaleRun } from './tailscale.js'
import { addPerson, computerWordFor, isComputerId, pidAlive, readStore, readStoreStrict, shareLine, storePath, update, type Line, type Store } from './store.js'

/**
 * The door's process: it runs for as long as OpenAgent runs, and follows the file. With the
 * switch on it opens the door; with it off it listens on nothing. A device taken out of the file
 * loses what it still held open.
 *
 * On a server (the file names the address it is reached at) the switch is not looked at: the
 * door is open to every network, over HTTPS, once it has a certificate for that address. The
 * certificate is asked for here and renewed here, and the proof its office reads is shown on
 * port 80, which otherwise only sends a browser on to the door.
 *
 * Behind Tailscale (the file names this computer's name on the person's Tailscale network) a door
 * listens on this computer alone, at the port after the Wi-Fi's, and Tailscale's Serve takes it to
 * the person's devices there (tailscale.ts). Serve is asked for here, again until Tailscale serves
 * it, and let go of when the door is no longer behind Tailscale. The switch still opens the Wi-Fi's
 * door beside it, with its own rules (plain HTTP, a knock from this Wi-Fi), at the port its devices
 * know it by; the file says that one apart (`wifiListening`, `wifiProblem`).
 *
 * While the door is open on the Wi-Fi, it is announced there, so another computer's OpenAgent
 * finds it (wifi.ts); a server's door is not, nor the one behind Tailscale.
 *
 * The lines are kept here too. To each server the file names, this computer keeps a line open,
 * whatever its own door does. And on a server, each computer that keeps a line here gets its
 * address, and OpenAgent is told of it.
 *
 * A call down a line goes where its person's runs here are ({@link routeFor}): this computer's
 * own OpenAgent for its own person, and, on a line for everyone at that server, the OpenAgent of
 * the user of their own that each other person has here, made the first time they need it.
 */

/** Said down a line for a call this computer does not take. */
export const ONLY_ITS_OWN = "This computer is only its own person's: it starts no run of anyone else's."
export const NOT_A_SERVER = 'This computer is not set up as a server: it gives nobody a user of their own.'
export const NO_OWNER = "This computer's owner is not named yet."
export const making = (name: string): string => `${name}'s place on this computer is being made. Try again in a minute.`

/** How often a line for everyone asks its server who is there. */
const MIRROR_MS = 60_000

/**
 * Where a call down `line` goes, by whom of the server's persons it is for. Its own person, or a
 * call that names nobody, reaches this computer's own OpenAgent. Anyone else only on a line for
 * everyone, on a computer that gives each person a user of their own: their own OpenAgent, once
 * their user is made; until then the call is answered that it is being made.
 *
 * A user is made (`make`) only for a call that needs one: a run started, or logins handed over. A
 * page that only looks whether the computer is there, or which logins it has, makes nobody a user:
 * it asks for every machine it lists, every few seconds, whether its person ever runs one there.
 */
export function routeFor(line: Line, store: Store, target: string, env: NodeJS.ProcessEnv, person: string | undefined, call: { method: string; path: string }, make: (name: string) => void, ownersName?: string): Route {
  const owner = store.persons.find(candidate => candidate.owner)?.name
  // A line that never heard who its person is takes every call as theirs, as before persons; a line for everyone does not.
  if (person === undefined || person === line.person || person === owner || (line.person === undefined && line.for !== 'everyone')) return { target }
  if (line.for !== 'everyone') return { status: 403, text: ONLY_ITS_OWN }
  if (!env.OPENAGENT_PERSON_HELPER) return { status: 403, text: NOT_A_SERVER }
  if (owner === undefined) return { status: 503, text: NO_OWNER }
  const theirs = store.persons.find(candidate => candidate.name === person && !candidate.owner)
  // Their OpenAgent goes by this computer's name, as its owner named it.
  if (theirs?.ready && theirs.port !== undefined) return { target: `http://127.0.0.1:${theirs.port}`, ...(ownersName !== undefined ? { ownersName } : {}) }
  const route = call.path.split('?')[0]
  // Whether the computer is there: its own OpenAgent says so, with its version and name and nothing else.
  if (call.method === 'GET' && route === '/_relay/ping') return { target }
  // No logins here yet: a server that is to copy them hands them over next, and that makes the user.
  if (call.method === 'GET' && route === '/_relay/logins') return { status: 200, text: '{}', type: 'application/json' }
  const working = theirs?.worker !== undefined && pidAlive(theirs.worker)
  const needed = call.method === 'POST' && (route === '/_relay/start' || route === '/_relay/logins')
  if (needed && !working) make(person)
  // One that could not be made says why, and is tried again at the next run.
  return { status: 503, text: theirs?.problem !== undefined && !working ? `@${person}'s place on this computer could not be made: ${theirs.problem.replace(/\.?$/, '.')} It is tried again at the next run.` : making(person) }
}

/** The door's port on a server, and the port the certificate office reads the proof on. */
export const HTTPS_PORT = 443
export const PROOF_PORT = 80

export interface ServeOptions {
  env: NodeJS.ProcessEnv
  /** OpenAgent's own address on this computer. */
  target: string
  /** The door's port; when unsaid the one after OpenAgent's own, so it is the same at every start, and 443 on a server. */
  port?: number
  /** On a server: the port the proof is shown on (80 when unsaid), and the certificate office's directory (Let's Encrypt's when unsaid). */
  proofPort?: number
  directory?: string
  /** On a server: how the certificate is kept, for a test that cannot wait days. */
  keep?: Pick<KeepOptions, 'now' | 'lookMs' | 'retryMs' | 'pollMs'>
  host?: string
  address?: AddressDeps
  /** Ends the process's work: the door is closed and the file says so. */
  signal: AbortSignal
  log?: (line: string) => void
  /** How often the file is looked at. */
  pollMs?: number
  /** After how long a door that could not be opened is tried again. */
  retryMs?: number
  /** How a line is kept, for a test that cannot wait: its retries, its questions, its patience. */
  line?: { retryMs?: readonly number[]; pingMs?: number; quietMs?: number }
  /** How often a line for everyone asks its server who is there, and how it asks; for a test. */
  mirrorMs?: number
  askMe?: typeof askMe
  /** How the making of a person's user is started on its own; this package's own command, detached, when unsaid. */
  startWork?: (env: NodeJS.ProcessEnv, person: string) => number | undefined
  /** How the door is announced on the Wi-Fi; on the network itself when unsaid. */
  announce?: typeof announce
  /** How the `tailscale` command is run; the computer's own when unsaid. */
  tailscale?: TailscaleRun
  /** How often the owner's OpenAgent is asked the computer's name; for a test. */
  ownersNameMs?: number
}

/** OpenAgent's version, as its own ping says it: what the Wi-Fi is told beside this computer's name. */
async function versionAt(target: string): Promise<string | undefined> {
  const { version } = await pingAt(target)
  return typeof version === 'string' && /^[\w.+-]{1,40}$/.test(version) ? version : undefined
}

/** This computer's name as its owner named it, as the owner's OpenAgent says it in its ping. */
async function nameAt(target: string): Promise<string | undefined> {
  const { name } = await pingAt(target)
  return typeof name === 'string' && name.trim() !== '' && name.length <= 200 ? name : undefined
}

/** What OpenAgent's own ping says; nothing when it does not answer. */
async function pingAt(target: string): Promise<{ version?: unknown; name?: unknown }> {
  try {
    const res = await fetch(`${target}/_relay/ping`, { signal: AbortSignal.timeout(5_000) })
    return ((await res.json()) ?? {}) as { version?: unknown; name?: unknown }
  } catch {
    return {}
  }
}

/** How often the owner's OpenAgent is asked the computer's name, to say it to each person's own. */
const OWNERS_NAME_MS = 60_000

/** The door's port for an OpenAgent at `target`. */
export function doorPort(target: string): number {
  const url = new URL(target)
  return (Number(url.port) || 80) + 1
}

function whyNot(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') return `Port ${port} is taken by another program on this computer.`
  if (code === 'EACCES') return `This computer does not let OpenAgent listen on port ${port}.`
  return `The door could not be opened: ${err instanceof Error ? err.message : String(err)}`
}

/** Whether a port is taken by the door's process of an OpenAgent that just ended: it is tried again, and is no problem to tell. */
function startingOver(err: unknown, store: Store): boolean {
  return (err as NodeJS.ErrnoException).code === 'EADDRINUSE' && store.listening !== undefined && store.listening.pid !== process.pid && pidAlive(store.listening.pid)
}

/** What is open on port 80 of a server: the proof a certificate office reads, and a way on to the door for everything else. */
async function openProof(port: number, host: string | undefined, proofs: ReadonlyMap<string, string>, doorAt: () => string): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url ?? '/'
    // Only a path is sent on: anything else a request names is not this computer's to point at.
    if (!path.startsWith('/')) return void res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
    if (path.startsWith(CHALLENGE_PREFIX)) {
      const proof = proofs.get(path.slice(CHALLENGE_PREFIX.length))
      return void res.writeHead(proof === undefined ? 404 : 200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end(proof ?? 'not found')
    }
    res.writeHead(308, { location: `${doorAt()}${path}`, 'cache-control': 'no-store' }).end()
  })
  // Open to every network: a caller that sends nothing, or too many at once, is not waited for.
  server.headersTimeout = 10_000
  server.maxConnections = 256
  const listen = (on: string): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, on, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  if (host !== undefined) await listen(host)
  else await listen('::').catch(err => ((err as NodeJS.ErrnoException).code === 'EAFNOSUPPORT' ? listen('0.0.0.0') : Promise.reject(err)))
  return server
}

/** Whether a request comes from this computer itself: the only caller a door behind Tailscale lets knock, Tailscale's Serve. */
function fromThisComputer(peer: string | undefined): boolean {
  const address = plainAddress(peer ?? '')
  return address === '::1' || /^127\./.test(address)
}

/** What the door behind Tailscale says while Tailscale is first asked to serve it. */
export const ASKING_TAILSCALE = 'Tailscale is being asked to serve the door. One moment.'

/** How long a door behind Tailscale waits before asking Serve again, when it did not serve the door: Tailscale waits each time to be turned on. */
const SERVE_AGAIN_MS = 30_000

/** Run until `signal` aborts. */
export async function serve(opts: ServeOptions): Promise<void> {
  const { env, signal } = opts
  const log = opts.log ?? (() => {})
  const port = opts.port ?? doorPort(opts.target)
  const httpsPort = opts.port ?? HTTPS_PORT
  const proofPort = opts.proofPort ?? PROOF_PORT
  let door: Door | undefined
  // Behind Tailscale, a door of its own, on this computer alone, at the port after the Wi-Fi's: the
  // Wi-Fi's goes on beside it, at the port its devices know it by, while the switch is on.
  let behindDoor: Door | undefined
  const behindPort = port === 0 ? 0 : port + 1
  let failedAt: number | undefined
  let stamp: string | undefined

  // On a server: the address the door is open at, what shows the proof, what keeps the certificate.
  let served: { address: string; proof: Server; keeper: Keeper } | undefined
  let secured: Secured | undefined
  let asking: string | undefined
  /** Set when the certificate changed or could not be had: the next look is not skipped. */
  let turned = false
  const proofs = new Map<string, string>()

  // Behind Tailscale: the name the door is served at, and whether Tailscale serves it yet.
  let behind: { address: string; serving: boolean; askedAt?: number } | undefined
  const tailscale = opts.tailscale ?? tailscaleRun(env, signal)

  // This computer's name as its owner named it, asked of the owner's OpenAgent now and then: the
  // door says it to each person's own OpenAgent, which goes by it.
  // Asked only where a person has an OpenAgent of their own, and never waited for: a look goes on.
  let ownersName: string | undefined
  let ownersNameAt = -Infinity
  const hearOwnersName = (): void => {
    if (!latest?.persons.some(person => !person.owner && person.port !== undefined)) return
    if (Date.now() - ownersNameAt < (opts.ownersNameMs ?? OWNERS_NAME_MS)) return
    ownersNameAt = Date.now()
    void nameAt(opts.target).then(name => void (ownersName = name ?? ownersName))
  }

  // Said on the Wi-Fi while the door is open there.
  let announcing: Promise<Announcing | undefined> | undefined
  const startAnnouncing = (port: number): void => {
    if (announcing) return
    announcing = (async () => {
      const address = numberAddress(opts.address)
      if (!address) return undefined
      return (opts.announce ?? announce)({ name: hostname().replace(/\.local$/i, '') || 'A computer', port, address, ...(await versionAt(opts.target).then(version => (version ? { version } : {}))) })
    })().catch((err: unknown) => {
      log(`devices: this computer could not be announced on the Wi-Fi, so other computers do not find it there: ${err instanceof Error ? err.message : String(err)}`)
      return undefined
    })
  }
  const stopAnnouncing = async (): Promise<void> => {
    const was = announcing
    announcing = undefined
    await (await was)?.stop().catch(() => {})
  }

  // The lines this computer keeps open, by what each is asked for with; what each server may do is read anew for every call.
  const kept = new Map<string, AbortController>()
  const modes = new Map<string, Line['mode']>()
  /** Write down whether the server took the key a line was asked for with, when that changed. */
  const answers = new Map<string, boolean>()
  const noteAnswer = async (asked: Line, letIn: boolean): Promise<void> => {
    // Only a change is written: a line that calls again says the same each time, and so does a server that keeps saying no.
    if (answers.get(asked.key) === letIn) return
    // Remembered once it is written: an answer that could not be written down is written at the next one.
    const written = await update(env, store => {
      const line = store.lines.find(candidate => candidate.url === asked.url && candidate.key === asked.key)
      if (line && (line.refused === true) === letIn) {
        if (letIn) delete line.refused
        else line.refused = true
      }
      return true
    }).catch(() => false)
    if (written) answers.set(asked.key, letIn)
  }
  // The file as the last look read it: where each call down a line goes is read off it, at once.
  let latest: Store | undefined
  // The persons whose user this process started making: one call after another while it is made starts it once.
  const asked = new Set<string>()
  const make = (name: string, from: string): void => {
    if (asked.has(name)) return
    asked.add(name)
    void (async () => {
      const person = await addPerson(env, name, Date.now(), true)
      if (!person?.port) return log(`devices: ${name} could not be given a place on this computer: it has as many persons as it can, or no owner`)
      // Started again only when it is not made and no making of it is at work, as the file says now: a
      // call that read the file a moment earlier may ask for one that was made since. One that failed is asked again.
      const working = person.ready === true || (person.worker !== undefined && pidAlive(person.worker))
      const known = (kept: Store): Store['persons'][number] | undefined => kept.persons.find(candidate => candidate.name === name && !candidate.owner)
      // Which server they came from, written before their user is made: whoever reads that it is made reads where they came from too.
      await update(env, kept => {
        const them = known(kept)
        if (!them) return
        them.from ??= from
        if (!working) delete them.problem
      })
      if (working) return
      const worker = (opts.startWork ?? startPersonWork)(env, name)
      if (worker === undefined) return
      await update(env, kept => {
        const them = known(kept)
        if (them) them.worker = worker
      })
    })()
      .catch(err => log(`devices: ${name}'s place on this computer could not be made: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => asked.delete(name))
  }
  const followLines = (store: Store): void => {
    latest = store
    // A line asked for again when who may use it changed: the server is told as the line is asked for.
    const wanted = new Map(store.lines.map(line => [`${line.url}\n${line.pin}\n${line.key}\n${line.for ?? ''}`, line]))
    modes.clear()
    for (const line of store.lines) modes.set(line.url, line.mode)
    for (const [id, controller] of kept) {
      if (wanted.has(id)) continue
      controller.abort()
      kept.delete(id)
    }
    for (const [id, line] of wanted) {
      if (kept.has(id)) continue
      const controller = new AbortController()
      kept.set(id, controller)
      answers.set(line.key, !line.refused)
      // Which computer this is, as OpenAgent said when it started this door: its line says the same.
      const computer = isComputerId(env.OPENAGENT_COMPUTER) ? computerWordFor(env.OPENAGENT_COMPUTER, line.url) : undefined
      void keepLine({
        url: line.url,
        pin: line.pin,
        key: line.key,
        ...(computer !== undefined ? { computer } : {}),
        // Written down, so the person is told: a line the server said no to stays so until it is asked for anew.
        onAnswer: letIn => void noteAnswer(line, letIn),
        everyone: line.for === 'everyone',
        // The line as the file says it now: who its person is may have been heard since it was asked for.
        route: (person, call) => {
          const now = latest ?? store
          return routeFor(now.lines.find(candidate => candidate.url === line.url) ?? line, now, opts.target, env, person, call, name => make(name, line.url), ownersName)
        },
        watch: () => modes.get(line.url) !== 'full',
        signal: controller.signal,
        log,
        ...opts.line,
      })
    }
  }

  // On a server: the computers that keep a line here, and whether OpenAgent still has to be told of them.
  const ports = linePorts(opts.target, env)
  let untold = false
  let toldAt = 0
  let whyUntold: string | undefined
  const lines = openLines({ log, ...(opts.line?.quietMs !== undefined ? { quietMs: opts.line.quietMs } : {}), onChange: () => void (untold = true) })
  const tell = async (): Promise<void> => {
    // Told at once when there is something to tell; after a failure, not before a while has passed.
    if (!untold || !door || !served || Date.now() - toldAt < (opts.retryMs ?? 10_000) / 2) return
    // Cleared before the telling: a computer that calls while OpenAgent is being told is told of next.
    untold = false
    try {
      // Each OpenAgent on this server of its own computers: one that does not answer (a person's that is starting) holds no other up.
      const told = await Promise.allSettled(whomToTell(await readStore(env), opts.target, ports, lines.computers()).map(async ({ person, target, ports: theirs, computers }) => tellOpenAgent(target, computers, theirs).catch((err: unknown) => Promise.reject(new Error(`${person !== undefined ? `@${person}'s OpenAgent: ` : ''}${err instanceof Error ? err.message : String(err)}`)))))
      const failed = told.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
      whyUntold = undefined
    } catch (err) {
      untold = true
      toldAt = Date.now()
      const why = err instanceof Error ? err.message : String(err)
      // Said once: an OpenAgent that is still starting fails the same way until it is up.
      if (why !== whyUntold) log(`devices: OpenAgent was not told of the computers on a line yet: ${why}`)
      whyUntold = why
    }
  }

  /**
   * On a server: each computer whose line is for everyone has an address for each person here,
   * also for one invited after its line was asked for, and none for one who left. Written only
   * when something is missing or left over.
   */
  const shareLines = async (store: Store): Promise<void> => {
    const looked = structuredClone(store)
    if (!looked.devices.some(device => device.line?.others !== undefined && shareLine(looked, device, ports))) return
    await update(env, kept => {
      for (const device of kept.devices) if (device.line?.others !== undefined) shareLine(kept, device, ports)
    })
  }

  // A line for everyone asks its server now and then who is there: who of those given a user here left it.
  // Any other line asks too until it has heard whose it is: a call for anyone else is refused only by that.
  const heardAt = new Map<string, number>()
  const mirror = (): void => {
    for (const line of latest?.lines ?? []) {
      if ((line.for !== 'everyone' && line.person !== undefined) || line.refused || Date.now() - (heardAt.get(line.key) ?? -Infinity) < (opts.mirrorMs ?? MIRROR_MS)) continue
      // Asked once in a while, whatever came of the last time: a server that is away is not asked in a hurry.
      heardAt.set(line.key, Date.now())
      void (opts.askMe ?? askMe)(line)
        .then(async (said: MeThere | undefined) => {
          if (!said) return
          const same = (kept: Line): boolean => (said.person === undefined || kept.person === said.person) && (said.persons === undefined || JSON.stringify(kept.persons) === JSON.stringify(said.persons))
          if (same(line)) return
          await update(env, store => {
            const kept = store.lines.find(candidate => candidate.url === line.url && candidate.key === line.key)
            if (!kept || same(kept)) return
            if (said.person !== undefined) kept.person = said.person
            if (said.persons !== undefined && kept.for === 'everyone') kept.persons = said.persons
          })
        })
        .catch(err => log(`devices: ${new URL(line.url).host} could not be asked who is there: ${err instanceof Error ? err.message : String(err)}`))
    }
  }

  const closeServed = async (): Promise<void> => {
    if (!served) return
    await lines.close()
    served.keeper.stop()
    served.proof.closeAllConnections()
    await new Promise<void>(resolve => served!.proof.close(() => resolve()))
    served = undefined
    secured = undefined
    asking = undefined
    proofs.clear()
  }

  /** The door on a server at `address`: the proof, the certificate, then the door itself. */
  const reconcileServed = async (store: Store, address: string): Promise<void> => {
    await shareLines(store)
    // What is written to the file once this look knows how far the door is.
    let problem: string | undefined
    if (!served) {
      // A door opened for the Wi-Fi is not the server's.
      await stopAnnouncing()
      await door?.close()
      door = undefined
      let proof: Server | undefined
      try {
        proof = await openProof(proofPort, opts.host, proofs, () => {
          const at = door?.port ?? httpsPort
          return `https://${urlHost(address)}${at === HTTPS_PORT ? '' : `:${at}`}`
        })
        const keeper = await keepCertificate({
          env,
          host: address,
          directory: opts.directory ?? LETS_ENCRYPT,
          prove: (token, content) => void proofs.set(token, content),
          withdraw: token => void proofs.delete(token),
          onCertificate: fresh => {
            secured = fresh
            door?.renew(fresh)
            turned = true
          },
          onProblem: words => {
            asking = words
            turned = true
          },
          ...opts.keep,
        })
        served = { address, proof, keeper }
      } catch (err) {
        failedAt = Date.now()
        // What was opened for a certificate that cannot be kept (a key file that cannot be read) is closed again.
        if (proof) {
          proof.closeAllConnections()
          await new Promise<void>(resolve => proof!.close(() => resolve()))
        }
        // The door's process of an OpenAgent that just ended still holds the port: it goes by itself.
        problem = startingOver(err, store) ? store.problem : whyNot(err, proofPort)
      }
    }
    if (served && !door && secured) {
      try {
        const using = secured
        door = await openDoor({ env, target: opts.target, port: httpsPort, ...(opts.host !== undefined ? { host: opts.host } : {}), knocks: () => true, secured: using, lines: { take: lines.take, ports, connected: lines.connected, pass: lines.pass }, ownersName: () => ownersName })
        // OpenAgent may have started anew since it was last told.
        untold = true
        // A certificate renewed while the door was being opened is the one it speaks with.
        if (secured !== using) door.renew(secured)
        failedAt = undefined
        log(`devices: the door is open on port ${door.port}, over HTTPS, at ${address}`)
      } catch (err) {
        failedAt = Date.now()
        problem = startingOver(err, store) ? store.problem : whyNot(err, httpsPort)
      }
    }
    if (served && problem === undefined) {
      if (!door) problem = asking !== undefined ? `No certificate for ${address} yet: ${asking}` : `The certificate for ${address} is being asked for.`
      else if (asking !== undefined) problem = `The certificate for ${address} could not be renewed: ${asking}`
    }
    const listening = door && (store.listening === undefined || store.listening.pid !== process.pid || store.listening.port !== door.port) ? { pid: process.pid, port: door.port } : undefined
    if (listening || store.problem !== problem || (!door && store.listening?.pid === process.pid)) {
      stamp = undefined
      await update(env, s => {
        if (listening) s.listening = listening
        else if (!door) delete s.listening
        if (problem === undefined) delete s.problem
        else s.problem = problem
      })
      if (problem !== undefined && store.problem !== problem) log(`devices: ${problem}`)
    }
    door?.dropRemoved(store)
    if (door) await lines.follow(store)
  }

  /** The door behind Tailscale at `address`: open on this computer alone, then served by Tailscale. */
  const reconcileBehind = async (store: Store, address: string): Promise<void> => {
    let problem: string | undefined
    let fixAt: string | undefined
    if (!behind) {
      try {
        behindDoor = await openDoor({ env, target: opts.target, port: behindPort, host: '127.0.0.1', knocks: fromThisComputer, proxied: true, origin: `https://${address}`, ownersName: () => ownersName })
        behind = { address, serving: false }
        failedAt = undefined
        log(`devices: the door is open on port ${behindDoor.port} of this computer, for Tailscale to serve at ${address}`)
      } catch (err) {
        failedAt = Date.now()
        problem = startingOver(err, store) ? store.problem : whyNot(err, behindPort)
      }
    }
    const door = behindDoor
    // Asked of Tailscale until it serves the door, not more often than it waits each time to be turned on.
    if (door && behind && !behind.serving && Date.now() - (behind.askedAt ?? -Infinity) >= (opts.retryMs ?? SERVE_AGAIN_MS)) {
      behind.askedAt = Date.now()
      // Tailscale takes a while to answer when Serve is off: meanwhile the file says what is under way.
      if (store.problem === undefined) {
        await update(env, s => void (s.problem ??= ASKING_TAILSCALE))
        // What the file says now, so the answer below replaces it.
        store.problem = ASKING_TAILSCALE
      }
      const ours = `http://127.0.0.1:${door.port}`
      const at = await servedAt(tailscale, address)
      if (!at.ok) problem = at.problem
      else if (at.value === ours) behind.serving = true
      // The door Tailscale served before it had a port of its own, at the Wi-Fi's: served here instead.
      else if (at.value !== undefined && (port === 0 || at.value !== `http://127.0.0.1:${port}`)) problem = `Tailscale already serves something else at https://${address}, so OpenAgent's door is not served there. Stop that with tailscale serve --https=443 off, and the door is served next.`
      else {
        const served = await serveDoor(tailscale, door.port)
        if (served.ok) behind.serving = true
        else {
          problem = served.problem
          fixAt = served.enable
        }
      }
      if (behind.serving) log(`devices: Tailscale serves the door at https://${address}`)
    } else if (door && behind && !behind.serving) {
      // Between two asks, the last answer stands.
      problem = store.problem
      fixAt = store.fixAt
    }
    // Looked at again soon: the next ask of Tailscale is not left waiting for the file to change.
    if (behind && !behind.serving) turned = true
    const listening = door && behind?.serving && (store.listening === undefined || store.listening.pid !== process.pid || store.listening.port !== door.port) ? { pid: process.pid, port: door.port } : undefined
    if (listening || store.problem !== problem || store.fixAt !== fixAt || (!behind?.serving && store.listening?.pid === process.pid)) {
      stamp = undefined
      await update(env, s => {
        if (listening) s.listening = listening
        else if (!behind?.serving) delete s.listening
        if (problem === undefined) delete s.problem
        else s.problem = problem
        if (fixAt === undefined) delete s.fixAt
        else s.fixAt = fixAt
      })
      if (problem !== undefined && store.problem !== problem) log(`devices: ${problem}`)
    }
    door?.dropRemoved(store)
  }

  /** The door no longer behind Tailscale: Tailscale serves it no more, when it was the door it served, and it is closed. */
  const leaveTailscale = async (): Promise<void> => {
    const was = behind
    behind = undefined
    if (was && behindDoor) {
      const at = await servedAt(tailscale, was.address)
      if (at.ok && at.value === `http://127.0.0.1:${behindDoor.port}`) {
        const stopped = await stopServing(tailscale)
        if (!stopped.ok) log(`devices: ${stopped.problem}`)
      }
    }
    await behindDoor?.close()
    behindDoor = undefined
    failedAt = undefined
    // The Wi-Fi's door, when it is open, is said in the file as the door at the next look.
    await update(env, s => {
      delete s.listening
      delete s.problem
      delete s.fixAt
      delete s.wifiListening
      delete s.wifiProblem
    })
    log('devices: the door behind Tailscale is closed')
  }

  const reconcile = async (): Promise<void> => {
    const now = await stat(storePath(env)).then(s => `${s.mtimeMs}:${s.size}`, () => 'none')
    const retry = failedAt !== undefined && Date.now() - failedAt > (opts.retryMs ?? 10_000)
    if (now === stamp && !retry && !turned) return
    stamp = now
    turned = false
    const store = await readStoreStrict(env)
    // A file that cannot be read is left as it is, and so is the door: it lets nobody in until the file reads again.
    if (store === 'unreadable') return log(`devices: ${storePath(env)} cannot be read; nobody gets in until it is corrected`)
    followLines(store)
    // No longer a server, or one at another address: what was open for the old address is closed.
    if (served && served.address !== store.https?.address) {
      await closeServed()
      await door?.close()
      door = undefined
      failedAt = undefined
      stamp = undefined
      await update(env, s => {
        delete s.listening
        delete s.problem
      })
      log('devices: the door is closed')
      return
    }
    // No longer behind Tailscale, or at another name: Tailscale lets go of the door, and it is closed.
    if (behind && behind.address !== store.tailscale?.address) {
      await leaveTailscale()
      stamp = undefined
      return
    }
    if (store.https) return reconcileServed(store, store.https.address)
    if (store.tailscale) await reconcileBehind(store, store.tailscale.address)
    // The Wi-Fi's door, by the switch: the door, or one beside the door behind Tailscale, whose
    // place in the file it then leaves alone.
    const beside = store.tailscale !== undefined
    const heard = beside ? store.wifiListening : store.listening
    const said = beside ? store.wifiProblem : store.problem
    const note = (s: Store, listening: Store['listening'], problem: string | undefined): void => {
      if (beside) {
        if (listening) s.wifiListening = listening
        else delete s.wifiListening
        if (problem === undefined) delete s.wifiProblem
        else s.wifiProblem = problem
      } else {
        if (listening) s.listening = listening
        else delete s.listening
        if (problem === undefined) delete s.problem
        else s.problem = problem
      }
    }
    if (store.on && !door) {
      try {
        const knocks = opts.address
        door = await openDoor({ env, target: opts.target, port, ...(opts.host !== undefined ? { host: opts.host } : {}), ...(knocks ? { knocks: peer => onOwnNetwork(peer, knocks), address: knocks } : {}), ownersName: () => ownersName })
        failedAt = undefined
        log(`devices: the door is open on port ${door.port}${beside ? ', on this Wi-Fi' : ''}`)
      } catch (err) {
        failedAt = Date.now()
        const problem = whyNot(err, port)
        // Another door's process holding the port (the one of an OpenAgent that just ended) is no
        // problem to tell: it goes by itself, and the door is tried again.
        const othersDoor = heard !== undefined && heard.pid !== process.pid && pidAlive(heard.pid)
        if (!othersDoor && said !== problem) {
          await update(env, s => note(s, undefined, problem))
          log(`devices: ${problem}`)
        }
      }
    } else if (!store.on && (door || heard || said)) {
      await stopAnnouncing()
      await door?.close()
      door = undefined
      failedAt = undefined
      await update(env, s => note(s, undefined, undefined))
      log(beside ? 'devices: the door on this Wi-Fi is closed' : 'devices: the door is closed')
    }
    if (!door) return
    // Said in the file once the door is open, and again when a write of it failed: by this the command knows the door listens.
    if (store.on && (heard === undefined || !pidAlive(heard.pid) || heard.port !== door.port)) {
      const listening = { pid: process.pid, port: door.port }
      // A write that failed is tried at the next look, not taken for a door that did not open.
      stamp = undefined
      await update(env, s => note(s, listening, undefined))
    }
    startAnnouncing(door.port)
    door.dropRemoved(store)
  }

  // One look at a time: a look that opens the door writes the file, which the next look reads.
  let looking: Promise<void> = Promise.resolve()
  const look = (): void => {
    looking = looking
      .then(reconcile)
      .then(hearOwnersName)
      .then(tell)
      .then(mirror)
      .catch(err => log(`devices: ${err instanceof Error ? err.message : String(err)}`))
  }
  look()
  const timer = setInterval(look, opts.pollMs ?? 1_000)

  await new Promise<void>(resolve => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
  clearInterval(timer)
  await looking
  for (const controller of kept.values()) controller.abort()
  kept.clear()
  await closeServed()
  await stopAnnouncing()
  await behindDoor?.close()
  if (door || behindDoor) {
    await door?.close()
    await update(env, s => {
      delete s.listening
      delete s.wifiListening
    }).catch(() => {})
  }
}
