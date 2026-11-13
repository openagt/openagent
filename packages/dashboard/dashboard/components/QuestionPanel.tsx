import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Radio } from '@base-ui/react/radio'
import { Check } from 'lucide-react'
import type { ChoiceRequest } from '../../src/index.js'
import { sendChoice, sendMessage } from '../rpc/control.js'
import { useAction } from '../lib/use-action.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { cn } from '../lib/utils.js'
import { RadioGroup } from './ui/radio-group.js'
import { answerPrompt, skipPrompt } from '../lib/answered-question.js'
import { MOD_KEY } from '../lib/shortcut.js'
import { isMobileScreen } from '../lib/use-mobile.js'

/** The pick that is no option: the person's own words, typed in the "Other" row. */
const OTHER = Symbol('other')


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

// A question's rows. One pick is a radio group, as WAI-ARIA's: one Tab stop, the arrow keys move
// the pick. Where several may be picked, each row is a box of its own.
function Choices({ multi, labelledBy, picked, onPick, disabled, children }: { multi: boolean | undefined; labelledBy: string; picked: string | typeof OTHER | undefined; onPick: (value: string | typeof OTHER) => void; disabled: boolean; children: ReactNode }) {
  return multi ? (
    <ul className="flex flex-col">{children}</ul>
  ) : (
    <RadioGroup render={<ul />} aria-labelledby={labelledBy} value={picked} onValueChange={value => onPick(value as string | typeof OTHER)} disabled={disabled} className="flex flex-col gap-0">
      {children}
    </RadioGroup>
  )
}

// A choice's row: the radio group's radio, or a box the row toggles. Rows are parted by a line, as
// Claude Code on the web parts them; none is filled but the one under the pointer.
function Choice({ multi, value, on, disabled, onPick, children }: { multi: boolean | undefined; value: string | typeof OTHER; on: boolean; disabled: boolean; onPick: () => void; children: ReactNode }) {
  const row = 'flex w-full items-start gap-3 p-4 text-left enabled:hover:bg-foreground/[0.03] disabled:opacity-60'
  return multi ? (
    <button type="button" role="checkbox" aria-checked={on} disabled={disabled} onClick={onPick} className={row}>
      {children}
    </button>
  ) : (
    <Radio.Root value={value} nativeButton render={<button type="button" className={row} />}>
      {children}
    </Radio.Root>
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
  focused = false,
  onSaid,
  focusNext,
  send,
}: {
  projectId: string
  agentId: string
  choice: ChoiceRequest
  /** The one question the keys answer: the number keys pick, ⌘ or Ctrl + Enter submits. */
  active?: boolean
  /** The question the page opened on: its pick takes the focus as it shows, where the screen is no phone's. */
  focused?: boolean
  /** Told what the answer said to the agent, so the chat can show it at once. */
  onSaid?: ((text: string) => void) | undefined
  /** Given the focus once the answer is taken, when it was in the card and the screen is no phone's: the message box. */
  focusNext?: (() => void) | undefined
  /**
   * Where the pick goes instead of the usual call: the picked option, or the checked ones. With
   * it the card has no "Other" row and no Skip: the bridge types only a parked question's own
   * labels into a cloud session, never free text, so it would refuse both.
   */
  send?: ((pick: string | string[]) => Promise<unknown>) | undefined
}) {
  const { busy, error, run } = useAction()
  // OpenAgent is not answering: no answer can be sent, and what is picked and typed stays.
  const down = useContext(DaemonDown)
  // Sent and accepted by the daemon: the card goes, and the chat shows the answer. A refusal is
  // shown in the daemon's own words, and the controls come back.
  const [sent, setSent] = useState(false)
  const [picked, setPicked] = useState<string | typeof OTHER | undefined>(() => (choice.multi ? undefined : (choice.recommended ?? choice.options[0]?.id)))
  const [checked, setChecked] = useState<Set<string>>(() => new Set(choice.multi ? choice.options.filter(o => o.default).map(o => o.id) : []))
  const [other, setOther] = useState('')
  // "Other" ticked beside options where several may be picked: its words go with them.
  const [otherOn, setOtherOn] = useState(false)
  const otherInput = useRef<HTMLInputElement>(null)
  const card = useRef<HTMLElement>(null)
  const titleId = useId()
  const words = other.trim()

  // Taken, the card goes and the chat is told what the agent was sent, to show it at once. The
  // focus in the card goes on, read as it is pressed: the card's buttons are off while it sends.
  const deliver = (fn: () => Promise<unknown>, said?: string) => {
    const handOn = card.current?.contains(document.activeElement) === true && !isMobileScreen()
    void run(fn, 'Could not send your answer — try again.').then(outcome => {
      if (!outcome.ok) return
      setSent(true)
      if (said !== undefined) onSaid?.(said)
      if (handOn) focusNext?.()
    })
  }
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
    if (busy || down || !ready) return
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

  useEffect(() => {
    if (focused && !isMobileScreen()) card.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"], [role="checkbox"]')?.focus({ preventScroll: true })
  }, [focused])

  // "Other" picked: its field takes the keys at once, as Claude Code's does.
  useEffect(() => {
    if (otherPicked) otherInput.current?.focus()
  }, [otherPicked])

  if (sent) return null
  return (
    <section ref={card} role="region" aria-label={choice.title} className="flex w-full max-w-[480px] flex-col overflow-clip rounded-xl font-sans text-sm ring-1 ring-border">
      <h2 id={titleId} className="bg-foreground/5 px-4 py-3 font-normal">{choice.title}</h2>
      <Choices multi={choice.multi} labelledBy={titleId} picked={picked} onPick={setPicked} disabled={busy}>
        {choice.options.map(o => {
          const on = choice.multi ? checked.has(o.id) : picked === o.id
          return (
            <li key={o.id} className="border-t border-border first:border-t-0">
              <Choice multi={choice.multi} value={o.id} on={on} disabled={busy} onPick={() => pick(o.id)}>
                <Mark on={on} multi={choice.multi} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span>
                    {o.label}
                    {/* A box of its own, which a screen reader reads as a word apart from the label. */}
                    {o.id === choice.recommended && <span className="ml-2 inline-block text-muted-foreground">Recommended</span>}
                  </span>
                  {o.detail && <span className="text-muted-foreground">{o.detail}</span>}
                </span>
              </Choice>
            </li>
          )
        })}
        {!send && (
          <li className="flex flex-col border-t border-border">
            <Choice multi={choice.multi} value={OTHER} on={otherPicked} disabled={busy} onPick={pickOther}>
              <Mark on={otherPicked} multi={choice.multi} />
              <span className="min-w-0 flex-1">Other</span>
            </Choice>
            {otherPicked && (
              <input
                ref={otherInput}
                value={other}
                disabled={busy}
                onChange={e => setOther(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) submit()
                }}
                name="own-answer"
                placeholder="Type your own answer here"
                aria-label="Your own answer"
                className="mx-4 mb-2 ml-11 rounded-md border border-border bg-transparent px-2.5 py-1.5 outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            )}
          </li>
        )}
      </Choices>
      <div className="flex items-center gap-2 px-4 pt-2 pb-4">
        {/* One line in every state, so the buttons never move: what went wrong, or that it is on its way. */}
        <span role={error ? 'alert' : busy ? 'status' : undefined} className={cn('min-w-0 flex-1 truncate text-xs', error ? 'text-danger' : 'text-muted-foreground')}>
          {error ?? (busy ? 'Sending your answer…' : '')}
        </span>
        {!send && (
          <button type="button" disabled={busy || down} onClick={() => say(skipPrompt(choice.title))} className="h-6 rounded-md bg-foreground/10 px-2 text-[13px] hover:bg-foreground/15 disabled:opacity-60">
            Skip
          </button>
        )}
        <button type="button" disabled={busy || down || !ready} onClick={submit} className="flex h-6 items-center gap-1.5 rounded-md bg-foreground px-2 text-[13px] font-medium text-background hover:bg-foreground/90 disabled:opacity-60">
          Submit
          {active && (
            <span className="flex gap-0.5 pointer-coarse:hidden" aria-hidden>
              <kbd className="flex h-[17px] min-w-[17px] items-center justify-center rounded border border-background/20 px-0.5 font-sans text-[11px]">{MOD_KEY}</kbd>
              <kbd className="flex h-[17px] min-w-[17px] items-center justify-center rounded border border-background/20 px-0.5 font-sans text-[11px]">Enter</kbd>
            </span>
          )}
        </button>
      </div>
    </section>
  )
}
