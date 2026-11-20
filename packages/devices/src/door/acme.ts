import { createHash, sign, type KeyObject } from 'node:crypto'
import { isIP } from 'node:net'

/**
 * Asking a certificate office for a certificate, the way Let's Encrypt and every office like it
 * is asked (ACME, RFC 8555): an account by its key, an order for one address, proof that this
 * computer answers at that address (a file the office reads over plain HTTP, port 80), the
 * request, and the certificate. Nothing here knows files or servers: the caller keeps the keys
 * and shows the proof.
 */

/** Let's Encrypt, the office the door asks unless told another. */
export const LETS_ENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory'

/** The path under which the office reads the proof, on port 80 of the address. */
export const CHALLENGE_PREFIX = '/.well-known/acme-challenge/'

export interface AcmeOptions {
  /** The office's directory address. */
  directory: string
  /** The account's key (EC P-256): made once and kept, so the office knows this computer again. */
  accountKey: { publicKey: KeyObject; privateKey: KeyObject }
  /** The address or name the certificate is for. */
  host: string
  /** The request for the certificate, DER, signed with the key the certificate is for. */
  request: Buffer
  /** Show the office the proof: answer `content` at {@link CHALLENGE_PREFIX} + `token`, until `withdraw`. */
  prove: (token: string, content: string) => void | Promise<void>
  withdraw: (token: string) => void | Promise<void>
  fetch?: typeof fetch
  /** How long the office gets for each of its steps, and how often it is asked how far it is. */
  timeoutMs?: number
  pollMs?: number
}

/** What the office said no with, in its own words. */
export class AcmeError extends Error {
  constructor(
    message: string,
    readonly type?: string,
    /** How long the office asked to be left alone, when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** The office's `Retry-After`, in milliseconds: a count of seconds, or a date. */
function retryAfter(res: Response): number | undefined {
  const said = res.headers.get('retry-after')
  if (!said) return undefined
  const ms = /^\d+$/.test(said) ? Number(said) * 1000 : Date.parse(said) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

interface Directory {
  newNonce: string
  newAccount: string
  newOrder: string
  meta?: { profiles?: Record<string, unknown> }
}

interface Order {
  status: string
  authorizations: string[]
  finalize: string
  certificate?: string
  error?: { detail?: string; type?: string }
}

interface Authorization {
  status: string
  challenges: { type: string; url: string; token: string; error?: { detail?: string; type?: string } }[]
}

const b64 = (data: Uint8Array | string): string => Buffer.from(data).toString('base64url')

/** The certificate, short-lived by choice: an address gets no other kind, and a name is as well served by it. */
const SHORT_LIVED = 'shortlived'

/** Ask for a certificate; answers it with the chain above it, PEM. Throws {@link AcmeError} with the office's reason. */
export async function orderCertificate(opts: AcmeOptions): Promise<string> {
  const send = opts.fetch ?? fetch
  // An office that cannot be reached is said with the reason, which a failed fetch keeps in its cause.
  const ask: typeof fetch = (input, init) =>
    send(input, init).catch((err: unknown) => {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
      throw new AcmeError(`the certificate office could not be reached: ${cause ?? (err instanceof Error ? err.message : String(err))}`)
    })
  const timeoutMs = opts.timeoutMs ?? 90_000
  const pollMs = opts.pollMs ?? 2_000
  const { kty, crv, x, y } = opts.accountKey.publicKey.export({ format: 'jwk' })
  const jwk = { crv, kty, x, y }
  // The key's thumbprint (RFC 7638): its fields in this order, hashed.
  const thumbprint = createHash('sha256').update(JSON.stringify(jwk)).digest('base64url')

  const directory = (await (await ask(opts.directory, { signal: AbortSignal.timeout(timeoutMs) })).json()) as Directory
  let nonce: string | undefined
  let account: string | undefined

  /** One signed request; `payload` undefined reads (a POST of nothing), an object sends it. */
  const post = async (url: string, payload?: unknown): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      nonce ??= (await ask(directory.newNonce, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })).headers.get('replay-nonce') ?? undefined
      if (!nonce) throw new AcmeError('the certificate office gave no number to sign a request with')
      const protectedPart = b64(JSON.stringify({ alg: 'ES256', nonce, url, ...(account ? { kid: account } : { jwk }) }))
      const payloadPart = payload === undefined ? '' : b64(JSON.stringify(payload))
      const signature = b64(sign('sha256', Buffer.from(`${protectedPart}.${payloadPart}`), { key: opts.accountKey.privateKey, dsaEncoding: 'ieee-p1363' }))
      const res = await ask(url, {
        method: 'POST',
        headers: { 'content-type': 'application/jose+json' },
        body: JSON.stringify({ protected: protectedPart, payload: payloadPart, signature }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      nonce = res.headers.get('replay-nonce') ?? undefined
      if (res.ok) return res
      const problem = (await res.json().catch(() => ({}))) as { type?: string; detail?: string }
      // A number that went stale is no refusal: the office hands a fresh one with its answer.
      if (problem.type === 'urn:ietf:params:acme:error:badNonce' && attempt < 3) continue
      throw new AcmeError(problem.detail ?? `the certificate office answered ${res.status}`, problem.type, retryAfter(res))
    }
  }

  /** Read `url` until `done` says so; the office works on its own time. */
  const until = async <T extends { status: string }>(url: string, done: (value: T) => boolean): Promise<T> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = (await (await post(url)).json()) as T
      if (done(value)) return value
      if (Date.now() > deadline) throw new AcmeError('the certificate office took too long')
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }

  account = (await post(directory.newAccount, { termsOfServiceAgreed: true })).headers.get('location') ?? undefined
  if (!account) throw new AcmeError('the certificate office named no account')

  const identifier = { type: isIP(opts.host) ? 'ip' : 'dns', value: opts.host }
  const ordered = await post(directory.newOrder, { identifiers: [identifier], ...(directory.meta?.profiles?.[SHORT_LIVED] !== undefined ? { profile: SHORT_LIVED } : {}) })
  const orderUrl = ordered.headers.get('location')
  let order = (await ordered.json()) as Order
  if (!orderUrl) throw new AcmeError('the certificate office named no order')

  for (const url of order.authorizations) {
    const authorization = (await (await post(url)).json()) as Authorization
    if (authorization.status === 'valid') continue
    const challenge = authorization.challenges.find(candidate => candidate.type === 'http-01')
    if (!challenge) throw new AcmeError('the certificate office offers no proof over plain HTTP for this address')
    await opts.prove(challenge.token, `${challenge.token}.${thumbprint}`)
    try {
      await post(challenge.url, {})
      const settled = await until<Authorization>(url, value => value.status !== 'pending' && value.status !== 'processing')
      if (settled.status !== 'valid') {
        const why = settled.challenges.find(candidate => candidate.error)?.error
        throw new AcmeError(why?.detail ?? `the certificate office did not accept the proof (${settled.status})`, why?.type)
      }
    } finally {
      await opts.withdraw(challenge.token)
    }
  }

  order = (await (await post(order.finalize, { csr: b64(opts.request) })).json()) as Order
  if (order.status !== 'valid') order = await until<Order>(orderUrl, value => value.status === 'valid' || value.status === 'invalid')
  if (order.status !== 'valid' || !order.certificate) throw new AcmeError(order.error?.detail ?? 'the certificate office did not issue the certificate', order.error?.type)
  return (await post(order.certificate)).text()
}
