import { useState } from 'react'
import { CircleAlert, MoreHorizontal } from 'lucide-react'
import { SettingsRow, SettingsSection } from './SettingsRows.js'
import { Switch } from './ui/switch.js'
import { Input } from './ui/input.js'
import { Button } from './ui/button.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.js'
import { Avatar } from './PersonMenu.js'
import { SignInSteps } from './TeamSignIn.js'
import { formatAge } from '../lib/format-date.js'
import { teamCall, useTeam, type TeamPerson } from '../lib/team.js'

// Settings › Team (his pick 2A, 11-27): Team mode, which shares this machine with a team. Off, as
// on every laptop, nobody signs in. Turning it on is signing in with GitHub: whoever does owns it,
// and alone adds people by their GitHub username, removes them, and turns it off. The people added
// see the list, without its presses.

export const TEAM_ENTRY = 'team'

const SWITCH_WORDS = 'The people you add here can sign in and run agents on this machine. Nobody gets in without signing in.'

export function TeamSettings() {
  const { team, reload } = useTeam()
  const [turningOn, setTurningOn] = useState(false)
  const [turningOff, setTurningOff] = useState(false)
  if (!team.on)
    return (
      <SettingsSection description="Share this machine with your team: each person signs in with GitHub, as themselves.">
        <SettingsRow
          label="Share this machine with your teammates"
          description={SWITCH_WORDS}
          labelFor="team-mode"
          control={<Switch id="team-mode" checked={turningOn} onCheckedChange={setTurningOn} />}
        />
        {turningOn && (
          <div className="max-w-sm">
            <SignInSteps
              turnOn
              start="start"
              onDone={() => location.reload()}
              onCancel={() => setTurningOn(false)}
              title="Sign in with GitHub first"
              words="You become this machine’s owner: the one who adds people and turns this off."
            />
          </div>
        )}
      </SettingsSection>
    )
  const isOwner = team.person !== undefined && team.person.login.toLowerCase() === team.owner.login.toLowerCase()
  return (
    <SettingsSection description="Share this machine with your team: each person signs in with GitHub, as themselves.">
      <SettingsRow
        label="Share this machine with your teammates"
        description={isOwner ? SWITCH_WORDS : `Only @${team.owner.login} changes this.`}
        labelFor="team-mode"
        dimmed={!isOwner}
        control={<Switch id="team-mode" checked disabled={!isOwner} onCheckedChange={on => !on && setTurningOff(true)} />}
      />
      <ConfirmDialog
        open={turningOff}
        onOpenChange={setTurningOff}
        title="Turn Team mode off?"
        body="Nobody stays signed in, and anyone who can open this machine’s address gets in with no sign-in. The people you added are kept for when you turn it on again."
        confirmLabel="Turn off"
        onConfirm={async () => {
          const answer = await teamCall<{ ok: true }>('/off')
          if ('error' in answer) throw new Error(answer.error)
        }}
        onSuccess={() => location.reload()}
      />
      <Members owner={team.owner} members={team.members ?? []} isOwner={isOwner} onChanged={reload} />
      {isOwner && <AddTeammate onAdded={reload} />}
      {isOwner && <p className="text-xs text-faint-foreground">Locked out? On this machine, delete ~/.openagent-team.json: Team mode is then off.</p>}
    </SettingsSection>
  )
}

function Members({ owner, members, isOwner, onChanged }: { owner: TeamPerson; members: { login: string; added: string; person?: TeamPerson; signedIn?: string }[]; isOwner: boolean; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | undefined>()
  const remove = async (login: string) => {
    const answer = await teamCall<{ ok: true }>('/members/remove', { login })
    setError('error' in answer ? answer.error : undefined)
    await onChanged()
  }
  return (
    <div className="space-y-2">
      <ul aria-label="Teammates" className="divide-y divide-hairline rounded-lg border border-hairline bg-card px-4">
        <MemberRow person={owner} login={owner.login} detail="owner" />
        {members.map(member => (
          <MemberRow
            key={member.login}
            {...(member.person ? { person: member.person } : {})}
            login={member.login}
            detail={member.signedIn ? `signed in ${formatAge(member.signedIn)}` : 'not signed in yet'}
            {...(isOwner ? { onRemove: () => void remove(member.login) } : {})}
          />
        ))}
      </ul>
      {error !== undefined && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

function MemberRow({ person, login, detail, onRemove }: { person?: TeamPerson; login: string; detail: string; onRemove?: () => void }) {
  const name = person?.name ?? login
  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar person={{ name, ...(person?.avatar ? { avatar: person.avatar } : {}) }} size="size-6 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          @{login} · {detail}
        </p>
      </div>
      {onRemove && (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`More for @${login}`} className="focus-ring flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
            <MoreHorizontal className="size-4" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRemove}>Remove from the team</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

function AddTeammate({ onAdded }: { onAdded: () => Promise<void> }) {
  const [login, setLogin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const add = async () => {
    setBusy(true)
    const answer = await teamCall<{ ok: true }>('/members/add', { login })
    setBusy(false)
    if ('error' in answer) return setError(answer.error)
    setError(undefined)
    setLogin('')
    await onAdded()
  }
  return (
    <form
      className="space-y-2"
      onSubmit={event => {
        event.preventDefault()
        if (login.trim()) void add()
      }}
    >
      <div className="flex gap-2">
        <Input aria-label="GitHub username" placeholder="GitHub username" value={login} onChange={event => setLogin(event.target.value)} className="flex-1" />
        <Button type="submit" variant="secondary" loading={busy} disabled={!login.trim()}>
          Add teammate
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </form>
  )
}
