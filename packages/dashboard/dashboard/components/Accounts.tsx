import { useEffect, useState, type ReactNode } from 'react'
import { Skeleton } from './ui/skeleton.js'
import { SentenceShape, Slot } from './ui/slot.js'
import type { DriverName } from '../../src/client.js'
import { takeLostFocus } from '../lib/lost-focus.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAgentAccounts } from './AgentAccounts.js'
import { GitHostsCard } from './GitHosts.js'
import { AgentFix, agentLoginState, agentWords, useAgentState, type LoginState } from './Logins.js'
import type { AgentState } from '../rpc/logins.js'
import { Badge, type BadgeTone } from './ui/badge.js'
import { ModuleSlot } from './ModulePageView.js'
import { Page } from './Page.js'
import { Section } from './ui/section.js'
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
      <div className="space-y-8">
        <FromLine />
        {/* Claude Code's press is the page's one primary, as the Overview draws it: the agent runs start on unless a person picks another. */}
        <AgentSetup driver="claude-code" title="Claude Code" primary />
        <AgentSetup driver="codex" title="Codex" primary={false} />
        <ServerAsks />
        <RotationCard />
        <GitHostsCard />
      </div>
    </ServersProvider>
  )
}

/** The skill's card, as the Overview draws it. While the modules load, it waits in the room of its emptiest answer: its heading and one sentence. */
function RotationCard() {
  const { cards, loaded } = useMountedModules()
  const card = cards.find(each => each.package === ACCOUNT_ROTATION && each.id === 'accounts')
  return (
    <Slot of={{ value: card, state: card || loaded ? 'fresh' : 'unknown' }} shape={<CardShape />}>
      {card =>
        card ? (
          <ModuleSlot package={card.package} label="accounts card">
            <card.Card projects={[]} accountWhere={account => <AccountWhere account={{ kind: account.agent, own: account.own, name: account.name }} />} />
          </ModuleSlot>
        ) : (
          <p className="text-sm text-danger">The accounts card did not load.</p>
        )
      }
    </Slot>
  )
}

/** A part's heading and its one sentence, while they are read. */
function CardShape() {
  return (
    <>
      <div className="mb-2 flex h-8 items-center">
        <Skeleton className="h-5 w-48" />
      </div>
      <SentenceShape />
    </>
  )
}

/** An agent that needs its press before it can run, as a part of the page: what is missing, and the press that installs it or logs it in. Once it can run, it says so while the page is open, then nothing. */
function AgentSetup({ driver, title, primary }: { driver: DriverName; title: string; /** Whether its press is the page's primary. */ primary: boolean }) {
  const { state, reload } = useAgentState(driver)
  const missing = !!state && !state.ready && (state.fix !== undefined || agentLoginState(state) === 'not-installed')
  const [wasMissing, setWasMissing] = useState(false)
  useEffect(() => {
    if (missing) setWasMissing(true)
  }, [missing])
  if (!state || (!missing && !(wasMissing && state.ready))) return null
  return (
    <Section title={title}>
      {state.ready ? (
        <p ref={takeLostFocus} role="status" tabIndex={-1} className="text-sm text-muted-foreground outline-none">
          <StateWords state={state}>{`${title} is ready: runs can start with it.`}</StateWords>
        </p>
      ) : (
        <AgentFix state={state} words={<StateWords state={state}>{agentWords(state)}</StateWords>} variant={primary ? undefined : 'secondary'} onChanged={() => void reload()} />
      )}
    </Section>
  )
}

/** A login's state by its colour, as a dot before the sentence that says it: the one mark of its part. */
const TONE: Record<LoginState, BadgeTone> = { connected: 'success', step: 'warning', 'not-installed': 'neutral' }

function StateWords({ state, children }: { state: AgentState; children: ReactNode }) {
  return (
    <Badge tone={TONE[agentLoginState(state)!]} className="text-sm font-normal whitespace-normal text-muted-foreground">
      {children}
    </Badge>
  )
}

/** On a server: whose computer's logins it uses. Nothing elsewhere. */
function FromLine() {
  const from = useAgentAccounts('claude').view?.from
  if (from === undefined) return null
  return (
    <div className="rounded-lg bg-muted px-3 py-3">
      <p className="text-sm font-medium">{`Your logins and settings from ${from}`}</p>
      <p className="text-xs text-muted-foreground">Log in or out there, or change a setting, and this server follows.</p>
    </div>
  )
}
