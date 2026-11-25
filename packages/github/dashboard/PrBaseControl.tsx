import { useEffect, useState } from 'react'
import { Check, GitPullRequestArrow } from 'lucide-react'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, SetupLine, SetupSaid, cn, nextRunAgain, useModuleHost, usePolled, type UiComposerControlProps } from '@openagt/ui/module'
import type { RunOptions } from '@openagt/hooks'
import { server } from './calls.js'

// The branch a run's pull request goes into, a line of the gear's menu under the message box
// (`composer.control` at `setup`). A run started from another
// branch than the main one (git-branches' pick, which origin has) opens its request into that
// branch, since that is the work it builds on, unless the person picks the main branch here; the
// pick is the next run's alone (`options.github.prBase`). Drawn only where there are two branches
// to pick from. A session's line says the branch its record keeps; a profile, for any project,
// draws nothing.

/** The run options with github's pull request base set, or taken out. */
function withPrBase(options: RunOptions, branch: string | undefined): RunOptions {
  const { github: was, ...rest } = options
  const { prBase: _old, ...github } = was ?? {}
  const kept = branch !== undefined ? { ...github, prBase: branch } : github
  return Object.keys(kept).length > 0 ? { ...rest, github: kept } : rest
}

export function PrBaseControl(props: UiComposerControlProps) {
  if (props.in === 'profile' || props.projectId === undefined) return <Silent say={props.say} />
  if (props.in === 'session') return <SessionPrBase options={props.options} say={props.say} />
  return <LauncherPrBase {...props} projectId={props.projectId} />
}

function Silent({ say }: Pick<UiComposerControlProps, 'say'>) {
  useEffect(() => say(undefined), [say])
  return null
}

/** The launcher's line: the branch the run starts from, or the main branch. */
function LauncherPrBase({ projectId, options, onChange, busy, say }: UiComposerControlProps & { projectId: string }) {
  const host = useModuleHost()
  // Read again as git-branches' pick of where runs start is saved.
  const target = usePolled(() => server(host).prTarget(projectId, {}), undefined, 60_000, [projectId], { remember: `github:pr-target:${projectId}` }, nextRunAgain).value
  const [toMain, setToMain] = useState(false)
  const start = target?.start
  const shown = start !== undefined && target?.main !== undefined
  const wanted = shown && !toMain ? start : undefined
  const prBase = options.github?.prBase
  // The pick goes with the Start: written into the run's options as the branch or the level changes.
  useEffect(() => {
    if (prBase !== wanted) onChange(withPrBase(options, wanted))
  }, [prBase, wanted, options, onChange])
  const into = shown ? (toMain ? target.main : start) : undefined
  useEffect(() => say(into !== undefined ? { words: `PR into ${into}` } : undefined), [say, into])
  if (!shown || into === undefined) return null
  const picks = [start, target.main!]
  return (
    <SetupLine icon={<GitPullRequestArrow aria-hidden />} label="Pull request into" value={<span className="truncate">{into}</span>} className="min-w-[14rem]" disabled={busy}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>The branch its pull request goes into</DropdownMenuLabel>
        {picks.map(branch => (
          <DropdownMenuItem key={branch} onClick={() => setToMain(branch !== start)}>
            <Check className={cn('h-3.5 w-3.5 shrink-0', branch === into ? 'opacity-100' : 'opacity-0')} aria-hidden />
            <span className="flex-1 truncate">{branch}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </SetupLine>
  )
}

/** A session's line: the branch its record keeps, said and not offered; nothing for a request into the repository's default branch. */
function SessionPrBase({ options, say }: Pick<UiComposerControlProps, 'options' | 'say'>) {
  const into = options.github?.prBase
  useEffect(() => say(into !== undefined ? { words: `PR into ${into}` } : undefined), [say, into])
  if (into === undefined) return null
  return <SetupSaid icon={<GitPullRequestArrow aria-hidden />} label="Pull request into" value={into} tip={`This run's pull request goes into ${into}`} />
}
