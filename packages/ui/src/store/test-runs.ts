import { parseRunCard, type AnyDiaryLine, type RunCard, type RunsFor, type RunsSource } from './runs.js'

/** One finished run a test seeds: its card (a whole card, or just its fields) and its diary. */
export interface TestRun {
  card: Partial<RunCard> & Pick<RunCard, 'id' | 'status'>
  diary?: AnyDiaryLine[]
}

/**
 * A runs provider as a test would have it: the finished runs of every project held in memory,
 * answering what a real provider's command would. `writes` records every remove and patch, and
 * the runs change the way the command would change them.
 */
export function testRuns(byProject: Record<string, TestRun[]> = {}): RunsFor & { writes: string[] } {
  const writes: string[] = []
  const runs = new Map(Object.entries(byProject).map(([root, list]) => [root, list.map(run => ({ card: parseRunCard({ startedAt: '2026-07-04T00:00:00.000Z', ...run.card })!, diary: run.diary ?? [] }))]))
  const sourceFor = (root: string): RunsSource => ({
    async list() {
      return [...(runs.get(root) ?? [])].map(run => run.card).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    },
    async show(id) {
      const run = runs.get(root)?.find(r => r.card.id === id)
      return run && { card: run.card, diary: run.diary }
    },
    async remove(id) {
      writes.push(`delete ${id}`)
      const list = runs.get(root) ?? []
      if (!list.some(r => r.card.id === id)) return { ok: false, error: `no run is named ${id}` }
      runs.set(root, list.filter(r => r.card.id !== id))
      return { ok: true }
    },
    async patch(id, patch) {
      writes.push(`patch ${id} ${JSON.stringify(patch)}`)
      const run = runs.get(root)?.find(r => r.card.id === id)
      if (!run) return { ok: false, error: `no run is named ${id}` }
      run.card = { ...run.card, ...patch }
      return { ok: true }
    },
  })
  return Object.assign(async (root: string) => (runs.has(root) ? sourceFor(root) : undefined), { writes })
}
