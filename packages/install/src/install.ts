import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { CERTIFICATE_FILE, KEY_FILE, readSecureAddress, secureAddressDir } from '@openagt/dashboard/secure-address'
import { ADDRESS, CERTIFICATE_CONFIG, CERTIFICATE_DAYS, LOOPBACK_ADDRESS } from './address.js'
import { linux } from './linux.js'
import { mac } from './mac.js'
import type { InstallIO, Platform } from './platform.js'
import { asAdmin, run } from './run.js'

export type { InstallIO }

const defaultIO: InstallIO = {
  out: line => process.stdout.write(line + '\n'),
  err: line => process.stderr.write(line + '\n'),
}

/** The kinds of computer OpenAgent installs on. */
const PLATFORMS: Partial<Record<NodeJS.Platform, Platform>> = { darwin: mac, linux }

/** The port the dashboard's plain address is on, which the install's dashboard takes. */
const DASHBOARD_PORT = 4200

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
 * The dashboard the computer starts at login. Run from a checkout, or from a folder of its own,
 * it is the one this command came with. Run by `npx`, that one is in npm's cache, which npm
 * empties when it likes: the same version is installed to a folder of OpenAgent's own.
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
  await writeFile(config, CERTIFICATE_CONFIG)
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, KEY_FILE), '-out', join(dir, CERTIFICATE_FILE), '-days', String(CERTIFICATE_DAYS), '-config', config, '-extensions', 'ext'])
  await rm(config)
  return readFile(join(dir, CERTIFICATE_FILE), 'utf8')
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

/** The variables of the install's terminal the dashboard needs at login: its `PATH`, and a moved config folder. */
function dashboardVars(env: NodeJS.ProcessEnv): { [name: string]: string } {
  return { PATH: env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin', ...(env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME } : {}) }
}

/** `url` in the person's browser, opened by `command` and not waited for: where none opens, the address is printed. */
function openInBrowser(command: string, url: string): void {
  spawn(command, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

/**
 * `npx @openagt/install`: the dashboard starts at login, at `https://openagent.build`. Asks for
 * the person's password as the administrator, for the name and its port; on a Mac also macOS's
 * own window, to trust the certificate made here. Typed again, it does the same, and asks nothing
 * it needs no more.
 */
export async function install(io: InstallIO = defaultIO, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const platform = PLATFORMS[process.platform]
  if (!platform) {
    io.err('For now OpenAgent installs on a Mac or on Linux only. On this computer, run `npx @openagt/dashboard`.')
    return 1
  }
  const unable = await platform.unable(env)
  if (unable) {
    io.err(unable)
    return 1
  }
  // One installed already stops first, and is waited for, so what holds the port below is someone else's.
  const stopped = await platform.stopDashboard(env)
  if (!(await freed(DASHBOARD_PORT, stopped ? 15_000 : 0))) {
    io.err(`A dashboard runs on port ${DASHBOARD_PORT} already. Stop it (Ctrl+C in its terminal), then run this again.`)
    return 1
  }
  try {
    const dashboard = await lastingDashboard(platform.appDir(env), io)
    await platform.prepare(io, env)
    const cert = await ensureCertificate(env)
    const certFile = join(secureAddressDir(env), CERTIFICATE_FILE)
    await asAdmin(platform.adminInstall(certFile), io)
    await platform.trust(certFile, io, env)

    const output = await platform.startDashboard({ node: process.execPath, dashboard, vars: dashboardVars(env) }, env)
    if (!(await waitUntilAnswers(cert, 30_000))) {
      io.err(`The dashboard does not answer at https://${ADDRESS} yet. What it says is in ${output}.`)
      return 1
    }
    io.out(`◆ OpenAgent is installed: https://${ADDRESS}`)
    io.out('  It starts when you log in. `npx @openagt/uninstall` takes it off again.')
    openInBrowser(platform.openCommand, `https://${ADDRESS}`)
    return 0
  } catch (err) {
    io.err(`OpenAgent could not be installed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

/** `npx @openagt/uninstall`: everything {@link install} put on this computer, taken off. Each part is taken off even when another fails. */
export async function uninstall(io: InstallIO = defaultIO, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const platform = PLATFORMS[process.platform]
  if (!platform) {
    io.err('OpenAgent installs on a Mac or on Linux only, so there is nothing to take off here.')
    return 1
  }
  const left = await platform.leftBehind(env)
  await platform.removeDashboard(env)
  const dir = secureAddressDir(env)
  await platform.untrust(join(dir, CERTIFICATE_FILE), io, env)
  const admin = await asAdmin(platform.adminUninstall(), io).then(
    () => true,
    () => false,
  )
  await rm(dir, { recursive: true, force: true })
  for (const folder of platform.folders(env)) await rm(folder, { recursive: true, force: true })
  if (!admin) {
    io.err('The hosts line and the port rule are still there: run this again to take them off.')
    return 1
  }
  io.out('◆ OpenAgent is off this computer. Your projects and their agents’ records are left as they were.')
  if (left) io.out(`  ${left}`)
  return 0
}
