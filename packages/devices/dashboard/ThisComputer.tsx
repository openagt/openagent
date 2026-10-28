import { useState, type ReactNode } from 'react'
import { Globe, Laptop, UserRound, Waypoints, Wifi } from 'lucide-react'
import { Button, Switch, buttonVariants, cn } from '@openagt/dashboard/module'
import { setSwitch, setTailscale } from './devices.js'
import { reach, sharedReach } from './servers.js'
import { hasDoor, hasServer } from './model.js'
import { Problem } from './parts.js'
import type { Devices } from './use-devices.js'

// Settings › Devices, at the top: this computer, and how the person's devices reach it. On this
// Wi-Fi, through the door's one switch; from anywhere, through each server this computer is in
// at, by the line it keeps open to that server: a server it installed, one it was let into from
// another computer of this person's, one someone invited this person to. Each has its switch.

/** What turning the Wi-Fi switch on says first: the link is not locked, and what that means. */
export const WARNING =
  'The link between the phone and this computer is plain HTTP, with no lock. Someone else on the same Wi-Fi who listens can read what passes, and can then start agents on this computer. Use it on a Wi-Fi you trust, like the one at home, and turn it off on any other.'

/** A way in, with its icon, its words and its switch. */
function Way({ icon: Icon, label, words, children }: { icon: typeof Wifi; label: string; words: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="flex min-w-0 gap-2">
        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-xs text-muted-foreground">{words}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

/** A server's line, as one switch: from anywhere, through that server. */
interface Line {
  key: string
  label: string
  on: boolean
  refused: boolean
  turn: (on: boolean) => Promise<boolean>
}

export function ThisComputer({ d, start }: { d: Devices; /** The start page: nothing reaches this computer yet, and the card says so alone. */ start: boolean }) {
  const { host, door } = d
  const status = door?.ok ? door.value : undefined
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const name = d.machines?.name ?? 'This computer'

  const change = async (run: () => Promise<{ ok: true } | { ok: false; error: string }>, reload: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    const answer = await run()
    if (!answer.ok) setError(answer.error)
    await reload().catch(() => {})
    setBusy(false)
    return answer.ok
  }
  const wifi = (on: boolean): void => {
    setConfirming(false)
    void change(() => d.changeDoor(() => setSwitch(host, on)), async () => {})
  }
  const onTailscale = (on: boolean): void => void change(() => d.changeDoor(() => setTailscale(host, on)), async () => {})

  // Each server this computer is in at, by the line it keeps there: installed here, or set up elsewhere.
  const lines: Line[] = [
    ...d.servers
      .filter(server => server.through === undefined && d.machines?.machines.some(machine => machine.url === server.url))
      .map(server => ({
        key: server.address,
        label: d.machines?.machines.find(machine => machine.url === server.url)?.label ?? server.address,
        on: server.reach === 'full' && d.devices[server.address]?.lineRefused !== true,
        refused: d.devices[server.address]?.lineRefused === true,
        turn: async (on: boolean) => {
          const done = await change(() => reach(host, server.address, on ? 'full' : 'watch'), d.reloadServers)
          // A line asked for anew is one the server lets in: said at once, not at the next look at its devices.
          const read = d.devices[server.address]
          if (done && on && read?.lineRefused) d.setDevices(server.address, { ...read, lineRefused: false })
          return done
        },
      })),
    ...(d.machines?.machines ?? [])
      .filter(machine => hasDoor(machine) && d.people[machine.id] !== undefined && !d.servers.some(server => server.url === machine.url))
      .map(machine => {
        const kept = d.shared.find(row => row.url === machine.url)
        return {
          key: machine.id,
          label: machine.label,
          on: kept?.reach === 'full' && !kept.lineRefused,
          refused: kept?.lineRefused === true,
          turn: (on: boolean) => change(() => sharedReach(host, machine.url, on ? 'full' : 'watch'), d.reloadShared),
        }
      }),
  ]
  const server = hasServer({ servers: d.servers, machines: d.machines?.machines ?? [] })
  const firstServer = lines[0]?.label
  const where = status?.https ? `https://${status.https.address.includes(':') ? `[${status.https.address}]` : status.https.address}` : undefined

  return (
    <section aria-label="This computer" className="space-y-1 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <Laptop aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {name} <span className="text-xs font-normal text-muted-foreground">· this computer</span>
          </p>
          {start && <p className="text-xs text-muted-foreground">Nothing reaches it yet: only this computer's own browser opens OpenAgent.</p>}
        </div>
      </div>
      {!start && (
        <div className="pt-2">
          <p className="pb-1 text-xs text-muted-foreground">How your devices reach it</p>
          {where !== undefined ? (
            <Way icon={Globe} label="On the internet" words={`This computer is a server. A device that is in opens OpenAgent at ${where} from anywhere.`}>
              {null}
            </Way>
          ) : (
            // Your own devices on your Tailscale network, from anywhere, with or without a server: the door
            // listens on this computer alone, and Tailscale serves it there, with a lock.
            <Way
              icon={Waypoints}
              label="On your Tailscale network"
              words={
                status?.tailscale
                  ? status.listening
                    ? `Your devices on Tailscale open OpenAgent at https://${status.tailscale.address}, from anywhere, with a lock.`
                    : `At https://${status.tailscale.address} once Tailscale serves it.`
                  : 'Your own phones and computers on Tailscale, from anywhere, with a lock. Tailscale must run on this computer.'
              }
            >
              <Switch aria-label="On your Tailscale network" checked={status?.tailscale !== undefined} disabled={busy || !status} onCheckedChange={onTailscale} />
            </Way>
          )}
          {where === undefined && status?.tailscale !== undefined && !status.listening && status.problem !== undefined && !busy && (
            <div className="space-y-2 py-1 pl-6">
              <Problem>{status.problem}</Problem>
              {status.fixAt !== undefined && (
                <a href={status.fixAt} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  Turn on Serve
                </a>
              )}
            </div>
          )}
          {/* The switch is not looked at behind Tailscale: this computer's devices reach it there. */}
          {where === undefined && status?.tailscale === undefined && (
            <Way icon={Wifi} label="On this Wi-Fi" words="Phones and computers at home, with no lock on the link.">
              <Switch
                aria-label="On this Wi-Fi"
                checked={status?.on ?? false}
                disabled={busy || !status}
                onCheckedChange={on => {
                  if (on) setConfirming(true)
                  else wifi(false)
                }}
              />
            </Way>
          )}
          {confirming && (
            <div role="alertdialog" aria-label="Turn on On this Wi-Fi" className="space-y-3 py-2 pl-6">
              <p className="text-sm">{WARNING}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => wifi(true)}>
                  Turn on
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {(status?.on || status?.https) && status.tailscale === undefined && status.problem !== undefined && !busy && <Problem>{status.problem}</Problem>}
          {lines.map(line => (
            <Way
              key={line.key}
              icon={Globe}
              label={`From anywhere, through ${line.label}`}
              words={
                line.refused
                  ? `Off: ${line.label} no longer lets this computer in for its line. Turn it on to set the line up again.`
                  : 'Your phone and your other computers start runs here from any internet. This computer must be on.'
              }
            >
              <Switch aria-label={`From anywhere, through ${line.label}`} checked={line.on} disabled={busy} onCheckedChange={on => void line.turn(on)} />
            </Way>
          ))}
          {server && !d.isServer && (
            <p className={cn('flex gap-2 border-t border-border pt-2 text-xs text-muted-foreground', lines.length || where === undefined ? 'mt-2' : undefined)}>
              <UserRound aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{`Only you can use this computer. To share a computer with people${firstServer !== undefined ? ` on ${firstServer}` : ''}, set it up as a server: Linux for now.`}</span>
            </p>
          )}
          {error !== undefined && <Problem>{error}</Problem>}
        </div>
      )}
    </section>
  )
}

