import { useState } from 'react'
import { Button, Input, Label, Textarea, useModuleHost } from '@openagt/dashboard/module'
import { newTicketFile, topicsIn, writeTicketFile, type TicketFields } from '../src/ticket-file.js'
import { listTickets, ticketsChanged } from './lib/list.js'

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
 * A ticket written by hand: its title, priority, topics and text, saved with the tickets
 * command's `put` as one commit, like any other change to the tickets. Editing keeps the lines
 * above the title it does not show (`Issue:`, `PR:`, `Waiting:`); a new ticket is named by today
 * and its title, never over one already there.
 */
export function TicketEditor({
  projectId,
  file,
  initial,
  issueLabel,
  onSaved,
  onCancel,
}: {
  projectId: string
  /** The ticket edited; none for a new one. */
  file?: string | undefined
  initial: TicketFields
  /** The issue the ticket follows: its title and text are rewritten from it when it changes. */
  issueLabel?: string | undefined
  onSaved: (file: string) => void
  onCancel: () => void
}) {
  const host = useModuleHost()
  const [title, setTitle] = useState(initial.title)
  const [priority, setPriority] = useState(initial.priority)
  const [topics, setTopics] = useState(initial.topics.join(', '))
  const [body, setBody] = useState(initial.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priorityOk = priority.trim() === '' || (/^\d+$/.test(priority.trim()) && Number(priority) <= 10)
  const ready = title.trim() !== '' && priorityOk && !saving

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
      const content = writeTicketFile({ priority: priority.trim(), topics: topicsIn(topics), title, body, kept: initial.kept })
      const result = await host.act(projectId, ['put', name], undefined, content)
      if (!result.ok) throw new Error(result.error)
      const refused = refusal(result.output)
      if (refused) throw new Error(refused)
      ticketsChanged(projectId)
      onSaved(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault()
        if (ready) void save()
      }}
    >
      {issueLabel && (
        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          This ticket follows issue {issueLabel}: when the issue changes, Update tickets writes its title and text again from it. Priority and topics stay as you set them.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="ticket-title">Title</Label>
        <Input id="ticket-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="What should be done, in a few words" autoFocus />
      </div>
      <div className="flex gap-3 max-sm:flex-col">
        <div className="space-y-1.5 sm:w-32">
          <Label htmlFor="ticket-priority">Priority</Label>
          <Input id="ticket-priority" value={priority} onChange={event => setPriority(event.target.value)} inputMode="numeric" placeholder="0–10" aria-invalid={!priorityOk} />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="ticket-topics">Topics</Label>
          <Input id="ticket-topics" value={topics} onChange={event => setTopics(event.target.value)} placeholder="ui, install" />
        </div>
      </div>
      {!priorityOk && <p className="text-xs text-danger">Priority is a whole number from 0 to 10, or empty for none.</p>}
      <div className="space-y-1.5">
        <Label htmlFor="ticket-body">Text</Label>
        <Textarea
          id="ticket-body"
          value={body}
          onChange={event => setBody(event.target.value)}
          rows={14}
          className="font-mono text-xs"
          placeholder={'## TLDR\n\nWhat is wrong or missing, and what done looks like.\n\n## Why it matters\n\n…'}
        />
        <p className="text-xs text-muted-foreground">Markdown. Agents read it as the ticket.</p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Not saved: {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready}>
          {saving ? 'Saving…' : file === undefined ? 'Create ticket' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
