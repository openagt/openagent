import { defineModule, type ModuleDefinition } from '@openagt/hooks'
import { actionsHost, type ActionsHostDeps } from './host.js'

export { ACTIONS_HOST, WORKFLOW } from './turn.js'

/**
 * host-github-actions, a plugin kept per project (#2394): GitHub Actions as a host for the
 * project's runs (`run.host`). Switched on in a project on GitHub whose repository has the
 * workflow it brings, "Run on" offers it beside this computer, and a run started there runs each
 * of its turns on a runner of the repository's own (`host.ts`). It starts off.
 */
export function hostGithubActions(deps: ActionsHostDeps = {}): ModuleDefinition {
  return defineModule({
    name: 'host-github-actions',
    plugin: { scope: 'project' },
    hooks: { 'run.host': [actionsHost(deps)] },
  })
}

export default hostGithubActions()
