import type { SendAsHost } from '../rpc/personal-folder.js'
import { openPermissions } from '../lib/use-route.js'
import { useAddGitAccount } from './AddGitAccount.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'

// The account OpenAgent sends a repository as (Rom's design: OpenAgent never uses the person's own
// login): one of its own accounts at the repository's host, picked where sending is turned on.

/** The login a select starts on: the one already kept, else the one runs use, else the first. */
export function firstSendAs(host: SendAsHost | undefined, kept?: string): string | undefined {
  if (!host || host.logins.length === 0) return undefined
  if (kept !== undefined && host.logins.includes(kept)) return kept
  return host.runs ?? host.logins[0]
}

/**
 * "Send as": OpenAgent's accounts at `host`, by login. With none there, the line says so and its
 * press adds one, in the dialog, which is then the one picked: nothing is sent as the person's own
 * login. With no host known, the press opens the Permissions page.
 */
export function SendAs({ host, value, onChange, disabled = false, label = 'Send as' }: { host: SendAsHost | undefined; value: string | undefined; onChange: (login: string) => void; disabled?: boolean; label?: string }) {
  const adding = useAddGitAccount(login => onChange(login))
  if (!host || host.logins.length === 0) {
    return (
      <p className="text-xs text-warning">
        OpenAgent has no account{host ? ` at ${host.host}` : ''} to send it as, and never uses your own login.{' '}
        <button type="button" className="underline underline-offset-2" onClick={host ? () => adding.add(host.host) : openPermissions}>
          {host ? 'Add one' : 'Add one in Permissions'}
        </button>
        .{adding.dialog}
      </p>
    )
  }
  const items = host.logins.map(login => ({ value: login, label: `@${login}` }))
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <Select items={items} value={value ?? null} onValueChange={next => next && onChange(String(next))} disabled={disabled}>
        <SelectTrigger size="sm" aria-label={label} className="h-7 min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
