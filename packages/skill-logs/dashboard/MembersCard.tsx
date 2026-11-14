import { PageLink, PersonMark, RowShapes, Section, Slot, STATUS_DOT, STATUS_TONE, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, formatDateTime, personName, personSaid, useModuleHost, usePolled, type ModuleCardProps, type ModuleHostPerson } from '@openagt/dashboard/module'
import { membersOf, peopleWithRuns, type Member, type PersonActivity } from '../src/people.js'

// The Overview's Members card: who worked in the projects shown in the last 30 days, from `logs
// people --local` in each, the same person counted once, across projects and across the emails of
// one account at the git host: whoever started agents or committed to the main branch. Each by the name git knows them by, with their runs and what
// they cost (as the dashboard lists the runs, so another computer's are as it says them), their
// commits, whether a run of theirs is going now, and when they last did either;
// the person at this computer marked. Its title opens the Logs page, where each run is. Each with
// their picture, where the project's git host knows the account behind their email (asked of the
// shell, which keeps the answer a day); else two letters of their name.

/** A member, with the git host's account behind their email when it knows one. */
type Shown = Member & { account?: ModuleHostPerson }

const NONE: Shown[] = []

/** How many days back the card looks. */
const DAYS = 30

/** What a person did in those days, in a few words: "63 runs · $13.70 · 416 commits", "5 commits". */
function didWords(member: Member): string {
  const parts = [
    member.runs > 0 ? `${member.runs === 1 ? '1 run' : `${member.runs} runs`}${member.cost > 0 ? ` · $${member.cost.toFixed(2)}` : ''}` : undefined,
    member.commits > 0 ? (member.commits === 1 ? '1 commit' : `${member.commits} commits`) : undefined,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing in the last 30 days'
}

export function MembersCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const key = projects.map(project => project.id).join(',')
  const { value: members, state } = usePolled<Shown[]>(
    async () => {
      const reads = await Promise.all(
        projects.map(async project => {
          const since = Date.now() - DAYS * 86_400_000
          // The runs of those days only: a project keeps hundreds, and a phone downloads every one asked for.
          const [result, runs] = await Promise.all([host.runCommand(project.id, ['people', '--local', '--days', String(DAYS)]), host.agents(project.id, { since: new Date(since).toISOString() }).catch(() => undefined)])
          const recorded = result.ok && Array.isArray(result.output) ? (result.output as PersonActivity[]) : []
          // The runs as the dashboard lists them, each computer's by its own word: a record stops at what was shared last.
          const people = runs ? peopleWithRuns(recorded, runs, since) : recorded
          // Each project's git host is asked of its own people: another project may be on another host.
          const accounts = people.length ? await host.gitHostPeople(project.id, people.map(person => person.person)).catch(() => []) : []
          return { project: project.name, people, accounts }
        }),
      )
      const accounts = new Map(reads.flatMap(read => read.accounts).map(account => [account.email.toLowerCase(), account] as const))
      return membersOf(reads, person => accounts.get(person.toLowerCase())?.login).map(member => {
        const account = accounts.get(member.person.toLowerCase())
        return account ? { ...member, account } : member
      })
    },
    NONE,
    // A local read of 30 days of records: a glance, not a feed.
    60_000,
    [key],
    // Kept for the next visit: the page opens with the last members, faded until they are read again.
    { remember: `skill-logs:members:${key}`, stored: true },
  )
  return (
    <Section title="Members" count={state !== 'unknown' && members.length > 0 ? members.length : undefined} action={<PageLink href={host.pageHref('logs')} onOpen={() => host.openPage('logs')}>Logs</PageLink>}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">Who worked here in the last 30 days: agents started, commits</p>
      <Slot of={{ state, value: members }} shape={<RowShapes />}>
        {() => members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has started an agent here yet.</p>
        ) : (
          <ul className="space-y-1">
            {members.map(member => (
              <li key={member.person} aria-label={personName(member.person, member.name)} className="flex min-w-0 items-center gap-3 md:min-h-10 max-md:min-h-11">
                <PersonMark email={member.person} name={member.name} picture={member.account?.avatar} you={member.you} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="min-w-0 truncate font-medium" title={personSaid(member.person, member.account)}>
                      {personName(member.person, member.name)}
                    </span>
                    {member.you && <span className="shrink-0 text-xs text-muted-foreground">you</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums" title={projects.length > 1 ? `In ${member.projects.join(', ')}` : undefined}>
                    {didWords(member)}
                  </p>
                </div>
                {member.running > 0 ? (
                  <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', STATUS_TONE['running'])}>
                    <span aria-hidden className={cn('size-1.5 rounded-full', STATUS_DOT['running'])} />
                    {member.running === 1 ? 'working' : `${member.running} working`}
                  </span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span className="shrink-0 text-xs text-muted-foreground tabular-nums" />}>{formatAge(member.lastAt)}</TooltipTrigger>
                    <TooltipContent>Last active {formatDateTime(member.lastAt)}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Slot>
    </Section>
  )
}
