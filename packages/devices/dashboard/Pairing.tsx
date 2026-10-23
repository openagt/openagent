import { useEffect, useRef, useState } from 'react'
import { Laptop, Loader2 } from 'lucide-react'
import { Button, Checkbox, Dialog, useModuleHost } from '@openagt/dashboard/module'
import { Joined, Waiting } from './codes.js'
import { addDevice, answerAsk, askComputer, cancelAsk, hearAnswer, loadAsks, type AskHere, type AskedThere, type FoundComputer } from './devices.js'
import { Problem } from './parts.js'
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
    <Dialog open onOpenChange={open => !open && onClose()} title="Add computer">
      <div className="space-y-4">
        {phase.at === 'asking' || phase.at === 'saving' ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            {phase.at === 'asking' ? `Asking ${name}…` : `${name} let you in. Saving it…`}
          </div>
        ) : phase.at === 'waiting' ? (
          <>
            <div className="space-y-1 text-center text-sm">
              <p>
                On <span className="font-medium">{name}</span>, press <span className="font-medium">Allow</span>.
              </p>
              <p>It shows the same number:</p>
            </div>
            <p aria-label="The number" className="text-center font-mono text-3xl font-semibold tracking-widest">
              {shownNumber(phase.asked.number)}
            </p>
            <div className="flex justify-center">
              <Waiting>{`Waiting for ${name}…`}</Waiting>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={both && canBoth} disabled={!canBoth} onCheckedChange={checked => setBoth(checked === true)} aria-label={`${name} can start runs on this computer too`} />
              <span>
                {`${name} can start runs on this computer too`}
                <span className="block text-xs text-muted-foreground">{canBoth ? 'Then runs go both ways.' : 'Turn on "On this Wi-Fi" here first: then runs can go both ways.'}</span>
              </span>
            </label>
          </>
        ) : phase.at === 'done' ? (
          <Joined words={phase.words}>{`${name} is connected.`}</Joined>
        ) : phase.at === 'denied' ? (
          <p role="status" className="py-6 text-center text-sm">{`${name} said no.`}</p>
        ) : phase.at === 'gone' ? (
          <p role="status" className="py-6 text-center text-sm">{`${name} did not answer. Try again.`}</p>
        ) : (
          <Problem>{phase.error}</Problem>
        )}
        <div className="flex justify-end gap-2">
          {phase.at === 'done' ? (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              {(phase.at === 'gone' || phase.at === 'failed') && (
                <Button size="sm" variant="outline" onClick={() => setRound(round + 1)}>
                  Try again
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={phase.at === 'saving'} onClick={onBack}>
                {phase.at === 'waiting' || phase.at === 'asking' ? 'Cancel' : 'Back'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** How long the popup rests after its read failed: a computer with no door package, or one that is down. */
const RETRY_MS = 30_000

/**
 * Over every page: a computer on this Wi-Fi asks to connect. Shown with the number its screen
 * shows, until someone here allows it or denies it, it gives up, or its two minutes run out. Read
 * with one command at a time that waits for the asks to change. The door answers no asks to a
 * device of a person the owner invited: their page shows none.
 */
export function AskPopup() {
  const host = useModuleHost()
  const [asks, setAsks] = useState<AskHere[]>([])
  // Closed on this page only: the ask goes on waiting for another of the person's devices.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let stopped = false
    void (async () => {
      let seen: string[] | undefined
      while (!stopped) {
        const read = await loadAsks(host, seen)
        if (stopped) return
        if (!read.ok) {
          await new Promise(resolve => setTimeout(resolve, RETRY_MS))
          continue
        }
        seen = read.value.map(ask => ask.id)
        setAsks(read.value)
      }
    })()
    return () => {
      stopped = true
    }
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
    <Dialog open onOpenChange={open => !open && setClosed(new Set([...closed, ask.id]))} title="A computer wants to connect">
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm">
          <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">{ask.name}</span> asks to start runs on this computer.
          </span>
        </p>
        <p className="text-xs text-muted-foreground">Its runs here use this computer's GitHub and Claude logins. Check that it shows the same number:</p>
        <p aria-label="The number" className="text-center font-mono text-3xl font-semibold tracking-widest">
          {shownNumber(ask.number)}
        </p>
        {error !== undefined && <Problem>{error}</Problem>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
            Deny
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void answer(true)}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Allow
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
