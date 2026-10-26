import { newestFirst, parseRunCard, runCardFile, runIdOfFile } from './run.js'

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

/** A reader of the records: the folders under a directory, and a file's text. */
export interface RecordsReader {
  list(dir: string): Promise<string[]>
  read(path: string): Promise<string | undefined>
}

/** When a run started, from its id alone: `2026-10-25T00-36-42-115Z` is that time in UTC. */
export function startOfId(id: string): number {
  return Date.parse(id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'))
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
    const ids = newestFirst((await reader.list(`${dir}/${folder}`)).flatMap(name => runIdOfFile(name) ?? []).map(id => ({ id })))
    if (ids.length === 0) continue
    const person = entry(folder, startOfId(ids[0]!.id))
    for (const { id } of ids) {
      if (!(startOfId(id) >= since)) break
      const card = parseRunCard((await reader.read(`${dir}/${folder}/${runCardFile(id)}`)) ?? '')
      if (!card) continue
      person.runs++
      if (card.status === 'running') person.running++
      person.cost += card.cost ?? 0
    }
    person.cost = Math.round(person.cost * 100) / 100
  }
  // The commits, newest first: a person's name is the one their newest commit carries.
  for (const commit of commits) {
    if (NO_PERSON.test(commit.email)) continue
    const known = byEmail.get(commit.email.toLowerCase())
    if (commit.at < since && !known) continue
    const person = known ?? entry(commit.email, commit.at)
    person.name ??= commit.name
    if (commit.at >= since) {
      person.commits++
      if (new Date(commit.at).toISOString() > person.lastAt) person.lastAt = new Date(commit.at).toISOString()
    }
  }
  return [...byEmail.values()].sort((a, b) => b.runs + b.commits - (a.runs + a.commits) || b.lastAt.localeCompare(a.lastAt))
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
    .map(person => ({ ...person, cost: Math.round(person.cost * 100) / 100 }))
    .sort((a, b) => b.runs + b.commits - (a.runs + a.commits) || b.lastAt.localeCompare(a.lastAt))
}

/** One person, over every project shown. */
export interface Member extends PersonActivity {
  /** The projects they ran in, by name. */
  projects: string[]
}

/** The same person's activity in several projects, as one. */
export function membersOf(reads: { project: string; people: PersonActivity[] }[]): Member[] {
  const byPerson = new Map<string, Member>()
  for (const { project, people } of reads)
    for (const activity of people) {
      const key = activity.person.toLowerCase()
      const known = byPerson.get(key)
      if (!known) {
        byPerson.set(key, { ...activity, projects: [project] })
        continue
      }
      known.runs += activity.runs
      known.commits += activity.commits
      if (known.name === undefined && activity.name !== undefined) known.name = activity.name
      known.running += activity.running
      known.cost = Math.round((known.cost + activity.cost) * 100) / 100
      if (activity.lastAt > known.lastAt) known.lastAt = activity.lastAt
      if (activity.you) known.you = true
      known.projects.push(project)
    }
  return [...byPerson.values()].sort((a, b) => Number(b.running > 0) - Number(a.running > 0) || b.runs + b.commits - (a.runs + a.commits) || b.lastAt.localeCompare(a.lastAt))
}

/** An email name that says nothing of whose it is: the domain names them instead. */
const GENERIC = new Set(['git', 'me', 'mail', 'email', 'hello', 'hi', 'info', 'contact', 'dev', 'noreply', 'no-reply'])

/** The name a person goes by here: the one git knows them by, else one drawn from their email ({@link emailName}). */
export function nameOf(member: Pick<PersonActivity, 'person' | 'name'>): string {
  return member.name?.trim() || emailName(member.person)
}

/**
 * A name drawn from an email: its name
 * (`suleiman@averotech.com` is suleiman), or the domain's when the name is a generic word
 * (`git@brillout.com` is brillout). The whole email is shown on hover.
 */
export function emailName(person: string): string {
  const [name = '', domain = ''] = person.split('@')
  if (GENERIC.has(name.toLowerCase()) && domain) return domain.split('.')[0] || person
  return name || person
}
