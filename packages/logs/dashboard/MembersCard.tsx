import { Users } from 'lucide-react'
import { Facts, PageLink, Panel, PanelGroup, PanelNote, PartDescription, PersonMark, PanelShape, RunMark, Slot, Tooltip, TooltipContent, TooltipTrigger, formatAge, formatDateTime, personName, personSaid, rpcClient, runWord, useModuleHost, usePolled, type UiCardProps, type ModuleHostPerson } from '@openagt/ui/module'
import { membersOf, peopleWithRuns, type Member, type PersonActivity } from '../src/people.js'

// The Overview's Members card: who worked in the projects shown in the last 30 days, as the
// package's server part reads each (what `logs people --local` prints), the same person counted
// once, across projects and across the emails of one account at the git host: whoever started
// agents or committed to the main branch. Each by the name git knows them by, with their runs and
// what they cost (as the dashboard lists the runs), their commits, whether a run of theirs is
// going now or waits on an answer, and when they last did either; the person at this computer
// marked. Its title opens the Logs page, where each run is.
// Each with their picture, where the project's git host knows the account behind their email
// (asked of the shell, which keeps the answer a day); else two letters of their name.

/** A member, with the git host's account behind their email when it knows one. */
type Shown = Member & { account?: ModuleHostPerson }

const NONE: Shown[] = []

/** How many days back the card looks. */
const DAYS = 30

/** What a person did in those days, as facts of a line: "63 runs", "$13.70", "416 commits"; none when they did nothing. */
function didFacts(member: Member): string[] {
  return [
    member.runs > 0 && (member.runs === 1 ? '1 run' : `${member.runs} runs`),
    member.runs > 0 && member.cost > 0 && `$${member.cost.toFixed(2)}`,
    member.commits > 0 && (member.commits === 1 ? '1 commit' : `${member.commits} commits`),
  ].filter(fact => fact !== false)
}

/** How many runs of a member stand one way now, by their state's mark and word: "working", "needs answer", and counted "2 working", "2 need an answer". */
function Going({ status, count }: { status: 'running' | 'waiting'; count: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <RunMark status={status} className="size-3" />
      {count === 1 ? runWord(status) : status === 'waiting' ? `${count} need an answer` : `${count} ${runWord(status)}`}
    </span>
  )
}

export function MembersCard({ projects }: UiCardProps) {
  const host = useModuleHost()
  const key = projects.map(project => project.id).join(',')
  const { value: members, state } = usePolled<Shown[]>(
    async () => {
      const server = rpcClient<typeof import('../src/server.js')>(host)
      const reads = await Promise.all(
        projects.map(async project => {
          const since = Date.now() - DAYS * 86_400_000
          // A project whose records cannot be read counts no one, and the others still do. Of the runs
          // the dashboard lists, those of these days only: a project keeps hundreds, and a phone
          // downloads every one asked for.
          const [recorded, runs] = await Promise.all([
            server.people(project.id, { days: DAYS }).catch((): PersonActivity[] => []),
            host.agents(project.id, { since: new Date(since).toISOString() }).catch(() => undefined),
          ])
          // The runs as the dashboard lists them, each computer's by its own word: a record stops at what was shared last.
          const people = runs ? peopleWithRuns(recorded, runs, since) : recorded
          // Each project's git host is asked of its own people: another project may be on another host.
          const accounts = people.length ? await host.people(project.id, people.map(person => person.person)).catch(() => []) : []
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
    { remember: `logs:members:${key}`, stored: true },
  )
  return (
    <PanelGroup bare title="Members" action={<PageLink href={host.pageHref('logs')} onOpen={() => host.openPage('logs')}>Logs</PageLink>}>
      <PartDescription>Who started agents or made commits here in the last 30 days</PartDescription>
      <Slot of={{ state, value: members }} shape={<PanelShape />}>
        {() => (
          <Panel>
            {members.length === 0 && <PanelNote icon={Users}>No one has started an agent here yet.</PanelNote>}
            {members.map(member => (
              <li key={member.person} aria-label={personName(member.person, member.name)} className="relative flex min-w-0 items-center gap-3 px-4 py-3 before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline">
                <PersonMark email={member.person} name={member.name} picture={member.account?.avatar} you={member.you} />
                <div className="min-w-0 flex-1">
                  {/* The name, then how many of their runs stand one way now at the line's end; where the card is too
                      narrow for both, those go under the name's line, so the name is cut only where it alone is wider. */}
                  <div className="flex flex-wrap items-center gap-x-3">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm">
                      <span className="min-w-0 truncate font-medium" title={personSaid(member.person, member.account)}>
                        {personName(member.person, member.name)}
                      </span>
                      {member.you && <span className="shrink-0 text-xs text-faint-foreground">you</span>}
                    </p>
                    {(member.running > 0 || member.waiting > 0) && (
                      <span className="ml-auto flex h-5 shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        {member.running > 0 && <Going status="running" count={member.running} />}
                        {member.waiting > 0 && <Going status="waiting" count={member.waiting} />}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-faint-foreground tabular-nums" title={projects.length > 1 ? `In ${member.projects.join(', ')}` : undefined}>
                    {didFacts(member).length > 0 ? <Facts facts={didFacts(member)} /> : 'Nothing in the last 30 days'}
                  </p>
                </div>
                {member.running > 0 || member.waiting > 0 ? null : (
                  <Tooltip>
                    <TooltipTrigger render={<span className="shrink-0 text-xs text-faint-foreground tabular-nums" />}>{formatAge(member.lastAt)}</TooltipTrigger>
                    <TooltipContent>Last active {formatDateTime(member.lastAt)}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </Panel>
        )}
      </Slot>
    </PanelGroup>
  )
}
