import { Card, CardContent } from './ui/card.js'
import { ClaudeLogo, CodexLogo } from './driver-logos.js'
import { Skeleton } from './ui/skeleton.js'
import type { DriverName } from '../../src/client.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAgentAccounts } from './AgentAccounts.js'
import { GitHostsCard } from './GitHosts.js'
import { AgentFix, StatePill, agentLoginState, agentWords, useAgentState } from './Logins.js'
import { ModuleSlot } from './ModulePageView.js'
import { ServersCard, ServersProvider } from './ServerLogins.js'

// Settings › Accounts: every login runs use, in one place. The coding agents' accounts are the
// skill's own card, the same as on the Overview. What is not account rotation is the dashboard's:
// an agent that needs installing or logging in, how this computer's logins stand on the person's
// servers (`ServerLogins.tsx`), the git hosts (`GitHosts.tsx`). On a server, the page says whose
// computer's logins it uses.

const ACCOUNT_ROTATION = '@openagt/skill-account-rotation'

/** Settings › Accounts. */
export function AccountsSettings() {
  return (
    <ServersProvider>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Runs use these accounts. When one hits its limit, the next free one takes the run over where it stopped.</p>
        <FromLine />
        <AgentSetup driver="claude-code" title="Claude Code" Logo={ClaudeLogo} />
        <AgentSetup driver="codex" title="Codex" Logo={CodexLogo} />
        <RotationCard />
        <ServersCard />
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
      <card.Card projects={[]} />
    </ModuleSlot>
  )
}

/** An agent that needs its press before it can run: its state, and the press that installs it or logs it in. Nothing once it can run. */
function AgentSetup({ driver, title, Logo }: { driver: DriverName; title: string; Logo: typeof ClaudeLogo }) {
  const { state, reload } = useAgentState(driver)
  if (!state || state.ready || (state.fix === undefined && agentLoginState(state) !== 'not-installed')) return null
  return (
    <section aria-label={title} className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Logo className="size-4 shrink-0" />
        <h3 className="flex-1 text-sm font-medium">{title}</h3>
        <StatePill state={agentLoginState(state)!} />
      </div>
      <p className="text-xs text-muted-foreground">{agentWords(state)}</p>
      <AgentFix state={state} onChanged={() => void reload()} />
    </section>
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
