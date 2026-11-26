import { Puzzle, SquareSlash } from 'lucide-react'
import { Facts, isUnreachable, Section, SettingsItem, SettingsItems, SettingsRowShapes, SettingsSection, Slot, useModuleHost, usePolled, type UiProject, type UiSettingsProps } from '@openagt/ui/module'
import { readSkills, type ProjectSkills } from './calls.js'

// Settings › Skills (#2394): each project's own skills, the ones its repository keeps where the
// coding agents read them. The page lists them and installs nothing: a project gets a skill by
// committing it, or with `npx skills add`, and OpenAgent never writes, updates or deletes one. The
// skills OpenAgent's own modules bring are linked into each run, never into the project, and are
// not here. With every project picked, each project's are listed under its name.

/** How often a project's skills are read again: a skill committed, or pulled in, shows within this. */
const EVERY_MS = 15_000

/** A read of one project's skills: what it answered, or why it could not. */
type Read = ProjectSkills | { error: string }

export function SkillsSettings({ projects }: UiSettingsProps) {
  if (projects.length === 0) return null
  return (
    <SettingsSection
      description={
        <>
          The skills a project keeps for its coding agents, under <Code>.agents/skills</Code> or <Code>.claude/skills</Code>. A run gets the ones on the branch it starts from. OpenAgent never adds or changes them: commit a skill there, or add one with{' '}
          <Code>npx skills add</Code>.
        </>
      }
    >
      {projects.length === 1 ? (
        <ProjectSkillList project={projects[0]!} />
      ) : (
        projects.map(project => (
          <Section key={project.id} title={project.name}>
            <ProjectSkillList project={project} />
          </Section>
        ))
      )}
    </SettingsSection>
  )
}

/** One project's skills: a row each, a command marked as one, a skill its runs do not have yet said so. */
function ProjectSkillList({ project }: { project: UiProject }) {
  const host = useModuleHost()
  const read = usePolled<Read | undefined>(
    () => readSkills(host, project.id).catch((error: unknown) => {
      if (isUnreachable(error)) throw error
      return { error: error instanceof Error ? error.message : String(error) }
    }),
    undefined,
    EVERY_MS,
    [project.id],
    { remember: `skills:${project.id}` },
  )
  return (
    <Slot of={read} shape={<SettingsRowShapes rows={2} />}>
      {answer =>
        answer === undefined ? null : 'error' in answer ? (
          <p role="alert" className="text-sm text-danger">
            The skills of {project.name} could not be read: {answer.error}
          </p>
        ) : answer.skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{project.name} keeps no skills of its own.</p>
        ) : (
          <SettingsItems aria-label={`Skills of ${project.name}`}>
            {answer.skills.map(skill => {
              // A command by what is typed in the message box; a skill not yet where runs start from, by that branch.
              const facts = [skill.command ? `/${skill.name}` : undefined, skill.waiting ? { fact: `Not on ${answer.startBranch ?? 'its branch'} yet`, className: 'text-warning' } : undefined].filter(fact => fact !== undefined)
              return (
                <SettingsItem
                  key={skill.name}
                  icon={skill.command ? SquareSlash : Puzzle}
                  title={skill.name}
                  // Said whole: what a skill says of itself is what tells it apart, and a cut line would hide it.
                  detail={skill.description !== undefined ? <span className="whitespace-normal">{skill.description}</span> : undefined}
                  {...(facts.length > 0 ? { end: <Facts facts={facts} /> } : {})}
                />
              )
            })}
          </SettingsItems>
        )
      }
    </Slot>
  )
}

/** A path or a command in a sentence. */
function Code({ children }: { children: string }) {
  return <code className="rounded-sm bg-muted px-1 font-mono text-xs">{children}</code>
}
