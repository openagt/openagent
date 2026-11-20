import { useEffect, useRef, useState } from 'react'
import { Laptop, Loader2 } from 'lucide-react'
import { Button, Checkbox, Dialog, useModuleHost, useOpenAgentDown } from '@openagt/ui/module'
import { Joined, Waiting } from './codes.js'
import { addDevice, answerAsk, askComputer, cancelAsk, hearAnswer, loadAsks, type AskHere, type AskedThere, type FoundComputer } from './devices.js'
import { Presses, PressRow, Problem } from './parts.js'
import type { Devices } from './use-devices.js'

// Pairing on this Wi-Fi, both ends. Here: Connect was pressed on a computer found on the Wi-Fi,
// and this computer waits for a person there to press Allow, both screens showing the same
// number; allowed, it is handed a code, and saves the computer with it, as a pasted link did. There:
// the popup over every page that shows the ask, with Allow and Deny.

/** Six digits as both screens show them: in two halves. */
export const shownNumber = (number: string): string => `${number.slice(0, 3)} ${number.slice(3)}`

/** The least time between two looks at the answer. */
const LOOK_REST_MS = 1_000

type Phase = { at: 'asking' } | { at: 'waiting'; asked: AskedThere } | { at: 'saving' } | { at: 'done'; words: string } | { at: 'denied' } | { at: 'gone' } | { at: 'failed'; error: string }

/**
 * Connect, pressed on `computer`: ask it, wait for its answer, and save it once allowed. With the
 * box ticked, it is let in here too, as a computer whose link was pasted was: it then starts runs
 * here, so runs go both ways in one go. That needs this computer's own door open on the Wi-Fi.
 */
export function Connecting({ d, computer, canBoth, onBack, onClose }: { d: Devices; computer: FoundComputer; /** This computer's door is open: the other one can be let in here too. */ canBoth: boolean; onBack: () => void; onClose: () => void }) {
  const down = useOpenAgentDown()
  const { host } = d
  const [phase, setPhase] = useState<Phase>({ at: 'asking' })
  const [both, setBoth] = useState(true)
  const [round, setRound] = useState(0)
  // Read when the answer comes, not when Connect was pressed: the box can be changed while it waits.
  const bothNow = useRef(both)
  bothNow.current = both && canBoth
  // The ask while it waits: taken away there when the person gives up here.
  const waiting = useRef<AskedThere | undefined>(undefined)

  useEffect(() => {
    let stopped = false
    void (async () => {
      setPhase({ at: 'asking' })
      const asked = await askComputer(host, computer.url)
      if (stopped) return
      if (!asked.ok) return setPhase({ at: 'failed', error: asked.error })
      waiting.current = asked.value
      setPhase({ at: 'waiting', asked: asked.value })
      for (;;) {
        // Each look waits a while at the other computer for the answer; one answered at once is not repeated at once.
        const looked = Date.now()
        const heard = await hearAnswer(host, computer.url, asked.value.secret)
        if (stopped) return
        if (!heard.ok) return setPhase({ at: 'failed', error: heard.error })
        if (heard.value.state === 'waiting') {
          await new Promise(resolve => setTimeout(resolve, Math.max(0, LOOK_REST_MS - (Date.now() - looked))))
          continue
        }
        waiting.current = undefined
        if (heard.value.state !== 'allowed') return setPhase({ at: heard.value.state })
        setPhase({ at: 'saving' })
        // By its name on the network first, as every link there goes; by its number when the name does not open here.
        let link = heard.value.link
        let added = await host.addMachine(link, computer.name)
        if (!added.ok && heard.value.numberLink) added = await host.addMachine((link = heard.value.numberLink), computer.name)
        if (stopped) return
        if (!added.ok) return setPhase({ at: 'failed', error: `${computer.name} let this computer in, but it could not be saved: ${added.error}` })
        let words = 'Your runs can go there.'
        if (bothNow.current) {
          // This computer's own link, handed to the other one, which saves it: its runs can come here too.
          const mine = await addDevice(host)
          const letIn = mine.ok ? await host.letMachineIn(new URL(link).origin, mine.value.url) : mine
          words = letIn.ok ? 'Runs go both ways.' : `Your runs can go there. It could not be let in here: ${letIn.error}`
        }
        await Promise.all([d.reloadMachines(), d.reloadDoor()]).catch(() => {})
        if (!stopped) setPhase({ at: 'done', words })
        return
      }
    })()
    return () => {
      stopped = true
      // Given up while it waited: the popup there goes too.
      if (waiting.current) void cancelAsk(host, computer.url, waiting.current.secret)
      waiting.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const name = computer.name
  return (
    <div className="space-y-6">
      {phase.at === 'asking' || phase.at === 'saving' ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          {phase.at === 'asking' ? `Asking ${name}…` : `${name} let you in. Saving it…`}
        </div>
      ) : phase.at === 'waiting' ? (
        <>
          <div className="space-y-1 text-sm">
            <p>
              On <span className="font-medium">{name}</span>, press <span className="font-medium">Allow</span>.
            </p>
            <p>It shows the same number:</p>
          </div>
          <p aria-label="The number" className="font-mono text-3xl font-semibold tracking-widest">
            {shownNumber(phase.asked.number)}
          </p>
          <Waiting>{`Waiting for ${name}…`}</Waiting>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" checked={both && canBoth} disabled={!canBoth} onCheckedChange={checked => setBoth(checked === true)} aria-label={`${name} can start runs on this computer too`} />
            <span>
              {`${name} can start runs on this computer too`}
              <span className="mt-0.5 block text-xs text-faint-foreground">{canBoth ? 'Then runs go both ways.' : 'Turn on "On this Wi-Fi" here first: then runs can go both ways.'}</span>
            </span>
          </label>
        </>
      ) : phase.at === 'done' ? (
        <Joined words={phase.words}>{`${name} is connected.`}</Joined>
      ) : phase.at === 'denied' ? (
        <p role="status" className="text-sm">{`${name} said no.`}</p>
      ) : phase.at === 'gone' ? (
        <p role="status" className="text-sm">{`${name} did not answer. Try again.`}</p>
      ) : (
        <Problem>{phase.error}</Problem>
      )}
      <Presses>
        {phase.at === 'done' ? (
          <Button onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" disabled={phase.at === 'saving'} onClick={onBack}>
              {phase.at === 'waiting' || phase.at === 'asking' ? 'Cancel' : 'Back'}
            </Button>
            {(phase.at === 'gone' || phase.at === 'failed') && (
              <Button variant="secondary" disabled={down} onClick={() => setRound(round + 1)}>
                Try again
              </Button>
            )}
          </>
        )}
      </Presses>
    </div>
  )
}

/**
 * How often the popup reads the asks while the page is in sight. Each read is answered at once: a
 * read that waited for the asks to change held one of the six connections a browser opens to the
 * dashboard, which all its tabs share, and two tabs' worth left every other call waiting.
 */
const LOOK_MS = 5_000

/** How long the popup rests after its read failed: a computer with no door package, or one that is down. */
const RETRY_MS = 30_000

/** Once the page is in sight, or never when `signal` ends first. */
function inSight(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (!document.hidden || signal.aborted) return resolve()
    const done = (): void => {
      if (document.hidden && !signal.aborted) return
      document.removeEventListener('visibilitychange', done)
      signal.removeEventListener('abort', done)
      resolve()
    }
    document.addEventListener('visibilitychange', done)
    signal.addEventListener('abort', done)
  })
}

/** `ms` from now, or sooner when `signal` ends. */
function rest(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

/**
 * Over every page: a computer on this Wi-Fi asks to connect. Shown with the number its screen
 * shows, until someone here allows it or denies it, it gives up, or its two minutes run out. Read
 * every few seconds while the page is in sight, and not at all out of sight or once the popup is
 * gone. The door answers no asks to a device of a person the owner invited: their page shows none.
 */
export function AskPopup() {
  const host = useModuleHost()
  const [asks, setAsks] = useState<AskHere[]>([])
  // Closed on this page only: the ask goes on waiting for another of the person's devices.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const down = useOpenAgentDown()
  // The keyboard starts on an answer, the one that lets nothing in: Enter at once denies, it never allows.
  const deny = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      while (!stop.signal.aborted) {
        await inSight(stop.signal)
        if (stop.signal.aborted) return
        const read = await loadAsks(host)
        if (stop.signal.aborted) return
        if (read.ok) setAsks(read.value)
        await rest(read.ok ? LOOK_MS : RETRY_MS, stop.signal)
      }
    })()
    return () => stop.abort()
  }, [host])

  const ask = asks.find(candidate => !closed.has(candidate.id))
  const shownId = ask?.id
  useEffect(() => setError(undefined), [shownId])
  if (!ask) return null

  const answer = async (allow: boolean): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const answered = await answerAsk(host, ask.id, allow)
    setBusy(false)
    if (answered.ok) setAsks(answered.value)
    else setError(answered.error)
  }

  return (
    <Dialog open onOpenChange={open => !open && setClosed(new Set([...closed, ask.id]))} title="A computer wants to connect" initialFocus={deny}>
      <div className="space-y-6">
        <p className="flex items-start gap-2 text-sm">
          <Laptop className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{ask.name}</span> asks to start runs on this computer.
          </span>
        </p>
        <p className="text-xs text-muted-foreground">Its runs here use this computer's GitHub and Claude logins. Check that it shows the same number:</p>
        <p aria-label="The number" className="text-center font-mono text-3xl font-semibold tracking-widest">
          {shownNumber(ask.number)}
        </p>
        {error !== undefined && <Problem>{error}</Problem>}
        <PressRow>
          <Button ref={deny} variant="secondary" loading={busy} disabled={down} onClick={() => void answer(false)}>
            Deny
          </Button>
          <Button loading={busy} disabled={down} onClick={() => void answer(true)}>
            Allow
          </Button>
        </PressRow>
      </div>
    </Dialog>
  )
}
