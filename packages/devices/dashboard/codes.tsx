import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleCheck, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button, Dialog, Input, QrCode, RadioGroup, RadioGroupOption } from '@openagt/dashboard/module'
import { Problem } from './parts.js'

// A code a new device gets in with, the ways it is shown: as a QR code a phone's camera opens, and
// as where and a code typed on another computer. It is asked for as its dialog opens, works once,
// and runs out: the dialog says for how long still, and waits for the device that uses it.

/** A code as a door gives it: the link a camera opens, and what is typed instead, where and the code. */
export interface Given {
  url: string
  /** The same link by the computer's number, when `url` goes by its name. */
  numberUrl?: string
  where?: string
  code?: string
  expires: string
}

export type GivenAnswer = { ok: true; value: Given } | { ok: false; error: string }

/** Minutes and seconds, as a clock shows them. */
export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const failed = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) })

/**
 * A code on the page: asked for once `asking` says so (at once, or when the dialog knows who it
 * is for), and again on `again`. Only the answer of the last ask is shown. `onCode` is told each
 * code that comes on the page, and `undefined` as a new one is asked for and as the page goes.
 */
export function useCode(ask: (person?: string) => Promise<GivenAnswer>, atOnce: boolean, onCode?: (code: Given | undefined) => void, stopped = false) {
  const [code, setCode] = useState<Given | undefined>()
  const [asking, setAsking] = useState(atOnce)
  const [error, setError] = useState<string | undefined>()
  const [now, setNow] = useState(() => Date.now())
  const asked = useRef(0)
  const told = useRef(onCode)
  told.current = onCode

  const show = (next: Given | undefined): void => {
    setCode(next)
    told.current?.(next)
  }
  const again = async (person?: string): Promise<void> => {
    const mine = ++asked.current
    setAsking(true)
    setError(undefined)
    show(undefined)
    const answer = await ask(person).catch(failed)
    if (mine !== asked.current) return
    setAsking(false)
    setNow(Date.now())
    if (answer.ok) show(answer.value)
    else setError(answer.error)
  }
  useEffect(() => {
    if (atOnce) void again()
    return () => {
      asked.current++
      told.current?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The time left, every second while a code is on the page and no device got in with it.
  useEffect(() => {
    if (!code || stopped) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [code, stopped])

  const left = code ? Date.parse(code.expires) - now : 0
  return { code, asking, error, left, expired: code !== undefined && left <= 0, again }
}

/** Copy `text`, and say so on the button for a moment. */
function CopyButton({ text, label, children }: { text: string; label: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button size="sm" variant="outline" aria-label={label} className="shrink-0" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
      {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : children}
    </Button>
  )
}

/** Where and the code as "Copy both" puts them: what "Join with a code" reads back from one paste. */
export const bothOf = (where: string, code: string): string => `Where: ${where}\nCode: ${code}`

/** Where and the code, to type on another computer. */
export function CodeCard({ where, code }: { where: string; code: string }) {
  return (
    <div role="group" aria-label="The code" className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Where</p>
          <p className="truncate font-mono text-lg">{where}</p>
        </div>
        <CopyButton text={where} label="Copy where">
          Copy
        </CopyButton>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Code</p>
          <p className="font-mono text-2xl font-semibold tracking-wider">{code}</p>
        </div>
        <CopyButton text={bothOf(where, code)} label="Copy both">
          Copy both
        </CopyButton>
      </div>
    </div>
  )
}

/** A line that waits: for the device that uses the code. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
      <span role="timer">{children}</span>
    </p>
  )
}

/** A device got in with the code: said in place of the code, which is spent. */
export function Joined({ children, words = 'It stays in until it is removed. The code is spent.' }: { children: ReactNode; words?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
      <CircleCheck className="h-8 w-8 text-success" aria-hidden />
      <p className="text-sm font-medium">{children}</p>
      <p className="text-xs text-muted-foreground">{words}</p>
    </div>
  )
}

/** While a code is asked for, or why there is none. */
export function NoCodeYet({ asking, error }: { asking: boolean; error: string | undefined }) {
  if (asking)
    return (
      <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        Asking for a code…
      </div>
    )
  return <Problem>{`No code: ${error ?? 'none was given'}`}</Problem>
}

/** The code ran out before a device used it. */
export function RanOut() {
  return (
    <p role="status" className="py-6 text-center text-sm text-muted-foreground">
      The code ran out. A new one works for ten minutes more.
    </p>
  )
}

/** How the dialog learns and names the computer's owner, for a code made for someone else. */
export interface Persons {
  /** The owner's name, once named. */
  owner: string | undefined
  /** The name of the person at this computer, as git knows it: what the owner's name starts as. */
  myName: () => Promise<string | undefined>
  /** Name the owner, once. */
  nameOwner: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

/** A person's name as it is typed: letters of any language, digits, spaces, dots, apostrophes and dashes, at most 40. */
export const nameOf = (said: string): string | undefined => {
  const name = said.trim().replace(/\s+/g, ' ')
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'’-]{0,39}$/u.test(name) ? name : undefined
}

/** Whether two names are one person's: their letters' case is not looked at. */
const samePerson = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** What is said under a name field that holds no name. */
const NOT_A_NAME = 'A name is letters and digits, with spaces, dots, apostrophes or dashes between, at most 40.'

/**
 * A phone gets in: the code as a QR code its camera opens, and the link to send it when it has no
 * camera, with how long the code still works, until the phone is in. On a computer that tells
 * persons apart (`persons`), who the phone is for is asked first.
 */
export function PhoneCode({
  title,
  ask,
  persons,
  steps = ["Open the phone's camera and point it at the code.", 'Tap the link it shows. OpenAgent opens, and stays in.'],
  camera = true,
  openHere = false,
  joined,
  onCode,
  onClose,
}: {
  title: string
  ask: (person?: string) => Promise<GivenAnswer>
  persons?: Persons
  /** What the person does with the code, step by step. */
  steps?: readonly string[]
  /** The code is for a phone's camera: the link is for one with no camera. */
  camera?: boolean
  /** The link may be opened in this browser: it lets this browser in, and spends the code. */
  openHere?: boolean
  /** The name of a device that got in with the code. Forgotten by the page at each `onCode`. */
  joined: string | undefined
  onCode?: (code: Given | undefined) => void
  onClose: () => void
}) {
  // Who the code is for: asked first when the computer tells persons apart; `null` until it is said, "" for the person at the page.
  const [person, setPerson] = useState<string | null>(persons ? null : '')
  const [byNumber, setByNumber] = useState(false)
  const { code, asking, error, left, expired, again } = useCode(ask, !persons, next => (setByNumber(false), onCode?.(next)), joined !== undefined)
  const link = code && byNumber && code.numberUrl ? code.numberUrl : code?.url
  const forWhom = person || undefined

  if (persons && person === null) return <ForWhom title={title} persons={persons} onClose={onClose} onPicked={picked => (setPerson(picked), void again(picked || undefined))} />

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <div className="space-y-4">
        {forWhom !== undefined && <p className="text-sm font-medium">{`For ${forWhom}. Send them the link.`}</p>}
        {joined !== undefined ? (
          <Joined>{`${joined} is in.`}</Joined>
        ) : asking || error !== undefined || !code ? (
          <NoCodeYet asking={asking} error={error} />
        ) : expired ? (
          <RanOut />
        ) : (
          <div className="flex items-start gap-5 max-sm:flex-col max-sm:items-center">
            <div className="shrink-0">
              <QrCode text={link!} label="The code a new device scans" />
            </div>
            <div className="w-full min-w-0 space-y-3">
              <ol className="space-y-3 text-sm">
                {steps.map((step, at) => (
                  <Step key={step} n={at + 1}>
                    {step}
                  </Step>
                ))}
              </ol>
              {code.numberUrl !== undefined && !byNumber && (
                <button type="button" className="text-xs underline" onClick={() => setByNumber(true)}>
                  Phone does not open it? Use the number.
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                {camera ? 'No camera? ' : ''}
                <CopyLink text={link!} />
                {camera ? ' and send it to the phone.' : ' to paste it there.'}
                {openHere && (
                  <>
                    {' '}
                    {/* The code is spent by the tab it opens: it leaves the page with the press. */}
                    <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline" onClick={onClose}>
                      Let this browser in instead
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </>
                )}
              </p>
              <Waiting>{`Waiting for the ${camera ? 'phone' : 'other computer'}… works once, for ${clock(left)}.`}</Waiting>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {!asking && (joined !== undefined || expired || error !== undefined || !code) && (
            <Button size="sm" variant="outline" onClick={() => void again(forWhom)}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              {joined !== undefined ? 'Add another' : 'New code'}
            </Button>
          )}
          <Button size="sm" variant={joined !== undefined ? 'default' : 'ghost'} onClick={onClose}>
            {joined !== undefined ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/** One numbered step. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-semibold text-primary-foreground">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}

/** "Copy the link", as words in a sentence: copied, it says so. */
function CopyLink({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="underline" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
      {copied ? 'Copied the link' : 'Copy the link'}
    </button>
  )
}

/**
 * The owner is named the first time a code is made for someone else: until then nobody but the
 * owner is in. The name starts as the one git knows for the person at this computer.
 */
export function useNaming(persons: Persons) {
  // The owner being named: the name typed so far, and why the last try did not go.
  const [naming, setNaming] = useState<{ typed: string; error?: string; busy: boolean } | undefined>()
  const ask = async (): Promise<void> => {
    setNaming({ typed: '', busy: true })
    const known = await persons.myName().catch(() => undefined)
    setNaming(was => ({ typed: was?.typed || known || '', busy: false }))
  }
  const type = (typed: string): void => setNaming(was => was && { ...was, typed })
  const confirm = async (owner: string): Promise<boolean> => {
    setNaming({ typed: owner, busy: true })
    const named = await persons.nameOwner(owner).catch(failed)
    if (!named.ok) {
      setNaming({ typed: owner, error: named.error, busy: false })
      return false
    }
    setNaming(undefined)
    return true
  }
  return { naming, ask, type, confirm }
}

/** The first time someone else is let in: the person at the page names themselves, the owner. */
export function WhoAreYou({ title, naming, onType, onConfirm, onClose }: { title: string; naming: { typed: string; error?: string; busy: boolean }; onType: (typed: string) => void; onConfirm: (owner: string) => void; onClose: () => void }) {
  const name = nameOf(naming.typed)
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          if (name !== undefined) onConfirm(name)
        }}
      >
        <div className="space-y-1">
          <label htmlFor="owner-name" className="text-sm">
            First, your name?
          </label>
          <Input id="owner-name" autoFocus disabled={naming.busy} value={naming.typed} onChange={event => onType(event.target.value)} className="h-8 bg-background px-2 text-sm" />
          <p className="text-xs text-muted-foreground">You are the owner, the one who invites. The devices already in are yours.</p>
          {naming.typed.trim() !== '' && name === undefined && <p className="text-xs text-danger">{NOT_A_NAME}</p>}
        </div>
        {naming.error !== undefined && <Problem>{naming.error}</Problem>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={naming.busy || name === undefined}>
            {naming.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Who a phone's code is for, on a computer that tells persons apart: the person at the page, or someone else by their name. */
function ForWhom({ title, persons, onPicked, onClose }: { title: string; persons: Persons; onPicked: (person: string) => void; onClose: () => void }) {
  const [whom, setWhom] = useState<'me' | 'other'>('me')
  const [typed, setTyped] = useState('')
  const { naming, ask, type, confirm } = useNaming(persons)
  const name = nameOf(typed)

  const go = (): void => {
    if (whom === 'me') return onPicked('')
    if (name === undefined) return
    if (persons.owner !== undefined) return onPicked(samePerson(name, persons.owner) ? '' : name)
    void ask()
  }

  if (naming !== undefined)
    return (
      <WhoAreYou
        title={title}
        naming={naming}
        onType={type}
        // The owner's own name is the owner's device, as "Me" is.
        onConfirm={owner => void confirm(owner).then(named => named && onPicked(name === undefined || samePerson(name, owner) ? '' : name))}
        onClose={onClose}
      />
    )

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          go()
        }}
      >
        <p id="code-for-whom" className="text-sm">
          Who is it for?
        </p>
        <RadioGroup aria-labelledby="code-for-whom" value={whom} onValueChange={next => setWhom(next === 'other' ? 'other' : 'me')} className="gap-3">
          <RadioGroupOption value="me" className="flex-nowrap items-start [&>[data-slot=radio-group-item]]:mt-0.5">
            <span>
              Me
              <span className="block text-xs text-muted-foreground">My phone or my browser.</span>
            </span>
          </RadioGroupOption>
          <RadioGroupOption value="other" className="flex-nowrap items-start [&>[data-slot=radio-group-item]]:mt-0.5">
            <span>
              Someone else
              <span className="block text-xs text-muted-foreground">By their name. On a server they get a user of their own, and their runs use their own logins. On any other computer they use this computer's.</span>
            </span>
          </RadioGroupOption>
        </RadioGroup>
        {whom === 'other' && (
          <div className="space-y-1">
            <Input autoFocus aria-label="Their name" placeholder="Their name" value={typed} onChange={event => setTyped(event.target.value)} className="h-8 bg-background px-2 text-sm" />
            {typed.trim() !== '' && name === undefined && <p className="text-xs text-danger">{NOT_A_NAME}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={whom === 'other' && name === undefined}>
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * Someone else is let in at a server, by their name: they type where and the code on
 * their computer, or scan it as a QR code with their phone. The first time, the person at the
 * page says they are the owner.
 */
export function Invite({
  label,
  ask,
  persons,
  joined,
  onCode,
  onClose,
}: {
  /** The server's name. */
  label: string
  ask: (person: string) => Promise<GivenAnswer>
  persons: Persons
  /** The name of a device that got in with the code. */
  joined: string | undefined
  onCode?: (code: Given | undefined) => void
  onClose: () => void
}) {
  const title = `Invite to ${label}`
  const [typed, setTyped] = useState('')
  const [person, setPerson] = useState<string | undefined>()
  const [qr, setQr] = useState(false)
  const { naming, ask: askOwner, type, confirm } = useNaming(persons)
  const { code, asking, error, left, expired, again } = useCode(said => ask(said!), false, next => (setQr(false), onCode?.(next)), joined !== undefined)
  const name = nameOf(typed)
  // The owner's own name is no one to invite: their own phone is added with Add device.
  const own = name !== undefined && persons.owner !== undefined && samePerson(name, persons.owner)

  const make = (owner = persons.owner): void => {
    if (name === undefined || (owner !== undefined && samePerson(name, owner))) return
    if (owner === undefined) return void askOwner()
    setPerson(name)
    void again(name)
  }

  if (naming !== undefined) return <WhoAreYou title={title} naming={naming} onType={type} onConfirm={owner => void confirm(owner).then(named => named && make(owner))} onClose={onClose} />

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <div className="space-y-4">
        <form
          className="space-y-1"
          onSubmit={event => {
            event.preventDefault()
            make()
          }}
        >
          <label htmlFor="invite-name" className="text-xs text-muted-foreground">
            Their name
          </label>
          <div className="flex gap-2">
            <Input id="invite-name" autoFocus placeholder="Their name" value={typed} onChange={event => setTyped(event.target.value)} className="h-8 min-w-0 flex-1 bg-background px-2 text-sm" />
            {(person === undefined || name !== person) && (
              <Button size="sm" type="submit" disabled={name === undefined || own || asking}>
                Make the code
              </Button>
            )}
          </div>
          {typed.trim() !== '' && name === undefined && <p className="text-xs text-danger">{NOT_A_NAME}</p>}
          {own && <p className="text-xs text-muted-foreground">That is you: add your own phone or computer with Add device.</p>}
        </form>
        {person === undefined ? null : joined !== undefined ? (
          <Joined>{`${joined} is in, for ${person}.`}</Joined>
        ) : asking || error !== undefined || !code?.where || !code.code ? (
          <NoCodeYet asking={asking} error={error ?? (code ? 'the server gives no code to type yet: update it first' : undefined)} />
        ) : expired ? (
          <RanOut />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{`${person} gets a user of their own on ${label}: their own runs, with their own logins. Send them this:`}</p>
            {qr ? (
              <div className="flex justify-center">
                <QrCode text={code.url} label="The code a new device scans" />
              </div>
            ) : (
              <CodeCard where={code.where} code={code.code} />
            )}
            <p className="text-xs text-muted-foreground">
              {qr ? (
                <>
                  {'On their phone: open the camera and point it at the code. On their computer: '}
                  <button type="button" className="underline" onClick={() => setQr(false)}>
                    show where and the code
                  </button>
                  {' instead.'}
                </>
              ) : (
                <>
                  On their computer: <span className="font-medium">Settings › Devices › Add device › I have a code</span>. On their phone:{' '}
                  <button type="button" className="underline" onClick={() => setQr(true)}>
                    show a QR code
                  </button>{' '}
                  instead.
                </>
              )}
            </p>
            <p role="timer" className="text-xs text-muted-foreground">{`Works once, for ${clock(left)} more.`}</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          {person !== undefined && !asking && (joined !== undefined || expired || error !== undefined) && (
            <Button size="sm" variant="outline" onClick={() => void again(person)}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              New code
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
