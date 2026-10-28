import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A home folder of a test's own: the env the door's file is found through, and how to remove it. */
export async function testHome(): Promise<{ env: NodeJS.ProcessEnv; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'devices-'))
  return { env: { XDG_CONFIG_HOME: dir }, remove: () => rm(dir, { recursive: true, force: true }) }
}

/** A door's process in a test says nothing on the network: what it would say is the Wi-Fi's own test's. */
export const quietAnnounce = async (): Promise<{ stop: () => Promise<void> }> => ({ stop: async () => {} })

/**
 * A `tailscale` command as a test has it: this computer signed in as `name`, and Serve, which is
 * off for the network until `enable()` (then it says where it is turned on), keeping what it
 * serves. Each call is noted in `calls`.
 */
export function fakeTailscale(name = 'laptop.tail1234.ts.net', opts: { serveOff?: boolean; state?: string } = {}) {
  const calls: string[][] = []
  let off = opts.serveOff === true
  let served: string | undefined
  const run = async (args: string[]): Promise<{ code: number | null; out: string }> => {
    calls.push(args)
    const [first, second] = args
    if (first === 'status') return { code: 0, out: JSON.stringify({ BackendState: opts.state ?? 'Running', Self: { DNSName: `${name}.` } }) }
    if (first === 'serve' && second === 'status') return { code: 0, out: JSON.stringify(served ? { TCP: { '443': { HTTPS: true } }, Web: { [`${name}:443`]: { Handlers: { '/': { Proxy: served } } } } } : {}) }
    if (first === 'serve' && args.at(-1) === 'off') {
      served = undefined
      return { code: 0, out: '' }
    }
    if (first === 'serve' && second === '--bg') {
      if (off) return { code: null, out: 'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=n1234CNTRL\n' }
      served = args.at(-1)
      return { code: 0, out: `Available within your tailnet:\n\nhttps://${name}/\n|-- proxy ${served}\n` }
    }
    return { code: 1, out: `unknown command ${args.join(' ')}` }
  }
  return {
    run,
    calls,
    /** What Serve sends on now, if anything. */
    served: () => served,
    /** The person turns Serve on for their network. */
    enable: () => void (off = false),
    /** Something else of the person's served on the same port. */
    serveOther: (target: string) => void (served = target),
  }
}
