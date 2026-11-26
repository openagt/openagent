import { useEffect, useRef, useState } from 'react'
import { Dialog, FixAction, forgetRemembered, useModuleHost, type UiActionAt, type UiActionResult } from '@openagt/ui/module'
import type { AgentState } from '../src/server.js'
import { agentOfItem, agentOfUpdate } from '../src/attention-items.js'
import { ConnectAgent, isAccountsList, useAddAccount, type AgentId } from './AccountsCard.js'
import { server, useAgentStates } from './reads.js'

// What gets a coding agent running here, where the shell draws what needs the person
// (`app.attention`, the items `../src/attention.ts` says): the install of an agent whose program
// is missing, run with the command its package declared, and the window an account is added in.

/** The press that installs an agent's program, with the command it runs, while it runs, and why it failed. */
export function InstallAgent({ state, onChanged, size, variant }: { state: AgentState; onChanged: () => void; size?: 'default' | 'sm' | undefined; variant?: 'secondary' | undefined }) {
  const host = useModuleHost()
  const [error, setError] = useState<string | undefined>()
  if (state.ready || state.fix?.kind !== 'install') return null
  const press = async (): Promise<void> => {
    setError(undefined)
    const done = await server(host).install({ agent: state.agent })
    if (!done.ok) setError(done.error)
    onChanged()
  }
  const failed = error ?? state.failed
  return (
    <FixAction
      size={size}
      variant={variant}
      label={`Install ${state.label}`}
      busy={state.fixing !== undefined}
      busyWords={`Installing ${state.label}…`}
      command={state.fix.command}
      {...(failed !== undefined ? { failed } : {})}
      onPress={() => void press()}
    />
  )
}

/** Install the agent an item is about: the press under the line above the message box. */
export const installFix: UiActionAt<'attention.fix'> = {
  place: 'attention.fix',
  id: 'install',
  label: 'Install',
  busyLabel: 'Installing…',
  async run(host, on): Promise<UiActionResult> {
    const agent = on.item !== undefined ? agentOfItem(on.item) : undefined
    if (agent === undefined) return { ok: false, error: 'Which coding agent to install is not said.' }
    return server(host).install({ agent })
  },
}

/** Update the agent a note about its newer version is for: the person's menu's press. Its models may be others after: the menu asks for them again. */
export const updateFix: UiActionAt<'attention.fix'> = {
  place: 'attention.fix',
  id: 'update',
  label: 'Update',
  busyLabel: 'Updating…',
  async run(host, on): Promise<UiActionResult> {
    const agent = agentOfUpdate(on.item)
    if (agent === undefined) return { ok: false, error: 'Which coding agent to update is not said.' }
    const done = await server(host).update({ agent })
    if (!done.ok) return done
    forgetRemembered('agent-driver:agents')
    return { ok: true }
  },
}

/**
 * Connect a coding agent: for an item about one agent, the window its account is added in; for
 * the one about this computer, each agent's press, the first the primary, an agent whose program is
 * missing installed first.
 */
function ConnectDialog({ on, onDone }: { on: { item?: string }; onDone: (result?: UiActionResult) => void }) {
  const host = useModuleHost()
  const { states, reload } = useAgentStates(host)
  const one = on.item !== undefined ? agentOfItem(on.item) : undefined
  const list = states?.find(state => state.agent === one)?.list
  if (one !== undefined) return list !== undefined && isAccountsList(list) ? <AddAccountWindow list={list} onDone={onDone} /> : null
  const done = (): void => {
    void reload()
    onDone({ ok: true })
  }
  return (
    <Dialog open onOpenChange={open => !open && onDone()} title="Connect a coding agent">
      <p className="text-sm text-muted-foreground">Sessions run on a coding agent, with your own account. One is enough; add the other any time.</p>
      <div className="mt-4 flex max-w-full flex-wrap items-center gap-2">
        {(states ?? []).map((state, at) =>
          state.fix?.kind === 'install' && !state.ready ? (
            <InstallAgent key={state.agent} state={state} onChanged={() => void reload()} {...(at === 0 ? {} : { variant: 'secondary' as const })} />
          ) : state.list !== undefined && isAccountsList(state.list) ? (
            <ConnectAgent key={state.agent} agent={state.list} primary={at === 0} onConnected={done} />
          ) : null,
        )}
      </div>
    </Dialog>
  )
}

/** The window an account of `list` is added in, open from the start: what an item about one agent's login opens. */
function AddAccountWindow({ list, onDone }: { list: AgentId; onDone: (result?: UiActionResult) => void }) {
  const add = useAddAccount({ adopt: false, onEnded: () => onDone({ ok: true }) })
  const back = useRef<HTMLElement | null>(null)
  const opened = useRef(false)
  useEffect(() => add.open(list), []) // eslint-disable-line react-hooks/exhaustive-deps
  // Closed without an account added: the press is done all the same, and opens it again.
  useEffect(() => {
    if (add.naming !== undefined) opened.current = true
    else if (opened.current) onDone()
  }, [add.naming]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>{add.dialog(back)}</>
}

export const connectFix: UiActionAt<'attention.fix'> = {
  place: 'attention.fix',
  id: 'connect',
  label: 'Connect a coding agent…',
  Dialog: ConnectDialog,
}
