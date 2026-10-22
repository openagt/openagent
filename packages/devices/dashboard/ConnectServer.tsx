import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Checkbox, Dialog, Input, RadioGroup, RadioGroupOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@openagt/dashboard/module'
import { hasDoor } from './model.js'
import { Problem } from './parts.js'
import type { Devices } from './use-devices.js'

// "Set up a server": a person gives a server's address and a user name, and OpenAgent installs
// itself there over SSH. The install is the `devices server` command's own process; the server's
// page shows its steps as they run. A computer at home, which nothing on the internet reaches, is
// set up the same way, through a server this computer is in at.

export function ConnectServer({ d, onClose, onStarted }: { d: Devices; onClose: () => void; /** The install started: the server is in the list from here on. */ onStarted: (address: string) => void }) {
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('root')
  const [copy, setCopy] = useState(false)
  // How the server is reached: at its own address, or through a server this computer is in at, by that server's address.
  const [reached, setReached] = useState<'internet' | 'through'>('internet')
  const [via, setVia] = useState<string | undefined>()
  const doors = (d.machines?.machines ?? []).filter(hasDoor)
  const through = reached === 'through' ? (via ?? doors[0]?.url) : undefined
  const { account, noLogin, busy, machines } = d

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!address.trim() || !user.trim()) return
    const at = address.trim()
    void d.install(at, user.trim(), copy && account !== undefined, through).then(started => {
      if (started) onStarted(at)
    })
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title="Set up a server">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-muted-foreground">OpenAgent installs itself on the server over SSH, with this computer's own SSH keys, and shows each step as it runs. It takes a few minutes.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
            <span>The server's address</span>
            <Input autoFocus aria-label="The server's address" placeholder="203.0.113.5" value={address} onChange={event => setAddress(event.target.value)} />
          </label>
          <label className="w-32 space-y-1 text-xs text-muted-foreground">
            <span>User name</span>
            <Input aria-label="User name" value={user} onChange={event => setUser(event.target.value)} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          The user is root, or one that becomes root without a password. It is only used to install, to update, to give the server its logins and to list its devices: what runs on the server afterwards runs as a user of its own, openagent.
        </p>
        {doors.length > 0 && (
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">Reached:</p>
            <RadioGroup aria-label="How the server is reached" value={reached} disabled={busy} onValueChange={next => setReached(next as 'internet' | 'through')}>
              <RadioGroupOption value="internet" className="text-xs">
                on the internet, at its own address
              </RadioGroupOption>
              <RadioGroupOption value="through" className="text-xs">
                through a server:
                <Select items={doors.map(door => ({ value: door.url, label: door.label }))} value={through ?? doors[0]!.url} disabled={busy || reached !== 'through'} onValueChange={next => setVia(next as string)}>
                  <SelectTrigger size="sm" aria-label="The server it is reached through" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {doors.map(door => (
                      <SelectItem key={door.url} value={door.url}>
                        {door.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </RadioGroupOption>
            </RadioGroup>
            {reached === 'through' && <p className="text-muted-foreground">SSH must be on at the computer, with this computer's key. The user name is your own user on it.</p>}
          </div>
        )}
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={copy && account !== undefined} onCheckedChange={checked => setCopy(checked === true)} disabled={busy || account === undefined} className="mt-0.5" aria-label="Copy my GitHub login to the server" />
          <span>
            {account !== undefined ? `Copy my GitHub login (${account}) to the server.` : 'Copy my GitHub login to the server.'}{' '}
            <span className="text-muted-foreground">
              {noLogin ?? "It can do there all it can do here, and every agent that runs on the server works with it. It goes there at the install's end, to a server met for the first time too, whose key is taken as it is."}
            </span>
          </span>
        </label>
        {d.error !== undefined && <Problem>{d.error}</Problem>}
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* Not before this computer has said which OpenAgent it runs: that is the one the server gets. */}
          <Button size="sm" type="submit" disabled={busy || !machines || !address.trim() || !user.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Connect
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
