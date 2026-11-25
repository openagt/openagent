import { useState, type ReactNode } from 'react'
import type { DashboardData } from '../../src/index.js'
import { X } from 'lucide-react'
import { onDashboard } from '../rpc/reads.js'
import { usePolled } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'
import { Panel, PanelGroup, StepNumber } from './ui/panel.js'
import { Skeleton } from './ui/skeleton.js'
import { updatePreferences } from '../lib/preferences.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { useAttention } from '../lib/use-attention.js'
import { attentionDetail, attentionKey, useAttentionFixes } from './Attention.js'

// "Discover OpenAgent", the Overview's first steps (#958): what a new install can set up, as the
// modules say it needs setting up on this computer (`app.attention`: a GitHub account to connect, a
// first project to add, the tickets and the queue to populate, say). Each is there until it is done,
// as its module tells: it cannot be ticked by clicking it, and a step done outside the dashboard
// leaves the card all the same. Numbered, not boxes: a box invites a click that can tick nothing.
//
// One step is open at a time (his pick): the first, its words and its button at the row's end; the
// steps after it, only their titles, each a press from open.
//
// It is the Overview's first part, above the box that starts a session, while a step is there (his
// pick). With none left it is gone: the box is how a session starts. Its ✕ hides it, and the
// "Discover OpenAgent on the Overview" switch in Settings › Appearance brings it back: what the ✕
// promises.

/** What the ✕ says it does. */
const HIDE = 'Hide; Settings › Appearance brings it back'

/** One step: what it is, and what to do about it. */
interface Step {
  key: string
  label: string
  /** What the step is, said while it is open. */
  description?: ReactNode
  /** The press that does it, at the row's end while the step is open. */
  action?: ReactNode
}

export function OnboardingChecklist() {
  // Slower than the Overview's own 5s poll: these change at human speed.
  // Kept for the next visit: the steps open where they stood, not as titles that then grow.
  const { reload, state } = usePolled<DashboardData | null>(onDashboard, null, 10_000, [], { remember: 'onboarding:dashboard', stored: true })
  // The step the person opened; by default, the first.
  const [picked, setPicked] = useState<string | undefined>()
  const attention = useAttention(null)
  const setupItems = (attention ?? []).filter(item => item.kind === 'setup' && item.scope === 'computer')
  const fixes = useAttentionFixes(undefined, () => void reload())


  // What the modules say needs setting up on this computer (`app.attention`), each a step with its fix.
  const moduleSteps: Step[] = setupItems.map(item => {
    const fix = fixes.fixOf(item)
    const detail = attentionDetail(item)
    return {
      key: `attention:${attentionKey(item)}`,
      label: item.words,
      ...(detail !== undefined ? { description: detail } : {}),
      ...(fix && item.fix ? { action: <Button size="sm" loading={fixes.pending} onClick={fix}>{item.fix.label}</Button> } : {}),
    }
  })

  const steps = moduleSteps

  // No step before its reads have said where it stands: the steps are what the modules say.
  const loginsRead = attention !== null
  const reading = state === 'unknown' || !loginsRead
  const open = picked !== undefined && steps.some(step => step.key === picked) ? picked : steps[0]?.key

  // No step left: nothing to discover, and the box under it is how a session starts. Only once what the modules
  // say is read: it can add a step, and the card waits for it rather than coming late.
  if (loginsRead && steps.length === 0) return null
  return (
    <>
    {fixes.overlay}
    <PanelGroup
      bare
      title="Discover OpenAgent"
      // How many steps are left: each leaves the card once it is done.
      count={
        reading ? (
          // As wide as the number it stands for, drawn unseen before it (not text of the page, nor said).
          <span aria-hidden data-shape={`${steps.length}`} className="inline-block h-4 animate-skeleton rounded-md bg-accent align-middle leading-4 before:invisible before:content-[attr(data-shape)] motion-reduce:animate-skeleton-still" />
        ) : (
          `${steps.length}`
        )
      }
      action={
        <>
          {/* Pulled out by its own padding, so its ✕ ends on the column's edge. */}
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => updatePreferences({ onboardingDismissed: true })} aria-label={HIDE} className="-mr-1.5 text-muted-foreground" />}>
              <X className="h-4 w-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{HIDE}</TooltipContent>
          </Tooltip>
        </>
      }
    >
      {reading ? (
        <>
          <p className="sr-only">Loading…</p>
          {/* The steps as they will stand once read, so nothing in them moves when the answer comes: each its mark and its
              title, the open step its words under its name (read with what the modules say, or fixed) and its presses' shapes at
              the row's end, centred on the row. Only once what the modules say is read (it can add a
              step at the top, which would push the rows drawn): nothing under the steps is drawn before they are. */}
          {loginsRead && (
            <Panel ordered aria-hidden>
              {steps.map((step, at) => (
                <li key={step.key} className={STEP_ROW}>
                  <StepNumber at={at} current={step.key === open} />
                  {step.key === open ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                        <span className="block text-sm font-medium">{step.label}</span>
                        {typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : step.description}
                      </div>
                      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-3">
                        <Skeleton className="h-8 w-36" />
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">{step.label}</span>
                  )}
                </li>
              ))}
            </Panel>
          )}
        </>
      ) : (
        <Panel ordered aria-label={`${steps.length} ${steps.length === 1 ? 'step' : 'steps'} left`}>
          {steps.map((step, at) => {
            const isOpen = step.key === open
            // A later step is a press that opens it: the whole row is, lit under the pointer.
            const press = !isOpen
            return (
              <li
                key={step.key}
                aria-label={step.label}
                aria-current={isOpen ? 'step' : undefined}
                className={cn(
                  STEP_ROW,
                  press && 'pointer-fine:hover:bg-foreground/4 pointer-fine:hover:before:opacity-0 pointer-fine:[&:hover+li]:before:opacity-0 has-[[data-cover]:active]:bg-foreground/8',
                  press && 'has-[[data-cover]:focus-visible]:ring-2 has-[[data-cover]:focus-visible]:ring-focus has-[[data-cover]:focus-visible]:ring-inset has-[[data-cover]:focus-visible]:before:opacity-0',
                )}
              >
                <StepNumber at={at} current={isOpen} />
                {/* The action goes under the words until it fits whole beside them with the words 16rem wide or more, so a
                    command is cut only where the row has no room for it. Beside them it is centred on the row and the title
                    stays on the row's first line, with the step's number; a command goes under its press where the two do
                    not fit one line. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-[1_1_16rem] space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <button
                        type="button"
                        disabled={!press}
                        onClick={() => setPicked(step.key)}
                        {...(press ? { 'data-cover': true } : {})}
                        className={cn('flex flex-wrap items-center gap-x-2 text-left text-sm', press && 'outline-none after:absolute after:inset-0', isOpen ? 'font-medium' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {step.label}
                      </button>
                    </div>
                    {isOpen && step.description && (typeof step.description === 'string' ? <p className="text-xs text-muted-foreground">{step.description}</p> : step.description)}
                  </div>
                  {isOpen && step.action && <div className="flex max-w-full shrink-0 self-center">{step.action}</div>}
                </div>
              </li>
            )
          })}
        </Panel>
      )}
    </PanelGroup>
    </>
  )
}

/** A step's row, as a panel's: 16 in from every edge, its mark on the title's line, a hairline from inset to inset over every row but the first. */
const STEP_ROW = 'relative flex items-start gap-3 px-4 py-3 before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline'
