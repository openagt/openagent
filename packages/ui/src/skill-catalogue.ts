/**
 * The skills a session can take on top of the ones every run gets (#2023), in the Skills menu's
 * groups under the message box, and the ones a run is handed down to link them from. The skills
 * every run gets are not here (the branches skill, and the ones the distribution says every run
 * gets): they come with every run. Each one is its package's, the distribution's package whose skill
 * it is. Until the plugins' Enabled rows (#2394), after which a run goes without plugins rather than
 * taking more.
 */

export interface SkillGroup {
  title: string
  skills: readonly string[]
}

export const GROUPS: readonly SkillGroup[] = [
  { title: 'Tickets and queue', skills: ['tickets', 'queue', 'plan', 'plan-tickets', 'triage', 'update-tickets', 'work-queue'] },
  { title: 'Agents', skills: ['logs', 'account-rotation'] },
  { title: 'Pull requests', skills: ['reply'] },
  { title: 'Automations', skills: ['scheduler'] },
  { title: 'Needs its own setup', skills: ['browser', 'discord'] },
]

/** Every skill of the list, in its order. */
export const SKILL_NAMES: readonly string[] = GROUPS.flatMap(group => group.skills)

/** The `description` a skill's text gives in its front matter, in one line; none, empty. */
export function descriptionOf(text: string): string {
  return /^description:[ \t]*(.*)$/m.exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1') ?? ''
}
