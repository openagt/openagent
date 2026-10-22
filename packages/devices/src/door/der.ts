import { createHash, sign, type KeyObject } from 'node:crypto'
import { isIP } from 'node:net'

/**
 * The little of DER the door writes itself: the request a certificate office signs (a PKCS #10
 * request naming one address), and the fingerprint a key is known by. Node signs and hashes; it
 * has no writer for the request, and the door takes on no package for it.
 */

/** One DER value: a tag, its length, its content. */
export function der(tag: number, ...content: Uint8Array[]): Buffer {
  const body = Buffer.concat(content)
  if (body.length < 0x80) return Buffer.concat([Buffer.from([tag, body.length]), body])
  const size: number[] = []
  for (let rest = body.length; rest > 0; rest >>>= 8) size.unshift(rest & 0xff)
  return Buffer.concat([Buffer.from([tag, 0x80 | size.length, ...size]), body])
}

export const sequence = (...content: Uint8Array[]): Buffer => der(0x30, ...content)
export const set = (...content: Uint8Array[]): Buffer => der(0x31, ...content)
export const octets = (content: Uint8Array): Buffer => der(0x04, content)
/** A string of bits that fills its bytes, as a signature does. */
export const bits = (content: Uint8Array): Buffer => der(0x03, Buffer.from([0]), content)

/** An object identifier, from its dotted form. */
export function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number)
  const bytes = [first * 40 + second]
  for (const part of rest) {
    const group = [part & 0x7f]
    for (let left = part >>> 7; left > 0; left >>>= 7) group.unshift((left & 0x7f) | 0x80)
    bytes.push(...group)
  }
  return der(0x06, Buffer.from(bytes))
}

const OID_EXTENSION_REQUEST = '1.2.840.113549.1.9.14'
export const OID_SUBJECT_ALT_NAME = '2.5.29.17'
export const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2'

/** An address as its bytes: four for IPv4, sixteen for IPv6. */
function addressBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number))
  const [head = '', tail] = address.split('::')
  const groups = (part: string): number[] => (part ? part.split(':').map(group => parseInt(group, 16)) : [])
  const before = groups(head)
  const after = tail === undefined ? [] : groups(tail)
  const all = [...before, ...new Array<number>(8 - before.length - after.length).fill(0), ...after]
  return Buffer.from(all.flatMap(group => [group >> 8, group & 0xff]))
}

/** The names a certificate is for, as its "subject alternative name" holds them: here one, an address or a name. */
export function alternativeName(host: string): Buffer {
  return sequence(isIP(host) ? der(0x87, addressBytes(host)) : der(0x82, Buffer.from(host, 'latin1')))
}

/**
 * A request for a certificate for `host`, an address or a name, signed with the key the
 * certificate is for (an EC P-256 key). The name is in the alternative name alone, which is all
 * a certificate office reads.
 */
export function certificateRequest(host: string, key: { publicKey: KeyObject; privateKey: KeyObject }): Buffer {
  const extensions = sequence(sequence(oid(OID_SUBJECT_ALT_NAME), octets(alternativeName(host))))
  const info = sequence(
    der(0x02, Buffer.from([0])),
    sequence(),
    key.publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa0, sequence(oid(OID_EXTENSION_REQUEST), set(extensions))),
  )
  return sequence(info, sequence(oid(OID_ECDSA_SHA256)), bits(sign('sha256', info, key.privateKey)))
}

/** What a key is known by: the SHA-256 of its public half, URL-safe. It stays when the certificate is renewed. */
export function keyFingerprint(publicKey: KeyObject): string {
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('base64url')
}
