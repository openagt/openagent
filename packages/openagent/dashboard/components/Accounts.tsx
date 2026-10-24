import { useAgentAccounts, AccountsCard } from './AgentAccounts.js'
import { GitHostCards } from './GitHosts.js'
import { ServerBars, ServersProvider } from './ServerLogins.js'

// Settings › Accounts: every login runs use, the coding agents' and the git hosts', in one place.
// On a computer of the person's, each server of theirs that uses its logins says how they stand
// there (`ServerLogins.tsx`). On a server, the page says whose computer's logins it uses.

/** Settings › Accounts. */
export function AccountsSettings() {
  return (
    <ServersProvider>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Runs use these accounts. When one hits its limit, the next free one takes the run over where it stopped.</p>
        <FromLine />
        <ServerBars />
        <h3 className="pt-1 text-sm font-medium">Coding agents</h3>
        <AccountsCard agent="claude" />
        <AccountsCard agent="codex" />
        <h3 className="pt-1 text-sm font-medium">Git hosts</h3>
        <GitHostCards />
      </div>
    </ServersProvider>
  )
}

/** On a server: whose computer's logins it uses. Nothing elsewhere. */
function FromLine() {
  const claude = useAgentAccounts('claude').view?.from
  const codex = useAgentAccounts('codex').view?.from
  const from = claude ?? codex
  if (from === undefined) return null
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <p className="text-sm font-medium">{`Your logins and settings from ${from}`}</p>
      <p className="text-xs text-muted-foreground">Log in or out there, or change a setting, and this server follows.</p>
    </div>
  )
}

