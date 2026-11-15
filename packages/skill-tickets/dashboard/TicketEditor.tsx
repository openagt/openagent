import { useRef, useState } from 'react'
import { Button, Input, Label, Textarea, useModuleHost } from '@openagt/dashboard/module'
import { newTicketFile, topicsIn, writeTicketFile, type TicketFields } from '../src/ticket-file.js'
import { listTickets, ticketsChanged } from './lib/list.js'
import { focusTitleOnceShown } from './TicketHeader.js'

/** What `put` answered, when it refused: its reason. */
function refusal(output: unknown): string | undefined {
  const said = output as { ok?: unknown; reason?: unknown } | null
  return said && typeof said === 'object' && said.ok === false ? (typeof said.reason === 'string' ? said.reason : 'the ticket could not be saved') : undefined
}

/** Today on this computer, as a ticket's name starts: yyyy-mm-dd. */
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * A ticket written by hand: its title, priority, topics, what it waits on and its text, saved with
 * the tickets command's `put` as one commit, like any other change to the tickets. Editing keeps
 * the lines above the title it does not show (`Issue:`, `PR:`); a new ticket is named by today
 * and its title, never over one already there.
 */
export function TicketEditor({
  projectId,
  file,
  initial,
  issueLabel,
  workedBy,
  onSaved,
  onCancel,
}: {
  projectId: string
  /** The ticket edited; none for a new one. */
  file?: string | undefined
  initial: TicketFields
  /** The issue the ticket follows: its title and text are rewritten from it when it changes. */
  issueLabel?: string | undefined
  /** The run at work on the ticket, by its name: it started from the ticket as it was. */
  workedBy?: string | undefined
  onSaved: (file: string) => void
  onCancel: () => void
}) {
  const host = useModuleHost()
  const [title, setTitle] = useState(initial.title)
  const [priority, setPriority] = useState(initial.priority)
  const [topics, setTopics] = useState(initial.topics.join(', '))
  const [waiting, setWaiting] = useState(initial.waiting)
  const [body, setBody] = useState(initial.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priorityOk = priority.trim() === '' || (/^\d+$/.test(priority.trim()) && Number(priority) <= 10)
  const untitled = title.trim() === ''
  // Pressed without a title: the field says it needs one, until it has one.
  const [askedTitle, setAskedTitle] = useState(false)
  const titleField = useRef<HTMLInputElement>(null)
  const priorityField = useRef<HTMLInputElement>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      let name = file
      if (name === undefined) {
        const listed = await listTickets(host, projectId)
        if ('error' in listed) throw new Error(listed.error)
        name = newTicketFile(title, today(), new Set(listed.tickets.map(ticket => ticket.file)))
      }
      const content = writeTicketFile({ priority: priority.trim(), topics: topicsIn(topics), waiting, title, body, kept: initial.kept })
      const result = await host.act(projectId, ['put', name], undefined, content)
      if (!result.ok) throw new Error(result.error)
      const refused = refusal(result.output)
      if (refused) throw new Error(refused)
      ticketsChanged(projectId)
      focusTitleOnceShown(name)
      onSaved(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form
      className="max-w-180 space-y-4"
      onSubmit={event => {
        event.preventDefault()
        if (saving) return
        // What stops the save is said where it is, and the keyboard is taken there.
        if (untitled) {
          setAskedTitle(true)
          titleField.current?.focus()
        } else if (!priorityOk) priorityField.current?.focus()
        else void save()
      }}
    >
      {workedBy && <p className="text-sm text-muted-foreground">The run “{workedBy}” is working on this ticket and started from it as it was: it may not see this change.</p>}
      {issueLabel && (
        <p id="ticket-issue-note" className="text-sm text-muted-foreground">
          This ticket follows issue {issueLabel}: when the issue changes, Update tickets writes its title and text again from it. Priority and topics stay as you set them.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="ticket-title">Title</Label>
        <Input
          ref={titleField}
          id="ticket-title"
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="What should be done, in a few words"
          aria-invalid={askedTitle && untitled}
          // The issue's note is said at the two fields it may write again.
          aria-describedby={[askedTitle && untitled && 'ticket-title-missing', issueLabel && 'ticket-issue-note'].filter(Boolean).join(' ') || undefined}
          autoFocus
        />
        {askedTitle && untitled && (
          <p id="ticket-title-missing" className="text-xs text-danger">
            Give the ticket a title.
          </p>
        )}
      </div>
      <div className="flex gap-4 max-sm:flex-col">
        <div className="space-y-2 sm:w-32">
          <Label htmlFor="ticket-priority">Priority</Label>
          <Input ref={priorityField} id="ticket-priority" value={priority} onChange={event => setPriority(event.target.value)} inputMode="numeric" placeholder="0–10" aria-invalid={!priorityOk} aria-describedby={priorityOk ? undefined : 'ticket-priority-error'} />
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="ticket-topics">Topics</Label>
          <Input id="ticket-topics" value={topics} onChange={event => setTopics(event.target.value)} placeholder="ui, install" />
        </div>
      </div>
      {!priorityOk && (
        <p id="ticket-priority-error" className="text-xs text-danger">
          Priority is a whole number from 0 to 10, or empty for none.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="ticket-waiting">Waiting on</Label>
        <Input id="ticket-waiting" value={waiting} onChange={event => setWaiting(event.target.value)} placeholder="Nothing" aria-describedby="ticket-waiting-note" />
        <p id="ticket-waiting-note" className="text-xs text-muted-foreground">
          No agent plans or works the ticket while it waits. Empty it when the wait is over.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-body">Text</Label>
        <Textarea
          id="ticket-body"
          aria-describedby={issueLabel ? 'ticket-issue-note' : undefined}
          value={body}
          onChange={event => setBody(event.target.value)}
          // Enter makes a new line in the text; with Ctrl or ⌘ it saves the ticket.
          onKeyDown={event => {
            if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
          rows={14}
          className="font-mono text-sm"
          placeholder={'## TLDR\n\nWhat is wrong or missing, and what done looks like.\n\n## Why it matters\n\n…'}
        />
        <p className="text-xs text-muted-foreground">Markdown. Agents read it as the ticket.</p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not saved: {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          {saving ? 'Saving…' : file === undefined ? 'Create ticket' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
