import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, X509Certificate, type KeyObject } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CHALLENGE_PREFIX } from './acme.js'
import { alternativeName, bits, der, octets, oid, OID_ECDSA_SHA256, OID_SUBJECT_ALT_NAME, sequence, set } from './der.js'

/**
 * A certificate office for the tests: it speaks what Let's Encrypt speaks, checks every request's
 * signature and number, reads the proof over plain HTTP as the real one does, and signs real
 * certificates with a key of its own, which a test trusts in place of the world's.
 */

const pem = (label: string, body: Buffer): string => `-----BEGIN ${label}-----\n${body.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`

const name = (common: string): Buffer => sequence(set(sequence(oid('2.5.4.3'), der(0x0c, Buffer.from(common)))))
const utcTime = (at: number): Buffer => der(0x17, Buffer.from(new Date(at).toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))

/** An X.509 certificate for `subjectKey`, signed with `issuerKey`. */
function certificate(o: { subject: string; subjectKey: Buffer; issuer: string; issuerKey: KeyObject; from: number; to: number; host?: string; authority?: boolean }): Buffer {
  const extensions = [
    ...(o.host ? [sequence(oid(OID_SUBJECT_ALT_NAME), octets(alternativeName(o.host)))] : []),
    ...(o.authority ? [sequence(oid('2.5.29.19'), der(0x01, Buffer.from([0xff])), octets(sequence(der(0x01, Buffer.from([0xff])))))] : []),
  ]
  const body = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, Buffer.concat([Buffer.from([1]), randomBytes(8)])),
    sequence(oid(OID_ECDSA_SHA256)),
    name(o.issuer),
    sequence(utcTime(o.from), utcTime(o.to)),
    name(o.subject),
    o.subjectKey,
    der(0xa3, sequence(...extensions)),
  )
  return sequence(body, sequence(oid(OID_ECDSA_SHA256)), bits(sign('sha256', body, o.issuerKey)))
}

/** The parts of a DER sequence, each with its tag and length still on. */
function parts(value: Buffer): Buffer[] {
  const headerOf = (at: number): { header: number; length: number } => {
    const first = value[at + 1]!
    if (first < 0x80) return { header: 2, length: first }
    const size = first & 0x7f
    return { header: 2 + size, length: value.subarray(at + 2, at + 2 + size).reduce((sum, byte) => sum * 256 + byte, 0) }
  }
  const outer = headerOf(0)
  const found: Buffer[] = []
  for (let at = outer.header; at < outer.header + outer.length; ) {
    const { header, length } = headerOf(at)
    found.push(value.subarray(at, at + header + length))
    at += header + length
  }
  return found
}

export interface TestOffice {
  /** The office's directory address: what the door is told in place of Let's Encrypt's. */
  directory: string
  /** The office's own certificate, PEM: what a test trusts. */
  authority: string
  /** The certificates it signed, newest last. */
  issued: X509Certificate[]
  /** Make the office refuse every proof with these words, until it is told `undefined`. */
  refuse(words: string | undefined): void
  close(): Promise<void>
}

/**
 * Open the office. It reads a proof at `proofPort` of the address a certificate is asked for
 * (the real one reads port 80), and signs certificates good for `lifetimeMs`.
 */
export async function testOffice(opts: { proofPort: () => number; lifetimeMs?: number; now?: () => number }): Promise<TestOffice> {
  const now = opts.now ?? Date.now
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const spki = (k: KeyObject): Buffer => k.export({ type: 'spki', format: 'der' })
  const authority = certificate({ subject: 'Test Office', subjectKey: spki(key.publicKey), issuer: 'Test Office', issuerKey: key.privateKey, from: now() - 60_000, to: now() + 365 * 86_400_000, authority: true })
  const issued: X509Certificate[] = []
  const nonces = new Set<string>()
  const accounts = new Map<string, KeyObject>()
  const orders = new Map<string, { host: string; status: string; token: string; proof?: 'valid' | 'invalid'; why?: string; certificate?: string }>()
  let refusal: string | undefined
  let staleOnce = true
  let base = ''

  const answer = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
    const nonce = randomBytes(12).toString('base64url')
    nonces.add(nonce)
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json', 'replay-nonce': nonce, ...headers })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const problem = (res: ServerResponse, status: number, type: string, detail: string): void => answer(res, status, { type: `urn:ietf:params:acme:error:${type}`, detail })

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = req.url ?? '/'
      if (path === '/directory') return answer(res, 200, { newNonce: `${base}/nonce`, newAccount: `${base}/account`, newOrder: `${base}/order`, meta: { profiles: { shortlived: 'six days' } } })
      if (path === '/nonce') return answer(res, 200, {})
      let raw = ''
      for await (const chunk of req) raw += chunk
      const jws = JSON.parse(raw) as { protected: string; payload: string; signature: string }
      const header = JSON.parse(Buffer.from(jws.protected, 'base64url').toString()) as { alg: string; nonce: string; url: string; kid?: string; jwk?: Record<string, string> }
      const payload = jws.payload === '' ? undefined : (JSON.parse(Buffer.from(jws.payload, 'base64url').toString()) as Record<string, unknown>)
      // The first request's number is called stale once, as a real office sometimes does.
      if (staleOnce && path !== '/account') {
        staleOnce = false
        return problem(res, 400, 'badNonce', 'that number is stale')
      }
      if (!nonces.delete(header.nonce)) return problem(res, 400, 'badNonce', 'that number was not given, or was used')
      if (header.alg !== 'ES256' || header.url !== `${base}${path}`) return problem(res, 400, 'malformed', 'the request is signed for another address')
      const signer = header.kid ? accounts.get(header.kid) : header.jwk ? createPublicKey({ key: header.jwk, format: 'jwk' }) : undefined
      if (!signer || !verify('sha256', Buffer.from(`${jws.protected}.${jws.payload}`), { key: signer, dsaEncoding: 'ieee-p1363' }, Buffer.from(jws.signature, 'base64url'))) {
        return problem(res, 401, 'unauthorized', 'the signature is not the account\'s')
      }

      if (path === '/account') {
        // An account that is there already is answered, not made again.
        const same = (one: KeyObject): boolean => one.equals(signer)
        const known = [...accounts].find(([, key]) => same(key))?.[0]
        const kid = known ?? `${base}/account/${accounts.size + 1}`
        accounts.set(kid, signer)
        return answer(res, known ? 200 : 201, { status: 'valid' }, { location: kid })
      }
      if (!header.kid) return problem(res, 400, 'malformed', 'only a new account is signed with the key itself')
      if (path === '/order') {
        const wanted = (payload?.identifiers as { type: string; value: string }[])[0]!
        if (payload?.profile !== 'shortlived') return problem(res, 400, 'malformed', 'the short-lived kind was not asked for')
        const id = String(orders.size + 1)
        orders.set(id, { host: wanted.value, status: 'pending', token: randomBytes(12).toString('base64url') })
        return answer(res, 201, { status: 'pending', authorizations: [`${base}/authorization/${id}`], finalize: `${base}/finalize/${id}` }, { location: `${base}/order/${id}` })
      }
      const [, kind, id] = path.split('/')
      const order = orders.get(id ?? '')
      if (!order) return problem(res, 404, 'malformed', 'no such order')
      const jwk = signer.export({ format: 'jwk' })
      const thumbprint = createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url')
      const challenge = { type: 'http-01', url: `${base}/challenge/${id}`, token: order.token, ...(order.why ? { error: { detail: order.why } } : {}) }
      if (kind === 'authorization') return answer(res, 200, { status: order.proof ?? 'pending', challenges: [challenge] })
      if (kind === 'challenge') {
        if (refusal !== undefined) {
          order.proof = 'invalid'
          order.why = refusal
        } else {
          // The proof is read where the real office reads it: over plain HTTP, at the address itself.
          const host = order.host.includes(':') ? `[${order.host}]` : order.host
          const shown = await fetch(`http://${host}:${opts.proofPort()}${CHALLENGE_PREFIX}${order.token}`).then(r => (r.ok ? r.text() : ''), () => '')
          order.proof = shown === `${order.token}.${thumbprint}` ? 'valid' : 'invalid'
          if (order.proof === 'invalid') order.why = `the proof at ${order.host} is not the one expected`
        }
        return answer(res, 200, challenge)
      }
      if (kind === 'finalize') {
        if (order.proof !== 'valid') return problem(res, 403, 'orderNotReady', 'the address is not proven')
        const request = Buffer.from(String(payload?.csr), 'base64url')
        const [info, , signature] = parts(request)
        const [, , subjectKey, attributes] = parts(info!)
        const asked = createPublicKey({ key: subjectKey!, format: 'der', type: 'spki' })
        // The signature is a string of bits: its tag, its length and a count of unused bits come before it.
        if (!verify('sha256', info!, asked, signature!.subarray(3))) return problem(res, 400, 'badCSR', 'the request is not signed with its own key')
        if (!attributes!.includes(alternativeName(order.host))) return problem(res, 400, 'badCSR', 'the request names another address')
        const leaf = certificate({ subject: order.host, subjectKey: subjectKey!, issuer: 'Test Office', issuerKey: key.privateKey, from: now() - 60_000, to: now() + (opts.lifetimeMs ?? 6 * 86_400_000), host: order.host })
        issued.push(new X509Certificate(leaf))
        order.certificate = pem('CERTIFICATE', leaf) + pem('CERTIFICATE', authority)
        order.status = 'valid'
        // Still at work when first asked, as the real office is.
        return answer(res, 200, { status: 'processing', authorizations: [], finalize: `${base}/finalize/${id}` })
      }
      if (kind === 'order') return answer(res, 200, { status: order.status, authorizations: [], finalize: `${base}/finalize/${id}`, ...(order.certificate ? { certificate: `${base}/certificate/${id}` } : {}) })
      if (kind === 'certificate' && order.certificate) return answer(res, 200, order.certificate)
      problem(res, 404, 'malformed', 'not found')
    })().catch(err => {
      if (!res.headersSent) res.writeHead(500).end(String(err))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    directory: `${base}/directory`,
    authority: pem('CERTIFICATE', authority),
    issued,
    refuse: words => void (refusal = words),
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
