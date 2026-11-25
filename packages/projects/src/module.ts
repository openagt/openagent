import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/git-branches'
import { type GitRunner, defineModule, PROJECTS, RunOrder, type ModuleDefinition, type RunContext } from '@openagt/hooks'
import { givenFolder } from './add.js'
import { noProjectYet } from './attention.js'

/**
 * projects, the module (#2394): the list of projects on this computer and what changes it, a
 * project added (by its folder, by its repository's address, or from the folder `openagent` was
 * typed in) and removed, each module cleaning up its own data. In a run: the project's repository
 * is there before anything is made of it (`CLONE`), and the agent is told where the copies of the
 * run's repos are (`CONTEXT`). Its server part (`server.ts`) is what the dashboard's picker, Add
 * project, Remove project and Settings › Repos call.
 */

/** What the module works with; the real one when absent. */
export interface ProjectsDeps {
  git?: GitRunner
}

export function projectsModule(deps: ProjectsDeps = {}): ModuleDefinition {
  const git = deps.git ?? nodeGitRunner()
  return defineModule({
    name: 'projects',
    hooks: {
      'run.step': [
        { order: RunOrder.CLONE, name: "make sure the project's repository is here", run: ctx => cloned(ctx, git) },
        { order: RunOrder.CONTEXT, name: 'tell the agent where its repos are', run: told },
      ],
      'app.lifecycle': {
        folderGiven: (folder, app) => givenFolder(app.settings, folder),
      },
      // About this computer, so asked with no project: a project's own pages have one already.
      'app.attention': async ({ project }, app) => (project === undefined ? noProjectYet((await app.settings.get(PROJECTS)).length) : []),
    },
  })
}

export default projectsModule()

/**
 * The project's folder holds its repository: a run makes its checkout of it next. A project added
 * by its address is cloned when it is added, behind the answer (`server.ts`): until the clone has
 * landed its folder is no repository, and the run says so rather than failing on a checkout.
 */
async function cloned(ctx: RunContext, git: GitRunner): Promise<void> {
  if (!ctx.project) return
  const { dir, name } = ctx.project
  const top = (await git(['rev-parse', '--show-toplevel'], dir).catch(() => '')).trim()
  if (top) return
  const listed = (await ctx.settings.get(PROJECTS)).some(project => project.path === dir)
  throw new Error(listed ? `${name} is not cloned on this computer yet: start the run once its clone has landed in ${dir}.` : `${dir} holds no repository.`)
}

/**
 * What the agent is told of the repos the task is about, beside the project: the copies of the
 * run's repos made for this start (git-branches' facts), where each is and where it came from. A
 * run with no project is told nothing: it starts in the folder that holds them. A resumed run that
 * has its copies already is not told again.
 */
function told(ctx: RunContext): void {
  const copies = ctx.facts['git-branches']?.copies
  if (!ctx.project || !copies || copies.made.length === 0) return
  ctx.context.push(copiesLine(copies.folder, copies.branch, copies.made))
}

/** The line a run in a project is handed about the copies just made for it. */
export function copiesLine(folder: string, branch: string, made: readonly { name: string; from: string }[]): string {
  const copies = made.map(repo => `${join(folder, repo.name)} (copied from ${repo.from})`).join(', ')
  return `Context: this session has its own ${made.length === 1 ? 'copy of a repo' : 'copies of repos'}, on the branch ${branch}: ${copies}. Read and change ${made.length === 1 ? 'it' : 'them'} there, not in the folder${made.length === 1 ? '' : 's'} copied from.`
}
