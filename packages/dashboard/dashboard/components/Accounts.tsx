import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { Skeleton } from './ui/skeleton.js'
import type { DriverName } from '../../src/client.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAgentAccounts } from './AgentAccounts.js'
import { GitHostsCard } from './GitHosts.js'
import { AgentFix, StatePill, agentLoginState, agentWords, useAgentState } from './Logins.js'
import { ModuleSlot } from './ModulePageView.js'
import { Page } from './Page.js'
import { AccountWhere, ServerAsks, ServersProvider } from './ServerLogins.js'

// The Permissions page: every account OpenAgent's agents work with, in one place. An agent can
// reach what its accounts can, and nothing else is a permission. Each account is said once, with
// where it works under it (this computer and the person's servers, `ServerLogins.tsx`), and only
// what a server asks of the person stands above them (his pick over a card that listed every
// account again under each server). The coding agents' accounts are the skill's own card, the same
// as on the Overview, the dashboard filling the line under each row through the card's
// `accountWhere`; the git hosts' are the dashboard's (`GitHosts.tsx`), in the same rows. On a
// server, the page says whose computer's logins it uses.

const ACCOUNT_ROTATION = '@openagt/skill-account-rotation'

/** The Permissions page. */
export function PermissionsPage() {
  return (
    <Page title="Permissions" description="The accounts your agents work with: what an agent can reach is what these accounts can.">
      <AccountsList />
    </Page>
  )
}

/** Every account, as the page lists them. */
export function AccountsList() {
  return (
    <ServersProvider>
      <div className="space-y-4">
        <FromLine />
        <AgentSetup driver="claude-code" title="Claude Code" Logo={ClaudeLogo} />
        <AgentSetup driver="codex" title="Codex" Logo={CodexLogo} />
        <ServerAsks />
        <RotationCard />
        <GitHostsCard />
      </div>
    </ServersProvider>
  )
}

/** The skill's card, as the Overview draws it. */
function RotationCard() {
  const { cards, loaded } = useMountedModules()
  const card = cards.find(each => each.package === ACCOUNT_ROTATION && each.id === 'accounts')
  if (!card)
    return loaded ? (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">The accounts card did not load.</CardContent>
      </Card>
    ) : (
      <Skeleton className="h-32 w-full" />
    )
  return (
    <ModuleSlot package={card.package} label="accounts card">
      <card.Card projects={[]} accountWhere={account => <AccountWhere account={{ kind: account.agent, own: account.own, name: account.name }} />} />
    </ModuleSlot>
  )
}

/** An agent that needs its press before it can run, as a card of the page: its state, and the press that installs it or logs it in. Once it can run, it says so while the page is open, then nothing. */
function AgentSetup({ driver, title, Logo }: { driver: DriverName; title: string; Logo: typeof ClaudeLogo }) {
  const { state, reload } = useAgentState(driver)
  const missing = !!state && !state.ready && (state.fix !== undefined || agentLoginState(state) === 'not-installed')
  const [wasMissing, setWasMissing] = useState(false)
  useEffect(() => {
    if (missing) setWasMissing(true)
  }, [missing])
  if (!state || (!missing && !(wasMissing && state.ready))) return null
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Logo className="size-4 shrink-0" />
          <CardTitle className="min-w-0 flex-1 text-base">{title}</CardTitle>
          <StatePill state={agentLoginState(state)!} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {state.ready ? (
          <p role="status" className="text-sm text-muted-foreground">{`${title} is ready: runs can start with it.`}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{agentWords(state)}</p>
            <AgentFix state={state} variant="outline" onChanged={() => void reload()} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** On a server: whose computer's logins it uses. Nothing elsewhere. */
function FromLine() {
  const from = useAgentAccounts('claude').view?.from
  if (from === undefined) return null
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <p className="text-sm font-medium">{`Your logins and settings from ${from}`}</p>
      <p className="text-xs text-muted-foreground">Log in or out there, or change a setting, and this server follows.</p>
    </div>
  )
}
