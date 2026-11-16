import { useEffect, useState } from 'react'
import { Skeleton } from './ui/skeleton.js'
import { SentenceShape, Slot } from './ui/slot.js'
import { takeLostFocus } from '../lib/lost-focus.js'
import { useMountedModules } from '../lib/use-modules.js'
import { useAgentAccounts } from './AgentAccounts.js'
import { GitHostsCard } from './GitHosts.js'
import { AgentFix, agentLoginState, agentWords, useAgentState } from './Logins.js'
import type { AgentState } from '../rpc/logins.js'
import { ModuleSlot } from './ModulePageView.js'
import { Page } from './Page.js'
import { PanelGroup } from './ui/panel.js'
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
  const claude = useAgentState('claude-code')
  const codex = useAgentState('codex')
  // What each coding agent still needs stands first, so until both are read the list waits in one part's shape:
  // drawn before them, the parts under them would move when they land.
  if (claude.state === undefined || codex.state === undefined)
    return (
      <div aria-busy="true">
        <CardShape />
      </div>
    )
  return (
    <ServersProvider>
      <div className="space-y-8">
        <FromLine />
        {/* Claude Code's press is the page's one primary, as the Overview draws it: the agent runs start on unless a person picks another. */}
        <AgentSetup state={claude.state} reload={claude.reload} title="Claude Code" primary />
        <AgentSetup state={codex.state} reload={codex.reload} title="Codex" primary={false} />
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
      {/* As high as a part's heading row (`PanelGroup`): the card that lands moves nothing under it. */}
      <div className="mb-2 flex h-5 items-center">
        <Skeleton className="h-4 w-48" />
      </div>
      <SentenceShape />
      {/* The emptiest answer's sentence takes a second line on a phone. */}
      <div className="md:hidden">
        <SentenceShape />
      </div>
    </>
  )
}

/** An agent that needs its press before it can run, as a part of the page: what is missing, and the press that installs it or logs it in. Once it can run, it says so while the page is open, then nothing. */
function AgentSetup({ state, reload, title, primary }: { state: AgentState; reload: () => Promise<void>; title: string; /** Whether its press is the page's primary. */ primary: boolean }) {
  const missing = !!state && !state.ready && (state.fix !== undefined || agentLoginState(state) === 'not-installed')
  const [wasMissing, setWasMissing] = useState(false)
  useEffect(() => {
    if (missing) setWasMissing(true)
  }, [missing])
  if (!missing && !(wasMissing && state.ready)) return null
  return (
    <PanelGroup bare title={title}>
      {state.ready ? (
        <p ref={takeLostFocus} role="status" tabIndex={-1} className="text-sm text-muted-foreground outline-none">
          {`${title} is ready: runs can start with it.`}
        </p>
      ) : (
        <AgentFix state={state} words={agentWords(state)} variant={primary ? undefined : 'secondary'} onChanged={() => void reload()} />
      )}
    </PanelGroup>
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
