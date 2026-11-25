import { projectId } from '@openagt/projects'
import { createHooks, loadHandedDown, SCHEDULED_COMMANDS, type ScheduledCommands, type Settings } from '@openagt/hooks'
import type { PacePick } from './pace.js'

/**
 * This computer's switches and paces of a project's scheduled commands (#2394, decision 9): kept in
 * OpenAgent's settings (`scheduled-agents.commands`, per computer, by the project's id), where the
 * queue reads them too, and not in the state file. Read and saved through the store of the
 * distribution handed down to this process: a scheduler OpenAgent started has it, and so have the
 * dashboard's commands and a run's agent. A command run by hand outside OpenAgent has none: it reads
 * every command off, and saves no switch or pace.
 */

/** The switches and paces of one project, as the state holds them. */
export interface Picks {
  switches?: Record<string, string>
  paces?: Record<string, PacePick>
}

/** Where the settings come from: the distribution handed down to this process, read once; a test gives its own. */
export const picksSettings: { of: () => Promise<Settings | undefined> } = { of: handedDown }

let loaded: Promise<Settings | undefined> | undefined
function handedDown(): Promise<Settings | undefined> {
  loaded ??= loadHandedDown().then(modules => (modules ? createHooks(modules).settings : undefined))
  return loaded
}

/** Why a switch or a pace cannot be saved here. */
export const NO_SETTINGS = "this machine's switches and paces are OpenAgent's settings, which a command reaches only where OpenAgent started it: from its dashboard, or an agent it started"

/**
 * The switches and paces this computer keeps for the project at `repo`: none outside OpenAgent.
 * Read from `settings` where given (the dashboard's own, to its server part), else from the
 * distribution handed down to this process.
 */
export async function readPicks(repo: string, given?: Settings): Promise<Picks> {
  const settings = given ?? (await picksSettings.of())
  if (!settings) return {}
  return picksOf((await settings.get(SCHEDULED_COMMANDS))[projectId(repo)] ?? {})
}

/** Save the switches and paces of the project at `repo`, in place of the ones kept: none take its entry away. */
export async function savePicks(repo: string, picks: Picks): Promise<void> {
  const commands = commandsOf(picks)
  const settings = await picksSettings.of()
  if (!settings) {
    if (Object.keys(commands).length === 0) return
    throw new Error(NO_SETTINGS)
  }
  const id = projectId(repo)
  const { [id]: _kept, ...others } = await settings.get(SCHEDULED_COMMANDS)
  await settings.set(SCHEDULED_COMMANDS, Object.keys(commands).length > 0 ? { ...others, [id]: commands } : others)
}

/** Whether two states keep the same switches and paces. */
export function samePicks(a: Picks, b: Picks): boolean {
  return canonical(commandsOf(a)) === canonical(commandsOf(b))
}

function picksOf(commands: ScheduledCommands): Picks {
  const switches = Object.entries(commands).flatMap(([command, picks]) => (picks.on !== undefined ? [[command, picks.on] as const] : []))
  const paces = Object.entries(commands).flatMap(([command, picks]) => (picks.pace !== undefined ? [[command, picks.pace as PacePick] as const] : []))
  return { ...(switches.length > 0 ? { switches: Object.fromEntries(switches) } : {}), ...(paces.length > 0 ? { paces: Object.fromEntries(paces) } : {}) }
}

function commandsOf({ switches = {}, paces = {} }: Picks): ScheduledCommands {
  const names = [...new Set([...Object.keys(switches), ...Object.keys(paces)])].sort()
  return Object.fromEntries(names.map(name => [name, { ...(switches[name] !== undefined ? { on: switches[name] } : {}), ...(paces[name] !== undefined ? { pace: paces[name] } : {}) }]))
}

/** One JSON spelling for equal values, whatever the order their keys were set in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
