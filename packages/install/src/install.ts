import { execFile, spawn } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CERTIFICATE_FILE, KEY_FILE, readSecureAddress, secureAddressDir } from '@openagt/dashboard/secure-address'
import { ADDRESS, CERTIFICATE_DAYS, DASHBOARD_LABEL, LOOPBACK_ADDRESS, adminInstallScript, adminUninstallScript, certificateConfig, dashboardPlist } from './mac.js'

/** Where the commands write. */
export interface InstallIO {
  out: (line: string) => void
  err: (line: string) => void
}

const defaultIO: InstallIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

/** The port the dashboard's plain address is on, which the install's dashboard takes. */
const DASHBOARD_PORT = 4200

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

/** Run a command to its end; rejects with what it said when it fails. `interactive` gives it this terminal, for a password. */
function run(command: string, args: string[], opts: { interactive?: boolean } = {}): Promise<void> {
  if (opts.interactive) {
    return new Promise((resolvePromise, rejectPromise) => {
      spawn(command, args, { stdio: 'inherit' })
        .on('error', rejectPromise)
        .on('exit', code => (code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} ended with ${code}`))))
    })
  }
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, (error, _stdout, stderr) => (error ? rejectPromise(new Error(String(stderr).trim() || error.message)) : resolvePromise()))
  })
}

/** Whether something answers on this computer's `port`. */
function taken(port: number): Promise<boolean> {
  return new Promise(resolvePromise => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => (socket.destroy(), resolvePromise(true)))
    socket.once('error', () => resolvePromise(false))
  })
}

/**
 * Whether `port` is free within `ms`: a dashboard told to stop closes its runs' views first, for
 * up to ten seconds, and holds its port until it has.
 */
export async function freed(port: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (await taken(port)) {
    if (Date.now() >= until) return false
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return true
}

/**
 * The dashboard the launch agent runs. Run from a checkout, or from a folder of its own, it is
 * the one this command came with. Run by `npx`, that one is in npm's cache, which npm empties
 * when it likes: the same version is installed to a folder of OpenAgent's own.
 */
async function lastingDashboard(app: string, io: InstallIO): Promise<string> {
  const manifest = await realpath(createRequire(import.meta.url).resolve('@openagt/dashboard/package.json'))
  if (!manifest.includes('/_npx/')) return join(dirname(manifest), 'dist', 'cli', 'bin.js')
  const { version } = JSON.parse(await readFile(manifest, 'utf8')) as { version: string }
  io.out(`◆ installing OpenAgent v${version} in ${app}`)
  await mkdir(app, { recursive: true })
  await run('npm', ['install', '--prefix', app, '--no-fund', '--no-audit', `@openagt/dashboard@${version}`])
  return join(app, 'node_modules', '@openagt', 'dashboard', 'dist', 'cli', 'bin.js')
}

/** The certificate for {@link ADDRESS}, made on this computer when there is none for it. */
async function ensureCertificate(env: NodeJS.ProcessEnv): Promise<string> {
  const kept = await readSecureAddress(env).catch(() => undefined)
  if (kept?.name === ADDRESS) return kept.cert
  const dir = secureAddressDir(env)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const config = join(dir, 'openssl.cnf')
  await writeFile(config, certificateConfig(ADDRESS))
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, KEY_FILE), '-out', join(dir, CERTIFICATE_FILE), '-days', String(CERTIFICATE_DAYS), '-config', config, '-extensions', 'ext'])
  await rm(config)
  return readFile(join(dir, CERTIFICATE_FILE), 'utf8')
}

/** Whether this Mac trusts the certificate for {@link ADDRESS} already, so a second install asks nothing. */
function trusted(certFile: string): Promise<boolean> {
  return run('security', ['verify-cert', '-c', certFile, '-p', 'ssl', '-s', ADDRESS, '-q']).then(
    () => true,
    () => false,
  )
}

/** Whether the secure address answers with the dashboard, as a browser reaches it. */
function answers(cert: string): Promise<boolean> {
  return new Promise(resolvePromise => {
    const req = request({ host: LOOPBACK_ADDRESS, port: 443, path: '/', servername: ADDRESS, ca: cert, headers: { host: ADDRESS }, timeout: 2000 }, res => {
      res.resume()
      resolvePromise(res.statusCode === 200)
    })
    req.on('error', () => resolvePromise(false))
    req.on('timeout', () => req.destroy())
    req.end()
  })
}

async function waitUntilAnswers(cert: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await answers(cert)) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  return false
}

/**
 * `npx @openagt/install`: the dashboard starts at login, at `https://openagent.build`. Asks
 * for the person's password twice: macOS's own window, to trust the certificate made here, and
 * once in this terminal, as the administrator, for the name and its port. Typed again, it does
 * the same, and asks nothing it needs no more.
 */
export async function install(io: InstallIO = defaultIO, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (process.platform !== 'darwin') {
    io.err('For now OpenAgent installs on a Mac only. On this computer, run `npx @openagt/dashboard`.')
    return 1
  }
  const place = places(env)
  const uid = process.getuid?.() ?? 0
  // One installed already stops first, and is waited for, so what holds the port below is someone else's.
  const stopped = await run('launchctl', ['bootout', `gui/${uid}/${DASHBOARD_LABEL}`]).then(
    () => true,
    () => false,
  )
  if (!(await freed(DASHBOARD_PORT, stopped ? 15_000 : 0))) {
    io.err(`A dashboard runs on port ${DASHBOARD_PORT} already. Stop it (Ctrl+C in its terminal), then run this again.`)
    return 1
  }
  try {
    const dashboard = await lastingDashboard(place.app, io)

    const cert = await ensureCertificate(env)
    const certFile = join(secureAddressDir(env), CERTIFICATE_FILE)
    if (!(await trusted(certFile))) {
      io.out(`◆ a certificate for ${ADDRESS} was made on this Mac. macOS asks for your password to trust it.`)
      await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', place.keychain, certFile])
    }

    io.out(`◆ your password as the administrator, once: ${ADDRESS} is pointed at this Mac (/etc/hosts), and its port 443 at the dashboard (a packet filter rule).`)
    await run('sudo', ['/bin/sh', '-c', adminInstallScript(ADDRESS)], { interactive: true })

    await mkdir(place.logs, { recursive: true })
    await mkdir(dirname(place.agent), { recursive: true })
    const log = join(place.logs, 'dashboard.log')
    const agentEnv = { PATH: env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', ...(env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME } : {}) }
    await writeFile(place.agent, dashboardPlist({ node: process.execPath, dashboard, home: place.home, env: agentEnv, log }))
    await run('launchctl', ['bootstrap', `gui/${uid}`, place.agent])

    if (!(await waitUntilAnswers(cert, 30_000))) {
      io.err(`The dashboard does not answer at https://${ADDRESS} yet. What it says is in ${log}.`)
      return 1
    }
    io.out(`◆ OpenAgent is installed: https://${ADDRESS}`)
    io.out('  It starts when you log in. `npx @openagt/uninstall` takes it off again.')
    spawn('open', [`https://${ADDRESS}`], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    return 0
  } catch (err) {
    io.err(`OpenAgent could not be installed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

/** `npx @openagt/uninstall`: everything {@link install} put on this Mac, taken off. Each part is taken off even when another fails. */
export async function uninstall(io: InstallIO = defaultIO, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (process.platform !== 'darwin') {
    io.err('OpenAgent installs on a Mac only, so there is nothing to take off here.')
    return 1
  }
  const place = places(env)
  const uid = process.getuid?.() ?? 0
  await run('launchctl', ['bootout', `gui/${uid}/${DASHBOARD_LABEL}`]).catch(() => {})
  await rm(place.agent, { force: true })

  const dir = secureAddressDir(env)
  const pem = await readFile(join(dir, CERTIFICATE_FILE), 'utf8').catch(() => undefined)
  if (pem !== undefined) {
    io.out('◆ macOS asks for your password to stop trusting the certificate.')
    await run('security', ['remove-trusted-cert', join(dir, CERTIFICATE_FILE)]).catch(() => {})
    const sha1 = new X509Certificate(pem).fingerprint.replaceAll(':', '')
    await run('security', ['delete-certificate', '-Z', sha1, place.keychain]).catch(() => {})
  }

  io.out(`◆ your password as the administrator, once: the hosts line for ${ADDRESS} and its port rule are taken off.`)
  const admin = await run('sudo', ['/bin/sh', '-c', adminUninstallScript()], { interactive: true }).then(
    () => true,
    () => false,
  )

  await rm(dir, { recursive: true, force: true })
  await rm(place.app, { recursive: true, force: true })
  await rm(place.logs, { recursive: true, force: true })
  if (!admin) {
    io.err(`The hosts line and the port rule are still there: run this again to take them off.`)
    return 1
  }
  io.out('◆ OpenAgent is off this Mac. Your projects and their agents’ records are left as they were.')
  return 0
}
