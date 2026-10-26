import { useState } from 'react'
import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitleLink, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, formatDateTime, useModuleHost, usePolled, type ModuleCardProps, type ModuleHostPerson } from '@openagt/dashboard/module'
import { membersOf, nameOf, peopleWithRuns, type Member, type PersonActivity } from '../src/people.js'

// The Overview's Members card: who worked in the projects shown in the last 30 days, from `logs
// people --local` in each, the same person in several projects counted once: whoever started agents
// or committed to the main branch. Each by the name git knows them by, with their runs and what
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

/** Two letters for a person's mark, from their name: "Romuald Brillout" is RB, "suleiman" is SU. */
function initials(member: Member): string {
  const name = nameOf(member)
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : name.slice(0, 2)).toUpperCase()
}

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
  const { value: members, loaded } = usePolled<Shown[]>(
    async () => {
      const reads = await Promise.all(
        projects.map(async project => {
          const [result, runs] = await Promise.all([host.runCommand(project.id, ['people', '--local', '--days', String(DAYS)]), host.agents(project.id).catch(() => undefined)])
          const recorded = result.ok && Array.isArray(result.output) ? (result.output as PersonActivity[]) : []
          // The runs as the dashboard lists them, each computer's by its own word: a record stops at what was shared last.
          const people = runs ? peopleWithRuns(recorded, runs, Date.now() - DAYS * 86_400_000) : recorded
          // Each project's git host is asked of its own people: another project may be on another host.
          const accounts = people.length ? await host.gitHostPeople(project.id, people.map(person => person.person)).catch(() => []) : []
          return { project: project.name, people, accounts }
        }),
      )
      const accounts = new Map(reads.flatMap(read => read.accounts).map(account => [account.email.toLowerCase(), account] as const))
      return membersOf(reads).map(member => {
        const account = accounts.get(member.person.toLowerCase())
        return account ? { ...member, account } : member
      })
    },
    NONE,
    // A local read of a week of records: a glance, not a feed.
    60_000,
    [key],
    // Kept for the next visit: the page opens with the last members, faded until they are read again.
    { remember: `skill-logs:members:${key}`, stored: true },
  )
  return (
    <Card>
      <CardHeader>
        <CardTitleLink icon={<Users className="h-4 w-4 text-muted-foreground" aria-hidden />} segment="logs" onOpen={() => host.openPage('logs')}>
          Members
        </CardTitleLink>
        <p className="text-xs text-muted-foreground">Who worked here in the last 30 days: agents started, commits</p>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has started an agent here yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {members.map(member => (
              <li key={member.person} aria-label={nameOf(member)} className="flex min-w-0 items-center gap-2.5">
                <Avatar member={member} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="min-w-0 truncate font-medium" title={member.account ? `${member.person} · ${member.account.login}` : member.person}>
                      {nameOf(member)}
                    </span>
                    {member.you && <span className="shrink-0 text-xs text-muted-foreground">you</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular-nums" title={projects.length > 1 ? `In ${member.projects.join(', ')}` : undefined}>
                    {didWords(member)}
                  </p>
                </div>
                {member.running > 0 ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-success">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
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
      </CardContent>
    </Card>
  )
}

/** A member's picture from their git host, else two letters of their name; a picture that does not load gives way to the letters. */
function Avatar({ member }: { member: Shown }) {
  const [broken, setBroken] = useState(false)
  const picture = member.account?.avatar
  if (picture && !broken) return <img src={picture} alt="" onError={() => setBroken(true)} className={cn('size-7 shrink-0 rounded-full object-cover', member.you && 'ring-2 ring-primary/40')} />
  return (
    <span aria-hidden className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', member.you ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
      {initials(member)}
    </span>
  )
}
