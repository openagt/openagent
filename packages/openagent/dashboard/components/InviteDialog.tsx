import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleCheck, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button } from './ui/button.js'
import { Dialog } from './ui/dialog.js'
import { Input } from './ui/input.js'
import { QrCode } from './QrCode.js'

// Letting a phone, a browser or a person in, in one step: the dialog asks for a code as it opens
// and shows it as a QR code and as a link to send, with how long it still works. The page that
// opens it knows who is in, and tells the dialog the name of a device that got in with the code:
// the dialog then says so. Settings › Devices (this computer) and a server's row in Settings ›
// Machines both open it, each with its own way of asking for a code.

/** A code a new device gets in with, as a door gives it: good once, until `expires`. */
export interface InviteCode {
  url: string
  /** The same link by the computer's number, when `url` goes by its name. */
  numberUrl?: string
  expires: string
}

export type InviteAnswer = { ok: true; value: InviteCode } | { ok: false; error: string }

/** Minutes and seconds, as a clock shows them. */
const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function InviteDialog({
  title,
  ask,
  scan,
  note,
  openHere = false,
  joined,
  onCode,
  onClose,
}: {
  title: string
  /** Asks for a new code: as the dialog opens, and on each "New code". */
  ask: () => Promise<InviteAnswer>
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
  const [asking, setAsking] = useState(true)
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

  const askAgain = async (): Promise<void> => {
    const mine = ++asked.current
    setAsking(true)
    setError(undefined)
    setByNumber(false)
    setCopied(false)
    show(undefined)
    const answer = await ask().catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (mine !== asked.current) return
    setAsking(false)
    setNow(Date.now())
    if (answer.ok) show(answer.value)
    else setError(answer.error)
  }

  useEffect(() => {
    void askAgain()
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

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={title}>
      <div className="space-y-4">
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
