import { ClaudeCodeDriver } from '@openagt/agent-driver-claude'
import { CodexDriver } from '@openagt/agent-driver-codex'
import type { Driver, DriverModel } from '@openagt/agent-driver'
import { DRIVERS, type DriverName } from '../driver-names.js'

/** What one coding agent offers: its models, or why it could not say; `missing` when its CLI is not on the computer at all. */
export type DriverModels = { models: DriverModel[] } | { models: []; error: string; missing?: true }

/** The models of every coding agent a person can pick, by driver. */
export type ModelsView = Record<DriverName, DriverModels>

/** Where the dashboard reads which models each coding agent offers. */
export interface ModelsSource {
  read(): Promise<ModelsView>
}

/**
 * Ask each coding agent for its models, once: the first read asks, every later read answers from
 * what it said, for the daemon's life. The list changes only with a new CLI version or a new
 * login, and each question starts a CLI, so a menu opened again never waits on one. An agent that
 * could not say is asked again at the next read, so a CLI installed or logged in since is found.
 */
export function cachedModelsSource(drivers: Record<DriverName, Pick<Driver, 'listModels'>>): ModelsSource {
  const asked = new Map<DriverName, Promise<DriverModel[]>>()
  const ask = (name: DriverName): Promise<DriverModels> => {
    let answer = asked.get(name)
    if (!answer) {
      const listModels = drivers[name].listModels
      answer = listModels ? listModels.call(drivers[name]) : Promise.reject(new Error('this agent cannot list its models'))
      asked.set(name, answer)
      answer.catch(() => asked.delete(name))
    }
    return answer.then(
      models => ({ models }),
      (err: unknown) => ({ models: [], error: err instanceof Error ? err.message : String(err), ...((err as NodeJS.ErrnoException).code === 'ENOENT' ? { missing: true as const } : {}) }),
    )
  }
  return {
    read: async () => Object.fromEntries(await Promise.all(DRIVERS.map(async name => [name, await ask(name)] as const))) as ModelsView,
  }
}

/** The daemon's own source: the coding agents on this machine, asked as the person's own login. */
export function defaultModelsSource(): ModelsSource {
  return cachedModelsSource({ 'claude-code': new ClaudeCodeDriver(), codex: new CodexDriver() })
}
