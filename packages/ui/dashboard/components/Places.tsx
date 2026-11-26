import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { RunOptions } from '@openagt/hooks'
import { moduleHost, type ActionPlace, type ActionPlaces, type ModuleHost, type OptionPlace, type UiActionResult, type UiComposerControlProps, type UiComposerIn, type UiControlSaid, type UiOffer, type ViewPlace, type ViewPlaces } from '../module/index.js'
import { DEFAULT_ORDER, useMountedModules, type MountedAction, type MountedOption, type MountedView } from '../lib/use-modules.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { ModuleSlot } from './ModulePageView.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { WorkRowPlace } from './WorkRow.js'
import { Button, buttonVariants } from './ui/button.js'
import { ButtonGroup, ButtonGroupSeparator } from './ui/button-group.js'
import { DaemonDown } from '../lib/use-daemon-health.js'
import { cn } from '../lib/utils.js'

// How the shell draws the places modules fill that are not pages of their own (#2394): the
// controls of the message box, the labels of a session's row, and the actions of the hand-off bar
// and of the menus. Each piece is drawn in its module's slot, with its module's host; a place
// names no module.

/** What a module brings is on where a place is drawn: in the project `projectId`, in a session with no project ({@link SESSIONS_ID}), or, `undefined`, wherever it is on (a profile's editor, for any project). */
export function onIn(of: { projects: readonly string[]; sessions?: true; computer?: true }, projectId: string | undefined): boolean {
  if (of.computer) return true
  if (projectId === undefined) return of.projects.length > 0 || of.sessions === true
  return projectId === SESSIONS_ID ? of.sessions === true : of.projects.includes(projectId)
}

/** The views at `place` on where it is drawn ({@link onIn}), in the place's order. */
export function useViewsAt<P extends ViewPlace>(place: P, projectId: string | undefined): MountedView<P>[] {
  const views = useMountedModules().views[place] as MountedView<P>[]
  return useMemo(() => views.filter(view => onIn(view, projectId)), [views, projectId])
}

/** The options at `place` on where it is drawn ({@link onIn}), in the place's order, each with its module's host: what a shared menu calls them with. */
export function useOptionsAt<P extends OptionPlace>(place: P, projectId: string | undefined): { option: MountedOption<P>; host: ModuleHost }[] {
  const options = useMountedModules().options[place] as MountedOption<P>[]
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  return useMemo(() => options.filter(option => onIn(option, projectId)).map(option => ({ option, host: moduleHost({ ...services, package: option.package }) })), [options, projectId, services])
}

/** Each view at `place` on where it is drawn, in its module's slot, given `props`. */
export function ViewsAt<P extends ViewPlace>({ place, projectId, props, label }: { place: P; projectId: string | undefined; props: ViewPlaces[P]['props']; /** Names a piece that failed: "pull request labels". */ label: string }) {
  const views = useViewsAt(place, projectId)
  return (
    <>
      {views.map(view => {
        const View = view.View as React.ComponentType<ViewPlaces[P]['props']>
        return (
          <ModuleSlot key={`${view.package}/${view.id}`} package={view.package} label={label}>
            <View {...props} />
          </ModuleSlot>
        )
      })}
    </>
  )
}

/** The box a message box's controls are drawn for: which box, the options picked there, and how they change. */
export interface ControlBox {
  in: UiComposerIn
  /** The project the box is in: {@link SESSIONS_ID} for a session with no project; none in a profile's editor. */
  projectId?: string | undefined
  agentId?: string | undefined
  options: RunOptions
  /** In a session's box: its options as its record keeps them, which the next message can add to. */
  recorded?: RunOptions | undefined
  onChange: (options: RunOptions) => void
  busy: boolean
  /** In the launcher: move it to another project, or none, taking what is typed along. */
  pickProject?: ((projectId: string | undefined) => void) | undefined
}

/** What every control of a box says of its pick, by the control, for the gear's hover. */
export type ControlsSaid = Readonly<Record<string, UiControlSaid>>

/**
 * The controls at `at` of the box, each in its module's slot: the ones on where the box is. What
 * each says is handed to `onSaid`, by the control, so the gear can say it with its menu shut.
 */
export function ComposerControls({ at, box, onSaid }: { at: ViewPlaces['composer.control']['entry']['at']; box: ControlBox; onSaid?: ((key: string, said: UiControlSaid | undefined) => void) | undefined }) {
  const views = useViewsAt('composer.control', box.projectId).filter(view => view.at === at)
  const projectId = box.projectId === SESSIONS_ID ? undefined : box.projectId
  return (
    <>
      {views.map(view => {
        const key = `${view.package}/${view.id}`
        const props: UiComposerControlProps = {
          in: box.in,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(box.agentId !== undefined ? { agentId: box.agentId } : {}),
          options: box.options,
          ...(box.recorded !== undefined ? { recorded: box.recorded } : {}),
          onChange: box.onChange,
          busy: box.busy,
          ...(box.pickProject ? { pickProject: box.pickProject } : {}),
          say: said => onSaid?.(key, said),
        }
        return (
          <ModuleSlot key={key} package={view.package} label="message box control">
            <ControlView View={view.View} props={props} onGone={() => onSaid?.(key, undefined)} />
          </ModuleSlot>
        )
      })}
    </>
  )
}

/** One control, which takes back what it said when it goes. */
function ControlView({ View, props, onGone }: { View: React.ComponentType<UiComposerControlProps>; props: UiComposerControlProps; onGone: () => void }) {
  const gone = useRef(onGone)
  gone.current = onGone
  useEffect(() => () => gone.current(), [])
  return <View {...props} />
}

/** What the controls of a box said, kept by the control, and how a control says it: for the gear's hover and its colour. */
export function useControlsSaid(resetKey: unknown): { said: ControlsSaid; onSaid: (key: string, said: UiControlSaid | undefined) => void } {
  const [said, setSaid] = useState<ControlsSaid>({})
  useEffect(() => setSaid({}), [resetKey])
  const onSaid = useMemo(
    () => (key: string, next: UiControlSaid | undefined) =>
      setSaid(was => {
        const before = was[key]
        if (next === undefined ? before === undefined : before !== undefined && before.words === next.words && before.warn === next.warn) return was
        const { [key]: _gone, ...rest } = was
        return next === undefined ? rest : { ...rest, [key]: next }
      }),
    [],
  )
  return { said, onSaid }
}

/** An action offered now, as a place draws it. */
export interface Offered<P extends ActionPlace> {
  key: string
  action: MountedAction<P>
  offer: UiOffer
}

/** What each place last offered for each `on`, for this page's life. */
const lastOffered = new Map<string, readonly unknown[]>()

/**
 * What the actions at `place` offer now for `on`, in the place's order (`rank`, else the action's
 * `order`): asked again whenever `on` or `again` changes, and after one of them ran. `null` until
 * the first answer. An action that says nothing of itself is offered as it is declared; one whose
 * question fails is not offered. What was last offered for the same `on` stands meanwhile: going
 * back to a session draws its next step at once rather than after the modules answer again.
 */
export function useOffers<P extends ActionPlace>(place: P, on: ActionPlaces[P] | null, projectId: string | undefined, again: unknown = 0): { offers: Offered<P>[] | null; reask: () => void } {
  const actions = (useMountedModules().actions[place] as MountedAction<P>[]).filter(action => onIn(action, projectId))
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const [asked, setAsked] = useState(0)
  const onKey = JSON.stringify(on)
  const actionsKey = actions.map(action => `${action.package}/${action.id}`).join('\n')
  const known = `${place}\n${onKey}\n${actionsKey}`
  const [offers, setOffers] = useState<Offered<P>[] | null>(() => (lastOffered.get(known) as Offered<P>[] | undefined) ?? null)
  // Another `on`: what was last offered for it, until the modules answer.
  const [shownFor, setShownFor] = useState(known)
  if (shownFor !== known) {
    setShownFor(known)
    setOffers((lastOffered.get(known) as Offered<P>[] | undefined) ?? null)
  }
  useEffect(() => {
    if (on === null) return setOffers(null)
    let live = true
    void Promise.all(
      actions.map(async (action): Promise<Offered<P> | undefined> => {
        const host = moduleHost({ ...services, package: action.package })
        try {
          const offer = action.offer ? await action.offer(host as never, on as never) : {}
          return offer ? { key: `${action.package}/${action.id}`, action, offer } : undefined
        } catch {
          return undefined
        }
      }),
    ).then(answers => {
      if (!live) return
      const offered = answers.filter((answer): answer is Offered<P> => answer !== undefined)
      offered.sort((a, b) => (a.offer.rank ?? a.action.order ?? DEFAULT_ORDER) - (b.offer.rank ?? b.action.order ?? DEFAULT_ORDER) || a.action.package.localeCompare(b.action.package))
      lastOffered.set(known, offered)
      setOffers(offered)
    })
    return () => {
      live = false
    }
    // `on` by its value, the actions by their keys: a new object of the same thing asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onKey, actionsKey, services, asked, again])
  const reask = useCallback(() => setAsked(n => n + 1), [])
  return { offers, reask }
}

/** Run an offered action: its link, its dialog, or its run, asked first when it asks to be. `overlay` is drawn where it outlives a menu that closed. */
export function useRunOffer<P extends ActionPlace>(on: ActionPlaces[P] | null, done: (offered: Offered<P>, result: UiActionResult) => void): { press: (offered: Offered<P>) => void; pending: string | null; overlay: ReactNode } {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const [pending, setPending] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Offered<P> | null>(null)
  const [dialog, setDialog] = useState<Offered<P> | null>(null)
  const run = async (offered: Offered<P>): Promise<UiActionResult> => {
    if (on === null || !offered.action.run) return { ok: true }
    setPending(offered.key)
    const host = moduleHost({ ...services, package: offered.action.package })
    const result: UiActionResult = await offered.action.run(host as never, on as never).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    setPending(null)
    done(offered, result)
    return result
  }
  const press = (offered: Offered<P>) => {
    if (pending !== null || offered.offer.noteOnly) return
    if (offered.offer.href !== undefined) return void window.open(offered.offer.href, '_blank', 'noreferrer')
    if (offered.action.Dialog) return setDialog(offered)
    if (offered.offer.confirm) return setConfirming(offered)
    void run(offered)
  }
  const Dialog = dialog?.action.Dialog as React.ComponentType<{ on: ActionPlaces[P]; onDone(result?: UiActionResult): void }> | undefined
  const confirm = confirming?.offer.confirm
  const overlay = (
    <>
      {confirming && confirm && (
        <ConfirmDialog
          open
          onOpenChange={open => {
            if (!open) setConfirming(null)
          }}
          title={confirm.title}
          body={confirm.description ?? ''}
          confirmLabel={confirm.confirmLabel}
          {...(confirming.action.busyLabel !== undefined ? { confirmBusyLabel: confirming.action.busyLabel } : {})}
          destructive={confirm.danger === true}
          // A refusal keeps the dialog open with its words.
          onConfirm={() => run(confirming)}
        />
      )}
      {dialog && Dialog && on !== null && (
        <ModuleSlot package={dialog.action.package} label={`${dialog.action.label} dialog`}>
          <Dialog
            on={on}
            onDone={result => {
              const offered = dialog
              setDialog(null)
              done(offered, result ?? { ok: true })
            }}
          />
        </ModuleSlot>
      )}
    </>
  )
  return { press, pending, overlay }
}

/**
 * The actions at a menu's place offered now: `items`, for the menu the caller draws, asked again
 * when `open` turns true; `overlay`, the dialogs and the confirmations they open, which the caller
 * draws beside the menu, so they outlive it once it closes.
 */
export function useMenuActions<P extends 'chat.menu' | 'project.menu' | 'person.menu'>(
  place: P,
  on: ActionPlaces[P] | null,
  projectId: string | undefined,
  open: boolean,
  onDone?: (result: UiActionResult) => void,
): { items: ReactNode; overlay: ReactNode; offered: number } {
  const [opened, setOpened] = useState(0)
  useEffect(() => {
    if (open) setOpened(n => n + 1)
  }, [open])
  const { offers, reask } = useOffers(place, on, projectId, opened)
  const { press, pending, overlay } = useRunOffer<P>(on, (_offered, result) => {
    reask()
    onDone?.(result)
  })
  const items = (offers ?? []).filter(offered => !offered.offer.noteOnly).map(offered => {
    const Icon = offered.action.icon
    const label = pending === offered.key && offered.action.busyLabel ? offered.action.busyLabel : (offered.offer.label ?? offered.action.label)
    return (
      <DropdownMenuItem key={offered.key} disabled={pending !== null} onClick={() => press(offered)} {...(offered.offer.title !== undefined ? { title: offered.offer.title } : {})} className={offered.offer.danger ? 'text-danger' : undefined}>
        {pending === offered.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
        <span className="flex-1">{label}</span>
        {/* What it says beside it, at the item's right: a checkout's size on disk. */}
        {offered.offer.note !== undefined && <span className="ml-auto pl-3 text-xs text-muted-foreground">{offered.offer.note}</span>}
      </DropdownMenuItem>
    )
  })
  return { items, overlay, offered: items.length }
}

/**
 * The places that show a repo's next step, by the run and the repo: the Activity panel's row and
 * the line above the box show the same one, and a press in one changes what the other offers.
 */
const stepShown = new Map<string, Set<() => void>>()

/** The row's press, as Claude Code's Create PR: grey, 24 high, its words at 13px. Busy, it stays focusable. */
const NEXT_STEP_CLASS = 'h-6 rounded-md bg-foreground/10 text-xs font-normal hover:bg-foreground/15 aria-disabled:pointer-events-none aria-disabled:opacity-50'

/**
 * The next step of an ended run's work, in the bar above its message box (`chat.handoff`): what
 * the modules offer now for the run's checkout, or for one of its copies (`repo`). The words they
 * say beside it first, then the first press; its arrow lists them all, the first too, as Claude
 * Code's Create PR does, a line above the first that loses something; what the last press did
 * is said until the work moves on. In the Activity panel's one-line rows the words beside the press
 * are its hover instead. Asked again when `again` changes (the run's work moved).
 */
export function HandoffOffers({ projectId, agentId, repo, again }: { projectId: string; agentId: string; repo?: string | undefined; again?: unknown }) {
  const on = useMemo(() => ({ projectId, agentId, ...(repo !== undefined ? { repo } : {}) }), [projectId, agentId, repo])
  const { offers, reask } = useOffers('chat.handoff', on, projectId, again)
  const [said, setSaid] = useState<{ text: string; error: boolean } | null>(null)
  useEffect(() => setSaid(null), [again, agentId, repo])
  // Every place showing this repo's step asks again after a press in any of them.
  const shownAs = `${projectId}\n${agentId}\n${repo ?? ''}`
  useEffect(() => {
    const places = stepShown.get(shownAs) ?? new Set<() => void>()
    stepShown.set(shownAs, places)
    places.add(reask)
    return () => {
      places.delete(reask)
      if (places.size === 0) stepShown.delete(shownAs)
    }
  }, [shownAs, reask])
  const { press, pending, overlay } = useRunOffer<'chat.handoff'>(on, (_offered, result) => {
    setSaid(result.ok ? (result.said !== undefined ? { text: result.said, error: false } : null) : { text: result.error, error: true })
    for (const again of stepShown.get(shownAs) ?? []) again()
  })
  const down = useContext(DaemonDown)
  const inPanel = useContext(WorkRowPlace) === 'activity'
  const offered = offers ?? []
  const notes = offered.filter(each => each.offer.note !== undefined)
  const [first, ...more] = offered.filter(each => !each.offer.noteOnly)
  // In the panel, what the bar says beside the press is its hover, after its own.
  const hover = [first?.offer.title, ...(inPanel ? notes.map(each => each.offer.note) : [])].filter(Boolean).join('\n') || undefined
  const labelOf = (each: Offered<'chat.handoff'>) => (pending === each.key && each.action.busyLabel ? each.action.busyLabel : (each.offer.label ?? each.action.label))
  const step = { disabled: down, 'aria-disabled': pending !== null || undefined }
  return (
    <>
      {said && (
        <span role={said.error ? 'alert' : 'status'} title={said.text} className={cn('min-w-0 truncate text-xs', said.error ? 'text-danger' : 'text-muted-foreground')}>
          {said.text}
        </span>
      )}
      {!said &&
        !inPanel &&
        notes.map(each => (
          <span key={`${each.key}:note`} className="min-w-0 truncate text-xs text-muted-foreground" {...(each.offer.title !== undefined ? { title: each.offer.title } : {})}>
            {each.offer.note}
          </span>
        ))}
      {first && (
        <ButtonGroup>
          <Button size="sm" variant="ghost" className={cn(NEXT_STEP_CLASS, 'min-w-18 justify-center px-3', first.offer.danger && 'text-danger')} data-next-step {...step} {...(hover !== undefined ? { title: hover } : {})} onClick={() => press(first)}>
            {pending === first.key && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {labelOf(first)}
          </Button>
          {more.length > 0 && (
            <>
              <ButtonGroupSeparator className="bg-border opacity-100" />
              <DropdownMenu>
                <DropdownMenuTrigger type="button" aria-label="Other choices" {...step} className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), NEXT_STEP_CLASS, 'px-1 data-[popup-open]:bg-foreground/15')}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[10rem]">
                  {[first, ...more].map((each, at, all) => {
                    const Icon = each.action.icon
                    return (
                      <Fragment key={each.key}>
                        {each.offer.danger && at > 0 && !all[at - 1]!.offer.danger && <DropdownMenuSeparator />}
                        <DropdownMenuItem onClick={() => press(each)} className={each.offer.danger ? 'text-danger' : undefined} {...(each.offer.title !== undefined ? { title: each.offer.title } : {})}>
                          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
                          {labelOf(each)}
                        </DropdownMenuItem>
                      </Fragment>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </ButtonGroup>
      )}
      {overlay}
    </>
  )
}
