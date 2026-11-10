import { Check, ChevronDown, Puzzle, Settings2 } from 'lucide-react'
import type { AgentRecord, AgentsView } from '../rpc/agents.js'
import { onProjectSkills } from '../rpc/skills.js'
import { useLoaded } from '../lib/use-async.js'
import { openSettings } from '../lib/use-route.js'
import { cn } from '../lib/utils.js'
import { SKILLS_ENTRY } from './ProjectSkills.js'
import { RowOff, rowButtonClass } from './ui/row-item.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js'

// The "Skills" menu under the launcher's box (Rom's design, the session's picks): what the session
// gets, for this session alone, as the account beside it is picked. Its agent's skills ticked,
// each one tickable off; every other skill OpenAgent carries under "More skills", in the groups
// the Agents page has, tickable on; then the project's own skills, all, none or each; then the
// project's Skills page. The picks go with the Start in the run's environment and its record
// keeps them, so a resume applies them again. The pick is not saved: the next session starts
// from its agent's list and every project skill. A session with no project has no project skills.

/** The session's picks: skills on top of its agent's, skills of its agent's left out, which of the project's own stay (absent: every one). */
export interface SkillPicks {
  on: string[]
  off: string[]
  project?: 'none' | string[]
}

export const NO_PICKS: SkillPicks = { on: [], off: [] }

/** The picks a session starts from on its agent: none, or no project skill for an agent set to never pick them up (the session still overrides). */
export function agentPicks(agent: Pick<AgentRecord, 'projectSkills'> | undefined): SkillPicks {
  return agent?.projectSkills === false ? { on: [], off: [], project: 'none' } : NO_PICKS
}

/** The names of the skills the session gets of its agent's and the picks: the agent's less the ones off, then the ones on. */
export function sessionSkills(agent: Pick<AgentRecord, 'skills'> | undefined, picks: SkillPicks): string[] {
  const own = agent?.skills ?? []
  return [...own.filter(name => !picks.off.includes(name)), ...picks.on.filter(name => !own.includes(name))]
}

/** The project's skills the session gets, among the ones it holds. */
function projectKept(held: readonly string[], project: SkillPicks['project']): string[] {
  return project === undefined ? [...held] : project === 'none' ? [] : held.filter(name => project.includes(name))
}

/** What the session's picks say, in a few words for a hover: what differs from its agent's list and from every project skill. */
export function skillPicksSaid(picks: { skillsOn?: readonly string[] | undefined; skillsOff?: readonly string[] | undefined; projectSkills?: 'none' | readonly string[] | undefined }): string {
  const parts = [
    ...(picks.skillsOn?.length ? [`with ${picks.skillsOn.join(', ')}`] : []),
    ...(picks.skillsOff?.length ? [`without ${picks.skillsOff.join(', ')}`] : []),
  ]
  const agents = `its agent's skills${parts.length > 0 ? ` ${parts.join(', ')}` : ''}`
  const project = picks.projectSkills === undefined ? 'every project skill' : picks.projectSkills === 'none' ? 'no project skill' : `the project skills ${picks.projectSkills.join(', ')}`
  return `${agents}, and ${project}`
}

export function SkillsMenu({
  projectId,
  agent,
  groups,
  picks,
  onChange,
  busy,
}: {
  /** The project, for its own skills and its Skills page; none for a session with no project. */
  projectId: string | undefined
  /** The agent the session is on, read; nothing until it is. */
  agent: AgentRecord | undefined
  /** Every skill OpenAgent carries, in the Agents page's groups. */
  groups: AgentsView['skills'] | undefined
  picks: SkillPicks
  onChange: (picks: SkillPicks) => void
  busy: boolean
}) {
  // The project's own skills, by name, as a run's checkout has them: the list's and the project's own.
  const project = useLoaded(projectId !== undefined ? () => onProjectSkills(projectId) : null, null, [projectId])
  const held = project?.held ?? []
  if (!agent || !groups) return null
  const own = agent.skills
  const ofAgent = sessionSkills(agent, picks)
  const listed = [...own, ...picks.on.filter(name => !own.includes(name))]
  const kept = projectKept(held, picks.project)
  const count = ofAgent.length + (projectId !== undefined ? kept.length : 0)
  const toggleOfAgent = (name: string) => {
    if (own.includes(name)) onChange({ ...picks, off: picks.off.includes(name) ? picks.off.filter(one => one !== name) : [...picks.off, name] })
    else onChange({ ...picks, on: picks.on.filter(one => one !== name) })
  }
  const toggleProject = (name: string) => {
    const next = kept.includes(name) ? kept.filter(one => one !== name) : [...held.filter(one => one === name || kept.includes(one))]
    const { project: _all, ...rest } = picks
    onChange(next.length === held.length ? rest : { ...rest, project: next.length === 0 ? 'none' : next })
  }
  const more = groups.map(group => ({ title: group.title, skills: group.skills.filter(skill => !listed.includes(skill.name)) })).filter(group => group.skills.length > 0)
  const said = `This session gets ${skillPicksSaid({ skillsOn: picks.on, skillsOff: picks.off, ...(projectId !== undefined ? { projectSkills: picks.project } : { projectSkills: 'none' }) })}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`Skills: ${count}`} className={rowButtonClass} />}>
          <Puzzle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{`Skills: ${count}`}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${agent.name}'s skills, this session`}</DropdownMenuLabel>
          {listed.map(name => (
            <DropdownMenuCheckboxItem key={name} checked={ofAgent.includes(name)} onCheckedChange={() => toggleOfAgent(name)}>
              <span className="truncate">{name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {more.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                More skills
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[14rem]">
                {more.map(group => (
                  <DropdownMenuGroup key={group.title}>
                    <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
                    {group.skills.map(skill => (
                      <DropdownMenuCheckboxItem key={skill.name} checked={false} onCheckedChange={() => onChange({ ...picks, on: [...picks.on, skill.name] })}>
                        <span className="truncate">{skill.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>
        {projectId !== undefined && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Project skills</DropdownMenuLabel>
              {held.length === 0 ? (
                <DropdownMenuItem disabled>
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="text-muted-foreground">None yet</span>
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuRadioGroup
                    value={picks.project === undefined ? 'all' : picks.project === 'none' ? 'none' : null}
                    onValueChange={(pick: 'all' | 'none') => onChange(pick === 'all' ? { on: picks.on, off: picks.off } : { ...picks, project: 'none' })}
                  >
                    <DropdownMenuRadioItem value="all" closeOnClick={false}>
                      <Check className={cn('h-3.5 w-3.5 shrink-0', picks.project === undefined ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      All
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="none" closeOnClick={false}>
                      <Check className={cn('h-3.5 w-3.5 shrink-0', picks.project === 'none' ? 'opacity-100' : 'opacity-0')} aria-hidden />
                      None
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  {held.map(name => (
                    <DropdownMenuCheckboxItem key={name} checked={kept.includes(name)} onCheckedChange={() => toggleProject(name)}>
                      <span className="truncate">{name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openSettings(SKILLS_ENTRY, projectId)}>
              <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              Manage project skills…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The session page's "Skills", in the launcher's place and look, off: a session keeps the skills
 * it started with, which its hover says as its record keeps them.
 */
export function SkillsOff({ skillsOn, skillsOff, projectSkills, noProject = false }: { skillsOn?: string[] | undefined; skillsOff?: string[] | undefined; projectSkills?: 'none' | string[] | undefined; noProject?: boolean }) {
  return (
    <RowOff tip={`This session got ${skillPicksSaid({ skillsOn, skillsOff, projectSkills: noProject ? 'none' : projectSkills })}`}>
      <button type="button" disabled className={rowButtonClass}>
        <Puzzle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">Skills</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>
    </RowOff>
  )
}
