import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, release } from 'node:os'
import { dirname, join } from 'node:path'
import { SECURE_PORT } from '@openagt/dashboard/secure-address'
import { ADDRESS, LOOPBACK_ADDRESS, addHostsLine, quoted, removeHostsLine } from './address.js'
import type { Platform } from './platform.js'
import { asAdmin, installed, run, succeeds } from './run.js'

/**
 * What the install puts on a Linux computer. Its files and its scripts as the administrator are
 * text, made by pure functions a test reads; {@link linux} writes and runs them.
 */

/** What starts the dashboard at login: a systemd service of the person's own. */
export const DASHBOARD_UNIT = 'openagent-dashboard.service'
/** What sends the address's port 443 to the dashboard at every start of the computer: a systemd service, the system's. */
export const PORT_UNIT = 'openagent-port.service'
export const PORT_UNIT_FILE = `/etc/systemd/system/${PORT_UNIT}`
/** The nftables table the port rule is in, of its own, so taking it off touches no other rule. */
export const PORT_TABLE = 'ip openagent'

/** The certificate's name in the browsers' certificate stores, which is how the uninstall finds it again. */
export const NSS_NICKNAME = `OpenAgent (${ADDRESS})`
/**
 * How the browsers trust it: as a server (`P`), which Chrome asks for, and as its own authority
 * (`C`), which Firefox asks for of a certificate that signs itself. It still signs no other: it
 * says it is no authority (`CA:FALSE`), and may not sign certificates.
 */
export const NSS_TRUST = 'CP,,'

/** The package managers the install knows: how each installs packages, and how a person removes them again. */
const PACKAGE_MANAGERS = {
  'apt-get': { install: 'DEBIAN_FRONTEND=noninteractive apt-get install -y', remove: 'apt-get remove' },
  dnf: { install: 'dnf install -y', remove: 'dnf remove' },
  pacman: { install: 'pacman -S --needed --noconfirm', remove: 'pacman -R' },
  zypper: { install: 'zypper --non-interactive install', remove: 'zypper remove' },
}
export type PackageManager = keyof typeof PACKAGE_MANAGERS

/** The commands the install runs that a Linux computer may lack: what each does for the install, and the package that has it, by package manager. */
export const TOOLS: Record<'openssl' | 'certutil' | 'nft', { does: string; package: Record<PackageManager, string> }> = {
  openssl: { does: 'makes the certificate', package: { 'apt-get': 'openssl', dnf: 'openssl', pacman: 'openssl', zypper: 'openssl' } },
  certutil: { does: 'puts the certificate in the browsers', package: { 'apt-get': 'libnss3-tools', dnf: 'nss-tools', pacman: 'nss', zypper: 'mozilla-nss-tools' } },
  nft: { does: 'sends port 443 to the dashboard', package: { 'apt-get': 'nftables', dnf: 'nftables', pacman: 'nftables', zypper: 'nftables' } },
}
export type Tool = keyof typeof TOOLS

/** The shell line that installs `packages` with `manager`. An `apt-get` that knows no package yet reads the list of packages first. */
export function installPackagesLine(manager: PackageManager, packages: string[]): string {
  const line = `${PACKAGE_MANAGERS[manager].install} ${packages.map(quoted).join(' ')}`
  return manager === 'apt-get' ? `${line} || { apt-get update && ${line}; }` : line
}

/** The script that installs `packages` with `manager`, and says what the package manager said only when it fails. */
export function installPackagesScript(manager: PackageManager, packages: string[]): string {
  return `said=$(mktemp)
if ! { ${installPackagesLine(manager, packages)}; } >"$said" 2>&1; then cat "$said" >&2; rm -f "$said"; exit 1; fi
rm -f "$said"
`
}

/**
 * The system's own store of trusted certificates, which `curl` and other tools read, where it takes
 * this certificate: Debian's and Ubuntu's. Fedora, Arch and openSUSE build theirs with p11-kit,
 * which keeps out of the bundle tools read any certificate that is no authority, as this one is.
 */
export const SYSTEM_STORE = { file: `/usr/local/share/ca-certificates/${ADDRESS}.crt`, refresh: 'update-ca-certificates' }
export type SystemStore = typeof SYSTEM_STORE

/** The system's store, on a computer that has its folder. */
function systemStore(): SystemStore | undefined {
  return existsSync(dirname(SYSTEM_STORE.file)) ? SYSTEM_STORE : undefined
}

/** `value` as one word of a systemd unit file; `exec` for a command line, which also reads `$`. */
export function unitWord(value: string, opts: { exec?: boolean } = {}): string {
  let word = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')
  if (opts.exec) word = word.replaceAll('$', '$$$$')
  return `"${word}"`
}

/**
 * The person's service that runs the dashboard from login on, in their home folder. It runs with
 * the variables of the install's terminal it needs (`vars`): a service's own `PATH` finds no `git`,
 * `gh` or coding agent the person installed in their home, and a moved config folder holds the
 * registry and the certificate. Started again only when it fails: a dashboard that ends well (one
 * ran on its port already, and it handed over) stays ended.
 */
export function dashboardUnit(opts: { node: string; dashboard: string; vars: { [name: string]: string } }): string {
  return `[Unit]
Description=OpenAgent dashboard, at https://${ADDRESS}

[Service]
ExecStart=${unitWord(opts.node, { exec: true })} ${unitWord(opts.dashboard, { exec: true })}
WorkingDirectory=%h
${Object.entries(opts.vars)
  .map(([name, value]) => `Environment=${unitWord(`${name}=${value}`)}`)
  .join('\n')}
Restart=on-failure

[Install]
WantedBy=default.target
`
}

/** The nftables commands that send the address's port 443 to the dashboard's secure port, however often they run. */
export function portRule(): string {
  return [
    `add table ${PORT_TABLE}`,
    `flush table ${PORT_TABLE}`,
    `add chain ${PORT_TABLE} output { type nat hook output priority -100 ; }`,
    `add rule ${PORT_TABLE} output ip daddr ${LOOPBACK_ADDRESS} tcp dport 443 redirect to :${SECURE_PORT}`,
  ].join('; ')
}

/**
 * The system's service that loads the port rule at each start of the computer, and takes it off
 * when stopped. It loads after the firewall's own rules, which may clear every rule first, and
 * again whenever they are loaded again, or started after a stop.
 */
export function portUnit(): string {
  return `[Unit]
Description=OpenAgent: port 443 of ${ADDRESS}, to the dashboard
After=nftables.service firewalld.service
PartOf=nftables.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=nft ${unitWord(portRule(), { exec: true })}
ExecStop=nft ${unitWord(`delete table ${PORT_TABLE}`, { exec: true })}

[Install]
WantedBy=multi-user.target nftables.service
`
}

/** The install's script as the administrator: the hosts line, the port rule's service, started now, and the certificate in the system's store. */
export function adminInstallScript(certFile: string, store: SystemStore | undefined): string {
  return `set -e
${addHostsLine('/etc/hosts')}
printf '%s' ${quoted(portUnit())} > ${PORT_UNIT_FILE}
chmod 644 ${PORT_UNIT_FILE}
systemctl daemon-reload
systemctl enable ${PORT_UNIT} 2>/dev/null
systemctl restart ${PORT_UNIT}
${store ? `install -m 644 ${quoted(certFile)} ${quoted(store.file)}\n${store.refresh} >/dev/null 2>&1\n` : ''}`
}

/** The uninstall's script as the administrator: everything {@link adminInstallScript} put there, taken off. */
export function adminUninstallScript(store: SystemStore | undefined): string {
  return `${removeHostsLine('/etc/hosts')}
systemctl disable --now ${PORT_UNIT} 2>/dev/null || true
rm -f ${PORT_UNIT_FILE}
systemctl daemon-reload
${store ? `if [ -e ${quoted(store.file)} ]; then rm -f ${quoted(store.file)}; ${store.refresh} >/dev/null 2>&1; fi\n` : ''}`
}

/**
 * The browsers' certificate stores in `home`: Chrome's and Chromium's, which they share, the one
 * of Chromium installed as a snap, and one per Firefox profile, wherever Firefox was installed
 * from. `withChrome` counts Chrome's in even before Chrome made it.
 */
export async function certificateStores(home: string, opts: { withChrome: boolean }): Promise<string[]> {
  const chrome = join(home, '.pki', 'nssdb')
  const firefoxes = [
    join(home, '.mozilla', 'firefox'),
    join(home, '.config', 'mozilla', 'firefox'),
    join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
  ]
  const candidates = [chrome, join(home, 'snap', 'chromium', 'current', '.pki', 'nssdb')]
  for (const folder of firefoxes) {
    const profiles = await readdir(folder, { withFileTypes: true }).catch(() => [])
    candidates.push(...profiles.filter(entry => entry.isDirectory()).map(entry => join(folder, entry.name)))
  }
  return candidates.filter(store => existsSync(join(store, 'cert9.db')) || (opts.withChrome && store === chrome))
}

/** Where the install keeps what it puts in the person's home. */
function places(env: NodeJS.ProcessEnv) {
  const home = env.HOME || homedir()
  const app = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'openagent')
  return {
    home,
    // systemd's own folder for a person's services, which it reads whatever the terminal's variables say.
    unit: join(home, '.config', 'systemd', 'user', DASHBOARD_UNIT),
    app,
    /** The packages the install put on this computer, which the uninstall leaves, and names. */
    packages: join(app, 'packages.json'),
  }
}

/** What the packages file lists; nothing when the install put no package on this computer. */
async function readPackages(file: string): Promise<{ manager?: PackageManager; packages: string[] }> {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  return text === undefined ? { packages: [] } : (JSON.parse(text) as { manager: PackageManager; packages: string[] })
}

/** The commands the install needs that this computer lacks. */
async function missingTools(env: NodeJS.ProcessEnv): Promise<Tool[]> {
  const missing: Tool[] = []
  for (const tool of Object.keys(TOOLS) as Tool[]) if (!(await installed(tool, env.PATH))) missing.push(tool)
  return missing
}

async function packageManager(env: NodeJS.ProcessEnv): Promise<PackageManager | undefined> {
  for (const manager of Object.keys(PACKAGE_MANAGERS) as PackageManager[]) if (await installed(manager, env.PATH)) return manager
  return undefined
}

const user = (args: string[]) => ['--user', ...args]

export const linux: Platform = {
  async unable(env) {
    if (release().toLowerCase().includes('microsoft')) {
      return 'Your browsers run on Windows, which this Linux cannot set up. Run `npx @openagt/dashboard` instead.'
    }
    if (!(await succeeds('systemctl', user(['show-environment'])))) {
      return 'This computer runs no systemd for you, which starts the dashboard when you log in. Run `npx @openagt/dashboard` instead.'
    }
    const missing = await missingTools(env)
    if (missing.length > 0 && !(await packageManager(env))) {
      return `Install the commands ${missing.join(', ')} (${missing.map(tool => TOOLS[tool].package['apt-get']).join(', ')} on Debian), then run this again.`
    }
    return undefined
  },
  async stopDashboard() {
    if (!(await succeeds('systemctl', user(['is-active', '--quiet', DASHBOARD_UNIT])))) return false
    await run('systemctl', user(['stop', DASHBOARD_UNIT]))
    return true
  },
  appDir: env => places(env).app,
  async prepare(io, env) {
    const missing = await missingTools(env)
    const manager = await packageManager(env)
    if (missing.length === 0 || !manager) return
    const packages = missing.map(tool => TOOLS[tool].package[manager])
    await asAdmin(
      {
        says: `your password as the administrator: ${packages.join(', ')} ${packages.length === 1 ? 'is' : 'are'} installed (${missing.map(tool => `${tool}, which ${TOOLS[tool].does}`).join('; ')}).`,
        script: installPackagesScript(manager, packages),
      },
      io,
    )
    const place = places(env)
    const before = await readPackages(place.packages)
    await mkdir(place.app, { recursive: true })
    await writeFile(place.packages, JSON.stringify({ manager, packages: [...new Set([...before.packages, ...packages])] }) + '\n')
  },
  adminInstall(certFile) {
    const store = systemStore()
    return {
      says: `your password as the administrator: ${ADDRESS} is pointed at this computer (/etc/hosts), and its port 443 at the dashboard (an nftables rule, loaded at each start)${store ? '; the system trusts its certificate, for curl and other tools' : ''}.`,
      script: adminInstallScript(certFile, store),
    }
  },
  async trust(certFile, io, env) {
    const stores = await certificateStores(places(env).home, { withChrome: true })
    for (const store of stores) {
      if (!existsSync(join(store, 'cert9.db'))) {
        await mkdir(store, { recursive: true, mode: 0o700 })
        await run('certutil', ['-N', '-d', `sql:${store}`, '--empty-password'])
      }
      // One made by an install before, for a certificate since made again, goes first.
      await run('certutil', ['-D', '-d', `sql:${store}`, '-n', NSS_NICKNAME]).catch(() => {})
      await run('certutil', ['-A', '-d', `sql:${store}`, '-n', NSS_NICKNAME, '-t', NSS_TRUST, '-i', certFile])
    }
    io.out(`◆ Chrome and Firefox trust the certificate (${stores.length} certificate store${stores.length === 1 ? '' : 's'}). A Firefox profile made later: run this again.`)
  },
  async startDashboard(opts, env) {
    const place = places(env)
    await mkdir(dirname(place.unit), { recursive: true })
    await writeFile(place.unit, dashboardUnit(opts))
    await run('systemctl', user(['daemon-reload']))
    await run('systemctl', user(['enable', DASHBOARD_UNIT]))
    await run('systemctl', user(['restart', DASHBOARD_UNIT]))
    return `\`journalctl --user -u ${DASHBOARD_UNIT}\``
  },
  openCommand: 'xdg-open',
  async removeDashboard(env) {
    await run('systemctl', user(['disable', '--now', DASHBOARD_UNIT])).catch(() => {})
    await rm(places(env).unit, { force: true })
    await run('systemctl', user(['daemon-reload'])).catch(() => {})
  },
  async untrust(_certFile, _io, env) {
    for (const store of await certificateStores(places(env).home, { withChrome: false })) {
      await run('certutil', ['-D', '-d', `sql:${store}`, '-n', NSS_NICKNAME]).catch(() => {})
    }
  },
  adminUninstall() {
    const store = systemStore()
    return {
      says: `your password as the administrator, once: the hosts line for ${ADDRESS} and its port rule are taken off${store ? ', and the system trusts its certificate no more' : ''}.`,
      script: adminUninstallScript(store),
    }
  },
  folders: env => [places(env).app],
  async leftBehind(env) {
    const { manager, packages } = await readPackages(places(env).packages)
    if (!manager || packages.length === 0) return undefined
    return `${packages.join(', ')} ${packages.length === 1 ? 'stays' : 'stay'} installed, as other programs may use ${packages.length === 1 ? 'it' : 'them'}: \`sudo ${PACKAGE_MANAGERS[manager].remove} ${packages.join(' ')}\` takes ${packages.length === 1 ? 'it' : 'them'} off.`
  },
}
