import { lstat, mkdir, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitReason, installProject } from '@openagt/agent-data'
import { initHooks, removeHooks, stopScheduler } from '@openagt/skill-scheduler'
import { carriedSkills } from './catalogue.js'
import { LINKS_DIR, TEXTS_DIR } from './project.js'
import { stamped } from './skill-file.js'

/**
 * Writing and deleting a project's skills (#2023). A skill is one tracked file,
 * `.agents/skills/<name>/SKILL.md`, where Codex reads it, and one tracked link,
 * `.claude/skills/<name>`, pointing at that folder, where Claude Code reads it: the way the
 * OpenAgent repository itself holds its skills. Nothing else is written: no `package.json`, no
 * install, so a Node project, a PHP project and an empty folder get exactly the same.
 */

/** What one write or delete touched, as paths from the project's root: what a commit of it holds. */
export interface Touched {
  paths: string[]
  /** A place that was left as it is, and why: something there that OpenAgent did not write. */
  left: { path: string; reason: string }[]
}

const kindOf = async (path: string): Promise<'none' | 'link' | 'directory' | 'other'> => {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return 'none'
  return entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'other'
}

/** The link made for Claude Code: relative, so it holds in every clone and every checkout that keeps links. */
const linkTarget = (name: string): string => `../../${TEXTS_DIR}/${name}`

/** Write (or write again) the text of skill `name` and its link. */
export async function writeSkill(root: string, name: string): Promise<Touched> {
  const skill = (await carriedSkills()).get(name)
  if (!skill) throw new Error(`no skill ${name}`)
  const touched: Touched = { paths: [], left: [] }
  const file = `${TEXTS_DIR}/${name}/SKILL.md`
  await mkdir(join(root, TEXTS_DIR, name), { recursive: true })
  await writeFile(join(root, file), stamped(skill.text, skill.version))
  touched.paths.push(file)

  const link = `${LINKS_DIR}/${name}`
  const kind = await kindOf(join(root, link))
  if (kind === 'none') {
    await mkdir(join(root, LINKS_DIR), { recursive: true })
    // A real link, also on Windows: git tracks a link, and a junction is none to it.
    const made = await symlink(linkTarget(name), join(root, link), 'dir').then(() => true, () => false)
    if (made) touched.paths.push(link)
    else touched.left.push({ path: link, reason: 'the link could not be made: Claude Code does not have this skill' })
  } else if ((await realpath(join(root, link)).catch(() => undefined)) !== (await realpath(join(root, TEXTS_DIR, name)))) {
    // Anything that does not lead to the text just written: a folder of the project's own, a link to somewhere else.
    touched.left.push({ path: link, reason: kind === 'link' ? 'a link to somewhere else' : 'not a link: Claude Code reads what is there' })
  }
  return touched
}

/** Delete the text of skill `name` and its link. A folder that holds more than the text keeps the rest. */
export async function removeSkill(root: string, name: string): Promise<Touched> {
  const touched: Touched = { paths: [], left: [] }
  const link = `${LINKS_DIR}/${name}`
  const kind = await kindOf(join(root, link))
  if (kind === 'link') {
    await rm(join(root, link))
    touched.paths.push(link)
  }
  for (const dir of kind === 'directory' ? [TEXTS_DIR, LINKS_DIR] : [TEXTS_DIR]) {
    const folder = `${dir}/${name}`
    const file = `${folder}/SKILL.md`
    if ((await kindOf(join(root, file))) === 'none') continue
    await rm(join(root, file))
    touched.paths.push(file)
    // rmdir, never a recursive remove: a file a person put beside the text keeps the folder.
    if (!(await rmdir(join(root, folder)).then(() => true, () => false))) touched.left.push({ path: folder, reason: 'it holds other files' })
  }
  return touched
}

/** What switching the scheduler answered. */
export type SchedulerOutcome = { ok: true; changed: boolean } | { ok: false; error: string }

/**
 * Switch the scheduler on or off for this project on this machine: its two lines in the project's
 * hooks file, which is outside git. Switching it off also stops one that is running, since nothing
 * else would. Switching it on in a folder with no `.openagent/` makes the folder a project first,
 * exactly as a dashboard's "Add project" does, since the hooks file lives there.
 */
export async function setScheduler(root: string, on: boolean): Promise<SchedulerOutcome> {
  if (!on) {
    const removed = await removeHooks(root)
    if (!removed.ok) return { ok: false, error: `${removed.file}: ${removed.detail ?? 'unreadable'}` }
    // The line that stops the scheduler when the dashboard closes just went: one that is running is stopped now.
    if (removed.removed.length > 0) await stopScheduler(root).catch(() => {})
    return { ok: true, changed: removed.removed.length > 0 }
  }
  const installed = await installProject(root)
  if (!installed.ok) return { ok: false, error: gitReason(new Error(installed.error)) }
  const written = await initHooks(root)
  if (!written.ok) return { ok: false, error: `${written.file}: ${written.detail ?? written.reason}` }
  return { ok: true, changed: written.added.length > 0 }
}
