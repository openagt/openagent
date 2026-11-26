import { SettingsSection, SettingsSelectRow, ToggleRow, inPlace, usePolled, useModuleHost, type SettingsOption } from '@openagt/ui/module'
import { agentOptions, type AgentOption } from './models.js'
import { server, useAgentStates, useAgentsOffered, usePicked } from './reads.js'
import { AgentUpdates } from './AgentUpdates.js'

// Settings › Coding agent: a newer version of a coding agent here, with its update (AgentUpdates),
// then the coding agent and the model every next run on this computer is on,
// the same pick the menu under the message box makes, and whether each run is named by a small
// model as it starts. A run whose options name an agent is on that one.

/**
 * The Model row's choices: the agent's own default first (the one pick the menu has no entry for,
 * since a menu entry is always a real model), then the models the agent listed. A saved model the
 * list does not hold is kept, by its id, since that id is still what a start is given; a list that
 * could not be had says why in a line that cannot be picked.
 */
function modelOptions(agent: AgentOption | undefined, model: string): SettingsOption[] {
  const listed = agent?.models ?? []
  return [
    { value: '', label: 'Default' },
    ...listed,
    ...(model && !listed.some(m => m.value === model) ? [{ value: model, label: model }] : []),
    ...(listed.length === 0 && agent ? [{ value: agent.modelsNote, label: agent.modelsNote, disabled: true }] : []),
  ]
}

export function AgentSettings() {
  const host = useModuleHost()
  const agents = agentOptions(useAgentsOffered(host))
  const { picked, pick } = usePicked(host)
  const { states } = useAgentStates(host)
  const { value: naming, reload } = usePolled<boolean | undefined>(() => server(host).naming({}), undefined, 60_000, [], { remember: 'agent-driver:naming' })
  const driver = picked?.driver ?? agents[0]?.value ?? ''
  const agent = agents.find(one => one.value === driver)
  const model = picked?.model ?? ''
  const missing = states?.find(state => state.agent === driver && !state.ready && state.fix?.kind === 'install')
  return (
    <SettingsSection>
      <AgentUpdates />
      <SettingsSelectRow
        label="Coding agent"
        description={
          <>
            Which coding agent runs the work.
            {missing && (
              <>
                {' '}
                <span className="text-warning">{missing.label} is not installed on this computer.</span>{' '}
                <a href={host.pageHref('permissions')} onClick={inPlace(() => host.openPage('permissions'))} className="text-primary hover:underline">
                  Install it on Permissions
                </a>
                .
              </>
            )}
          </>
        }
        value={driver}
        options={agents}
        // A model is always one agent's own (the menu's rule), so a new agent starts unpinned.
        onChange={value => void pick({ driver: value })}
      />
      <SettingsSelectRow
        label="Model"
        description="The models the coding agent lists. Its own default when none is picked."
        value={model}
        options={modelOptions(agent, model)}
        onChange={value => void pick({ ...(picked?.driver !== undefined ? { driver: picked.driver } : {}), ...(value ? { model: value } : {}) })}
      />
      <ToggleRow
        label="Name each run"
        description="A small model names each run in a few words, for about a thirtieth of a cent. Off, a run is listed by what you asked for."
        checked={naming ?? true}
        onChange={next => void server(host).setNaming({ on: next }).then(reload)}
      />
    </SettingsSection>
  )
}
