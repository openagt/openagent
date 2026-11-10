import { startOfId } from './run.js'
import { readCard, runIdsOf, type RecordsReader } from './records.js'

// Who works in a project: whoever started runs there, as its records tell it (each run is kept
// under the person who started it, so the people are the records' own folders), and whoever
// committed to its main branch. For each, in the last days, their runs (how many, what they cost,
// how many are going now) and their commits, when they last did either, and the name git knows
// them by. Only the runs of those days are read: an id says when its run started, so the rest are
// passed over unread.

/** What a person did in the project, as `logs people` says it. */
export interface PersonActivity {
  /** Their email: the folder their runs are kept in, and what their commits are signed with. */
  person: string
  /** The name their commits carry, when git knows one. */
  name?: string
  /** Runs they started in the days asked for. */
  runs: number
  /** Of those, how many are going now. */
  running: number
  /** What those runs cost, in US dollars. */
  cost: number
  /** Commits of theirs on the main branch in those days. */
  commits: number
  /** When they last started a run or made a commit, ISO. */
  lastAt: string
  /** It is the person at this computer, by its git email. */
  you?: true
}

/** A commit of the main branch, as `git log --format=%ae%x09%an%x09%at` says it. */
export interface CommitLine {
  email: string
  name: string
  /** When, in ms. */
  at: number
}

/** The commit lines of `git log --format=%ae%x09%an%x09%at`, newest first; a line that does not read is skipped. */
export function readCommitLines(text: string): CommitLine[] {
  return text.split('\n').flatMap(line => {
    const [email, name, seconds] = line.split('\t')
    return email && name && seconds && /^\d+$/.test(seconds) ? [{ email, name, at: Number(seconds) * 1000 }] : []
  })
}

/** An address no person reads (a bot's, a tool's): its commits are no member's. */
const NO_PERSON = /noreply|no-reply|\[bot\]/i

/** GitHub's own address for a person's account, what a server's git signs with: it says no-reply, and is theirs. A bot's has `[bot]` in it. */
const PERSONS_OWN_ADDRESS = /^[^[\]]+@users\.noreply\.github\.com$/i

/** The busiest first: the most runs and commits together, then the most lately active. */
function busiestFirst(a: PersonActivity, b: PersonActivity): number {
  return b.runs + b.commits - (a.runs + a.commits) || b.lastAt.localeCompare(a.lastAt)
}

/** A sum of US dollars, to the cent. */
function toCents(usd: number): number {
  return Math.round(usd * 100) / 100
}

/**
 * Each person who started runs under `dir` or made commits among `commits`, the busiest first:
 * their runs and commits since `since`, when they last did either, and their name from the commits.
 */
export async function peopleOf(reader: RecordsReader, dir: string, since: number, me: string | undefined, commits: CommitLine[] = []): Promise<PersonActivity[]> {
  const byEmail = new Map<string, PersonActivity>()
  const isMe = (email: string): boolean => me !== undefined && email.toLowerCase() === me.toLowerCase()
  const entry = (email: string, at: number): PersonActivity => {
    const key = email.toLowerCase()
    let person = byEmail.get(key)
    if (!person) byEmail.set(key, (person = { person: email, runs: 0, running: 0, cost: 0, commits: 0, lastAt: new Date(at).toISOString(), ...(isMe(email) ? { you: true as const } : {}) }))
    if (new Date(at).toISOString() > person.lastAt) person.lastAt = new Date(at).toISOString()
    return person
  }
  for (const folder of await reader.list(dir)) {
    const ids = await runIdsOf(reader, dir, folder)
    if (ids.length === 0) continue
    const person = entry(folder, startOfId(ids[0]!))
    for (const id of ids) {
      if (!(startOfId(id) >= since)) break
      const card = await readCard(reader, dir, { person: folder, id })
      if (!card) continue
      person.runs++
      if (card.status === 'running') person.running++
      person.cost += card.cost ?? 0
    }
    person.cost = toCents(person.cost)
  }
  // The commits, newest first: a person's name is the one their newest commit carries.
  for (const commit of commits) {
    if (NO_PERSON.test(commit.email) && !PERSONS_OWN_ADDRESS.test(commit.email)) continue
    const known = byEmail.get(commit.email.toLowerCase())
    if (commit.at < since && !known) continue
    const person = known ?? entry(commit.email, commit.at)
    person.name ??= commit.name
    if (commit.at >= since) {
      person.commits++
      if (new Date(commit.at).toISOString() > person.lastAt) person.lastAt = new Date(commit.at).toISOString()
    }
  }
  return [...byEmail.values()].sort(busiestFirst)
}

/** A run as the dashboard lists it: whose it is, when it started, how it stands, what it cost. */
export interface RunAsListed {
  person?: string
  startedAt: string
  status: string
  cost?: number
}

/**
 * A project's people with their runs counted from the runs as the dashboard lists them, not from
 * the records: a record stops at what its computer shared last, and the dashboard asks the
 * computers themselves how their runs stand. Their commits and names stay as git says them; a
 * person with runs since `since` that no record has yet is added.
 */
export function peopleWithRuns(people: readonly PersonActivity[], runs: readonly RunAsListed[], since: number): PersonActivity[] {
  const byEmail = new Map(people.map(person => [person.person.toLowerCase(), { ...person, runs: 0, running: 0, cost: 0 }]))
  for (const run of runs) {
    if (run.person === undefined || !(Date.parse(run.startedAt) >= since)) continue
    const key = run.person.toLowerCase()
    let person = byEmail.get(key)
    if (!person) byEmail.set(key, (person = { person: run.person, runs: 0, running: 0, cost: 0, commits: 0, lastAt: run.startedAt }))
    person.runs++
    if (run.status === 'running') person.running++
    person.cost += run.cost ?? 0
    if (run.startedAt > person.lastAt) person.lastAt = run.startedAt
  }
  return [...byEmail.values()]
    .map(person => ({ ...person, cost: toCents(person.cost) }))
    .sort(busiestFirst)
}

/** One person, over every project shown. */
export interface Member extends PersonActivity {
  /** The projects they ran in, by name. */
  projects: string[]
}

/**
 * The same person's activity in several projects, as one. `account` says the git host's account
 * behind an email, when it knows one: a person's two emails on one account are one person too, as
 * when a server signs with GitHub's own address and their laptop with their own.
 */
export function membersOf(reads: { project: string; people: PersonActivity[] }[], account: (person: string) => string | undefined = () => undefined): Member[] {
  const byPerson = new Map<string, Member>()
  for (const { project, people } of reads)
    for (const activity of people) {
      const key = (account(activity.person) ?? activity.person).toLowerCase()
      const known = byPerson.get(key)
      if (!known) {
        byPerson.set(key, { ...activity, projects: [project] })
        continue
      }
      known.runs += activity.runs
      known.commits += activity.commits
      if (known.name === undefined && activity.name !== undefined) known.name = activity.name
      known.running += activity.running
      known.cost = toCents(known.cost + activity.cost)
      if (activity.lastAt > known.lastAt) known.lastAt = activity.lastAt
      if (activity.you) known.you = true
      if (!known.projects.includes(project)) known.projects.push(project)
    }
  return [...byPerson.values()].sort((a, b) => Number(b.running > 0) - Number(a.running > 0) || busiestFirst(a, b))
}
