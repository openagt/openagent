import { useState, type KeyboardEvent } from 'react'
import { parseMachineUrl } from '../../src/client.js'
import { addMachine } from '../lib/machines.js'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'

// The "Add a machine" modal (#1052). A machine is any reachable daemon — a LAN IP, a tailnet name,
// a tunnel URL — so the input is not a LAN-IP model but the full `?token=` URL the other machine
// prints when it is opened to the network (cli.ts). The address and the key are read out of one
// paste and handed to the daemon, which keeps them: the key is not kept in the browser.

export function AddMachineDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseMachineUrl(url)
  // A pasted URL with no `?token=` cannot authenticate against a guarded machine, so it is not savable.
  const valid = parsed !== null && parsed.token !== ''

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    const result = await addMachine(url, label.trim() || undefined).catch(() => ({ ok: false as const, error: 'The machine could not be saved.' }))
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onAdded()
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void save()
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }} title="Add a machine">
      <div className="flex w-full flex-col gap-2" onKeyDown={onKeyDown}>
        <p className="text-xs text-muted-foreground">
          Paste the URL the other machine printed when it was opened to the network (it looks like <code>http://host:port/?token=…</code>).
        </p>
        <input
          type="text"
          value={url}
          placeholder="http://host:port/?token=…"
          autoFocus
          onChange={e => setUrl(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
        <input
          type="text"
          value={label}
          maxLength={60}
          placeholder={parsed ? `Name (optional) — defaults to ${new URL(parsed.url).host}` : 'Name (optional)'}
          onChange={e => setLabel(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        {url.trim() !== '' && !valid && (
          <p className="text-xs text-warning">
            {parsed === null ? 'That is not a valid URL.' : 'This URL has no token, so the machine would refuse every call.'}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!valid || saving} onClick={() => void save()}>
            Add machine
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
