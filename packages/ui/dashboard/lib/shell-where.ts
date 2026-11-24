import type { UiWhereRepo } from '@openagt/hooks/ui'
import { onHostedRepos } from '../rpc/projects.js'
import type { MountedModules, MountedOption } from './use-modules.js'

// The repositories at the git hosts, offered to the project picker (`composer.where`) by the shell
// itself: the accounts' and those of the owners Settings › Repos on GitHub names
// (`src/dashboard-rpc/hosted-repos.ts`). The github module offers them once it takes Settings ›
// Repos on GitHub over; until then the shell does, so the picker lists them beside this computer's.

/** What a repo at a host says under its name: whether it is private, that it is not here, and why it is listed. */
function hostedDetail(repo: { private: boolean; from: string }): string {
  return [repo.private && 'Private', 'Not on this computer', repo.from].filter(Boolean).join(' · ')
}

const HOSTED: MountedOption<'composer.where'> = {
  place: 'composer.where',
  id: 'hosted',
  label: 'On GitHub',
  loadingWords: 'Asking GitHub for repos…',
  order: 100,
  repos: async () => {
    const read = await onHostedRepos()
    const repos = read.repos.map((repo): UiWhereRepo => ({ address: repo.address, label: repo.address.split('/').slice(1).join('/'), detail: hostedDetail(repo) }))
    return { repos, loading: read.loading, ...(read.unreached ? { unreached: 'GitHub could not be reached: its repos are not listed.' } : {}) }
  },
  package: '@openagt/ui',
  projects: [],
  computer: true,
}

/** The modules mounted, with the shell's own repos at the git hosts among the project picker's. */
export function withShellWhere(modules: MountedModules): MountedModules {
  return { ...modules, options: { ...modules.options, 'composer.where': [...modules.options['composer.where'], HOSTED] } }
}
