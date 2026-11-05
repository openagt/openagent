import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The dashboard's secure address (#1919): a name like `openagent.build` that this computer
 * answers itself, with a certificate made on this computer for that one name.
 *
 * `@openagt/install` makes the certificate and points the name at this computer; the dashboard
 * only reads what it finds here. With a certificate here, it also answers over HTTPS on
 * {@link SECURE_PORT}, which the install sends the name's port 443 to.
 */

/** The port the secure address is answered on, on this computer's own address only. */
export const SECURE_PORT = 4243

export const KEY_FILE = 'key.pem'
export const CERTIFICATE_FILE = 'cert.pem'

/**
 * The folder the key and the certificate are kept in: `$XDG_CONFIG_HOME/openagent-address` when
 * that is set, else `~/.openagent-address`, beside the registry file. Not in the personal folder
 * `~/.openagent`, which may be pushed to a repository: the key never leaves this computer.
 */
export function secureAddressDir(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'openagent-address')
  return join(env.HOME ?? '', '.openagent-address')
}

/** The name, and the key and certificate a TLS server takes. */
export interface SecureAddress {
  name: string
  key: string
  cert: string
}

/**
 * The secure address kept on this computer, or `undefined` when there is none. The name is read
 * off the certificate, so the two can never disagree.
 */
export async function readSecureAddress(env: NodeJS.ProcessEnv): Promise<SecureAddress | undefined> {
  const dir = secureAddressDir(env)
  const read = (file: string) => readFile(join(dir, file), 'utf8').catch(err => ((err as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(err)))
  const [key, cert] = await Promise.all([read(KEY_FILE), read(CERTIFICATE_FILE)])
  if (key === undefined || cert === undefined) return undefined
  const name = certificateNames(new X509Certificate(cert).subjectAltName)[0]
  if (name === undefined) throw new Error(`the certificate in ${dir} names no address`)
  return { name, key, cert }
}

/** The names a certificate's `subjectAltName` lists (`DNS:a, DNS:b`), in order. */
export function certificateNames(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return []
  return subjectAltName
    .split(', ')
    .filter(entry => entry.startsWith('DNS:'))
    .map(entry => entry.slice('DNS:'.length))
}
