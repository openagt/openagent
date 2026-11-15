import { useId, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Button, Checkbox, Input, SettingsFoot, useOpenAgentDown } from '@openagt/dashboard/module'
import { hasDoor } from './model.js'
import { Problem, useFlowHold } from './parts.js'
import { sharedReach } from './servers.js'
import type { Devices } from './use-devices.js'

// Join with a code: this computer gets in where another device of the person's gave a code, by
// typing where and the code it shows. Through a server, this computer's own runs can come from
// the person's other devices too, in the same press: it keeps its line there, and the computers
// of the person's that keep theirs are saved here, through the server.

/** Where and the code out of one paste, as "Copy both" puts them. */
export function readBoth(pasted: string): { where: string; code: string } | undefined {
  const match = /where:\s*(\S+)\s+code:\s*([a-z0-9][a-z0-9 -]*[a-z0-9])/i.exec(pasted.trim())
  return match ? { where: match[1]!, code: match[2]! } : undefined
}

/** A link a door gave, pasted whole: it holds where and the code already. */
const isLink = (said: string): boolean => /^https?:\/\/[^#]+#./i.test(said.trim())

/** The address a pasted link is for: what is said of it, without the code it holds. */
function hostOfLink(link: string): string {
  try {
    return new URL(link.trim()).host
  } catch {
    return ''
  }
}

/** The address typed under Where, as a door's origin: a server's door speaks HTTPS. */
export function originOf(where: string): string | undefined {
  const host = where.trim().replace(/^https:\/\//i, '').replace(/\/+$/, '')
  if (!host || /[\s/#?@]/.test(host)) return undefined
  try {
    return new URL(`https://${host}`).origin
  } catch {
    return undefined
  }
}

/** The link the door would have given for where and the code: what OpenAgent gets in with. */
export function linkOf(where: string, code: string): string | undefined {
  if (isLink(where)) return where.trim()
  const origin = originOf(where)
  const typed = code.toUpperCase().replace(/[\s-]/g, '')
  return origin && /^[A-Z0-9]{4,32}$/.test(typed) ? `${origin}/_devices/enter#${typed}` : undefined
}

export function Join({ d, onClose, onJoined }: { d: Devices; onClose: () => void; /** The code was someone else's computer's: its page opens, where their logins are set. */ onJoined?: (machineId: string) => void }) {
  const down = useOpenAgentDown()
  const { host } = d
  const [where, setWhere] = useState('')
  const [code, setCode] = useState('')
  const [both, setBoth] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // Join stands in Settings' foot, outside the form's box: it is the form's own press by its id.
  const formId = useId()
  // What was typed is held until it is sent: Join, or Cancel, which throws it away.
  const leave = useFlowHold((where.trim() !== '' || code.trim() !== '') && !error?.startsWith('Joined.'))
  const link = linkOf(where, code)
  // Through a server: a link pasted whole may be a computer's on its Wi-Fi, or one on Tailscale, which keeps no line.
  const server = link !== undefined && hasDoor({ url: new URL(link).origin })
  // Where, never the code: a link pasted whole is said by its address alone.
  const shownWhere = isLink(where) ? hostOfLink(where) : (originOf(where)?.replace(/^https:\/\//, '') ?? where.trim())

  // "Copy both" pasted into either field fills both.
  const paste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const read = readBoth(event.clipboardData.getData('text'))
    if (!read) return
    event.preventDefault()
    setWhere(read.where)
    setCode(read.code)
  }

  const join = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!link) return
    setJoining(true)
    setError(undefined)
    const added = await host.addMachine(link)
    if (!added.ok) {
      setError(added.error)
      setJoining(false)
      return
    }
    const origin = new URL(link).origin
    const machine = (await host.machines().catch(() => undefined))?.machines.find(saved => saved.url === origin)
    const problems: string[] = []
    if (machine && hasDoor(machine)) {
      if (both) {
        const reached = await sharedReach(host, machine.url, 'full')
        if (!reached.ok) problems.push(`Your other devices cannot start runs here yet: ${reached.error}`)
      }
      // The person's computers that keep a line there: saved here, so runs go to them from here.
      const there = await host.computersThrough(machine.id)
      if (there.ok) {
        for (const computer of there.computers.filter(computer => computer.owner === undefined && !computer.added)) {
          const saved = await host.addComputerThrough(machine.id, computer.id)
          if (!saved.ok) problems.push(`${computer.name} could not be saved: ${saved.error}`)
        }
      }
    }
    await Promise.all([d.reloadMachines(), d.reloadShared()]).catch(() => {})
    setJoining(false)
    if (problems.length) setError(`Joined. ${problems.join(' ')}`)
    // Someone else's computer: its page says whose it is, and takes this person's logins for it.
    else if (machine?.owner !== undefined && onJoined) leave(() => onJoined(machine.id))
    else leave(onClose)
  }

  return (
    <form id={formId} className="space-y-4" onSubmit={event => void join(event)}>
      <p className="text-sm text-muted-foreground">Type what the other device shows.</p>
      <label className="block space-y-1">
        <span className="block text-sm font-medium">Where</span>
        <Input name="pairing-address" autoFocus aria-label="Where" placeholder="203.0.113.10" value={where} onPaste={paste} onChange={event => setWhere(event.target.value)} className="font-mono" />
        <span className="block text-xs text-muted-foreground">An address, or the whole link the other device gave.</span>
      </label>
      {!isLink(where) && (
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Code</span>
          <Input name="pairing-code" aria-label="Code" placeholder="K7P4-QX9M" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} onPaste={paste} onChange={event => setCode(event.target.value)} className="font-mono uppercase placeholder:normal-case" />
        </label>
      )}
      {server && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={both} onCheckedChange={checked => setBoth(checked === true)} aria-label="Your other devices can start runs on this computer" />
          <span>
            Your other devices can start runs on this computer
            <span className="block text-xs text-muted-foreground">{`Through ${shownWhere}, while it is on.`}</span>
          </span>
        </label>
      )}
      {error !== undefined && <Problem>{error}</Problem>}
      <SettingsFoot>
        <div className="flex justify-end gap-2 max-md:[&_button]:h-11">
          <Button type="button" variant="ghost" onClick={() => leave(onClose)}>
            {error?.startsWith('Joined.') ? 'Done' : 'Cancel'}
          </Button>
          {!error?.startsWith('Joined.') && (
            <Button type="submit" form={formId} loading={joining} disabled={link === undefined || down}>
              Join
            </Button>
          )}
        </div>
      </SettingsFoot>
    </form>
  )
}
