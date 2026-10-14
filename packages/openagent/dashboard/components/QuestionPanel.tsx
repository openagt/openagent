import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { ChoiceRequest } from '../../src/index.js'
import { sendChoice, sendMessage } from '../rpc/control.js'
import { useAction } from '../lib/use-action.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'

/** What Skip says to the agent: the person's own message, shown in the chat like any other. */
export const SKIP_MESSAGE = 'I skip this question.'

/** The pick that is no option: the person's own words, typed in the "Other" row. */
const OTHER = Symbol('other')

function Key({ n }: { n: number }) {
  return (
    <kbd className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-border px-1 font-sans text-[11px] text-muted-foreground" aria-hidden>
      {n}
    </kbd>
  )
}

// The question an agent's turn ended on, as a panel above the message box, the way Claude Code on
// the web asks: the title, one row per option (its label, its description, the number key that
// picks it), an "Other" row to answer in one's own words, and Skip / Submit. An option's pick goes
// over the control RPC, which hands the chosen labels to the agent; "Other" and Skip go as the
// person's own message, which continues the agent like any message. A caller whose agent is not
// reached that way (a cloud session) gives `send`: the pick goes through it, and the panel offers
// the options only.
// Mount it with `key={choice.id}` so a question asked again starts fresh. `active` binds the keys.
export function QuestionPanel({
  projectId,
  agentId,
  choice,
  active = false,
  onSaid,
  send,
}: {
  projectId: string
  agentId: string
  choice: ChoiceRequest
  /** The one question the keys answer: the number keys pick, Ctrl+Enter submits. */
  active?: boolean
  /** Told the message "Other" or Skip sent, so the chat can show it at once. */
  onSaid?: ((text: string) => void) | undefined
  /**
   * Where the pick goes instead of the usual call: the picked option, or the checked ones. With
   * it the panel has no "Other" row and no Skip: the bridge types only a parked question's own
   * labels into a cloud session, never free text, so it would refuse both.
   */
  send?: ((pick: string | string[]) => Promise<unknown>) | undefined
}) {
  const { busy, error, run } = useAction()
  // Sent and accepted by the daemon: the panel stays, its controls off, until the agent going on
  // takes it away. A refusal is shown in the daemon's own words, and the controls come back.
  const [sent, setSent] = useState(false)
  const [picked, setPicked] = useState<string | typeof OTHER | undefined>(() => (choice.multi ? undefined : (choice.recommended ?? choice.options[0]?.id)))
  const [checked, setChecked] = useState<Set<string>>(() => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []))
  const [other, setOther] = useState('')
  // Folded, and put away: the card's own two controls, as Claude Code's card has them. Neither
  // answers the question; the agent goes on waiting, and the chat keeps the "Asking" row.
  const [folded, setFolded] = useState(false)
  const [hidden, setHidden] = useState(false)
  const otherInput = useRef<HTMLInputElement>(null)
  const parked = busy || sent
  const words = other.trim()

  const deliver = (fn: () => Promise<unknown>) => void run(fn, 'Could not send your answer — try again.').then(outcome => outcome.ok && setSent(true))
  const answer = (pick: string | string[]) => deliver(() => (send ? send(pick) : sendChoice(projectId, choice.id, pick, agentId)))
  const say = (text: string) =>
    deliver(async () => {
      const result = await sendMessage(projectId, text, agentId)
      if (result.ok) onSaid?.(text)
      return result
    })

  // A single pick with "Other" chosen needs its words; everything else can always be sent.
  const ready = choice.multi || picked !== OTHER || words !== ''
  const submit = () => {
    if (parked || !ready) return
    if (choice.multi) {
      // Words in "Other" go with the checked options' labels, as one message: the agent reads both.
      if (words !== '') return say([...choice.options.filter(o => checked.has(o.id)).map(o => o.label), words].join(', '))
      return answer([...checked])
    }
    if (picked === OTHER) return say(words)
    if (picked !== undefined) answer(picked)
  }
  const pick = (id: string) => {
    if (parked) return
    if (!choice.multi) return setPicked(id)
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // The latest of everything the key handler reads, so the handler is wired up once.
  const keys = useRef({ submit, pick })
  keys.current = { submit, pick }
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a text field are that field's, except this panel's own "Other" row.
      const target = e.target as HTMLElement | null
      const typing = target !== null && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (typing && target !== otherInput.current) return
        e.preventDefault()
        keys.current.submit()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return
      const n = Number(e.key)
      const option = choice.options[n - 1]
      if (option) keys.current.pick(option.id)
      else if (!send && n === choice.options.length + 1) otherInput.current?.focus()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, choice.options, send])

  // A row is a filled block, not an outlined one, as Claude Code on the web draws its options: the
  // card already has the only border, and five outlines inside one made the panel read as a stack
  // of boxes. The one picked is a lighter fill in its place.
  const row = (on: boolean) => cn('flex w-full items-start gap-3 rounded-[5px] p-2 text-left', on ? 'bg-accent' : 'bg-muted/60 hover:bg-muted')
  if (hidden) return null
  return (
    <section role="region" aria-label={choice.title} className="mx-auto w-full max-w-3xl px-2 pt-2">
      <div className="rounded-[10px] border border-border bg-background p-3">
        <div className="mb-2 flex items-start gap-2 px-1">
          <h2 className="min-w-0 flex-1 text-sm font-medium">{choice.title}</h2>
          {/* Folded away or put aside by hand, as Claude Code's is: the question is still in the
              chat, and the agent waits for it either way. */}
          <button
            type="button"
            aria-label={folded ? 'Show the options' : 'Hide the options'}
            aria-expanded={!folded}
            onClick={() => setFolded(f => !f)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', folded && '-rotate-90')} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Put this question away"
            onClick={() => setHidden(true)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        {!folded && (
        <ul className="flex flex-col gap-[3px]">
          {choice.options.map((o, at) => {
            const on = choice.multi ? checked.has(o.id) : picked === o.id
            return (
              <li key={o.id}>
                <button type="button" role={choice.multi ? 'checkbox' : 'radio'} aria-checked={on} disabled={parked} onClick={() => pick(o.id)} className={cn(row(on), 'disabled:opacity-60')}>
                  {choice.multi && (
                    <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')} aria-hidden>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {o.label}
                      {o.id === choice.recommended && <span className="ml-2 text-xs font-normal text-muted-foreground">Recommended</span>}
                    </span>
                    {o.detail && <span className="block text-xs text-muted-foreground">{o.detail}</span>}
                  </span>
                  <Key n={at + 1} />
                </button>
              </li>
            )
          })}
          {!send && (
            <li>
              <label className={cn(row(choice.multi ? words !== '' : picked === OTHER), 'items-center')}>
                <input
                  ref={otherInput}
                  value={other}
                  disabled={parked}
                  onFocus={() => !choice.multi && setPicked(OTHER)}
                  onChange={e => setOther(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) submit()
                  }}
                  placeholder="Other: say it in your own words"
                  aria-label="Other"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <Key n={choice.options.length + 1} />
              </label>
            </li>
          )}
        </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 px-1 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {/* One line in every state, so the buttons never move. What the keys do is not written
              out: the number beside each option says it, and the key that submits is on the button. */}
          <span role={parked ? 'status' : undefined} className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
            {busy ? 'Sending your answer…' : sent ? 'Answer sent — waiting for the agent to pick it up…' : ''}
          </span>
          {!send && (
            <Button variant="ghost" size="sm" disabled={parked} onClick={() => say(SKIP_MESSAGE)}>
              Skip
            </Button>
          )}
          <Button size="sm" disabled={parked || !ready} onClick={submit}>
            Submit
            {active && <kbd className="font-sans text-[11px] opacity-70" aria-hidden>⌃⏎</kbd>}
          </Button>
        </div>
      </div>
    </section>
  )
}
