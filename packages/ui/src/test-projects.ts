import { resolve } from 'node:path'
import { projectId } from './project-id.js'
import { PROJECTS, type ProjectRecord } from '@openagt/hooks'
import { distributionSettings } from './distribution-hooks.js'

/**
 * Put the folder at `path` on this computer's list of projects, as the projects module does when
 * one is added, for a test that needs a project there: through the settings of the distribution
 * handed down. A folder on the list already keeps its record. Answers the record.
 */
export async function listTestProject(path: string, addedAt: string = new Date().toISOString(), env: NodeJS.ProcessEnv = process.env): Promise<ProjectRecord> {
  const settings = await distributionSettings(env)
  const absolute = resolve(path)
  const listed = await settings.get(PROJECTS)
  const there = listed.find(project => project.path === absolute)
  if (there) return there
  const record = { id: projectId(absolute), path: absolute, addedAt }
  await settings.set(PROJECTS, [...listed, record])
  return record
}
