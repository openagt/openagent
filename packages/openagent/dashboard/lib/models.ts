import { DRIVERS, DRIVER_LABELS, type DriverName } from '../../src/client.js'
import type { DriverOption } from '../components/DriverModelMenu.js'
import { useLoaded } from './use-async.js'
import { onModels, type DriverModels, type ModelsView } from '../rpc/models.js'

// Which models each coding agent offers, as the daemon asked the agents themselves. The daemon
// asks once and keeps the answer, so every surface that names a model reads it freely.

/**
 * The models each coding agent offers, `undefined` until the daemon has answered. Remembered for
 * the page's life: every row and pane that names a model reads it, and one mounted later shows
 * the names from its first frame rather than the ids for a moment.
 */
export function useModels(): ModelsView | undefined {
  return useLoaded<ModelsView | undefined>(onModels, undefined, [], { remember: 'models' })
}

/**
 * Every coding agent with the models it listed, by the names it gives them, or a line saying why
 * there are none: the one list every surface that picks a model offers (the start menu, Settings),
 * so the two can never disagree on what a pick may be. No icons: those are the menu's own.
 */
export function driverOptions(models: ModelsView | undefined): DriverOption[] {
  return DRIVERS.map(name => {
    const answer = models?.[name]
    const modelsNote = !answer ? `Asking ${DRIVER_LABELS[name]}…` : 'error' in answer ? answer.error : 'No models listed'
    return {
      value: name,
      label: DRIVER_LABELS[name],
      models: (answer?.models ?? []).map(m => ({ value: m.id, label: m.name })),
      modelsNote,
    }
  })
}

/**
 * A model's name as its agent shows it ("Opus 5.5" for `opus`, and for `claude-opus-5-5`, the full
 * id `opus` runs today). A model the agent does not list, or a list not answered yet, is named by
 * the id itself: that is what the run was given or ran.
 */
export function modelName(models: DriverModels | undefined, id: string): string {
  return (models?.models.find(m => m.id === id) ?? models?.models.find(m => m.resolvedId === id))?.name ?? id
}

/**
 * A model's name as whichever coding agent lists it, for a reader that does not know which agent
 * ran it (a subagent the coding agent started itself runs on the same agent, and says only its
 * model): the id itself when none lists it.
 */
export function anyModelName(models: ModelsView | undefined, id: string): string {
  for (const answer of Object.values(models ?? {})) {
    const name = modelName(answer, id)
    if (name !== id) return name
  }
  return id
}

/**
 * The effort levels the picked model offers, by the coding agent's own names and in its own order
 * (`DriverModel.efforts`). Empty for a model that takes none, for an agent that could not list its
 * models, and before the daemon has answered — the control is simply not there then.
 */
export function modelEfforts(models: ModelsView | undefined, driver: string | undefined, id: string | undefined): readonly string[] {
  if (!driver || !id) return []
  const answer = models?.[driver as DriverName]
  const listed = answer?.models ?? []
  return (listed.find(m => m.id === id) ?? listed.find(m => m.resolvedId === id))?.efforts ?? []
}

/**
 * How much conversation the picked model holds, by the coding agent's own word (Codex says it; for
 * Claude it is what the driver knows of the family). `undefined` for a model nobody has said it
 * of — nothing here guesses one.
 */
export function modelContextWindow(models: ModelsView | undefined, driver: string | undefined, id: string | undefined): number | undefined {
  if (!driver || !id) return undefined
  const listed = models?.[driver as DriverName]?.models ?? []
  return (listed.find(m => m.id === id) ?? listed.find(m => m.resolvedId === id))?.contextWindow
}

export type { DriverModels, ModelsView }

/** A coding agent as a module offers it: its name for the run (`claude-code`), its label, its models, and why it lists none. */
export type CodingAgent = DriverOption

/**
 * Every coding agent with the models it lists (#1902): the start menu's own list, for a module that
 * lets a person pick one, so its picks are the ones a run can be given.
 */
export function useCodingAgents(): CodingAgent[] {
  return driverOptions(useModels())
}
