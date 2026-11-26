import { useState } from 'react'
import { Button, Input, isUnreachable, SettingsRow, SettingsRowShapes, SettingsSection, cn, computerRpcClient, useAction, useLoaded, useModuleHost, type ModuleHost } from '@openagt/ui/module'

/** The module's server part, in no project: the command is this computer's. */
const server = (host: ModuleHost) => computerRpcClient<typeof import('../src/server.js')>(host)

/** The command as read: the one saved, or why it could not be read. */
type Read = { command: string } | { error: string }

const ABOUT = (
  <>
    A command of yours this computer runs when a run needs you: when it ends waiting on a question, and when it opens a pull request. It runs in the project's folder, with <code>$MESSAGE</code>, one
    line for you, and <code>$RUN_ID</code>, <code>$STATUS</code>, <code>$QUESTION</code> and <code>$PR_URL</code>.
  </>
)

/**
 * Settings › Notification command: the shell line this computer runs when a run needs the person,
 * typed and saved here, one line, empty for none. What it does is the person's: it may post to a
 * channel (`npx @openagt/discord@0.1 send "$MESSAGE"`), or anything else.
 */
export function CommandSettings() {
  const host = useModuleHost()
  const read = useLoaded<Read | undefined>(
    () =>
      server(host)
        .command({})
        .then(
          (command): Read => ({ command }),
          (err: unknown): Read => {
            if (isUnreachable(err)) throw err
            return { error: err instanceof Error ? err.message : String(err) }
          },
        ),
    undefined,
    [host],
  )
  // What the person typed; until they type, what is saved.
  const [typed, setTyped] = useState<string | undefined>()
  // What this page saved, in place of what was read before it.
  const [kept, setKept] = useState<string | undefined>()
  const saving = useAction()
  const [saved, setSaved] = useState(false)
  if (read === undefined)
    return (
      <SettingsSection description={ABOUT}>
        <SettingsRowShapes rows={1} />
      </SettingsSection>
    )
  if ('error' in read)
    return (
      <SettingsSection description={ABOUT}>
        <p role="alert" className="text-sm text-danger">
          The command could not be read: {read.error}
        </p>
      </SettingsSection>
    )
  const savedCommand = kept ?? read.command
  const command = typed ?? savedCommand
  const changed = command.trim() !== savedCommand
  const save = () =>
    void saving.run(() => server(host).saveCommand({ command }), 'Could not save the command.').then(outcome => {
      if (!outcome.ok) return
      setKept(command.trim())
      setTyped(undefined)
      setSaved(true)
    })

  return (
    <SettingsSection description={ABOUT}>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (changed && !saving.busy) save()
        }}
      >
        <SettingsRow
          label="Command"
          labelFor="notifications-command"
          stacked
          description={savedCommand ? 'Run when a run on this computer needs you.' : 'None yet: nothing runs.'}
          control={
            <div className="flex items-center gap-2">
              <Input
                id="notifications-command"
                value={command}
                placeholder={'npx @openagt/discord@0.1 send "$MESSAGE"'}
                spellCheck={false}
                disabled={saving.busy}
                onChange={event => {
                  setTyped(event.target.value)
                  saving.reset()
                  setSaved(false)
                }}
                className="flex-1 font-mono text-xs"
              />
              {/* With nothing to save, it keeps the focus it was pressed with: a disabled press would drop it to the page. */}
              <Button type="submit" aria-disabled={!changed || undefined} loading={saving.busy} className={cn('min-w-16', !changed && 'opacity-50')}>
                {saving.busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          }
        />
        {saving.error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {saving.error}
          </p>
        )}
        {saved && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {savedCommand ? 'Saved.' : 'Saved: nothing runs now.'}
          </p>
        )}
      </form>
    </SettingsSection>
  )
}
