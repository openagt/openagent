import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, Check, Loader2 } from 'lucide-react'
import { Button, CopyButton, DIALOG_PRESSES_CLASS, Dialog, FixAction, Linked, NO_PROJECT, cn, useModuleHost, type FixVariant } from '@openagt/ui/module'
import { missingWords, server, useAccounts, type AccountsRead } from './calls.js'

// Adding an account of OpenAgent's on GitHub, the same dialog wherever one is added (his pick
// over a code shown in each place's own layout): the Permissions page, the Overview's first steps,
// the account in the gear's menu under the message box. It installs gh where it is missing, asks
// gh for a code, shows it while the person signs in on GitHub, and closes on the account once it
// is there. Closing it gives the login up.

/** How often the dialog asks the host's package how the login stands, while it is open. */
const FOLLOW_MS = 2_000
/** How long "@login is added" stands before the dialog closes on it. */
const DONE_MS = 900

/** The dialog that adds an account, while `open`. `onClose` says the login it added, if it did. */
export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: (added?: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()} title={open ? 'Add a GitHub account' : ''}>
      {open && <Adding onClose={onClose} />}
    </Dialog>
  )
}

/** The dialog's body, alive only while it is open: what it was asked and saw goes with it. */
function Adding({ onClose }: { onClose: (added?: string) => void }) {
  const host = useModuleHost()
  const { accounts: p, reload } = useAccounts()
  // The logins the host took when the dialog opened: one more is the account it added.
  const before = useRef<Set<string> | undefined>(undefined)
  if (p && before.current === undefined) before.current = new Set(p.accounts.filter(account => account.ok).map(account => account.login))
  const [asking, setAsking] = useState(false)
  // The code as the press was answered, shown until the host's own answer says it too.
  const [asked, setAsked] = useState<{ code: string; url: string } | undefined>()
  const [seen, setSeen] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [installError, setInstallError] = useState<string | undefined>()
  const added = p?.accounts.find(account => account.ok && before.current?.has(account.login) === false)?.login
  const underWay = p?.loggingIn ?? (seen ? undefined : asked)
  // A login that was under way and is not any more, with no account more: given up at the host, or its code ran out.
  const ended = seen && !p?.loggingIn && added === undefined && !asking

  const start = async () => {
    setAsking(true)
    setError(undefined)
    setSeen(false)
    setAsked(undefined)
    try {
      const done = await server(host).login(NO_PROJECT, {})
      if (done.ok) setAsked({ code: done.code, url: done.url })
      else setError(done.error)
      await reload()
    } finally {
      setAsking(false)
    }
  }

  useEffect(() => {
    if (p?.loggingIn) setSeen(true)
  }, [p?.loggingIn])

  // The code shown: the link to open takes the focus the dialog opened with, on its ✕, but none the person put on a press here.
  const body = useRef<HTMLDivElement>(null)
  const openLink = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (openLink.current && !body.current?.contains(document.activeElement)) openLink.current.focus()
  }, [underWay?.code])

  // Followed closely while open, whatever the page's own pace is: the person may sign in at any moment.
  const follow = useRef(reload)
  follow.current = reload
  useEffect(() => {
    if (added !== undefined) return
    const timer = setInterval(() => void follow.current(), FOLLOW_MS)
    return () => clearInterval(timer)
  }, [added])

  // Open on a host whose tool is here: the code is asked for at once, with no press more.
  const ready = p?.installed === true
  const started = useRef(false)
  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    if (!p?.loggingIn) void start()
    // Once, when the tool is here: a login already under way is shown as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // The dialog goes away with a login under way: it is given up, as Cancel does.
  const pending = useRef(false)
  pending.current = (asking || underWay !== undefined) && added === undefined
  useEffect(
    () => () => {
      if (pending.current) void server(host).stopLogin(NO_PROJECT, {}).catch(() => undefined)
    },
    [host],
  )

  useEffect(() => {
    if (added === undefined) return
    const timer = setTimeout(() => onClose(added), DONE_MS)
    return () => clearTimeout(timer)
    // The account it added, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added])

  if (!p) return <Waiting words="Reading…" />
  if (added !== undefined)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Check className="size-4 shrink-0 text-success" aria-hidden />
        {`@${added} is added.`}
      </p>
    )
  if (!p.installed)
    return (
      <div className="space-y-3">
        <Install accounts={p} error={installError} onError={setInstallError} onChanged={reload} />
        <div className={cn('flex justify-end', DIALOG_PRESSES_CLASS)}>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </div>
    )
  return (
    <div ref={body} className="space-y-3">
      {underWay ? (
        <>
          <div role="status" className="space-y-3">
            <p className="text-sm">
              {'Open '}
              <a ref={openLink} href={underWay.url} target="_blank" rel="noreferrer" className="focus-ring rounded-sm font-medium text-primary underline-offset-2 hover:underline">
                {underWay.url.replace(/^https:\/\//, '')}
              </a>
              {' and enter this code:'}
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-xl font-medium tracking-widest">{underWay.code}</code>
              <CopyButton text={underWay.code} label="Copy the code" />
            </div>
          </div>
          <Waiting words={`Waiting for you at ${p.name}…`} />
        </>
      ) : ended ? (
        <p className="text-sm text-muted-foreground">{`No account was added: the login was given up at ${p.name}, its code ran out, or OpenAgent has that account already.`}</p>
      ) : error === undefined ? (
        <Waiting words="Asking for a code…" />
      ) : null}
      {error !== undefined && (
        <p role="alert" className="flex items-start gap-2 whitespace-pre-line text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            {`Could not get a code from ${p.name}:\n`}
            <Linked text={error} />
          </span>
        </p>
      )}
      {/* Said while there is a place to sign in at. */}
      {underWay && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Sign in there as the account OpenAgent should use. Your own logins stay as they are.</p>
          {/* Rom's advice, where the account is chosen: an agent's own account limits what a run can reach. */}
          <p>An account of its own for your agents, with access to only what they need, is safer: name it like you-agent.</p>
        </div>
      )}
      {/* The presses at the right, the primary last, as every dialog has them. */}
      <div className={cn('flex items-center justify-end gap-2', DIALOG_PRESSES_CLASS)}>
        <Button variant="ghost" onClick={() => onClose()}>
          Cancel
        </Button>
        {(ended || error !== undefined) && (
          <Button disabled={asking} onClick={() => void start()}>
            {ended ? 'Get a new code' : 'Try again'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Waiting({ words }: { words: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      {words}
    </p>
  )
}

/** gh is not on this computer: the press that installs it, with its command; the code follows by itself. */
function Install({ accounts: p, error, onError, onChanged }: { accounts: AccountsRead; error: string | undefined; onError: (error: string | undefined) => void; onChanged: () => Promise<void> }) {
  const host = useModuleHost()
  const install = async () => {
    onError(undefined)
    const done = await server(host).install(NO_PROJECT, {})
    if (!done.ok) onError(done.error)
    await onChanged()
  }
  const failed = error ?? p.installFailed
  return (
    <div className="space-y-2">
      <p className="text-sm">{missingWords(p)}</p>
      {p.install ? (
        <FixAction label={`Install ${p.tool}`} busy={p.installing === true} busyWords={`Installing ${p.tool}…`} command={p.install} {...(failed !== undefined ? { failed } : {})} onPress={() => void install()} />
      ) : (
        <p className="text-xs text-muted-foreground">{`Install ${p.tool} by hand: ${p.name} makes none for this computer.`}</p>
      )}
    </div>
  )
}

/**
 * Adding an account from a place of its own: `add()` opens the dialog, which the place draws as
 * `dialog`; `onAdded` hears the login once it is there.
 */
export function useAddAccount(onAdded?: (login: string) => void | Promise<void>): { add: () => void; dialog: ReactNode } {
  const [open, setOpen] = useState(false)
  const close = (added?: string) => {
    setOpen(false)
    if (added !== undefined) void onAdded?.(added)
  }
  return { add: () => setOpen(true), dialog: <AddAccountDialog open={open} onClose={close} /> }
}

/** The press for no account, or no gh: it opens the dialog that adds one. Nothing once there is one. */
export function AccountFix({ accounts: p, onChanged, size = 'default', variant, label }: { accounts: AccountsRead; onChanged: () => Promise<void>; size?: 'default' | 'sm' | undefined; variant?: FixVariant; /** What the press says, where GitHub's name stands beside it already. */ label?: string }) {
  const adding = useAddAccount(onChanged)
  if (!p.installed && !p.install) return <p className="text-xs text-muted-foreground">{`Install ${p.tool} by hand: ${p.name} makes none for this computer.`}</p>
  if (p.installed && p.accounts.length > 0 && !p.loggingIn) return adding.dialog
  return (
    <>
      {/* On a phone a finger's 44, as every fix's press. */}
      <Button size={size} variant={variant} aria-label={`Add a ${p.name} account`} onClick={adding.add} className={cn(size === 'default' && 'max-md:h-11')}>
        {label ?? `Add a ${p.name} account`}
      </Button>
      {adding.dialog}
    </>
  )
}
