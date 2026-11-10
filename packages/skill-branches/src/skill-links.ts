import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodeGitRunner, type GitRunner, excludeFromGit } from '@openagt/agent-data'
import { nodeLinkFs } from './worktree-deps.js'
import { entryExists, linkPackage, packageLinkPaths, type PackageLink } from './command-link.js'
import { CLI_BIN_DIR } from './bin-dir.js'

/**
 * The skill, where the agent's harness looks for one (#1739). A harness discovers skills under a
 * directory of its own at the checkout root — `.claude/skills/<name>/SKILL.md` for Claude Code,
 * `.agents/skills/<name>/SKILL.md` for Codex — and a checkout under `.branches/` is its own
 * repository root to it, so nothing the project keeps in those directories reaches the agent.
 * Every checkout the package creates therefore gets one symlink per harness, named as the skill
 * and pointing at this package, whose `SKILL.md` is the skill. One mechanism for every harness,
 * and the same text for every agent; a new harness is one more entry in {@link HARNESS_SKILL_DIRS}.
 */

/** The skill's name: the `name` in `SKILL.md`'s front matter, and the directory a harness lists it under. */
export const SKILL_NAME = 'branches'

/** Where each harness looks for skills, relative to the checkout root. */
export const HARNESS_SKILL_DIRS = ['.claude/skills', '.agents/skills'] as const

/**
 * This package's directory — the one holding `SKILL.md`. Beside `dist/`, so it is the same path
 * from a workspace checkout and from an installed package.
 */
export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * A skill to link into a checkout: its name (the directory a harness lists it under) and the
 * directory holding its `SKILL.md`.
 *
 * A caller names the skills it ships itself and wants in every checkout it makes, skills that
 * live with the caller and not in the repository. A skill a project uses
 * is the project's own tracked `.claude/skills/<name>`, in every worktree by itself.
 */
export interface SkillLink {
  name: string
  dir: string
  /** The package the skill's text calls by its full name, when the skill has a command: linked with its commands (`command-link.ts`). */
  package?: PackageLink
}

/**
 * This package's own skill, as a {@link SkillLink}, with its command: the skill's text runs
 * `npx @openagt/skill-branches@0.1`, which finds this copy linked in the checkout (`command-link.ts`).
 */
export const OWN_SKILL: SkillLink = { name: SKILL_NAME, dir: SKILL_DIR, package: { name: '@openagt/skill-branches', dir: SKILL_DIR, bins: { branches: join(CLI_BIN_DIR, 'branches') } } }

/**
 * Link the skill into `checkout` for every harness — this package's own, plus whatever `skills`
 * the caller names (see {@link SkillLink}) — and hide the links from the project's git (see
 * {@link hideLink}): a symlink at the checkout root would otherwise ride any sweeping `git add -A`
 * onto the agent's branch. Best-effort: an entry already at a link's path is left alone and is not
 * hidden, a link of this package's that points nowhere is made again, and a link that cannot be
 * made is a worse run, not a failed one.
 */
export async function linkSkill(repo: string, checkout: string, skills: readonly SkillLink[] = [], git: GitRunner = nodeGitRunner()): Promise<void> {
  await linkSkills(repo, checkout, [OWN_SKILL, ...skills], git, (dir, name) => hideLink(repo, checkout, dir, name, git))
}

/**
 * Link `skills` into a folder that is no checkout: a session's own folder, which has no project and
 * no git. The same links a checkout gets for each harness and each skill's package, without this
 * package's own skill, which is about branches, and with nothing to hide from a git that is not there.
 */
export async function linkSkillsInFolder(folder: string, skills: readonly SkillLink[], git: GitRunner = nodeGitRunner()): Promise<void> {
  await linkSkills(folder, folder, skills, git)
}

/** Each of `skills` linked under `root` for every harness, each link hidden by `hide` when there is one, then the skill's package. */
async function linkSkills(repo: string, root: string, skills: readonly SkillLink[], git: GitRunner, hide?: (dir: string, name: string) => Promise<void>): Promise<void> {
  const fs = nodeLinkFs()
  for (const skill of skills) {
    for (const dir of HARNESS_SKILL_DIRS) {
      try {
        const path = join(root, dir, skill.name)
        // The project's own copy, tracked or not, stays, and is not hidden: that would hide what a person adds there.
        if (await entryExists(path)) continue
        await fs.mkdir(join(root, dir))
        await hide?.(dir, skill.name).catch(() => {})
        await fs.symlinkDir(skill.dir, path)
      } catch {
        // A filesystem that refuses the link: the agent still starts, without the skill.
      }
    }
    if (skill.package) await linkPackage(repo, root, skill.package, git)
  }
}

/** The paths of a skill's links, relative to a checkout: its text for every harness, and its package's links when it has one. */
export function skillLinkPaths(skill: SkillLink): string[] {
  return [...HARNESS_SKILL_DIRS.map(dir => `${dir}/${skill.name}`), ...(skill.package ? packageLinkPaths(skill.package) : [])]
}

/** The file a skill's link is hidden by, in the folder the link is in. */
const IGNORE_FILE = '.gitignore'

/**
 * Hide the link `<dir>/<name>` by a line in `<dir>/.gitignore` of the agent's checkout, a file that
 * names itself too, so it is hidden as well. The file is in that checkout only: a person who adds a
 * skill of the same name in their own checkout sees it in git, where a rule in the repository's
 * exclude file, read by every checkout of it, hid it from them too. A project that tracks its own
 * `<dir>/.gitignore` gets no line in it, which would be work for the agent to commit: there the
 * link is hidden by the repository's exclude file.
 */
async function hideLink(repo: string, checkout: string, dir: string, name: string, git: GitRunner): Promise<void> {
  const tracked = (await git(['ls-files', '--', `${dir}/${IGNORE_FILE}`], checkout)).trim() !== ''
  if (tracked) return excludeFromGit(repo, `/${dir}/${name}`, undefined, git)
  const file = join(checkout, dir, IGNORE_FILE)
  const current = await readFile(file, 'utf8').catch(() => `/${IGNORE_FILE}\n`)
  if (current.split('\n').includes(`/${name}`)) return
  await writeFile(file, (current.endsWith('\n') ? current : `${current}\n`) + `/${name}\n`)
}
