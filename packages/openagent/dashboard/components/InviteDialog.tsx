import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleCheck, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'
import { Input } from './ui/input.js'
import { RadioGroup, RadioGroupOption } from './ui/radio-group.js'
import { QrCode } from './QrCode.js'

// Letting a phone, a browser or a person in, in one step: the dialog asks for a code as it opens
// and shows it as a QR code and as a link to send, with how long it still works. The page that
// opens it knows who is in, and tells the dialog the name of a device that got in with the code:
// the dialog then says so. Settings › Devices (this computer) and a server's row in Settings ›
// Machines both open it, each with its own way of asking for a code.
//
// Given `persons`, it first asks who the code is for: the person at the page ("Me"), or someone
// else, by their GitHub account. The first time it is someone else, it asks the person at the page
// to say they are the computer's owner, by the GitHub account this computer is logged in to.

/** A code a new device gets in with, as a door gives it: good once, until `expires`. */
export interface InviteCode {
  url: string
  /** The same link by the computer's number, when `url` goes by its name. */
  numberUrl?: string
  expires: string
}

export type InviteAnswer = { ok: true; value: InviteCode } | { ok: false; error: string }

/** How the dialog learns and names the computer's owner, for a code made for someone else. */
export interface InvitePersons {
  /** The owner's GitHub account, once named. */
  owner: string | undefined
  /** The GitHub account this computer is logged in to: who the owner would be. */
  whoAmI: () => Promise<{ ok: true; account: string } | { ok: false; error: string }>
  /** Name the owner, once. */
  nameOwner: (account: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

/** A GitHub account as a person types it: letters, digits and single dashes, with or without an `@`. */
const accountOf = (said: string): string | undefined => {
  const account = said.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(account) ? account : undefined
}

/** Minutes and seconds, as a clock shows them. */
const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function InviteDialog({
  title,
  ask,
  persons,
  scan,
  note,
  openHere = false,
  joined,
  onCode,
  onClose,
}: {
  title: string
  /** Asks for a new code, for `person` when it is for someone else: as the dialog opens (or once it knows who it is for), and on each "New code". */
  ask: (person?: string) => Promise<InviteAnswer>
  /** Given, the dialog first asks who the code is for. */
  persons?: InvitePersons
  /** What the person does with the code: "Scan it with the phone's camera…". */
  scan: string
  /** A line under the link, for what else the link is good for. */
  note?: ReactNode
  /** A link that may be opened in this browser: it lets this browser in, and spends the code. */
  openHere?: boolean
  /** The name of a device that got in with the code on the page. Forgotten by the page at each `onCode`. */
  joined?: string | undefined
  /** Told each time a code comes on the page, and with `undefined` as a new one is asked for and as the dialog closes. */
  onCode?: (code: InviteCode | undefined) => void
  onClose: () => void
}) {
  const [code, setCode] = useState<InviteCode | undefined>()
  // Who the code is for: asked first when the computer tells persons apart; `null` until it is said, "" for the person at the page.
  const [person, setPerson] = useState<string | null>(persons ? null : '')
  const [asking, setAsking] = useState(!persons)
  const [error, setError] = useState<string | undefined>()
  const [byNumber, setByNumber] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // The answer of the last ask only: one asked before it, answered later, is no code on the page.
  const asked = useRef(0)
  const told = useRef(onCode)
  told.current = onCode

  const show = (next: InviteCode | undefined): void => {
    setCode(next)
    told.current?.(next)
  }

  const askAgain = async (forWhom = person ?? ''): Promise<void> => {
    const mine = ++asked.current
    setAsking(true)
    setError(undefined)
    setByNumber(false)
    setCopied(false)
    show(undefined)
    const answer = await ask(forWhom || undefined).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (mine !== asked.current) return
    setAsking(false)
    setNow(Date.now())
    if (answer.ok) show(answer.value)
    else setError(answer.error)
  }

  useEffect(() => {
    if (!persons) void askAgain()
    return () => {
      asked.current++
      told.current?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The time left, every second while a code is on the page.
  useEffect(() => {
    if (!code || joined !== undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [code, joined])

  const left = code ? Date.parse(code.expires) - now : 0
  const expired = code !== undefined && left <= 0

  const link = code && byNumber && code.numberUrl ? code.numberUrl : code?.url
  const copy = (): void => {
    if (!link) return
    void navigator.clipboard?.writeText(link).then(() => setCopied(true))
  }

  if (persons && person === null) return <ForWhom title={title} persons={persons} onClose={onClose} onPicked={picked => (setPerson(picked), void askAgain(picked))} />

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <div className="space-y-4">
        {person ? <p className="text-sm font-medium">{`For @${person}. Send them the link.`}</p> : null}
        {joined !== undefined ? (
          <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
            <CircleCheck className="h-8 w-8 text-success" aria-hidden />
            <p className="text-sm font-medium">{`${joined} is in.`}</p>
            <p className="text-xs text-muted-foreground">It stays in until it is removed. The code is spent.</p>
          </div>
        ) : asking ? (
          <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            Asking for a code…
          </div>
        ) : error !== undefined || !code ? (
          <p role="alert" className="whitespace-pre-wrap py-4 text-xs text-danger">{`No code: ${error ?? 'none was given'}`}</p>
        ) : expired ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">
            The code ran out. A new one works for five minutes more.
          </p>
        ) : (
          <div className="flex items-start gap-4 max-sm:flex-col max-sm:items-center">
            <div className="shrink-0">
              <QrCode text={link!} label="The code a new device scans" />
            </div>
            <div className="w-full min-w-0 space-y-3">
              <p className="text-sm">{scan}</p>
              {code.numberUrl !== undefined && !byNumber && (
                <button type="button" className="text-xs underline" onClick={() => setByNumber(true)}>
                  Phone does not open it? Use the number.
                </button>
              )}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Or send the link to the person, or open it on the device:</p>
                <div className="flex gap-2">
                  <Input readOnly aria-label="The link" value={link} onFocus={event => event.currentTarget.select()} className="h-8 min-w-0 flex-1 bg-background px-2 font-mono text-xs" />
                  <Button size="sm" variant="outline" className="shrink-0" onClick={copy}>
                    {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {note !== undefined && <p className="text-xs text-muted-foreground">{note}</p>}
              </div>
              <p role="timer" className="text-xs text-muted-foreground">{`Works once, for ${clock(left)} more.`}</p>
              {openHere && (
                // The code is spent by the tab it opens: it leaves the page with the press.
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" onClick={onClose}>
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Let this browser in instead
                </a>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {!asking && (joined !== undefined || expired || error !== undefined || !code) && (
            <Button size="sm" variant="outline" onClick={() => void askAgain()}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {joined !== undefined ? 'Add another' : 'New code'}
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The dialog's first step on a computer that tells persons apart: who the code is for. The first
 * time it is someone else, the person at the page says they are the owner, by this computer's
 * GitHub account, before anyone else is let in.
 */
function ForWhom({ title, persons, onPicked, onClose }: { title: string; persons: InvitePersons; onPicked: (person: string) => void; onClose: () => void }) {
  const [whom, setWhom] = useState<'me' | 'other'>('me')
  const [typed, setTyped] = useState('')
  // The owner being named: this computer's account as GitHub says it, or why it cannot be said.
  const [naming, setNaming] = useState<{ account?: string; error?: string; busy: boolean } | undefined>()
  const account = accountOf(typed)

  const go = async (): Promise<void> => {
    if (whom === 'me') return onPicked('')
    if (account === undefined) return
    if (persons.owner !== undefined) return onPicked(account === persons.owner ? '' : account)
    setNaming({ busy: true })
    const me = await persons.whoAmI().catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    setNaming(me.ok ? { account: me.account, busy: false } : { error: me.error, busy: false })
  }

  const confirm = async (owner: string): Promise<void> => {
    setNaming({ account: owner, busy: true })
    const named = await persons.nameOwner(owner).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (!named.ok) return setNaming({ account: owner, error: named.error, busy: false })
    // The owner's own account is the owner's device, as "Me" is.
    onPicked(account === undefined || account === owner ? '' : account)
  }

  if (naming !== undefined) {
    return (
      <Dialog open onOpenChange={open => !open && onClose()} title={title}>
        <div className="space-y-4">
          {naming.account !== undefined ? (
            <div className="space-y-2">
              <p className="text-sm">{`First, who are you? This computer is logged in to GitHub as @${naming.account}.`}</p>
              <p className="text-xs text-muted-foreground">That account becomes this computer's owner, the one who invites. The devices already in are yours.</p>
            </div>
          ) : naming.busy ? (
            <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
              Asking GitHub who you are…
            </div>
          ) : null}
          {naming.error !== undefined && <p role="alert" className="whitespace-pre-wrap text-xs text-danger">{naming.error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {naming.account !== undefined ? (
              <Button size="sm" disabled={naming.busy} onClick={() => void confirm(naming.account!)}>
                {"Yes, that's me"}
              </Button>
            ) : (
              !naming.busy && (
                <Button size="sm" onClick={() => void go()}>
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  Try again
                </Button>
              )
            )}
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          void go()
        }}
      >
        <p id="invite-for-whom" className="text-sm">
          Who is it for?
        </p>
        <RadioGroup aria-labelledby="invite-for-whom" value={whom} onValueChange={next => setWhom(next === 'other' ? 'other' : 'me')} className="gap-3">
          <RadioGroupOption value="me" className="flex-nowrap items-start [&>[data-slot=radio-group-item]]:mt-0.5">
            <span>
              Me
              <span className="block text-xs text-muted-foreground">My phone or my browser.</span>
            </span>
          </RadioGroupOption>
          <RadioGroupOption value="other" className="flex-nowrap items-start [&>[data-slot=radio-group-item]]:mt-0.5">
            <span>
              Someone else
              <span className="block text-xs text-muted-foreground">By their GitHub account. For now they can do everything this page can: start runs here, with this computer's logins.</span>
            </span>
          </RadioGroupOption>
        </RadioGroup>
        {whom === 'other' && (
          <div className="space-y-1">
            <Input autoFocus aria-label="Their GitHub account" placeholder="their-github-account" value={typed} onChange={event => setTyped(event.target.value)} className="h-8 bg-background px-2 text-sm" />
            {typed.trim() !== '' && account === undefined && <p className="text-xs text-danger">That is not a GitHub account.</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={whom === 'other' && account === undefined}>
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
