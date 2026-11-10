import { newestFirst, parseDiary, parseRunCard, runCardFile, runDiaryFile, runIdOfFile, type AnyDiaryLine, type RunCard } from './run.js'

// Walking the runs, through whichever copy of the records is read: this machine's checkout of the
// project's data, or origin's copy read off git. A run is two files in the folder of the person it
// is kept under, `<dir>/<person>/<id>.json` and `<id>.jsonl`; this module is the one place that
// lays them out, for every reader of them.

/** A reader of the records: the entries of a directory by name, and a file's text (`undefined` when it cannot be read). */
export interface RecordsReader {
  list(dir: string): Promise<string[]>
  read(path: string): Promise<string | undefined>
}

/** A run as the listings name it: the person it is kept under, by their folder, and its id. */
export interface RunEntry {
  person: string
  id: string
}

/** One person's runs under `dir`, by id, newest first: from their folder's listing alone, no card read. */
export async function runIdsOf(reader: RecordsReader, dir: string, person: string): Promise<string[]> {
  const ids = (await reader.list(`${dir}/${person}`)).flatMap(name => runIdOfFile(name) ?? [])
  return newestFirst(ids.map(id => ({ id }))).map(run => run.id)
}

/** Every run under `dir`, newest first, from the listings alone. */
export async function runEntries(reader: RecordsReader, dir: string): Promise<RunEntry[]> {
  const entries: RunEntry[] = []
  for (const person of await reader.list(dir)) for (const id of await runIdsOf(reader, dir, person)) entries.push({ person, id })
  return newestFirst(entries)
}

/** The run `id` with the person it is kept under: the first folder under `dir` that holds its card; `undefined` when none does. */
export async function findEntry(reader: RecordsReader, dir: string, id: string): Promise<RunEntry | undefined> {
  for (const person of await reader.list(dir)) if ((await reader.list(`${dir}/${person}`)).includes(runCardFile(id))) return { person, id }
  return undefined
}

/** A run's card, `undefined` when it does not parse. */
export async function readCard(reader: RecordsReader, dir: string, run: RunEntry): Promise<RunCard | undefined> {
  return parseRunCard((await reader.read(`${dir}/${run.person}/${runCardFile(run.id)}`)) ?? '')
}

/** A run's diary, every line: `[]` for a run with no diary file. */
export async function readRunDiary(reader: RecordsReader, dir: string, run: RunEntry): Promise<AnyDiaryLine[]> {
  return parseDiary((await reader.read(`${dir}/${run.person}/${runDiaryFile(run.id)}`)) ?? '')
}
