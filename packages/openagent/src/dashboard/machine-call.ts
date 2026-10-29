import { createHash, createHmac } from 'node:crypto'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { connect, type TLSSocket } from 'node:tls'
import { computerNameOf, renameThisComputer } from '../registry.js'

/**
 * One call to a saved machine. A machine reached over HTTPS whose link carried what its key is
 * known by is known by that key alone: the connection is made, the key the machine shows is
 * compared, and only then is anything sent, so a key and a prompt never reach whoever holds the
 * machine's address next. The key stays when the machine renews its certificate, and a
 * certificate that ran out while its office could not be reached does not cut the machine off.
 *
 * Any other machine (one on the same Wi-Fi, over plain HTTP) is called as it always was. Neither
 * kind of call follows a redirect.
 */

/** What a key is known by: the SHA-256 of its public half, URL-safe. */
function fingerprintOf(socket: TLSSocket): string | undefined {
  const shown = socket.getPeerX509Certificate()
  return shown && createHash('sha256').update(shown.publicKey.export({ type: 'spki', format: 'der' })).digest('base64url')
}

/** What a call says when the machine at the address shows another key than the one it was added with. */
export const NOT_THE_MACHINE = 'what answers at this address is not the machine that was added: add the machine again, with a new link'

/** How long a machine gets to show its key once it took the connection. */
const HANDSHAKE_MS = 10_000

/** How this computer says which one it is to a machine's door, with every call: the door lists it once by it. */
export const COMPUTER_HEADER = 'x-openagent-computer'

/**
 * How this computer says its own name to a machine's door, with every call: the door lists it under
 * the name it has now. URI-encoded: a header carries plain letters only, and a name is any language's.
 */
export const COMPUTER_NAME_HEADER = 'x-openagent-computer-name'

let computer: string | undefined
let named: string | undefined

/** Say which computer this is from here on, with every call to a machine. Set once, when OpenAgent starts. */
export function sayComputer(id: string | undefined): void {
  computer = id
}

/** Say this computer's own name from here on, with every call to a machine: when OpenAgent starts, and when the person renames it. */
export function sayName(name: string | undefined): void {
  named = name
}

/**
 * On a computer several people use, the name its owner gave it, as the door says it to the
 * OpenAgent of each person the owner invited (`OPENAGENT_PERSON`), with every call it passes on:
 * the computer has one name, the owner's, and that OpenAgent goes by it. URI-encoded, as above.
 */
export const OWNERS_NAME_HEADER = 'x-openagent-owners-name'

let heard: string | undefined

/**
 * On a person's own OpenAgent: keep the computer's name the door said, when it changed, and say it
 * from here on. Anywhere else the header is nobody's to say, and is not read.
 */
export function noteOwnersName(header: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env, keep: (name: string) => Promise<unknown> = name => renameThisComputer(name, undefined, env)): void {
  if (!env.OPENAGENT_PERSON || typeof header !== 'string') return
  let name: string | undefined
  try {
    name = computerNameOf(decodeURIComponent(header))
  } catch {
    return
  }
  if (name === undefined || name === heard) return
  heard = name
  named = name
  // One that could not be kept is kept at the next call.
  void keep(name).catch(() => (heard = undefined))
}

/** The word OpenAgent was told to say, as the home file keeps it: what its own packages are handed, to say the same. */
export function computerSaid(): string | undefined {
  return computer
}

/**
 * The word this computer says to one machine's door, made from the word it keeps and that door's
 * address: each door hears another word, so one that a machine learned says nothing at any other.
 * A door's own package makes the same word for the line it keeps to that door.
 */
export function computerWordFor(word: string, door: string): string {
  return createHmac('sha256', word).update(new URL(door).origin).digest('hex').slice(0, 32)
}

export interface MachineCall {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export function machineFetch(url: string, pin: string | undefined, call: MachineCall = {}): Promise<Response> {
  const said = { ...(computer !== undefined ? { [COMPUTER_HEADER]: computerWordFor(computer, url) } : {}), ...(named !== undefined ? { [COMPUTER_NAME_HEADER]: encodeURIComponent(named) } : {}) }
  const init: MachineCall = { ...call, headers: { ...call.headers, ...said } }
  const target = new URL(url)
  if (target.protocol !== 'https:' || pin === undefined) return fetch(url, { ...init, redirect: 'error' })
  return new Promise<Response>((resolve, reject) => {
    const host = target.hostname.replace(/^\[|\]$/g, '')
    const signal = init.signal
    const givenUp = (): Error => (signal?.reason instanceof Error ? signal.reason : new Error('the call was given up on'))
    // A call given up on before the machine took the connection ends here: the request itself
    // says nothing until it has a connection.
    signal?.addEventListener('abort', () => reject(givenUp()), { once: true })
    const req = request(
      target,
      {
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        ...(signal ? { signal } : {}),
        // The connection is made here, by no agent, and handed over only once the machine has
        // shown the key it is known by: one connection for one call.
        createConnection: (_options, handOver) => {
          const socket = connect({ host, port: Number(target.port) || 443, ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: false })
          // The connection goes with the call: one that is given up on, and one a machine takes
          // and then says nothing on, is not left open.
          const drop = (): void => void socket.destroy(givenUp())
          if (signal?.aborted) drop()
          else signal?.addEventListener('abort', drop, { once: true })
          socket.once('close', () => signal?.removeEventListener('abort', drop))
          socket.setTimeout(HANDSHAKE_MS, () => socket.destroy(new Error('the machine took the connection and did not go on')))
          socket.once('error', err => handOver(err, socket))
          socket.once('secureConnect', () => {
            socket.setTimeout(0)
            if (fingerprintOf(socket) === pin) return handOver(null, socket)
            socket.destroy()
            handOver(new Error(NOT_THE_MACHINE), socket)
          })
          return undefined as never
        },
      },
      res => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(res.headers)) for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, one)
        const status = res.statusCode ?? 502
        // A status with no body is answered without one: `Response` refuses a body there.
        const empty = status === 204 || status === 205 || status === 304 || init.method === 'HEAD'
        if (empty) res.resume()
        try {
          resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }))
        } catch (err) {
          // A status no answer can carry: the machine's fault, told as a failed call.
          res.destroy()
          reject(err)
        }
      },
    )
    req.once('error', reject)
    req.end(init.body)
  })
}
