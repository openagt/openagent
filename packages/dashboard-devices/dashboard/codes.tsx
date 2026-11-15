import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleCheck, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button, Dialog, Input, QrCode, SettingsFoot, Skeleton, Slot, useOpenAgentDown } from '@openagt/dashboard/module'
import { failed, type Answer, type Given } from './devices.js'
import { CodeStrip, LinkPress, Problem } from './parts.js'

// A code a new device gets in with, the ways it is shown: as a QR code a phone's camera opens, and
// as where and a code typed on another computer. It is asked for as it is shown, works once, and
// runs out: what shows it says for how long still, and waits for the device that uses it.

/** Minutes and seconds, as a clock shows them. */
export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * A code on the page: asked for once `asking` says so (at once, or when the dialog knows who it
 * is for), and again on `again`. Only the answer of the last ask is shown. `onCode` is told each
 * code that comes on the page, and `undefined` as a new one is asked for and as the page goes.
 */
export function useCode(ask: (person?: string) => Promise<Answer<Given>>, atOnce: boolean, onCode?: (code: Given | undefined) => void, stopped = false) {
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
export function CopyButton({ text, label, children }: { text: string; label: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button type="button" variant="ghost" size="sm" aria-label={label} onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : children}
    </Button>
  )
}

/** Where and the code as "Copy both" puts them: what "Join with a code" reads back from one paste. */
export const bothOf = (where: string, code: string): string => `Where: ${where}\nCode: ${code}`

/** Where and the code, to type on another computer. */
export function CodeCard({ where, code }: { where: string; code: string }) {
  return (
    <div role="group" aria-label="The code" className="space-y-3">
      <CodeStrip
        label="Where"
        text={where}
        copy={
          <CopyButton text={where} label="Copy where">
            Copy
          </CopyButton>
        }
      />
      <CodeStrip
        label="Code"
        text={code}
        big
        copy={
          <CopyButton text={bothOf(where, code)} label="Copy both">
            Copy both
          </CopyButton>
        }
      />
    </div>
  )
}

/** A line that waits: for the device that uses the code. */
export function Waiting({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
      <span role="timer">{children}</span>
    </p>
  )
}

/** A device got in with the code: said in place of the code, which is spent. */
export function Joined({ children, words = 'It stays in until it is removed. The code is spent.' }: { children: ReactNode; words?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
      <CircleCheck className="size-8 text-success" aria-hidden />
      <p className="text-sm font-medium">{children}</p>
      <p className="text-xs text-muted-foreground">{words}</p>
    </div>
  )
}

/** Where and the code while they are asked for: {@link CodeCard}'s shape. */
export const CODE_SHAPE = (
  <div className="space-y-3">
    {[0, 1].map(at => (
      <div key={at} className="space-y-1">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-9 w-full" />
      </div>
    ))}
  </div>
)

/** A phone's code while it is asked for: the QR code's square and the steps beside it. */
const QR_SHAPE = (
  <div className="flex gap-6 max-sm:flex-col max-sm:items-center">
    <Skeleton className="size-64 shrink-0 rounded-lg" />
    <div className="w-full space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  </div>
)

/** While a code is asked for, in the shape of what it brings; or why there is none. */
export function NoCodeYet({ asking, error, shape = CODE_SHAPE }: { asking: boolean; error: string | undefined; shape?: ReactNode }) {
  if (asking)
    return (
      <Slot of={{ state: 'unknown', value: undefined }} shape={shape}>
        {() => null}
      </Slot>
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
 * camera, with how long the code still works, until the phone is in. The phone is the person's
 * own: someone else's device is added with Add person.
 */
export function PhoneCode({
  ask,
  steps = ["Open the phone's camera and point it at the code.", 'Tap the link it shows. OpenAgent opens, and stays in.'],
  camera = true,
  openHere = false,
  hint,
  joined,
  onCode,
  onClose,
}: {
  ask: () => Promise<Answer<Given>>
  /** What the person does with the code, step by step. */
  steps?: readonly string[]
  /** A word under the steps about where the code opens, when it needs one. */
  hint?: string
  /** The code is for a phone's camera: the link is for one with no camera. */
  camera?: boolean
  /** The link may be opened in this browser: it lets this browser in, and spends the code. */
  openHere?: boolean
  /** The name of a device that got in with the code. Forgotten by the page at each `onCode`. */
  joined: string | undefined
  onCode?: (code: Given | undefined) => void
  onClose: () => void
}) {
  const down = useOpenAgentDown()
  const [byNumber, setByNumber] = useState(false)
  const [byWifi, setByWifi] = useState(false)
  const { code, asking, error, left, expired, again } = useCode(() => ask(), true, next => (setByNumber(false), setByWifi(false), onCode?.(next)), joined !== undefined)
  const link = code && byWifi && code.wifiUrl ? code.wifiUrl : code && byNumber && code.numberUrl ? code.numberUrl : code?.url

  return (
    <div className="space-y-4">
      {joined !== undefined ? (
        <Joined>{`${joined} is in.`}</Joined>
      ) : asking || error !== undefined || !code ? (
        <NoCodeYet asking={asking} error={error} shape={QR_SHAPE} />
      ) : expired ? (
        <RanOut />
      ) : (
        <div className="flex gap-6 sm:items-start max-sm:flex-col max-sm:items-center">
          <QrOnWhite text={link!} />
          <div className="w-full min-w-0 space-y-3">
            <ol className="list-decimal space-y-2 pl-5 text-sm marker:text-muted-foreground">
              {steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
            {code.wifiUrl !== undefined && !byWifi && (
              <p className="text-xs">
                <LinkPress onClick={() => setByWifi(true)}>Not on Tailscale? Use this Wi-Fi.</LinkPress>
              </p>
            )}
            {code.numberUrl !== undefined && !byNumber && (
              <p className="text-xs">
                <LinkPress onClick={() => setByNumber(true)}>Phone does not open it? Use the number.</LinkPress>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {camera ? 'No camera? ' : ''}
              <CopyLink text={link!} />
              {camera ? ' and send it to the phone.' : ' to paste it there.'}
              {openHere && (
                <>
                  {' '}
                  {/* The code is spent by the tab it opens: it leaves the page with the press. */}
                  <a href={link} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded-sm text-primary hover:underline" onClick={onClose}>
                    Let this browser in instead
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </>
              )}
            </p>
            <Waiting>{`Waiting for the ${camera ? 'phone' : 'other computer'}… works once, for ${clock(left)}.`}</Waiting>
          </div>
        </div>
      )}
      {/* Cancel before the other press; once joined, Done is the press the page ends on, last. */}
      <SettingsFoot>
        <div className="flex justify-end gap-2 max-md:[&_button]:h-11">
          {joined === undefined && (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          {!asking && (joined !== undefined || expired || error !== undefined || !code) && (
            <Button variant="secondary" disabled={down} onClick={() => void again()}>
              <RotateCw className="size-4" aria-hidden />
              {joined !== undefined ? 'Add another' : 'New code'}
            </Button>
          )}
          {joined !== undefined && <Button onClick={onClose}>Done</Button>}
        </div>
      </SettingsFoot>
    </div>
  )
}

/** The QR code on white with room around it, in either theme: a camera finds a code by its quiet edge. */
function QrOnWhite({ text }: { text: string }) {
  return (
    <div className="shrink-0 rounded-lg bg-white p-4">
      <QrCode text={text} label="The code a new device scans" />
    </div>
  )
}

/** "Copy the link", as words in a sentence: copied, it says so. */
function CopyLink({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <LinkPress onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? 'Copied the link' : 'Copy the link'}</LinkPress>
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
  const down = useOpenAgentDown()
  const name = nameOf(naming.typed)
  const field = useRef<HTMLInputElement>(null)
  // The field is disabled while the name is read and while it is tried; once either ends, it takes the focus.
  useEffect(() => {
    if (!naming.busy) field.current?.focus()
  }, [naming.busy])
  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title} initialFocus={field}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          if (name !== undefined) onConfirm(name)
        }}
      >
        <div className="space-y-1">
          <label htmlFor="owner-name" className="block text-sm font-medium">
            First, your name?
          </label>
          <Input id="owner-name" ref={field} disabled={naming.busy} value={naming.typed} onChange={event => onType(event.target.value)} />
          <p className="text-xs text-muted-foreground">You are the owner, the one who invites. The devices already in are yours.</p>
          {naming.typed.trim() !== '' && name === undefined && <p className="text-xs text-danger">{NOT_A_NAME}</p>}
        </div>
        {naming.error !== undefined && <Problem>{naming.error}</Problem>}
        <div className="flex justify-end gap-2 max-md:[&_button]:h-11">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={naming.busy} disabled={name === undefined || down}>
            Continue
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * Add person: someone else is let in at a server, or at a computer that gives each person a user
 * of their own, by their name. They add it to their own OpenAgent with where and the code, on
 * their computer; a phone with no computer behind it scans it as a QR code and opens OpenAgent
 * there. The first time, the person at the page says they are the owner.
 */
export function Invite({
  label,
  ask,
  persons,
  joined,
  onCode,
  onClose,
  tailscale = false,
}: {
  /** The server's name. */
  label: string
  /** The server is on the person's Tailscale network: the one invited reaches it only once it is shared with them there. */
  tailscale?: boolean
  ask: (person: string) => Promise<Answer<Given>>
  persons: Persons
  /** The name of a device that got in with the code. */
  joined: string | undefined
  onCode?: (code: Given | undefined) => void
  onClose: () => void
}) {
  const down = useOpenAgentDown()
  const title = `Add person to ${label}`
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)
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
    <Dialog open onOpenChange={open => !open && onClose()} title={title} initialFocus={field}>
      <div className="space-y-4">
        <form
          className="space-y-1"
          onSubmit={event => {
            event.preventDefault()
            make()
          }}
        >
          <label htmlFor="invite-name" className="block text-sm font-medium">
            Their name
          </label>
          <div className="flex gap-2">
            <Input id="invite-name" ref={field} placeholder="Their name" value={typed} onChange={event => setTyped(event.target.value)} className="min-w-0 flex-1" />
            {(person === undefined || name !== person) && (
              <Button type="submit" disabled={name === undefined || own || asking || down}>
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
            {tailscale && <p className="text-xs">{`${label} is on your Tailscale network: ${person} reaches it only once you share it with them in Tailscale (its machine in the Tailscale admin › Share), with Tailscale on their device.`}</p>}
            {qr ? (
              <div className="flex justify-center">
                <QrOnWhite text={code.url} />
              </div>
            ) : (
              <CodeCard where={code.where} code={code.code} />
            )}
            <p className="text-xs text-muted-foreground">
              {qr ? (
                <>
                  {`On their phone: open the camera and point it at the code; OpenAgent on ${label} opens, as them. On their computer: `}
                  <LinkPress onClick={() => setQr(false)}>show where and the code</LinkPress>
                  {' instead.'}
                </>
              ) : (
                <>
                  On their computer: <span className="font-medium">Settings › Devices › Add device › I have a code</span>. {label} is then in their own OpenAgent, as yours, shared with them. On a phone with no computer:{' '}
                  <LinkPress onClick={() => setQr(true)}>show a QR code</LinkPress>{' '}
                  instead.
                </>
              )}
            </p>
            <p role="timer" className="text-xs text-muted-foreground">{`Works once, for ${clock(left)} more.`}</p>
          </>
        )}
        <div className="flex justify-end gap-2 max-md:[&_button]:h-11">
          {person !== undefined && !asking && (joined !== undefined || expired || error !== undefined) && (
            <Button variant="secondary" disabled={down} onClick={() => void again(person)}>
              <RotateCw className="size-4" aria-hidden />
              New code
            </Button>
          )}
          {/* Until the code is made, Make the code is the press the dialog is for. */}
          <Button variant={person === undefined || name !== person ? 'secondary' : 'default'} onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
