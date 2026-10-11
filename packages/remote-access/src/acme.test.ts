import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { generateKeyPairSync, X509Certificate } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AcmeError, CHALLENGE_PREFIX, orderCertificate } from './acme.js'
import { certificateRequest, keyFingerprint } from './der.js'
import { testOffice } from './test-office.js'

const newKey = () => generateKeyPairSync('ec', { namedCurve: 'P-256' })

/** A computer that shows proofs over plain HTTP, as the door does on port 80. */
async function prover(): Promise<{ port: number; shown: Map<string, string>; close: () => Promise<void> }> {
  const shown = new Map<string, string>()
  const server: Server = createServer((req, res) => {
    const content = shown.get((req.url ?? '').slice(CHALLENGE_PREFIX.length))
    res.writeHead(content ? 200 : 404).end(content ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as AddressInfo).port, shown, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

test('a certificate is asked for an address, proven over plain HTTP, and comes back for that address and that key', async () => {
  const shows = await prover()
  const office = await testOffice({ proofPort: () => shows.port })
  try {
    const key = newKey()
    const chain = await orderCertificate({
      directory: office.directory,
      accountKey: newKey(),
      host: '127.0.0.1',
      request: certificateRequest('127.0.0.1', key),
      prove: (token, content) => void shows.shown.set(token, content),
      withdraw: token => void shows.shown.delete(token),
      pollMs: 10,
    })
    const [leaf, authority] = chain.split(/(?=-----BEGIN CERTIFICATE-----)/).map(one => new X509Certificate(one))
    assert.equal(leaf!.subjectAltName, 'IP Address:127.0.0.1')
    assert.equal(keyFingerprint(leaf!.publicKey), keyFingerprint(key.publicKey))
    assert.equal(leaf!.checkIssued(authority!), true)
    assert.equal(leaf!.verify(new X509Certificate(office.authority).publicKey), true)
    assert.equal(shows.shown.size, 0) // the proof is withdrawn once the office has read it
  } finally {
    await office.close()
    await shows.close()
  }
})

test('a proof the office does not accept is told in the office\'s words, and withdrawn', async () => {
  const shows = await prover()
  const office = await testOffice({ proofPort: () => shows.port })
  try {
    const ask = (prove: (token: string, content: string) => void): Promise<string> =>
      orderCertificate({ directory: office.directory, accountKey: newKey(), host: '127.0.0.1', request: certificateRequest('127.0.0.1', newKey()), prove, withdraw: token => void shows.shown.delete(token), pollMs: 10 })
    // Nothing shown: the office finds no proof at the address.
    await assert.rejects(ask(() => {}), (err: unknown) => err instanceof AcmeError && /the proof at 127\.0\.0\.1 is not the one expected/.test(err.message))
    office.refuse('port 80 of this address cannot be reached')
    await assert.rejects(ask((token, content) => void shows.shown.set(token, content)), /port 80 of this address cannot be reached/)
    assert.equal(shows.shown.size, 0)
    assert.equal(office.issued.length, 0)
  } finally {
    await office.close()
    await shows.close()
  }
})

test('the same account asks again, and an office that cannot be reached is said with the reason', async () => {
  const shows = await prover()
  const office = await testOffice({ proofPort: () => shows.port })
  try {
    const accountKey = newKey()
    const ask = (directory: string): Promise<string> =>
      orderCertificate({ directory, accountKey, host: '127.0.0.1', request: certificateRequest('127.0.0.1', newKey()), prove: (token, content) => void shows.shown.set(token, content), withdraw: token => void shows.shown.delete(token), pollMs: 10 })
    await ask(office.directory)
    await ask(office.directory) // the office knows the account by its key
    assert.equal(office.issued.length, 2)
    // An office that is gone: nothing listens where it was.
    const gone = office.directory
    await office.close()
    // The reason is the computer's own word for it, another on each kind of computer: here only that there is one.
    await assert.rejects(ask(gone), (err: unknown) => err instanceof AcmeError && /^the certificate office could not be reached: \S/.test(err.message))
  } finally {
    await office.close()
    await shows.close()
  }
})

test('a request for another address than the one proven is refused', async () => {
  const shows = await prover()
  const office = await testOffice({ proofPort: () => shows.port })
  try {
    await assert.rejects(
      orderCertificate({
        directory: office.directory,
        accountKey: newKey(),
        host: '127.0.0.1',
        request: certificateRequest('203.0.113.5', newKey()),
        prove: (token, content) => void shows.shown.set(token, content),
        withdraw: token => void shows.shown.delete(token),
        pollMs: 10,
      }),
      /names another address/,
    )
  } finally {
    await office.close()
    await shows.close()
  }
})
