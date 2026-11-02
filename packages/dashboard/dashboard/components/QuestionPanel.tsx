import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { ChoiceRequest } from '../../src/index.js'
import { sendChoice, sendMessage } from '../rpc/control.js'
import { useAction } from '../lib/use-action.js'
import { cn } from '../lib/utils.js'
import { answerPrompt, skipPrompt } from '../lib/answered-question.js'

/** The pick that is no option: the person's own words, typed in the "Other" row. */
const OTHER = Symbol('other')

/** The key that submits, as the keyboard in front of the person names it. */
const SUBMIT_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

// A pick's mark, as Claude Code on the web draws one: a ring, filled with a dot when picked; a
// box with a tick where several may be picked.
function Mark({ on, multi }: { on: boolean; multi: boolean | undefined }) {
  return multi ? (
    <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/20')} aria-hidden>
      {on && <Check className="h-3 w-3" />}
    </span>
  ) : (
    <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full', on ? 'bg-primary' : 'border border-foreground/20')} aria-hidden>
      {on && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
    </span>
  )
}

// The question an agent's turn ended on, in the chat under what the agent said, the way Claude
// Code on the web asks: a card with the title on a grey band, one row per option (a ring, its
// label, its description), an "Other" row to answer in one's own words, and Skip / Submit. The
// number keys pick, as before, with no number drawn. An option's pick goes over the control RPC,
// which hands the chosen labels to the agent; "Other" and Skip go as a message in the same
// sentence's shape, so the chat draws every answer, a skip too, as the question and what was said
// to it. The card goes the moment the answer is taken, and the chat shows it then: the agent's own
// line comes seconds later, once it is going again. A caller whose agent is not reached that way (a
// cloud session) gives `send`: the pick goes through it, and the card offers the options only.
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
  /** The one question the keys answer: the number keys pick, ⌘ or Ctrl + Enter submits. */
  active?: boolean
  /** Told what the answer said to the agent, so the chat can show it at once. */
  onSaid?: ((text: string) => void) | undefined
  /**
   * Where the pick goes instead of the usual call: the picked option, or the checked ones. With
   * it the card has no "Other" row and no Skip: the bridge types only a parked question's own
   * labels into a cloud session, never free text, so it would refuse both.
   */
  send?: ((pick: string | string[]) => Promise<unknown>) | undefined
}) {
  const { busy, error, run } = useAction()
  // Sent and accepted by the daemon: the card goes, and the chat shows the answer. A refusal is
  // shown in the daemon's own words, and the controls come back.
  const [sent, setSent] = useState(false)
  const [picked, setPicked] = useState<string | typeof OTHER | undefined>(() => (choice.multi ? undefined : (choice.recommended ?? choice.options[0]?.id)))
  const [checked, setChecked] = useState<Set<string>>(() => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []))
  const [other, setOther] = useState('')
  // "Other" ticked beside options where several may be picked: its words go with them.
  const [otherOn, setOtherOn] = useState(false)
  const otherInput = useRef<HTMLInputElement>(null)
  const words = other.trim()

  // Taken, the card goes and the chat is told what the agent was sent, to show it at once.
  const deliver = (fn: () => Promise<unknown>, said?: string) =>
    void run(fn, 'Could not send your answer — try again.').then(outcome => {
      if (!outcome.ok) return
      setSent(true)
      if (said !== undefined) onSaid?.(said)
    })
  const answer = (pick: string | string[]) => {
    if (send) return deliver(() => send(pick))
    const labels = choice.options.filter(o => [pick].flat().includes(o.id)).map(o => o.label)
    deliver(() => sendChoice(projectId, choice.id, pick, agentId), answerPrompt(choice.title, labels.length ? labels.join(', ') : '(none)'))
  }
  const say = (text: string) => deliver(() => sendMessage(projectId, text, agentId), text)

  // "Other" picked needs its words; everything else can always be sent.
  const otherPicked = choice.multi ? otherOn : picked === OTHER
  const ready = !otherPicked || words !== ''
  const submit = () => {
    if (busy || !ready) return
    if (choice.multi) {
      // Words in "Other" go with the checked options' labels, as one message: the agent reads both.
      if (otherOn) return say(answerPrompt(choice.title, [...choice.options.filter(o => checked.has(o.id)).map(o => o.label), words].join(', ')))
      return answer([...checked])
    }
    if (picked === OTHER) return say(answerPrompt(choice.title, words))
    if (picked !== undefined) answer(picked)
  }
  const pickOther = () => {
    if (busy) return
    if (choice.multi) setOtherOn(on => !on)
    else setPicked(OTHER)
  }
  const pick = (id: string) => {
    if (busy) return
    if (!choice.multi) return setPicked(id)
    setChecked(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // The latest of everything the key handler reads, so the handler is wired up once.
  const keys = useRef({ submit, pick, pickOther })
  keys.current = { submit, pick, pickOther }
  useEffect(() => {
    // Answered: the card is gone, and its keys with it.
    if (!active || sent) return
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a text field are that field's, except this card's own "Other" row.
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
      else if (!send && n === choice.options.length + 1) keys.current.pickOther()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, sent, choice.options, send])

  // "Other" picked: its field takes the keys at once, as Claude Code's does.
  useEffect(() => {
    if (otherPicked) otherInput.current?.focus()
  }, [otherPicked])

  // Rows are parted by a line, as Claude Code on the web parts them; none is filled.
  const row = 'flex w-full items-start gap-3 p-3 text-left disabled:opacity-60'
  if (sent) return null
  return (
    <section role="region" aria-label={choice.title} className="flex w-full max-w-[480px] flex-col overflow-clip rounded-[10px] font-sans text-sm ring-1 ring-border">
      <h2 className="bg-foreground/5 px-3 py-2 font-normal">{choice.title}</h2>
      <ul className="flex flex-col">
        {choice.options.map(o => {
          const on = choice.multi ? checked.has(o.id) : picked === o.id
          return (
            <li key={o.id} className="border-t border-border first:border-t-0">
              <button type="button" role={choice.multi ? 'checkbox' : 'radio'} aria-checked={on} disabled={busy} onClick={() => pick(o.id)} className={row}>
                <Mark on={on} multi={choice.multi} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span>
                    {o.label}
                    {o.id === choice.recommended && <span className="ml-2 text-muted-foreground">Recommended</span>}
                  </span>
                  {o.detail && <span className="text-muted-foreground">{o.detail}</span>}
                </span>
              </button>
            </li>
          )
        })}
        {!send && (
          <li className="flex flex-col border-t border-border">
            <button type="button" role={choice.multi ? 'checkbox' : 'radio'} aria-checked={otherPicked} disabled={busy} onClick={pickOther} className={row}>
              <Mark on={otherPicked} multi={choice.multi} />
              <span className="min-w-0 flex-1">Other</span>
            </button>
            {otherPicked && (
              <input
                ref={otherInput}
                value={other}
                disabled={busy}
                onChange={e => setOther(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) submit()
                }}
                placeholder="Type your own answer here"
                aria-label="Other"
                className="mx-3 mb-1 ml-10 rounded-md border border-border bg-transparent px-2.5 py-1.5 outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            )}
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2 px-3 pt-2 pb-3">
        {/* One line in every state, so the buttons never move: what went wrong, or that it is on its way. */}
        <span role={error ? 'alert' : busy ? 'status' : undefined} className={cn('min-w-0 flex-1 truncate text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
          {error ?? (busy ? 'Sending your answer…' : '')}
        </span>
        {!send && (
          <button type="button" disabled={busy} onClick={() => say(skipPrompt(choice.title))} className="h-6 rounded-md bg-foreground/10 px-2 text-[13px] hover:bg-foreground/15 disabled:opacity-60">
            Skip
          </button>
        )}
        <button type="button" disabled={busy || !ready} onClick={submit} className="flex h-6 items-center gap-1.5 rounded-md bg-foreground px-2 text-[13px] font-medium text-background hover:bg-foreground/90 disabled:opacity-60">
          Submit
          {active && (
            <span className="flex gap-0.5" aria-hidden>
              <kbd className="flex h-[17px] min-w-[17px] items-center justify-center rounded border border-background/20 px-0.5 font-sans text-[11px]">{SUBMIT_KEY}</kbd>
              <kbd className="flex h-[17px] min-w-[17px] items-center justify-center rounded border border-background/20 px-0.5 font-sans text-[11px]">↵</kbd>
            </span>
          )}
        </button>
      </div>
    </section>
  )
}
