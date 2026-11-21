import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, Dialog, Input, Textarea, pressed, useLoaded, useModuleHost, type UiPromptSaveProps } from '@openagt/ui/module'
import { LIMITS, type Whose } from '../src/saved.js'
import { hasProject, save } from './calls.js'

// The "Save prompt" dialog (#649, #626, #2394): a modal over the message box, which its menus'
// "Save prompt…" opens. It is prefilled with what the box holds, the common "save what I just
// wrote" path. A saved prompt is a name and a text, the person's or, in a project, the project's
// (#1025), kept with the project's agent data.

export function SavePrompt({ projectId, text, onDone }: UiPromptSaveProps) {
  const host = useModuleHost()
  const [label, setLabel] = useState('')
  const labelField = useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = useState(text)
  const [whose, setWhose] = useState<Whose>('person')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Whether the box is in a project, whose prompt it may then be: the choice shows once that is read.
  const inProject = useLoaded(() => hasProject(host, projectId).catch(() => false), false, [host, projectId])

  // What an empty field needs, said under it while Save waits for it.
  const needs = useId()
  const trimmedLabel = label.trim()
  const trimmedPrompt = prompt.trim()

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!trimmedLabel || !trimmedPrompt || busy) return
    setBusy(true)
    setError(null)
    save(host, projectId, { label: trimmedLabel, text: trimmedPrompt, whose: inProject ? whose : 'person' }).then(
      () => onDone(true),
      (failed: unknown) => {
        setBusy(false)
        setError(failed instanceof Error ? failed.message : String(failed))
      },
    )
  }

  // ⌘/Ctrl+Enter saves, matching the box; Esc closes, through the Dialog itself.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (pressed(e, 'savePrompt')) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onDone(false) }} title="Save prompt" initialFocus={labelField}>
      <form className="flex w-full flex-col gap-2" onKeyDown={onKeyDown} onSubmit={submit}>
        <Input
          name="prompt-name"
          ref={labelField}
          type="text"
          value={label}
          maxLength={LIMITS.label}
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
          maxLength={LIMITS.text}
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
        {inProject && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <span>Save to</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(['person', 'project'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => setWhose(value)}
                  aria-pressed={whose === value}
                  className={whose === value ? 'bg-foreground px-2 py-1 text-background' : 'px-2 py-1 text-foreground hover:bg-[var(--color-muted)]'}
                >
                  {value === 'person' ? 'Just me' : 'This project'}
                </button>
              ))}
            </div>
            <span className="truncate">{whose === 'project' ? 'Kept with this project’s agent data: whoever reads that has it' : 'Yours alone, in every project'}</span>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone(false)}>
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
