import { useContext } from 'react'
import { Check, Puzzle, Settings2 } from 'lucide-react'
import type { Profile } from '../rpc/profiles.js'
import { onProjectSkillNames, onSkillChoices, type SkillChoices } from '../rpc/skill-choices.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { pluginsAgain } from '../lib/plugins-switched.js'
import { inWords } from '../lib/in-words.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { RowChevron, RowSaid, rowButtonClass, rowWideClass } from './ui/row-item.js'
import { useProfilesList } from './ProfilesPage.js'
import { PLUGINS_ENTRY } from './PluginsSettings.js'
import { DEFAULT_PROFILE } from '../../src/client.js'
import { SESSIONS_ID } from '../../src/project-address.js'
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
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js'

// The "Skills" menu under the launcher's box (the session's picks): what the session gets, for
// this session alone, as the account beside it is picked. The plugins on in the project that give
// its runs something, each ticked, tickable off: the session goes without it, so it gets none of
// its skills nor its steps; then the project's own skills, all, none or each; both as its profile
// has them until the session picks. Then the project's plugins and its skills in Settings. The
// picks go with the Start in the run's environment and its record keeps them, so a resume applies
// them again. The pick is not saved: the next session starts from its profile's. A session with no
// project has no project skills. The skills module's own control under the box, once the box has
// places for them (#2394).

/** Settings › Skills, the skills module's entry: each project's own skills, listed. */
const SKILLS_SETTINGS = 'skills'

/** The session's picks: the plugins it goes without, which of the project's own skills stay (absent: every one). */
export interface SkillPicks {
  without: string[]
  project?: 'none' | string[]
}

export const NO_PICKS: SkillPicks = { without: [] }

/** The picks a session starts from on its profile: every plugin on but the ones it leaves out, and the project skills it names (the session still overrides). */
export function profilePicks(profile: Pick<Profile, 'options'> | undefined): SkillPicks {
  const without = profile?.options.plugins?.without ?? []
  const project = profile?.options.skills?.project
  return { without: [...without], ...(project !== undefined && project !== 'all' ? { project } : {}) }
}

/** The skills the session gets of its modules': the core modules', then those of each plugin it does not go without. */
export function sessionSkills(choices: SkillChoices, without: readonly string[]): string[] {
  return [...choices.core, ...choices.plugins.filter(plugin => !without.includes(plugin.name)).flatMap(plugin => plugin.skills)]
}

/** The project's skills the session gets, among the ones it holds. */
function projectKept(held: readonly string[], project: 'all' | 'none' | readonly string[] | undefined): string[] {
  return project === undefined || project === 'all' ? [...held] : project === 'none' ? [] : held.filter(name => project.includes(name))
}

/** How many skills the session gets: a project skill of the same name takes the place of a module's, so the session has it once. */
function skillCount(own: readonly string[], kept: readonly string[]): number {
  return new Set([...own, ...kept]).size
}

/** What the session's picks say, in a few words for a hover: the plugins it goes without, and which project skills it gets. */
export function skillPicksSaid(picks: { pluginsWithout?: readonly string[] | undefined; projectSkills?: 'all' | 'none' | readonly string[] | undefined }): string {
  const own = `the skills of every plugin on${picks.pluginsWithout?.length ? ` but ${inWords(picks.pluginsWithout)}` : ''}`
  const project = picks.projectSkills === undefined || picks.projectSkills === 'all' ? 'every project skill' : picks.projectSkills === 'none' ? 'no project skill' : `the project skills ${inWords(picks.projectSkills)}`
  return `${own}, and ${project}`
}

/** How often the plugins to pick from are read again, besides at once when one is switched in Settings. */
const CHOICES_MS = 30_000

/** The plugins a session in the project picks from (none: a session with no project), kept in this browser so the menu and its count land whole. */
export function useSkillChoices(projectId: string | undefined): SkillChoices | null | undefined {
  const id = projectId ?? SESSIONS_ID
  return usePolled<SkillChoices | null | undefined>(() => onSkillChoices(id), undefined, CHOICES_MS, [id], { remember: `skill-choices:${id}`, stored: true }, pluginsAgain).value
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
  const choices = useSkillChoices(projectId)
  const project = useProjectSkills(projectId)
  const held = project ?? []
  if (!choices) return null
  // Counted only once the project's skills are read: a count of the others alone would be drawn, then change. Till
  // then the item holds its place, a digit's room kept for the count, so nothing after it moves when it lands.
  const reading = projectId !== undefined && project === null
  const kept = projectKept(held, picks.project)
  const count = skillCount(sessionSkills(choices, picks.without), projectId !== undefined ? kept : [])
  const togglePlugin = (name: string) => onChange({ ...picks, without: picks.without.includes(name) ? picks.without.filter(one => one !== name) : [...picks.without, name] })
  const toggleProject = (name: string) => {
    const next = kept.includes(name) ? kept.filter(one => one !== name) : [...held.filter(one => one === name || kept.includes(one))]
    const { project: _all, ...rest } = picks
    onChange(next.length === held.length ? rest : { ...rest, project: next.length === 0 ? 'none' : next })
  }
  const said = `This session gets ${skillPicksSaid({ pluginsWithout: picks.without.filter(name => choices.plugins.some(plugin => plugin.name === name)), ...(projectId !== undefined ? { projectSkills: picks.project } : { projectSkills: 'none' }) })}`
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
          <DropdownMenuLabel>Plugins, this session</DropdownMenuLabel>
          {choices.plugins.length === 0 ? (
            <DropdownMenuItem disabled>
              <span className="text-muted-foreground">None on</span>
            </DropdownMenuItem>
          ) : (
            choices.plugins.map(plugin => (
              <DropdownMenuCheckboxItem key={plugin.name} checked={!picks.without.includes(plugin.name)} onCheckedChange={() => togglePlugin(plugin.name)}>
                <span className="truncate">{plugin.name}</span>
              </DropdownMenuCheckboxItem>
            ))
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
                    onValueChange={(pick: 'all' | 'none') => onChange(pick === 'all' ? { without: picks.without } : { ...picks, project: 'none' })}
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
            <DropdownMenuItem onClick={() => services.openSettings(PLUGINS_ENTRY, projectId)}>
              <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              Plugins in Settings…
            </DropdownMenuItem>
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
 * picks it started with, counted as the launcher counts them, which their hover says as its record
 * keeps them; as its profile has them where the session picked none. Drawn once the plugins to pick
 * from, the profiles and the project's skills are read, so the count lands whole.
 */
export function SkillsOff({ projectId, profile, pluginsWithout, projectSkills }: { projectId: string | undefined; profile: string | undefined; pluginsWithout?: string[] | undefined; projectSkills?: 'all' | 'none' | string[] | undefined }) {
  const choices = useSkillChoices(projectId)
  const { view } = useProfilesList()
  const project = useProjectSkills(projectId)
  if (!choices || !view || (projectId !== undefined && project === null)) return null
  const on = view.profiles.find(one => one.id === (profile ?? DEFAULT_PROFILE))?.options
  const without = pluginsWithout ?? on?.plugins?.without ?? []
  const got = projectSkills ?? on?.skills?.project
  const count = skillCount(sessionSkills(choices, without), projectId !== undefined ? projectKept(project ?? [], got) : [])
  return (
    <RowSaid tip={`This session got ${skillPicksSaid({ pluginsWithout: without, projectSkills: projectId === undefined ? 'none' : got })}`}>
      <Puzzle className="size-4 shrink-0" aria-hidden />
      <span className="truncate">
        <span className={rowWideClass}>Skills: </span>
        {count}
      </span>
    </RowSaid>
  )
}
