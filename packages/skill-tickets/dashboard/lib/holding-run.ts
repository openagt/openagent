import { runName, type ModuleAgent } from '@openagt/dashboard/module'
import type { HoldingRun } from '../../src/module.js'

/** The run behind a claim, named as every list of runs names it ({@link runName}). */
export function holdingRun(agent: ModuleAgent | undefined): HoldingRun | undefined {
  if (!agent) return undefined
  const name = runName({ ...(agent.title ? { title: agent.title } : {}), ...(agent.ask ? { intent: agent.ask } : {}), ...(agent.name ? { branch: agent.name } : {}) })
  return { id: agent.id, ...(name ? { name } : {}) }
}
