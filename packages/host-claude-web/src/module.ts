import { defineModule, type ModuleDefinition } from '@openagt/hooks'
import { webAttention } from './attention.js'
import { bridgeLifecycle, bridgeRoute, type BridgeDeps } from './bridge.js'
import { webHost, type WebHostDeps } from './host.js'

export { WEB_HOST } from './web-runs.js'

/**
 * host-claude-web, a plugin kept per computer (#2394): Claude Code on the web as a host for a
 * project's runs (`run.host`), with the bridge to the Chrome extension that makes their cloud
 * sessions and carries their questions and answers (`app.route`, `app.lifecycle`), and "Needs
 * answer" for a session parked on its person (`app.attention`). Switched on, "Run on" offers it in
 * a project on GitHub. It starts off: it opens an address of OpenAgent's to a caller from
 * elsewhere, behind a key of its own.
 */
export function hostClaudeWeb(deps: { host?: WebHostDeps; bridge?: BridgeDeps } = {}): ModuleDefinition {
  return defineModule({
    name: 'host-claude-web',
    plugin: { scope: 'computer' },
    hooks: {
      'run.host': [webHost(deps.host)],
      'app.lifecycle': bridgeLifecycle(deps.bridge),
      'app.route': [bridgeRoute],
      'app.attention': webAttention(),
    },
  })
}

export default hostClaudeWeb()
