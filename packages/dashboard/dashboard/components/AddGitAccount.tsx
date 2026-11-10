import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { sendGitHostInstall, sendGitHostLogin, sendStopGitHostLogin, type GitHostRow } from '../rpc/logins.js'
import { Button } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'
import { Dialog } from './ui/dialog.js'
import { FixAction, hostWords, useGitHosts } from './Logins.js'

// Adding an account of OpenAgent's at a git host, the same dialog wherever one is added (his pick
// over a code shown in each place's own layout): the Permissions page, the Overview's first steps,
// an agent's accounts, the account under the message box, "Back up as". It installs the host's
// tool where it is missing, asks the host's package for a code, shows it while the person signs in
// at the host, and closes on the account once it is there. Closing it gives the login up.

/** How often the dialog asks the host's package how the login stands, while it is open. */
const FOLLOW_MS = 2_000
/** How long "@login is added" stands before the dialog closes on it. */
const DONE_MS = 900

/** The dialog that adds an account at `host`; closed while `host` is undefined. `onClose` says the login it added, if it did. */
export function AddGitAccountDialog({ host, onClose }: { host: string | undefined; onClose: (added?: string) => void }) {
  return (
    <Dialog open={host !== undefined} onOpenChange={open => !open && onClose()} title={host !== undefined ? <AddTitle host={host} /> : ''}>
      {host !== undefined && <Adding key={host} host={host} onClose={onClose} />}
    </Dialog>
  )
}

function AddTitle({ host }: { host: string }) {
  const { view } = useGitHosts()
  const name = view?.hosts.find(row => row.host === host)?.provider?.name ?? host
  return <>{`Add a ${name} account`}</>
}

/** The dialog's body, alive only while it is open: what it was asked and saw goes with it. */
function Adding({ host, onClose }: { host: string; onClose: (added?: string) => void }) {
  const { view, reload } = useGitHosts()
  const row = view?.hosts.find(one => one.host === host)
  const p = row?.provider
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
      const done = await sendGitHostLogin(host)
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
      if (pending.current) void sendStopGitHostLogin(host).catch(() => undefined)
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

  if (!view) return <Waiting words="Reading…" />
  if (!row || !p) return <p className="text-sm text-muted-foreground">{`No package answers for ${host} yet.`}</p>
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
        <Install row={row} error={installError} onError={setInstallError} onChanged={reload} />
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </div>
    )
  return (
    <div className="space-y-3">
      {underWay ? (
        <div role="status" className="space-y-3">
          <p className="text-sm">
            {'Open '}
            <a href={underWay.url} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-primary)] underline-offset-2 hover:underline">
              {underWay.url.replace(/^https:\/\//, '')}
            </a>
            {' and enter this code:'}
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg font-medium tracking-widest">{underWay.code}</code>
            <CopyButton text={underWay.code} label="Copy the code" />
          </div>
          <Waiting words={`Waiting for you at ${p.name}…`} />
        </div>
      ) : ended ? (
        <p className="text-sm text-muted-foreground">{`No account was added: the login was given up at ${p.name}, its code ran out, or OpenAgent has that account already.`}</p>
      ) : error === undefined ? (
        <Waiting words="Asking for a code…" />
      ) : null}
      {error !== undefined && (
        <p role="alert" className="whitespace-pre-line text-xs text-danger">
          {error}
        </p>
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Sign in there as the account OpenAgent should use. Your own logins stay as they are.</p>
        {/* Rom's advice, where the account is chosen: an agent's own account limits what a run can reach. */}
        <p>An account of its own for your agents, with access to only what they need, is safer: name it like you-agent.</p>
      </div>
      <div className="flex items-center justify-end gap-2">
        {(ended || error !== undefined) && (
          <Button size="sm" disabled={asking} onClick={() => void start()}>
            Get a new code
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onClose()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Waiting({ words }: { words: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      {words}
    </p>
  )
}

/** The host's tool is not on this computer: the press that installs it, with its command; the code follows by itself. */
function Install({ row, error, onError, onChanged }: { row: GitHostRow; error: string | undefined; onError: (error: string | undefined) => void; onChanged: () => Promise<void> }) {
  const p = row.provider!
  const install = async () => {
    onError(undefined)
    const done = await sendGitHostInstall(row.host)
    if (!done.ok) onError(done.error)
    await onChanged()
  }
  const failed = error ?? p.installFailed
  return (
    <div className="space-y-2">
      <p className="text-sm">{hostWords(row)}</p>
      {p.install ? (
        <FixAction label={`Install ${p.tool}`} busy={p.installing === true} busyWords={`Installing ${p.tool}…`} command={p.install} {...(failed !== undefined ? { failed } : {})} onPress={() => void install()} />
      ) : (
        <p className="text-xs text-muted-foreground">{`Install ${p.tool} by hand: ${p.name} makes none for this computer.`}</p>
      )}
    </div>
  )
}

/**
 * Adding an account from a place of its own: `add(host)` opens the dialog, which the place draws
 * as `dialog`; `onAdded` hears the login once it is there.
 */
export function useAddGitAccount(onAdded?: (login: string, host: string) => void | Promise<void>): { add: (host: string) => void; dialog: ReactNode } {
  const [host, setHost] = useState<string | undefined>()
  const close = (added?: string) => {
    const at = host
    setHost(undefined)
    if (added !== undefined && at !== undefined) void onAdded?.(added, at)
  }
  return { add: setHost, dialog: <AddGitAccountDialog host={host} onClose={close} /> }
}

/** The press for a host with no account, or no tool: it opens the dialog that adds one. Nothing for a host that has one. */
export function HostFix({ row, onChanged, size = 'sm' }: { row: GitHostRow; onChanged: () => Promise<void>; size?: 'sm' | 'xs' | undefined }) {
  const adding = useAddGitAccount(onChanged)
  const p = row.provider
  if (!p) return null
  if (!p.installed && !p.install) return <p className="text-xs text-muted-foreground">{`Install ${p.tool} by hand: ${p.name} makes none for this computer.`}</p>
  if (p.installed && p.accounts.length > 0 && !p.loggingIn) return adding.dialog
  return (
    <>
      <Button size={size} onClick={() => adding.add(row.host)}>
        {`Add a ${p.name} account`}
      </Button>
      {adding.dialog}
    </>
  )
}
