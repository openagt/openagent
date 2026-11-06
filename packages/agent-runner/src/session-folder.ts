import { mkdir } from 'node:fs/promises'
import { sessionFolder } from '@openagt/agent-data'
import { linkSkillsInFolder, type SkillLink } from '@openagt/skill-branches'

/**
 * Where a run with no project works: a folder of its own in the sessions home, made when it is not
 * there yet, the run's skills linked in where its coding agent looks for them. The folder has no
 * branch and no git: it stays when the run ends, holding what the agent made, and a resumed run
 * goes on in it.
 */
export async function openSessionFolder(home: string, id: string, skills: readonly SkillLink[]): Promise<{ path: string }> {
  const path = sessionFolder(home, id)
  await mkdir(path, { recursive: true })
  await linkSkillsInFolder(path, skills)
  return { path }
}
