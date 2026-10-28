import { execFile } from 'node:child_process'

/**
 * The door behind Tailscale: a computer the person reaches from their other devices over their own
 * Tailscale network, with or without a server of theirs. The door listens on this computer alone
 * (127.0.0.1), and Tailscale's Serve takes it to the network: it answers at this computer's name
 * there (`laptop.tail1234.ts.net`) over HTTPS, with a certificate Tailscale keeps, and passes each
 * request on to the door as it came. Only the person's own devices on that network reach it, and a
 * device still gets in with a code, as at any door.
 *
 * Serve is something the person turns on once for their whole network, in their Tailscale account:
 * until then, Tailscale says where, and the door says so.
 */

/** How the `tailscale` command is run: its arguments, and how long it may take. */
export type TailscaleRun = (args: string[], timeoutMs: number) => Promise<{ code: number | null; out: string }>

/** The door's port on Tailscale's network: the one a browser opens with no port in the address. */
export const TAILSCALE_PORT = 443

/** How long Serve is given to take the door: it waits for the person to turn it on, when it is off, and is not waited for that long. */
const SERVE_MS = 15_000
const ASK_MS = 10_000

const NOT_INSTALLED = 'Tailscale is not installed on this computer. Install it from tailscale.com and sign in, then turn this on again.'
const NOT_IN = 'Tailscale is not signed in on this computer. Sign in to Tailscale, then turn this on again.'

/** Where macOS keeps the command of the Tailscale app, for a Mac whose command line has none. */
const MAC_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

/**
 * The `tailscale` command, as the person's computer has it: named by OPENAGENT_TAILSCALE, else the
 * one on the path, else the Mac app's. A call still at work when `signal` aborts is ended: one
 * that waits for Serve to be turned on would otherwise serve a door that is gone by then.
 */
export function tailscaleRun(env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): TailscaleRun {
  const once = (command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string } | 'missing'> =>
    new Promise(resolve => {
      execFile(command, args, { timeout: timeoutMs, env, ...(signal ? { signal } : {}) }, (err, stdout, stderr) => {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve('missing')
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0
        resolve({ code, out: `${stdout}${stderr}` })
      })
    })
  return async (args, timeoutMs) => {
    const named = env.OPENAGENT_TAILSCALE
    for (const command of named ? [named] : ['tailscale', ...(process.platform === 'darwin' ? [MAC_APP] : [])]) {
      const ran = await once(command, args, timeoutMs)
      if (ran !== 'missing') return ran
    }
    return { code: null, out: NOT_INSTALLED }
  }
}

/** What Tailscale said, as the door tells the person: this computer's name there, or why there is none. */
export type Said<T> = { ok: true; value: T } | { ok: false; problem: string; enable?: string }

/** This computer's name on the person's Tailscale network, from Tailscale itself. */
export async function tailscaleName(run: TailscaleRun): Promise<Said<string>> {
  const { code, out } = await run(['status', '--json'], ASK_MS)
  if (out === NOT_INSTALLED) return { ok: false, problem: NOT_INSTALLED }
  let status: { BackendState?: unknown; Self?: { DNSName?: unknown } }
  try {
    status = JSON.parse(out) as typeof status
  } catch {
    return { ok: false, problem: code === 0 ? 'Tailscale answered in a way OpenAgent does not read.' : NOT_IN }
  }
  if (status.BackendState !== 'Running') return { ok: false, problem: NOT_IN }
  const name = typeof status.Self?.DNSName === 'string' ? status.Self.DNSName.replace(/\.$/, '').toLowerCase() : ''
  if (!/\.ts\.net$/.test(name)) return { ok: false, problem: 'This computer has no name on your Tailscale network: turn on MagicDNS in your Tailscale account, then turn this on again.' }
  return { ok: true, value: name }
}

/** What Serve sends on, at `name` on its HTTPS port: the address it passes requests to, or undefined when nothing is served there. */
export async function servedAt(run: TailscaleRun, name: string): Promise<Said<string | undefined>> {
  const { code, out } = await run(['serve', 'status', '--json'], ASK_MS)
  if (code !== 0) return { ok: false, problem: `Tailscale could not say what it serves: ${firstLine(out)}` }
  try {
    const config = JSON.parse(out || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }> }
    const handlers = config.Web?.[`${name}:${TAILSCALE_PORT}`]?.Handlers
    if (!handlers) return { ok: true, value: undefined }
    const proxy = handlers['/']?.Proxy
    // Anything else served on that port is the person's own: the door does not take it over.
    return { ok: true, value: Object.keys(handlers).length === 1 && typeof proxy === 'string' ? proxy : 'something else' }
  } catch {
    return { ok: false, problem: 'Tailscale answered in a way OpenAgent does not read.' }
  }
}

/** Serve the door, at 127.0.0.1:`port`, on this computer's HTTPS port on the network; kept by Tailscale across restarts. */
export async function serveDoor(run: TailscaleRun, port: number): Promise<Said<undefined>> {
  const { code, out } = await run(['serve', '--bg', `--https=${TAILSCALE_PORT}`, `http://127.0.0.1:${port}`], SERVE_MS)
  // Off for the whole network: Tailscale names the page in the person's account where it is turned on, and waits for it.
  const enable = /https:\/\/login\.tailscale\.com\/\S+/.exec(out)?.[0]
  if (/not enabled/i.test(out)) return { ok: false, problem: 'Serve is off on your Tailscale network. Turn it on once in your Tailscale account; the door opens by itself then.', ...(enable ? { enable } : {}) }
  if (code !== 0) return { ok: false, problem: `Tailscale did not serve the door: ${firstLine(out)}` }
  return { ok: true, value: undefined }
}

/** Serve nothing on this computer's HTTPS port any more. */
export async function stopServing(run: TailscaleRun): Promise<Said<undefined>> {
  const { code, out } = await run(['serve', `--https=${TAILSCALE_PORT}`, 'off'], ASK_MS)
  return code === 0 ? { ok: true, value: undefined } : { ok: false, problem: `Tailscale did not stop serving the door: ${firstLine(out)}` }
}

function firstLine(out: string): string {
  return out.trim().split('\n')[0]?.trim() || 'it gave no reason'
}
