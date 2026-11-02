import { createPrivateKey, createPublicKey, generateKeyPairSync, X509Certificate, type KeyObject } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { AcmeError, orderCertificate } from './acme.js'
import { certificateRequest, keyFingerprint } from './der.js'
import { storePath } from './store.js'

/**
 * The door's certificate on a server: asked for once the door is told its address, kept in the
 * person's home folder beside the door's file, and asked for again well before it runs out, for
 * as long as the door's process runs. The door's key is made once and stays: each certificate is
 * for the same key, so a computer that knows the key knows the door again after every renewal.
 */

/** The folder the keys and the certificate are kept in: beside the door's file, the person's own. */
export function keysDir(env: NodeJS.ProcessEnv): string {
  return storePath(env).replace(/\.json$/, '')
}

const DOOR_KEY = 'door.key'
const ACCOUNT_KEY = 'account.key'
const CERTIFICATE = 'door.crt'

type KeyPair = { publicKey: KeyObject; privateKey: KeyObject }

async function writePrivate(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await rename(tmp, path)
}

/** What a file holds, or `undefined` when there is no such file. A file that is there and cannot be read throws: it is never taken for none. */
async function kept(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(err => ((err as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(err)))
}

/**
 * The key kept in `file`, made and kept now when there is none. A key file that cannot be read
 * is never replaced: every computer that knows the door knows it by this key.
 */
async function keptKey(dir: string, file: string): Promise<KeyPair> {
  const path = join(dir, file)
  const pem = await kept(path)
  if (pem !== undefined) {
    const privateKey = createPrivateKey(pem)
    return { privateKey, publicKey: createPublicKey(privateKey) }
  }
  const made = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  await writePrivate(path, made.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string)
  return made
}

/** What the door's key is known by, when the door has one: read off the key file, without making one. */
export async function doorFingerprint(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const pem = await kept(join(keysDir(env), DOOR_KEY))
  return pem === undefined ? undefined : keyFingerprint(createPublicKey(createPrivateKey(pem)))
}

/** A key and its certificate, as a TLS server takes them. */
export interface Secured {
  key: string
  cert: string
}

/** The first certificate of a chain, read; `undefined` for what is no certificate. */
function leafOf(chain: string): X509Certificate | undefined {
  try {
    return new X509Certificate(chain)
  } catch {
    return undefined
  }
}

/** Whether `leaf` is a certificate for `host` and for `key`. */
function isFor(leaf: X509Certificate, host: string, key: KeyPair): boolean {
  const named = isIP(host) ? leaf.checkIP(host) : leaf.checkHost(host)
  return named !== undefined && keyFingerprint(leaf.publicKey) === keyFingerprint(key.publicKey)
}

export interface KeepOptions {
  env: NodeJS.ProcessEnv
  /** The address or name the door is reached at. */
  host: string
  /** The certificate office's directory address. */
  directory: string
  /** Show and withdraw the proof the office reads over plain HTTP. */
  prove: (token: string, content: string) => void
  withdraw: (token: string) => void
  /** Called with each certificate: the one kept from before, when it is for this address and key, and each new one. */
  onCertificate: (secured: Secured) => void
  /** Called when asking failed, with the reason in words, and with `undefined` once asking worked again. */
  onProblem: (problem: string | undefined) => void
  now?: () => number
  /** How often the certificate's age is looked at. */
  lookMs?: number
  /** After how long a failed asking is tried again the first time; twice as long after each further failure, up to {@link RETRY_CAP_MS}. */
  retryMs?: number
  pollMs?: number
  fetch?: typeof fetch
}

/** The longest a failed asking waits before the next: an office counts failures, and shuts out an address that keeps failing. */
export const RETRY_CAP_MS = 6 * 60 * 60_000

export interface Keeper {
  stop(): void
}

/** Keep the door's certificate good until `stop`. Resolves once the key exists and the first look was started. */
export async function keepCertificate(opts: KeepOptions): Promise<Keeper> {
  const now = opts.now ?? Date.now
  const dir = keysDir(opts.env)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700).catch(() => {})
  const doorKey = await keptKey(dir, DOOR_KEY)
  const accountKey = await keptKey(dir, ACCOUNT_KEY)
  const key = doorKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  // The certificate kept from before is used when it is for this address and this key, also one
  // that ran out: a computer that knows the door by its key still gets in, and the next is asked for at once.
  let leaf: X509Certificate | undefined
  const keptChain = await kept(join(dir, CERTIFICATE))
  const keptLeaf = keptChain === undefined ? undefined : leafOf(keptChain)
  if (keptChain !== undefined && keptLeaf && isFor(keptLeaf, opts.host, doorKey)) {
    leaf = keptLeaf
    opts.onCertificate({ key, cert: keptChain })
  }

  /** Whether the certificate is past the middle of its life: the time to ask for the next one. */
  const due = (): boolean => {
    if (!leaf) return true
    const from = Date.parse(leaf.validFrom)
    const to = Date.parse(leaf.validTo)
    return now() > from + (to - from) / 2
  }

  let stopped = false
  let asking = false
  /** Not before this time is the office asked again, after a failure. */
  let notBefore = 0
  let failures = 0
  const look = async (): Promise<void> => {
    if (stopped || asking || !due() || now() < notBefore) return
    asking = true
    try {
      const chain = await orderCertificate({
        directory: opts.directory,
        accountKey,
        host: opts.host,
        request: certificateRequest(opts.host, doorKey),
        prove: opts.prove,
        withdraw: opts.withdraw,
        ...(opts.pollMs !== undefined ? { pollMs: opts.pollMs } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      })
      const fresh = leafOf(chain)
      if (!fresh || !isFor(fresh, opts.host, doorKey)) throw new Error('the certificate office answered a certificate for another address or key')
      // A certificate that could not be kept is used all the same: the next start asks for another.
      await writePrivate(join(dir, CERTIFICATE), chain).catch(() => {})
      if (stopped) return
      leaf = fresh
      failures = 0
      opts.onCertificate({ key, cert: chain })
      opts.onProblem(undefined)
    } catch (err) {
      const wait = Math.min((opts.retryMs ?? 10 * 60_000) * 2 ** failures++, RETRY_CAP_MS)
      notBefore = now() + Math.max(wait, err instanceof AcmeError ? (err.retryAfterMs ?? 0) : 0)
      if (!stopped) opts.onProblem(err instanceof Error ? err.message : String(err))
    } finally {
      asking = false
    }
  }
  void look()
  const timer = setInterval(() => void look(), opts.lookMs ?? 60_000)
  timer.unref()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}
