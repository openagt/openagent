import { useContext } from 'react'
import { Check, Puzzle, Settings2 } from 'lucide-react'
import type { Preset } from '../rpc/presets.js'
import { onProjectSkillNames, onSkillChoices, type SkillChoices } from '../rpc/skill-choices.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { RowChevron, RowSaid, rowButtonClass, rowWideClass } from './ui/row-item.js'
import { usePresetsList } from './PresetsPage.js'
import { DEFAULT_PRESET } from '../../src/client.js'
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

// The "Skills" menu under the launcher's box (the session's picks): what the session gets, for
// this session alone, as the account beside it is picked. The skills every run gets ticked, each
// one tickable off; every other skill OpenAgent carries under "More skills", in its groups,
// tickable on; then the project's own skills, all, none or each, as its preset has them until the
// session picks; then the project's skills in Settings, what each one says it does. The picks go
// with the Start in the run's environment and its record keeps them, so a resume applies them
// again. The pick is not saved: the next session starts from the skills every run gets and its
// preset's project skills. A session with no project has no project skills. The skills module's
// own control under the box, once the box has places for them (#2394).

/** Settings › Skills, the skills module's entry: each project's own skills, listed. */
const SKILLS_SETTINGS = 'skills'

/** The session's picks: skills on top of the ones every run gets, ones of those left out, which of the project's own stay (absent: every one). */
export interface SkillPicks {
  on: string[]
  off: string[]
  project?: 'none' | string[]
}

export const NO_PICKS: SkillPicks = { on: [], off: [] }

/** The picks a session starts from on its preset: none, or the project skills the preset names (the session still overrides). */
export function presetPicks(preset: Pick<Preset, 'options'> | undefined): SkillPicks {
  const project = preset?.options.skills?.project
  return project === undefined || project === 'all' ? NO_PICKS : { on: [], off: [], project }
}

/** The names of the skills the session gets of the ones every run gets: those less the ones off, then the ones on. */
export function sessionSkills(everyRun: readonly string[], picks: Pick<SkillPicks, 'on' | 'off'>): string[] {
  return [...everyRun.filter(name => !picks.off.includes(name)), ...picks.on.filter(name => !everyRun.includes(name))]
}

/** The project's skills the session gets, among the ones it holds. */
function projectKept(held: readonly string[], project: 'all' | 'none' | readonly string[] | undefined): string[] {
  return project === undefined || project === 'all' ? [...held] : project === 'none' ? [] : held.filter(name => project.includes(name))
}

/** How many skills the session gets: a project skill of the same name takes the place of one every run gets, so the session has it once. */
function skillCount(own: readonly string[], kept: readonly string[]): number {
  return new Set([...own, ...kept]).size
}

/** What the session's picks say, in a few words for a hover: what differs from the skills every run gets and from every project skill. */
export function skillPicksSaid(picks: { skillsOn?: readonly string[] | undefined; skillsOff?: readonly string[] | undefined; projectSkills?: 'all' | 'none' | readonly string[] | undefined }): string {
  const parts = [
    ...(picks.skillsOn?.length ? [`with ${picks.skillsOn.join(', ')}`] : []),
    ...(picks.skillsOff?.length ? [`without ${picks.skillsOff.join(', ')}`] : []),
  ]
  const own = `the skills every run gets${parts.length > 0 ? ` ${parts.join(', ')}` : ''}`
  const project = picks.projectSkills === undefined || picks.projectSkills === 'all' ? 'every project skill' : picks.projectSkills === 'none' ? 'no project skill' : `the project skills ${picks.projectSkills.join(', ')}`
  return `${own}, and ${project}`
}

/** How often the skills to pick from are read again: they are the distribution's, which changes only with OpenAgent. */
const CHOICES_MS = 5 * 60_000

/** The skills a session picks from, kept in this browser so the menu and its count land whole. */
export function useSkillChoices(): SkillChoices | undefined {
  return usePolled<SkillChoices | undefined>(onSkillChoices, undefined, CHOICES_MS, [], { remember: 'skill-choices', stored: true }).value
}

/**
 * The project's own skills, by name, as a run's checkout has them, kept in this browser: the Skills
 * item counts them, and counted from the last load it holds its place in the row from the first frame.
 */
function useProjectSkills(projectId: string | undefined): string[] | null {
  return useLoaded(projectId !== undefined ? () => onProjectSkillNames(projectId) : null, null, [projectId], projectId !== undefined ? { remember: `project-skill-names:${projectId}`, stored: true } : undefined)
}

export function SkillsMenu({
  projectId,
  picks,
  onChange,
  busy,
}: {
  /** The project, for its own skills and their list in Settings; none for a session with no project. */
  projectId: string | undefined
  picks: SkillPicks
  onChange: (picks: SkillPicks) => void
  busy: boolean
}) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const choices = useSkillChoices()
  const project = useProjectSkills(projectId)
  const held = project ?? []
  if (!choices) return null
  // Counted only once the project's skills are read: a count of the others alone would be drawn, then change. Till
  // then the item holds its place, a digit's room kept for the count, so nothing after it moves when it lands.
  const reading = projectId !== undefined && project === null
  const own = choices.everyRun.map(skill => skill.name)
  const gets = sessionSkills(own, picks)
  const listed = [...own, ...picks.on.filter(name => !own.includes(name))]
  const kept = projectKept(held, picks.project)
  const count = skillCount(gets, projectId !== undefined ? kept : [])
  const toggleListed = (name: string) => {
    if (own.includes(name)) onChange({ ...picks, off: picks.off.includes(name) ? picks.off.filter(one => one !== name) : [...picks.off, name] })
    else onChange({ ...picks, on: picks.on.filter(one => one !== name) })
  }
  const toggleProject = (name: string) => {
    const next = kept.includes(name) ? kept.filter(one => one !== name) : [...held.filter(one => one === name || kept.includes(one))]
    const { project: _all, ...rest } = picks
    onChange(next.length === held.length ? rest : { ...rest, project: next.length === 0 ? 'none' : next })
  }
  const more = choices.more.map(group => ({ title: group.title, skills: group.skills.filter(skill => !listed.includes(skill.name)) })).filter(group => group.skills.length > 0)
  const said = `This session gets ${skillPicksSaid({ skillsOn: picks.on, skillsOff: picks.off, ...(projectId !== undefined ? { projectSkills: picks.project } : { projectSkills: 'none' }) })}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy || reading} aria-label={reading ? 'Skills' : `Skills: ${count}`} className={rowButtonClass} />}>
          <Puzzle className="size-4 shrink-0" aria-hidden />
          <span className="truncate tabular-nums">
            <span className={rowWideClass}>Skills: </span>
            {reading ? <span className="before:invisible before:content-['0']" /> : count}
          </span>
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[16rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Skills, this session</DropdownMenuLabel>
          {listed.map(name => (
            <DropdownMenuCheckboxItem key={name} checked={gets.includes(name)} onCheckedChange={() => toggleListed(name)}>
              <span className="truncate">{name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {more.length > 0 && (
            <DropdownMenuSub>
              {/* On the skills' own text edge: a name, as theirs are, with no mark before it. */}
              <DropdownMenuSubTrigger>
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
                  <span className="text-muted-foreground">None yet</span>
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuRadioGroup
                    value={picks.project === undefined ? 'all' : picks.project === 'none' ? 'none' : null}
                    onValueChange={(pick: 'all' | 'none') => onChange(pick === 'all' ? { on: picks.on, off: picks.off } : { ...picks, project: 'none' })}
                  >
                    {/* Marked at the right, in the one column every skill's tick stands in. */}
                    <DropdownMenuRadioItem value="all" closeOnClick={false}>
                      All
                      <span className="ml-auto flex size-4 shrink-0 items-center justify-center">{picks.project === undefined && <Check className="size-4" aria-hidden />}</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="none" closeOnClick={false}>
                      None
                      <span className="ml-auto flex size-4 shrink-0 items-center justify-center">{picks.project === 'none' && <Check className="size-4" aria-hidden />}</span>
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
            <DropdownMenuItem onClick={() => services.openSettings(SKILLS_SETTINGS, projectId)}>
              <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              Project skills in Settings…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The session page's "Skills", in the launcher's place, as words, not a press: a session keeps the
 * skills it started with, counted as the launcher counts them, which their hover says as its record
 * keeps them; the project's own as its preset has them where the session picked none. Drawn once
 * the skills to pick from, the presets and the project's skills are read, so the count lands whole.
 */
export function SkillsOff({ projectId, preset, skillsOn, skillsOff, projectSkills }: { projectId: string | undefined; preset: string | undefined; skillsOn?: string[] | undefined; skillsOff?: string[] | undefined; projectSkills?: 'all' | 'none' | string[] | undefined }) {
  const choices = useSkillChoices()
  const { view } = usePresetsList()
  const project = useProjectSkills(projectId)
  if (!choices || !view || (projectId !== undefined && project === null)) return null
  const got = projectSkills ?? view.presets.find(one => one.id === (preset ?? DEFAULT_PRESET))?.options.skills?.project
  const count = skillCount(sessionSkills(choices.everyRun.map(skill => skill.name), { on: skillsOn ?? [], off: skillsOff ?? [] }), projectId !== undefined ? projectKept(project ?? [], got) : [])
  return (
    <RowSaid tip={`This session got ${skillPicksSaid({ skillsOn, skillsOff, projectSkills: projectId === undefined ? 'none' : got })}`}>
      <Puzzle className="size-4 shrink-0" aria-hidden />
      <span className="truncate">
        <span className={rowWideClass}>Skills: </span>
        {count}
      </span>
    </RowSaid>
  )
}
