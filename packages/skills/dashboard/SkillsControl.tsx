import { useEffect } from 'react'
import { Check, Puzzle, Settings2 } from 'lucide-react'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  SetupLine,
  SetupSaid,
  inWords,
  nextRunAgain,
  pluginsAgain,
  useModuleHost,
  usePolled,
  type ModuleHost,
  type UiComposerControlProps,
} from '@openagt/ui/module'
import { DEFAULT_PROFILE, type RunOptions } from '@openagt/hooks'
import { readSkillChoices, type SkillChoices } from './calls.js'

// The "Skills" line of the gear's menu under the message box (`composer.control` at `setup`), after
// the profile's: what a run gets. The plugins on in the project that give its runs something, each
// ticked, tickable off: the run goes without it, so it gets none of its skills nor its steps; then
// the project's own skills, all, none or each; both as the profile in force has them until a pick
// here. Then the project's plugins and its skills in Settings. The picks are the run's options
// (`plugins.without`, `skills.project`), which its record keeps, so a resume applies them again. In
// the launcher they are the next run's alone: the run after starts from its profile's again. In a
// session they are said as its record keeps them; in a profile's editor they are the profile's own.
// A session with no project, and a profile, which is for any project, name no skill of a project.

/** Which of the project's own skills a run gets: every one when absent. */
type ProjectPick = NonNullable<RunOptions['skills']>['project']

/** What a run's picks are, over what they start from. */
interface Picks {
  without: readonly string[]
  project: ProjectPick | undefined
}

/** The skills a run gets of its modules': the core modules', then those of each plugin it does not go without. */
export function sessionSkills(choices: Pick<SkillChoices, 'core' | 'plugins'>, without: readonly string[]): string[] {
  return [...choices.core, ...choices.plugins.filter(plugin => !without.includes(plugin.name)).flatMap(plugin => plugin.skills)]
}

/** The project's skills a run gets, among the ones it holds. */
function projectKept(held: readonly string[], project: ProjectPick | undefined): string[] {
  return project === undefined || project === 'all' ? [...held] : project === 'none' ? [] : held.filter(name => project.includes(name))
}

/** How many skills a run gets: a project skill of the same name takes the place of a module's, so the run has it once. */
function skillCount(choices: SkillChoices, picks: Picks): number {
  return new Set([...sessionSkills(choices, picks.without), ...projectKept(choices.project, picks.project)]).size
}

/** What a profile says of the project's own skills, in a few words. */
function projectSaid(project: ProjectPick | undefined): string {
  return project === undefined || project === 'all' ? 'every project skill' : project === 'none' ? 'no project skill' : `the project skills ${inWords(project)}`
}

/** What a run's picks say, in a few words for a hover: the plugins it goes without, and which project skills it gets. */
export function skillPicksSaid(picks: Picks): string {
  return `the skills of every plugin on${picks.without.length > 0 ? ` but ${inWords(picks.without)}` : ''}, and ${projectSaid(picks.project)}`
}

/** How often the choices are read again, besides at once when a plugin is switched, or a profile picked for every next run. */
const CHOICES_MS = 30_000

/** Read again when a plugin is switched in Settings, and when a profile is picked for every next run. */
const choicesAgain: typeof pluginsAgain = read => {
  const plugins = pluginsAgain(read)
  const picked = nextRunAgain(read)
  return () => (plugins(), picked())
}

/** What the line picks from, kept in this browser so it and its count land whole from the first frame. */
function useSkillChoices(host: ModuleHost, projectId: string | undefined, input: { profile?: string; every?: boolean }): SkillChoices | undefined {
  const key = `skill-choices:${projectId ?? ''}:${input.profile ?? ''}:${input.every === true}`
  return usePolled<SkillChoices | undefined>(() => readSkillChoices(host, projectId, input), undefined, CHOICES_MS, [key], { remember: key, stored: true }, choicesAgain).value
}

/** The Skills line, in whichever box it is drawn. */
export function SkillsControl(props: UiComposerControlProps) {
  const host = useModuleHost()
  const editor = props.in === 'profile'
  // A session's are said over the profile its record names (Default where none), the launcher's over the one picked for every next run.
  const profile = props.in === 'session' ? (props.options.profiles?.profile ?? DEFAULT_PROFILE) : undefined
  const choices = useSkillChoices(host, editor ? undefined : props.projectId, { ...(profile !== undefined ? { profile } : {}), ...(editor ? { every: true } : {}) })
  // In a profile's editor the picks are the profile's own, over nothing.
  const under = choices && !editor ? choices.profile : {}
  const picks: Picks = { without: props.options.plugins?.without ?? under.without ?? [], project: props.options.skills?.project ?? under.project }
  const count = choices ? skillCount(choices, picks) : undefined
  const words = count === undefined ? undefined : editor ? profileWords(picks) : `${count} skill${count === 1 ? '' : 's'}`
  const { say } = props
  useEffect(() => say(words === undefined ? undefined : { words }), [say, words])
  if (!choices || count === undefined) return null
  if (props.in === 'session')
    return <SetupSaid icon={<Puzzle aria-hidden />} label="Skills" value={<span className="tabular-nums">{count}</span>} tip={`This session got ${skillPicksSaid({ ...picks, project: props.projectId === undefined ? 'none' : picks.project })}`} />
  return <SkillsMenu {...props} choices={choices} picks={picks} under={under} count={count} />
}

/** What a profile's picks say on its row and in its editor. */
function profileWords(picks: Picks): string {
  const project = projectSaid(picks.project)
  return [...(picks.without.length > 0 ? [`Without ${inWords(picks.without)}`] : []), `${project.charAt(0).toUpperCase()}${project.slice(1)}`].join(' · ')
}

/**
 * The line's list: the plugins, then the project's skills, then both in Settings. A pick is written
 * whole where it says something the run would not get otherwise: what it starts from (the profile's)
 * is no pick.
 */
function SkillsMenu({ in: where, projectId, options, onChange, busy, choices, picks, under, count }: UiComposerControlProps & { choices: SkillChoices; picks: Picks; under: SkillChoices['profile']; count: number }) {
  const host = useModuleHost()
  const editor = where === 'profile'
  const held = choices.project
  const kept = projectKept(held, picks.project)
  const withPlugins = (without: string[]): RunOptions => {
    const { plugins: _was, ...rest } = options
    return without.length === 0 && under.without === undefined ? rest : { ...rest, plugins: { ...options.plugins, without } }
  }
  const withProject = (project: ProjectPick | undefined): RunOptions => {
    const { skills: _was, ...rest } = options
    // Every one is what a run gets unless its profile names its own.
    const all = project === undefined || project === 'all'
    if (all && (under.project === undefined || under.project === 'all')) return rest
    return { ...rest, skills: { ...options.skills, project: all ? 'all' : project } }
  }
  const togglePlugin = (name: string) => onChange(withPlugins(picks.without.includes(name) ? picks.without.filter(one => one !== name) : [...picks.without, name]))
  const toggleProject = (name: string) => {
    const next = kept.includes(name) ? kept.filter(one => one !== name) : held.filter(one => one === name || kept.includes(one))
    onChange(withProject(next.length === held.length ? 'all' : next.length === 0 ? 'none' : next))
  }
  const allPicked = picks.project === undefined || picks.project === 'all'
  return (
    <SetupLine icon={<Puzzle aria-hidden />} label="Skills" value={<span className="tabular-nums">{count}</span>} disabled={busy} className="min-w-[16rem]">
      <DropdownMenuGroup>
        <DropdownMenuLabel>{editor ? 'Plugins, this profile' : 'Plugins, this session'}</DropdownMenuLabel>
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
      {(projectId !== undefined || editor) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Project skills</DropdownMenuLabel>
            {!editor && held.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="text-muted-foreground">None yet</span>
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuRadioGroup value={allPicked ? 'all' : picks.project === 'none' ? 'none' : null} onValueChange={(pick: 'all' | 'none') => onChange(withProject(pick))}>
                  {/* Marked at the right, in the one column every skill's tick stands in. */}
                  <DropdownMenuRadioItem value="all" closeOnClick={false}>
                    All
                    <span className="ml-auto flex size-4 shrink-0 items-center justify-center">{allPicked && <Check className="size-4" aria-hidden />}</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="none" closeOnClick={false}>
                    None
                    <span className="ml-auto flex size-4 shrink-0 items-center justify-center">{picks.project === 'none' && <Check className="size-4" aria-hidden />}</span>
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {/* A profile is for any project: the skills it names, by name, where a project has them. */}
                {editor
                  ? Array.isArray(picks.project) && (
                      <DropdownMenuItem disabled>
                        <span className="truncate text-muted-foreground">{`Only ${inWords(picks.project)}`}</span>
                      </DropdownMenuItem>
                    )
                  : held.map(name => (
                      <DropdownMenuCheckboxItem key={name} checked={kept.includes(name)} onCheckedChange={() => toggleProject(name)}>
                        <span className="truncate">{name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
              </>
            )}
          </DropdownMenuGroup>
        </>
      )}
      {projectId !== undefined && !editor && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => host.openSettings('plugins', projectId)}>
            <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Plugins in Settings…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => host.openSettings('skills', projectId)}>
            <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Project skills in Settings…
          </DropdownMenuItem>
        </>
      )}
    </SetupLine>
  )
}
