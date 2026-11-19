// A save on the Skills page of Settings, over a page that shows the same skills: what is under the
// dialog reads them again at once, not at its next read, and the shell reads the projects and
// their modules, since a skill written or deleted gives or takes a page.

import type { Again } from './use-async.js'

const listeners = new Set<() => void>()
let saves = 0

/** The Skills page changed a project's skills. */
export function skillsSaved(): void {
  saves += 1
  for (const listener of listeners) listener()
}

/** Told at each save; answers how to stop being told. */
export function onSkillsSaved(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For a read of a project's skills: read again at each save. */
export const skillsAgain: Again = read => onSkillsSaved(() => read(saves))
