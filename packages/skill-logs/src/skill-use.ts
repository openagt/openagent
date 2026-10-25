import { newestFirst, parseDiary, parseRunCard, runCardFile, runDiaryFile, runIdOfFile } from './run.js'
import { startOfId, type RecordsReader } from './people.js'

// Which skills a project's agents used, as their runs' records tell it: a skill an agent loaded
// (its coding agent's Skill step, kept in the run's diary), and a skill a run was started with (its
// ask is the skill's command, `/work-queue`). Only the runs of the days asked for are read: an id
// says when its run started, so the rest are passed over unread.

/** One skill's use, as `logs skills` says it. */
export interface SkillUse {
  skill: string
  /** How many times agents loaded it, or a run was started with it. */
  uses: number
  /** In how many runs. */
  runs: number
  /** When it was last used, ISO. */
  lastAt: string
}

/** The skill a run was started with: its ask's command, `/work-queue …` is work-queue. */
const COMMAND = /^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/

/** Each skill used under `dir` since `since`, the most used first. */
export async function skillUseOf(reader: RecordsReader, dir: string, since: number): Promise<SkillUse[]> {
  const bySkill = new Map<string, SkillUse & { inRuns: Set<string> }>()
  const used = (skill: string, run: string, at: string): void => {
    const known = bySkill.get(skill) ?? { skill, uses: 0, runs: 0, lastAt: at, inRuns: new Set<string>() }
    known.uses++
    known.inRuns.add(run)
    if (at > known.lastAt) known.lastAt = at
    bySkill.set(skill, known)
  }
  for (const person of await reader.list(dir)) {
    const ids = newestFirst((await reader.list(`${dir}/${person}`)).flatMap(name => runIdOfFile(name) ?? []).map(id => ({ id })))
    for (const { id } of ids) {
      if (!(startOfId(id) >= since)) break
      const started = new Date(startOfId(id)).toISOString()
      const card = parseRunCard((await reader.read(`${dir}/${person}/${runCardFile(id)}`)) ?? '')
      const command = card?.intent ? COMMAND.exec(card.intent.trim())?.[1] : undefined
      if (command) used(command, id, started)
      for (const line of parseDiary((await reader.read(`${dir}/${person}/${runDiaryFile(id)}`)) ?? '')) {
        const step = line as { kind: string; label?: unknown; detail?: unknown; at?: unknown }
        if (step.kind === 'action' && step.label === 'Skill' && typeof step.detail === 'string' && step.detail) used(step.detail, id, typeof step.at === 'string' ? step.at : started)
      }
    }
  }
  return [...bySkill.values()].map(({ inRuns, ...use }) => ({ ...use, runs: inRuns.size })).sort((a, b) => b.uses - a.uses || b.lastAt.localeCompare(a.lastAt))
}
