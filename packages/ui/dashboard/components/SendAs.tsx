import { useContext } from 'react'
import type { HostAccounts } from '@openagt/hooks'
import { PERMISSIONS_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.js'

// The account OpenAgent sends a repository as (Rom's design: OpenAgent never uses the person's own
// login): one of its own accounts at the repository's host, picked where sending is turned on.

/** The login a select starts on: the one already kept, else the one runs use, else the first. */
export function firstSendAs(host: HostAccounts | undefined, kept?: string): string | undefined {
  if (!host || host.logins.length === 0) return undefined
  if (kept !== undefined && host.logins.includes(kept)) return kept
  return host.runs ?? host.logins[0]
}

/**
 * "Send as": OpenAgent's accounts at `host`, by login. With none there, the line says so and its
 * press opens the Permissions page, where one is added: nothing is sent as the person's own login.
 */
export function SendAs({ host, value, onChange, disabled = false, label = 'Send as' }: { host: HostAccounts | undefined; value: string | undefined; onChange: (login: string) => void; disabled?: boolean; label?: string }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  if (!host || host.logins.length === 0) {
    return (
      <p className="text-xs text-warning">
        OpenAgent has no account{host ? ` at ${host.host}` : ''} to send it as, and never uses your own login.{' '}
        <button type="button" className="underline underline-offset-2" onClick={() => services.openPage(PERMISSIONS_PAGE)}>
          Add one in Permissions
        </button>
        .
      </p>
    )
  }
  const items = host.logins.map(login => ({ value: login, label: `@${login}` }))
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <Select items={items} value={value ?? null} onValueChange={next => next && onChange(String(next))} disabled={disabled}>
        <SelectTrigger aria-label={label} className="h-7 min-w-0">
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
