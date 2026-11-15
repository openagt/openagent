import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { CustomPreset } from '../../src/index.js'
import { Button } from './ui/button.js'
import { Input } from './ui/input.js'
import { Textarea } from './ui/textarea.js'
import { Dialog } from './ui/dialog.js'
import { pressed } from '../lib/shortcut.js'

// The "Save prompt" dialog (#649/#626): a modal over the composer rather than a panel that
// pushed the controls down. Prefills the prompt from the editor's current text — the common "save
// what I just wrote" path. A saved prompt is just a label + a prompt, plus where it is kept (#1025).

const LABEL_MAX = 80

/** Where a saved prompt lives (#1025): private to the user, or committed into the project's repo. */
export type PresetScope = 'user' | 'project'

/** A fresh id for a saved prompt. `crypto.randomUUID` is present in every browser this targets. */
function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}`
}

export function PresetCreatePanel({
  currentPrompt,
  busy,
  canSaveToProject,
  onSave,
  onCancel,
}: {
  /** The editor's current text, prefilled so you can save what you just wrote. */
  currentPrompt: string
  busy: boolean
  /** Whether a project is open to commit a shared prompt into (#1025); hides the scope choice otherwise. */
  canSaveToProject: boolean
  onSave: (preset: CustomPreset, scope: PresetScope) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const labelField = useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = useState(currentPrompt)
  const [scope, setScope] = useState<PresetScope>('user')

  // What an empty field needs, said under it while Save waits for it.
  const needs = useId()
  const trimmedLabel = label.trim()
  const trimmedPrompt = prompt.trim()

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    if (!trimmedLabel || !trimmedPrompt) return
    onSave({ id: newId(), label: trimmedLabel, prompt: trimmedPrompt }, canSaveToProject ? scope : 'user')
  }

  // ⌘/Ctrl+Enter saves, matching the composer (#948); Esc closes via the Dialog itself.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (pressed(e, 'savePrompt')) {
      e.preventDefault()
      save()
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onCancel() }} title="Save prompt" initialFocus={labelField}>
      <form className="flex w-full flex-col gap-2" onKeyDown={onKeyDown} onSubmit={save}>
      <Input
        name="prompt-name"
        ref={labelField}
        type="text"
        value={label}
        maxLength={LABEL_MAX}
        placeholder="Name"
        aria-label="Name"
        {...(!trimmedLabel ? { 'aria-describedby': `${needs}-name` } : {})}
        disabled={busy}
        onChange={e => setLabel(e.target.value)}
        className="h-8 bg-background px-2"
      />
      {!trimmedLabel && (
        <p id={`${needs}-name`} className="text-xs text-muted-foreground">
          Name it to save it: Commands lists it by its name.
        </p>
      )}
      <Textarea
        name="prompt"
        value={prompt}
        placeholder="The prompt to save…"
        aria-label="Prompt"
        {...(!trimmedPrompt ? { 'aria-describedby': `${needs}-prompt` } : {})}
        disabled={busy}
        rows={5}
        onChange={e => setPrompt(e.target.value)}
        className="resize-y px-2 py-1 font-mono text-xs"
      />
      {!trimmedPrompt && (
        <p id={`${needs}-prompt`} className="text-xs text-muted-foreground">
          Write the prompt it loads into the box.
        </p>
      )}
      {canSaveToProject && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <span>Save to</span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(['user', 'project'] as const).map(value => (
              <button
                key={value}
                type="button"
                disabled={busy}
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={
                  scope === value
                    ? 'bg-foreground px-2 py-1 text-background'
                    : 'px-2 py-1 text-foreground hover:bg-[var(--color-muted)]'
                }
              >
                {value === 'user' ? 'Just me' : 'This project'}
              </button>
            ))}
          </div>
          <span className="truncate">
            {scope === 'project' ? 'Committed to the repo, shared with your team' : 'Private to you, on every project'}
          </span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !trimmedLabel || !trimmedPrompt}>
          Save prompt
        </Button>
      </div>
      </form>
    </Dialog>
  )
}
