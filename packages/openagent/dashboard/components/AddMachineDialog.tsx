import { useState, type KeyboardEvent } from 'react'
import { parseMachineLink } from '../../src/client.js'
import { addMachine } from '../lib/machines.js'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'

// The "Add a machine" modal (#1052). The other machine's OpenAgent listens on its own computer
// only, so this one gets in as a phone does: with the link the other machine gives for a new
// device, pasted here where a phone scans it. The daemon is let in with it and keeps the key it is
// answered: no key is kept in the browser.

export function AddMachineDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A paste that is no link with a code in it cannot let this computer in, so it is not savable.
  const parsed = parseMachineLink(url)
  const valid = parsed !== null

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
          On the other machine, open Settings, find Devices, and press Add device. Copy the link under the code and paste it
          here. It works once, and for a short time.
        </p>
        <input
          type="text"
          value={url}
          placeholder="http://studio.local:4201/…"
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
            That is not the link another machine gives for a new device.
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
            {saving ? 'Adding…' : 'Add machine'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
