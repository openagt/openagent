import { useEffect, useState, type ReactNode } from 'react'
import { Skeleton } from './ui/skeleton.js'
import { SentenceShape, Slot } from './ui/slot.js'
import { takeLostFocus } from '../lib/lost-focus.js'
import { useMountedModules } from '../lib/use-modules.js'
import { GitHostsCard } from './GitHosts.js'
import { AgentFix, agentLoginState, agentWords, useAgentState, type LoginState } from './Logins.js'
import type { AgentState } from '../rpc/logins.js'
import { Badge, type BadgeTone } from './ui/badge.js'
import { ModuleSlot } from './ModulePageView.js'
import { Page } from './Page.js'
import { PanelGroup } from './ui/panel.js'

// The Permissions page: every account OpenAgent's agents work with, in one place. An agent can
// reach what its accounts can, and nothing else is a permission. What a coding agent still needs
// before it can run stands first; the modules' parts of the page (`permissions.section`) come next,
// the coding agents' accounts among them; the git hosts' are the dashboard's (`GitHosts.tsx`).

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
    <div className="space-y-8">
      {/* Claude Code's press is the page's one primary, as the Overview draws it: the agent runs start on unless a person picks another. */}
      <AgentSetup state={claude.state} reload={claude.reload} title="Claude Code" primary />
      <AgentSetup state={codex.state} reload={codex.reload} title="Codex" primary={false} />
      <ModuleSections />
      <GitHostsCard />
    </div>
  )
}

/**
 * The modules' parts of the page (`permissions.section`), in their order. While the modules load,
 * they wait in the room of one part's emptiest answer: its heading and one sentence.
 */
function ModuleSections() {
  const { views, loaded } = useMountedModules()
  const sections = views['permissions.section']
  return (
    <Slot of={{ value: sections, state: sections.length > 0 || loaded ? 'fresh' : 'unknown' }} shape={<CardShape />}>
      {sections =>
        sections.length > 0 && (
          <div className="space-y-8">
            {sections.map(section => (
              <ModuleSlot key={`${section.package} ${section.id}`} package={section.package} label={section.label}>
                <section.View />
              </ModuleSlot>
            ))}
          </div>
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
          <StateWords state={state}>{`${title} is ready: runs can start with it.`}</StateWords>
        </p>
      ) : (
        <AgentFix state={state} words={<StateWords state={state}>{agentWords(state)}</StateWords>} variant={primary ? undefined : 'secondary'} onChanged={() => void reload()} />
      )}
    </PanelGroup>
  )
}

/** A login's state by its colour, as a dot before the sentence that says it: green when there is nothing to do, amber for a step, grey for a tool not here. */
const TONE: Record<LoginState, BadgeTone> = { connected: 'success', step: 'warning', 'not-installed': 'neutral' }

function StateWords({ state, children }: { state: AgentState; children: ReactNode }) {
  return (
    <Badge tone={TONE[agentLoginState(state)!]} className="text-sm font-normal whitespace-normal text-muted-foreground">
      {children}
    </Badge>
  )
}
