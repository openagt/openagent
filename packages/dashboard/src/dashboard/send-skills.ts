import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitReason, nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { commitSkills, skillPaths } from '../project-skills/branch.js'
import { projectGitHost, type GitHostFor } from '../store/git-host.js'
import { forgetBranchPrs, forgetPr } from './pull-requests.js'
import { startBranch } from './start-branch.js'

/**
 * A project's skills sent to where its agents start from (#2023): what "Save and send" and "Send"
 * on the project's page do. An agent's checkout starts from the remote's default branch, so a skill
 * reaches agents only once it is there. The files of the named skills are committed in the folder,
 * then the same files go to the remote's default branch; where that push is refused (a protected
 * branch), they go to {@link SKILLS_BRANCH} and a pull request is opened for it. A project with no
 * remote starts its agents from its own commits, so the commit is all it takes.
 *
 * Nothing else the person has is pushed: the folder's branch is pushed as it is only when it is the
 * default branch and holds nothing past the remote's but skill files; else the skills' files are
 * written onto the remote's branch in a commit of their own, made without touching the folder.
 */

/** The branch the skills go to when the default branch takes no push: one, so a second send updates the open pull request. */
export const SKILLS_BRANCH = 'openagent/skills'

const MESSAGE = 'Update OpenAgent skills\n'

export type SendSkillsResult =
  /** No remote: committed in the folder, where agents start from. */
  | { ok: true; sent: 'committed' }
  /** On the remote's default branch, `branch` by name. */
  | { ok: true; sent: 'pushed'; branch: string }
  /** The default branch took no push: in this pull request. */
  | { ok: true; sent: 'request'; request: { number: number; url: string } }
  /** The default branch took no push, and no git host package opens a pull request: on {@link SKILLS_BRANCH}, to merge by hand. */
  | { ok: true; sent: 'branch'; branch: string }
  | { ok: false; error: string }

export async function sendSkills(cwd: string, names: readonly string[], deps: { git?: GitRunner; gitHost?: GitHostFor } = {}): Promise<SendSkillsResult> {
  if (names.length === 0) return { ok: false, error: 'no skill to send' }
  const git = deps.git ?? nodeGitRunner()
  const committed = await commitSkills(cwd, names, git)
  if (!committed.ok) return committed
  const start = await startBranch(cwd)
  if (!start || start.ref === 'HEAD') return { ok: true, sent: 'committed' }
  try {
    await git(['fetch', '--quiet', 'origin', start.name], cwd)
  } catch (err) {
    return { ok: false, error: `could not reach the remote: ${gitReason(err)}` }
  }
  const paths = await skillPaths(cwd, names)
  const commit = (await asItIs(cwd, start, paths, git)) ?? (await onTopOf(cwd, start.ref, paths))
  if (commit === undefined) return { ok: true, sent: 'pushed', branch: start.name }
  try {
    await git(['push', '--quiet', 'origin', `${commit}:refs/heads/${start.name}`], cwd)
    return { ok: true, sent: 'pushed', branch: start.name }
  } catch {
    // Refused: most often a protected branch. The other way in is a pull request, from a branch of OpenAgent's own.
  }
  try {
    await git(['push', '--quiet', '--force', 'origin', `${commit}:refs/heads/${SKILLS_BRANCH}`], cwd)
  } catch (err) {
    return { ok: false, error: `the remote took no push: ${gitReason(err)}` }
  }
  const host = await (deps.gitHost ?? projectGitHost)(cwd).catch(() => undefined)
  if (!host) return { ok: true, sent: 'branch', branch: SKILLS_BRANCH }
  const opened = await host.open(SKILLS_BRANCH, {
    title: 'Update OpenAgent skills',
    body: `The skill files picked on OpenAgent's dashboard: ${names.join(', ')}.\n\n${start.name} took no push, so they come as this pull request. Agents started from ${start.name} have them once it is merged.`,
  })
  forgetPr(cwd, SKILLS_BRANCH)
  forgetBranchPrs(cwd, SKILLS_BRANCH)
  return opened.ok ? { ok: true, sent: 'request', request: opened.request } : { ok: false, error: `pushed to ${SKILLS_BRANCH}, but no pull request was opened: ${opened.error}` }
}

/**
 * The folder's own commit, when it can go as it is: the folder is on the default branch, past the
 * remote's copy of it, and everything between the two is skill files. Pushed as it is, the folder
 * and the remote stay one history.
 */
async function asItIs(cwd: string, start: { ref: string; name: string }, paths: readonly string[], git: GitRunner): Promise<string | undefined> {
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).catch(() => '')).trim()
  if (branch !== start.name) return undefined
  if (!(await git(['merge-base', '--is-ancestor', start.ref, 'HEAD'], cwd).then(() => true, () => false))) return undefined
  const changed = (await git(['diff', '--name-only', '-z', start.ref, 'HEAD'], cwd)).split('\0').filter(Boolean)
  const skills = new Set(paths)
  return changed.length > 0 && changed.every(path => skills.has(path)) ? (await git(['rev-parse', 'HEAD'], cwd)).trim() : undefined
}

/**
 * A commit on `base` holding `paths` as the folder's HEAD has them (a path HEAD lacks is deleted),
 * built in an index of its own so the folder's checkout and index are never touched. Undefined
 * when `base` already holds them so.
 */
async function onTopOf(cwd: string, base: string, paths: readonly string[]): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'openagent-skills-'))
  const git = (args: string[], input?: string): Promise<string> => run(cwd, args, { GIT_INDEX_FILE: join(dir, 'index') }, input)
  try {
    await git(['read-tree', base])
    for (const path of paths) {
      const entry = (await git(['ls-tree', '-z', 'HEAD', '--', path])).split('\0')[0]
      if (entry) {
        const [mode, , sha] = entry.split('\t')[0]!.split(' ')
        await git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${path}`])
      } else await git(['update-index', '--force-remove', '--', path])
    }
    const tree = (await git(['write-tree'])).trim()
    if (tree === (await git(['rev-parse', `${base}^{tree}`])).trim()) return undefined
    return (await git(['commit-tree', tree, '-p', base, '-F', '-'], MESSAGE)).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** git with environment of its own, which a {@link GitRunner} does not take. */
function run(cwd: string, args: string[], env: Record<string, string>, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, env: { ...process.env, ...env }, timeout: 30_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
    // A git that ends before it reads its input closes the pipe under the write: its exit code
    // says how it went, and the EPIPE, with no one listening for it, would be thrown at the process.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input ?? '')
  })
}
