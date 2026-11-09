/**
 * The secure address, the same on every computer: its name, the address it points at, its hosts
 * line and its certificate. Each platform's own parts are in its module (mac.ts, linux.ts).
 */

/**
 * The dashboard's secure address: the website's own name, which this computer then answers
 * itself, the dashboard with the website's copy beside it (#1919).
 */
export const ADDRESS = 'openagent.build'
/**
 * The address the name points at: one of this computer's own, the address's alone. The port rule
 * then touches nothing else this computer sends itself on port 443 (a container a developer
 * publishes there, say), as a rule for `127.0.0.1` would.
 */
export const LOOPBACK_ADDRESS = '127.0.0.42'

/** The end of the hosts line the install adds, which is how the uninstall finds it again. */
export const HOSTS_MARK = '# OpenAgent'

/** `value` as one word of a shell script, whatever it holds. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Shell lines that take the install's line out of the hosts file `file`, and leave the rest as it
 * was. The file is written over, not replaced, so it keeps its owner, its permissions and a link
 * that points at it.
 */
export function removeHostsLine(file: string): string {
  const kept = quoted(`${file}.openagent`)
  return `if grep -q ${quoted(` ${HOSTS_MARK}$`)} ${quoted(file)}; then sed ${quoted(`/ ${HOSTS_MARK}$/d`)} ${quoted(file)} > ${kept} && cat ${kept} > ${quoted(file)} && rm ${kept}; fi`
}

/** Shell lines that point the address at this computer in the hosts file `file`, once, however often they run. */
export function addHostsLine(file: string): string {
  return [
    removeHostsLine(file),
    // A file that does not end its last line would have this one joined to it.
    `if [ -s ${quoted(file)} ] && [ -n "$(tail -c 1 ${quoted(file)})" ]; then echo >> ${quoted(file)}; fi`,
    `printf '%s\\n' ${quoted(`${LOOPBACK_ADDRESS} ${ADDRESS} ${HOSTS_MARK}`)} >> ${quoted(file)}`,
  ].join('\n')
}

/** The certificate's openssl settings: for the address alone, for a server, and no authority over any other. */
export const CERTIFICATE_CONFIG = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${ADDRESS}
[ext]
subjectAltName = DNS:${ADDRESS}
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
`

/** The longest a certificate may last for Safari and macOS: 825 days. */
export const CERTIFICATE_DAYS = 825
