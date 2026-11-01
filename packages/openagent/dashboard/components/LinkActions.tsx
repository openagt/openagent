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
  label?: (action: MountedLinkAction) => string
  /** Shown on hover, the same for every action. */
  tooltip?: ReactNode
  disabled?: boolean
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}) {
  const { linkActions } = useMountedModules()
  const services = useContext(HostServicesContext)
  const actions = linkActions.filter(action => projects.some(id => action.projects.includes(id)))
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // A change of the set arms every rested button again: it is a new set to act on.
  const key = resetKey ?? projects.join('\n')
  useEffect(() => {
    setDone(new Set())
    setError(null)
  }, [key])

  const actionKey = (action: MountedLinkAction) => `${action.package}\n${action.label}`

  const run = async (action: MountedLinkAction) => {
    if (running !== null) return
    setRunning(actionKey(action))
    setError(null)
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
    setRunning(null)
    if (result.ok) setDone(prev => new Set(prev).add(actionKey(action)))
    else setError(result.error)
  }

  if (actions.length === 0) return null
  return (
    <>
      {actions.map(action => {
        const Icon = action.icon
        const rested = done.has(actionKey(action))
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
          <Tooltip key={actionKey(action)}>
            <TooltipTrigger render={<Button {...props} />}>{content}</TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Button key={actionKey(action)} {...props}>
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
