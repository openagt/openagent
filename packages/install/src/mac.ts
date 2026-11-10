import { X509Certificate } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SECURE_PORT } from '@openagt/dashboard/secure-address'
import { ADDRESS, LOOPBACK_ADDRESS, addHostsLine, quoted, removeHostsLine } from './address.js'
import type { Platform } from './platform.js'
import { run, succeeds } from './run.js'

/**
 * What the install puts on a Mac. Its files and its script as the administrator are text, made by
 * pure functions a test reads; {@link mac} writes and runs them.
 */

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
 * It runs with the variables of the install's terminal it needs (`vars`): a launch agent's own
 * `PATH` finds no `git`, `gh` or coding agent the person installed, and a moved config folder
 * holds the registry and the certificate. Started again only when it fails: a dashboard that
 * ends well (one ran on its port already, and it handed over) stays ended.
 */
export function dashboardPlist(opts: { node: string; dashboard: string; home: string; vars: { [name: string]: string }; log: string }): string {
  return plist({
    Label: DASHBOARD_LABEL,
    ProgramArguments: [opts.node, opts.dashboard],
    WorkingDirectory: opts.home,
    EnvironmentVariables: opts.vars,
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    StandardOutPath: opts.log,
    StandardErrorPath: opts.log,
  })
}

/** The rule that sends the address's port 443 to the dashboard's secure port. */
export function portRule(): string {
  return `rdr pass on lo0 inet proto tcp from any to ${LOOPBACK_ADDRESS} port 443 -> 127.0.0.1 port ${SECURE_PORT}\n`
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

/** Forget what the Mac remembers of names, so the hosts line counts at once. */
const FORGET_NAMES = 'dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true'

/** The install's one script as the administrator: the hosts line, and the port rule with its launch daemon, started now. */
export function adminInstallScript(): string {
  return `set -e
${addHostsLine('/etc/hosts')}
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

/** Where the install keeps what it puts on this Mac, outside the secure address's own folder. */
function places(env: NodeJS.ProcessEnv) {
  const home = env.HOME || homedir()
  return {
    home,
    agent: join(home, 'Library', 'LaunchAgents', `${DASHBOARD_LABEL}.plist`),
    logs: join(home, 'Library', 'Logs', 'OpenAgent'),
    app: join(home, 'Library', 'Application Support', 'OpenAgent'),
    keychain: join(home, 'Library', 'Keychains', 'login.keychain-db'),
  }
}

const uid = () => process.getuid?.() ?? 0

/** The launch agent taken out of launchd, which stops the dashboard; whether it was in. */
const bootoutDashboard = () => succeeds('launchctl', ['bootout', `gui/${uid()}/${DASHBOARD_LABEL}`])

export const mac: Platform = {
  unable: async () => undefined,
  stopDashboard: bootoutDashboard,
  appDir: env => places(env).app,
  prepare: async () => {},
  adminInstall: () => ({
    says: `your password as the administrator, once: ${ADDRESS} is pointed at this Mac (/etc/hosts), and its port 443 at the dashboard (a packet filter rule).`,
    script: adminInstallScript(),
  }),
  async trust(certFile, io, env) {
    // Trusted already, by an install before: macOS asks nothing.
    if (await succeeds('security', ['verify-cert', '-c', certFile, '-p', 'ssl', '-s', ADDRESS, '-q'])) return
    io.out(`◆ a certificate for ${ADDRESS} was made on this Mac. macOS asks for your password to trust it.`)
    await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', places(env).keychain, certFile])
  },
  async startDashboard({ node, dashboard, vars }, env) {
    const place = places(env)
    await mkdir(place.logs, { recursive: true })
    await mkdir(dirname(place.agent), { recursive: true })
    const log = join(place.logs, 'dashboard.log')
    await writeFile(place.agent, dashboardPlist({ node, dashboard, home: place.home, vars, log }))
    await run('launchctl', ['bootstrap', `gui/${uid()}`, place.agent])
    return log
  },
  openCommand: 'open',
  async removeDashboard(env) {
    await bootoutDashboard()
    await rm(places(env).agent, { force: true })
  },
  async untrust(certFile, io, env) {
    const pem = await readFile(certFile, 'utf8').catch(() => undefined)
    if (pem === undefined) return
    io.out('◆ macOS asks for your password to stop trusting the certificate.')
    await run('security', ['remove-trusted-cert', certFile]).catch(() => {})
    const sha1 = new X509Certificate(pem).fingerprint.replaceAll(':', '')
    await run('security', ['delete-certificate', '-Z', sha1, places(env).keychain]).catch(() => {})
  },
  adminUninstall: () => ({
    says: `your password as the administrator, once: the hosts line for ${ADDRESS} and its port rule are taken off.`,
    script: adminUninstallScript(),
  }),
  folders: env => [places(env).app, places(env).logs],
  leftBehind: async () => undefined,
}
