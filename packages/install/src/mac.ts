import { SECURE_PORT } from '@openagt/dashboard/secure-address'

/**
 * What the install puts on a Mac, as text: the files it writes and the one script it runs as the
 * administrator. Pure, so a test reads each one; {@link install} and {@link uninstall} write and run them.
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

/** What starts the dashboard at login: a launch agent of the person's own. */
export const DASHBOARD_LABEL = 'build.openagent.dashboard'
/** What sends the address's port 443 to the dashboard at every start of the Mac: a launch daemon, the system's. */
export const PORT_LABEL = 'build.openagent.port'
export const PORT_PLIST = `/Library/LaunchDaemons/${PORT_LABEL}.plist`
/**
 * The port rule's place: a part of Apple's own `com.apple` rules, which `/etc/pf.conf` reads
 * whatever is in them, so the file itself is never changed.
 */
export const PORT_ANCHOR = 'com.apple/openagent'
export const PORT_RULE_FILE = '/etc/pf.anchors/build.openagent'

/** The end of the hosts line the install adds, which is how the uninstall finds it again. */
export const HOSTS_MARK = '# OpenAgent'

/** One value in a launchd property list. */
type PlistValue = string | boolean | PlistValue[] | { [key: string]: PlistValue }

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function plistValue(value: PlistValue, indent: string): string {
  if (typeof value === 'string') return `${indent}<string>${escapeXml(value)}</string>`
  if (typeof value === 'boolean') return `${indent}<${value}/>`
  if (Array.isArray(value)) return [`${indent}<array>`, ...value.map(item => plistValue(item, indent + '  ')), `${indent}</array>`].join('\n')
  return [`${indent}<dict>`, ...Object.entries(value).flatMap(([key, item]) => [`${indent}  <key>${escapeXml(key)}</key>`, plistValue(item, indent + '  ')]), `${indent}</dict>`].join('\n')
}

/** A launchd property list holding `dict`. */
export function plist(dict: { [key: string]: PlistValue }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(dict, '')}
</plist>
`
}

/**
 * The launch agent that runs the dashboard from login on, as the person, in their home folder.
 * It runs with the variables of the install's terminal it needs (`env`): a launch agent's own
 * `PATH` finds no `git`, `gh` or coding agent the person installed, and a moved config folder
 * holds the registry and the certificate. Started again only when it fails: a dashboard that
 * ends well (one ran on its port already, and it handed over) stays ended.
 */
export function dashboardPlist(opts: { node: string; dashboard: string; home: string; env: { [name: string]: string }; log: string }): string {
  return plist({
    Label: DASHBOARD_LABEL,
    ProgramArguments: [opts.node, opts.dashboard],
    WorkingDirectory: opts.home,
    EnvironmentVariables: opts.env,
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    StandardOutPath: opts.log,
    StandardErrorPath: opts.log,
  })
}

/** The rule that sends the address's port 443 to the dashboard's secure port. */
export function portRule(port: number = SECURE_PORT): string {
  return `rdr pass on lo0 inet proto tcp from any to ${LOOPBACK_ADDRESS} port 443 -> 127.0.0.1 port ${port}\n`
}

/**
 * The launch daemon that, at each start of the Mac, gives this computer the address's own
 * address, loads the port rule and switches the packet filter on. A Mac has only `127.0.0.1` of
 * its own until told more.
 */
export function portPlist(): string {
  return plist({
    Label: PORT_LABEL,
    ProgramArguments: ['/bin/sh', '-c', `/sbin/ifconfig lo0 alias ${LOOPBACK_ADDRESS} up && /sbin/pfctl -a ${PORT_ANCHOR} -f ${PORT_RULE_FILE} && /sbin/pfctl -E`],
    RunAtLoad: true,
  })
}

/** `value` as one word of a shell script, whatever it holds. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Shell lines that take the install's line out of the hosts file `file`, and leave the rest as it was. */
export function removeHostsLine(file: string): string {
  return `if grep -q ${quoted(` ${HOSTS_MARK}$`)} ${quoted(file)}; then sed -i '' ${quoted(`/ ${HOSTS_MARK}$/d`)} ${quoted(file)}; fi`
}

/** Shell lines that point `name` at this computer in the hosts file `file`, once, however often they run. */
export function addHostsLine(file: string, name: string): string {
  return [
    removeHostsLine(file),
    // A file that does not end its last line would have this one joined to it.
    `if [ -s ${quoted(file)} ] && [ -n "$(tail -c 1 ${quoted(file)})" ]; then echo >> ${quoted(file)}; fi`,
    `printf '%s\\n' ${quoted(`${LOOPBACK_ADDRESS} ${name} ${HOSTS_MARK}`)} >> ${quoted(file)}`,
  ].join('\n')
}

/** Forget what the Mac remembers of names, so the hosts line counts at once. */
const FORGET_NAMES = 'dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true'

/** The install's one script as the administrator: the hosts line, and the port rule with its launch daemon, started now. */
export function adminInstallScript(name: string = ADDRESS): string {
  return `set -e
${addHostsLine('/etc/hosts', name)}
printf '%s' ${quoted(portRule())} > ${PORT_RULE_FILE}
printf '%s' ${quoted(portPlist())} > ${PORT_PLIST}
chown root:wheel ${PORT_RULE_FILE} ${PORT_PLIST}
chmod 644 ${PORT_RULE_FILE} ${PORT_PLIST}
launchctl bootout system/${PORT_LABEL} 2>/dev/null || true
launchctl bootstrap system ${PORT_PLIST}
${FORGET_NAMES}
`
}

/** The uninstall's one script as the administrator: everything {@link adminInstallScript} put there, taken off. */
export function adminUninstallScript(): string {
  return `${removeHostsLine('/etc/hosts')}
launchctl bootout system/${PORT_LABEL} 2>/dev/null || true
/sbin/pfctl -a ${PORT_ANCHOR} -F all 2>/dev/null || true
/sbin/ifconfig lo0 -alias ${LOOPBACK_ADDRESS} 2>/dev/null || true
rm -f ${PORT_RULE_FILE} ${PORT_PLIST}
${FORGET_NAMES}
`
}

/** The certificate's openssl settings: for `name` alone, for a server, and no authority over any other. */
export function certificateConfig(name: string): string {
  return `[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${name}
[ext]
subjectAltName = DNS:${name}
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
`
}

/** The longest a certificate may last for Safari and macOS: 825 days. */
export const CERTIFICATE_DAYS = 825
