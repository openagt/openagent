import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { CHALLENGE_PREFIX, LETS_ENCRYPT } from './acme.js'
import { onOwnNetwork, urlHost, type AddressDeps } from './address.js'
import { keepCertificate, type KeepOptions, type Keeper, type Secured } from './certificate.js'
import { openDoor, type Door } from './door.js'
import { pidAlive, readStoreStrict, storePath, update, type Store } from './store.js'

/**
 * The door's process: it runs for as long as OpenAgent runs, and follows the file. With the
 * switch on it opens the door; with it off it listens on nothing. A device taken out of the file
 * loses what it still held open.
 *
 * On a server (the file names the address it is reached at) the switch is not looked at: the
 * door is open to every network, over HTTPS, once it has a certificate for that address. The
 * certificate is asked for here and renewed here, and the proof its office reads is shown on
 * port 80, which otherwise only sends a browser on to the door.
 */

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
}

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

/** Run until `signal` aborts. */
export async function serve(opts: ServeOptions): Promise<void> {
  const { env, signal } = opts
  const log = opts.log ?? (() => {})
  const port = opts.port ?? doorPort(opts.target)
  const httpsPort = opts.port ?? HTTPS_PORT
  const proofPort = opts.proofPort ?? PROOF_PORT
  let door: Door | undefined
  let failedAt: number | undefined
  let stamp: string | undefined

  // On a server: the address the door is open at, what shows the proof, what keeps the certificate.
  let served: { address: string; proof: Server; keeper: Keeper } | undefined
  let secured: Secured | undefined
  let asking: string | undefined
  /** Set when the certificate changed or could not be had: the next look is not skipped. */
  let turned = false
  const proofs = new Map<string, string>()

  const closeServed = async (): Promise<void> => {
    if (!served) return
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
    // What is written to the file once this look knows how far the door is.
    let problem: string | undefined
    if (!served) {
      // A door opened for the Wi-Fi is not the server's.
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
        door = await openDoor({ env, target: opts.target, port: httpsPort, ...(opts.host !== undefined ? { host: opts.host } : {}), knocks: () => true, secured: using })
        // A certificate renewed while the door was being opened is the one it speaks with.
        if (secured !== using) door.renew(secured)
        failedAt = undefined
        log(`remote-access: the door is open on port ${door.port}, over HTTPS, at ${address}`)
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
      if (problem !== undefined && store.problem !== problem) log(`remote-access: ${problem}`)
    }
    door?.dropRemoved(store)
  }

  const reconcile = async (): Promise<void> => {
    const now = await stat(storePath(env)).then(s => `${s.mtimeMs}:${s.size}`, () => 'none')
    const retry = failedAt !== undefined && Date.now() - failedAt > (opts.retryMs ?? 10_000)
    if (now === stamp && !retry && !turned) return
    stamp = now
    turned = false
    const store = await readStoreStrict(env)
    // A file that cannot be read is left as it is, and so is the door: it lets nobody in until the file reads again.
    if (store === 'unreadable') return log(`remote-access: ${storePath(env)} cannot be read; nobody gets in until it is corrected`)
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
      log('remote-access: the door is closed')
      return
    }
    if (store.https) return reconcileServed(store, store.https.address)
    if (store.on && !door) {
      try {
        const knocks = opts.address
        door = await openDoor({ env, target: opts.target, port, ...(opts.host !== undefined ? { host: opts.host } : {}), ...(knocks ? { knocks: peer => onOwnNetwork(peer, knocks) } : {}) })
        failedAt = undefined
        log(`remote-access: the door is open on port ${door.port}`)
      } catch (err) {
        failedAt = Date.now()
        const problem = whyNot(err, port)
        // Another door's process holding the port (the one of an OpenAgent that just ended) is no
        // problem to tell: it goes by itself, and the door is tried again.
        const othersDoor = store.listening !== undefined && store.listening.pid !== process.pid && pidAlive(store.listening.pid)
        if (!othersDoor && store.problem !== problem) {
          await update(env, s => {
            delete s.listening
            s.problem = problem
          })
          log(`remote-access: ${problem}`)
        }
      }
    } else if (!store.on && (door || store.listening || store.problem)) {
      await door?.close()
      door = undefined
      failedAt = undefined
      await update(env, s => {
        delete s.listening
        delete s.problem
      })
      log('remote-access: the door is closed')
    }
    if (!door) return
    // Said in the file once the door is open, and again when a write of it failed: by this the command knows the door listens.
    if (store.on && (store.listening === undefined || !pidAlive(store.listening.pid))) {
      const listening = { pid: process.pid, port: door.port }
      // A write that failed is tried at the next look, not taken for a door that did not open.
      stamp = undefined
      await update(env, s => {
        s.listening = listening
        delete s.problem
      })
    }
    door.dropRemoved(store)
  }

  // One look at a time: a look that opens the door writes the file, which the next look reads.
  let looking: Promise<void> = Promise.resolve()
  const look = (): void => {
    looking = looking.then(reconcile).catch(err => log(`remote-access: ${err instanceof Error ? err.message : String(err)}`))
  }
  look()
  const timer = setInterval(look, opts.pollMs ?? 1_000)

  await new Promise<void>(resolve => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
  clearInterval(timer)
  await looking
  await closeServed()
  if (door) {
    await door.close()
    await update(env, s => {
      delete s.listening
    }).catch(() => {})
  }
}
