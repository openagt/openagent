import { useContext, useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { moduleHost, type LinkActionResult, type ModuleLink } from '../module/index.js'
import { useMountedModules, type MountedLinkAction } from '../lib/use-modules.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { Button, type ButtonProps } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// The slot for the actions the installed modules offer on links (#1774 Q3). A page that shows
// something as a link — a ticket, a plan to write — renders this beside it, and every module whose
// package the link's project has puts its verb here: the queue module's "Add to queue", say. The
// page names no module, the module names no ticket; the dashboard, which installed both, puts the
// two together. A project without such a package shows nothing here at all.

/** The links one project's worth of a click acts on. */
export interface ProjectLinks {
  projectId: string
  links: ModuleLink[]
}

/** The links a click acts on: known up front, or resolved at click time (a page that first reads what is already there). */
export type LinkTargets = ProjectLinks[] | (() => Promise<ProjectLinks[]>)

/** One action the installed modules offer on links here, as a menu or a button offers it. */
export interface LinkActionOffer {
  /** Stable per action, for keys and for remembering which one is done. */
  key: string
  /** The module's verb: "Add to queue". */
  label: string
  /** What the action says once done: "Queued". */
  doneLabel?: string | undefined
  icon?: MountedLinkAction['icon']
}

/**
 * The actions the installed modules offer on links in `projects`, and a way to run one on a set
 * of links: for a surface that offers them as items of its own menu, not as {@link LinkActions}'
 * buttons. Each project in `targets` that has the action's package is handed its links, in order,
 * until one fails.
 */
export function useLinkActions(projects: readonly string[]): { actions: LinkActionOffer[]; run: (key: string, targets: LinkTargets) => Promise<LinkActionResult> } {
  const { linkActions } = useMountedModules()
  const services = useContext(HostServicesContext)
  const mounted = linkActions.filter(action => projects.some(id => action.projects.includes(id)))
  const keyOf = (action: MountedLinkAction) => `${action.package}\n${action.label}`
  const actions = mounted.map(action => ({ key: keyOf(action), label: action.label, doneLabel: action.doneLabel, icon: action.icon }))
  const run = async (key: string, targets: LinkTargets): Promise<LinkActionResult> => {
    const action = mounted.find(candidate => keyOf(candidate) === key)
    if (!action) return { ok: false, error: 'That action is no longer offered here.' }
    let result: LinkActionResult = { ok: true }
    try {
      const groups = typeof targets === 'function' ? await targets() : targets
      // An action acts: its commands are marked so, and the dashboard reads back what they wrote at once.
      const host = moduleHost({ ...(services ?? INERT_HOST_SERVICES), package: action.package }, { acts: true })
      // One project at a time, in the order given, only those that have the action's package;
      // the first failure ends the batch with its reason.
      for (const { projectId, links } of groups) {
        if (!action.projects.includes(projectId) || links.length === 0) continue
        result = await action.run(host, projectId, links)
        if (!result.ok) break
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    return result
  }
  return { actions, run }
}

export function LinkActions({
  projects,
  targets,
  resetKey,
  label,
  tooltip,
  disabled = false,
  size = 'sm',
  variant = 'outline',
}: {
  /** The projects the links belong to: an action shows when its package is in at least one of them. */
  projects: readonly string[]
  /** What a click acts on, grouped by project. */
  targets: LinkTargets
  /** A done button rests until this changes: the identity of the set it acted on. Defaults to the projects. */
  resetKey?: string
  /** The button's text for an action; the action's own label otherwise. */
  label?: (action: LinkActionOffer) => string
  /** Shown on hover, the same for every action. */
  tooltip?: ReactNode
  disabled?: boolean
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}) {
  const { actions, run: runAction } = useLinkActions(projects)
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // A change of the set arms every rested button again: it is a new set to act on.
  const key = resetKey ?? projects.join('\n')
  useEffect(() => {
    setDone(new Set())
    setError(null)
  }, [key])

  const run = async (action: LinkActionOffer) => {
    if (running !== null) return
    setRunning(action.key)
    setError(null)
    const result = await runAction(action.key, targets)
    setRunning(null)
    if (result.ok) setDone(prev => new Set(prev).add(action.key))
    else setError(result.error)
  }

  if (actions.length === 0) return null
  return (
    <>
      {actions.map(action => {
        const Icon = action.icon
        const rested = done.has(action.key)
        const content = rested ? (
          <>
            <Check className="h-3.5 w-3.5" aria-hidden /> <span className="max-md:min-w-0 max-md:truncate">{action.doneLabel ?? action.label}</span>
          </>
        ) : (
          <>
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
            <span className="max-md:min-w-0 max-md:truncate">{label ? label(action) : action.label}</span>
          </>
        )
        const props: ButtonProps = {
          variant,
          size,
          // On a phone the button gives up width, and its words are cut with an ellipsis.
          className: 'gap-1.5 md:shrink-0 max-md:min-w-0',
          disabled: disabled || running !== null || rested,
          onClick: () => void run(action),
        }
        return tooltip ? (
          <Tooltip key={action.key}>
            <TooltipTrigger render={<Button {...props} />}>{content}</TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Button key={action.key} {...props}>
            {content}
          </Button>
        )
      })}
      {error && (
        <p role="alert" className="basis-full text-xs text-danger">
          {error}
        </p>
      )}
    </>
  )
}
