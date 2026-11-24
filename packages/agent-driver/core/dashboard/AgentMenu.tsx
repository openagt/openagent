import { useEffect, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { AgentDriverOptions, RunOptions } from '@openagt/hooks'
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Facts,
  PackageLogo,
  RowChevron,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  effortLabel,
  rowButtonClass,
  rowItemClass,
  useModuleHost,
  type UiComposerControlProps,
} from '@openagt/ui/module'
import { AgentAccountItems } from './AgentAccounts.js'
import { firstAccount, useAccounts, useAllAccounts, type AccountRow } from './accounts.js'
import { agentOptions, modelEfforts, modelName, type AgentOption } from './models.js'
import { useAgentsOffered, usePicked } from './reads.js'

// The coding agent, its model and how hard it thinks, as one control under the message box
// (`composer.control` at the row's right, #650/#656/#658). The top level is the coding agents, and
// each agent's submenu holds only its own models: picking a model sets both, so an incompatible
// pair (Codex with a Claude model) can't be chosen. Under them, how hard the model may think: the
// levels are the model's own. Each agent's part also holds its accounts on this computer, under its
// models, and its row says the one its runs take first: who runs it is picked where what runs is.
// The trigger says all three (ModelWords): the agent's mark, the model, and the level smaller and
// quieter ("Opus 5.5 High"); the agent's default level says nothing.
//
// In the launcher a pick is the next run's, and the one every next run on this computer is on (the
// catalog's `PICKED_AGENT`, which a run reads where its options name no agent). In a session it says
// what the run's record keeps, and offers nothing. In a profile's editor it is the profile's: its
// agent and model, and the accounts its runs take.

/** What a sentence says when no model is pinned and the coding agent picks for itself (#1143). */
const NO_MODEL_PINNED = "the coding agent's default"

/** agent-driver's slice of the options. */
function sliceOf(options: RunOptions): AgentDriverOptions {
  return options['agent-driver'] ?? {}
}

/** agent-driver's slice as a change makes it: a part set to `undefined` is taken out. */
type SliceChange = { [K in keyof AgentDriverOptions]?: AgentDriverOptions[K] | undefined }

/** The options with agent-driver's slice changed, an empty one left out. */
function withSlice(options: RunOptions, slice: SliceChange): RunOptions {
  const { 'agent-driver': _was, ...rest } = options
  const kept = Object.fromEntries(Object.entries(slice).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))) as AgentDriverOptions
  return Object.keys(kept).length > 0 ? { ...rest, 'agent-driver': kept } : rest
}

/**
 * A model as the row under the box says it, on the launcher's menu button and in a session alike
 * (his pick): the coding agent's mark, the model's name, and how hard it thinks as smaller, quieter
 * words on the line's middle, neither raised nor a badge.
 */
export function ModelWords({ logo, name, effort }: { logo?: string | undefined; name?: string | undefined; effort?: string | undefined }) {
  return (
    <>
      {logo !== undefined && <PackageLogo svg={logo} className="size-4" />}
      {name !== undefined && <span className="truncate font-medium text-foreground">{name}</span>}
      {effort !== undefined && <span className="mt-px shrink-0 text-xs leading-none text-muted-foreground">{effort}</span>}
    </>
  )
}

/** An agent of the menu, with what its row says of its accounts and its accounts' items. */
export interface MenuAgent extends AgentOption {
  /** The account its runs take first on this computer, said on its row: a name and how full it is ("16%"). */
  account?: { name: string; percent: string | undefined } | undefined
  /** Its accounts, under its models in its part: which one is first, and adding one. */
  accounts?: ReactNode
}

/**
 * The label for the current model: its name in the agent's own list, the id itself for a model the
 * list does not hold (the run is still given it, so the trigger says what is sent), or `undefined`
 * when nothing is pinned. Never the first model (#1143): the trigger would name a model the agent
 * does not pass.
 */
function modelLabel(agent: AgentOption | undefined, model: string | undefined): string | undefined {
  if (!model) return undefined
  return agent?.models.find(m => m.value === model)?.label ?? model
}

/** How hard the model may think: the levels it offers, the one in force, and the pick. */
export interface EffortChoice {
  /** The levels the picked model offers, in the agent's own order. Empty: the menu has no effort part. */
  levels: readonly string[]
  /** The level in force, or `undefined` for the agent's own default. */
  level?: string | undefined
  /** Told the new level, or `undefined` when the pick is cleared back to the agent's default. */
  onChange: (level: string | undefined) => void
}

/** What the menu's trigger says, for a reader and for the gear's hover. */
function saidOf(current: AgentOption | undefined, model: string | undefined, levels: readonly string[], level: string | undefined): string {
  return `Coding agent: ${current?.label ?? ''} · Model: ${modelLabel(current, model) ?? NO_MODEL_PINNED}${levels.length > 0 ? ` · Effort: ${level ?? "the coding agent's default"}` : ''}`
}

export function AgentMenu({
  agents,
  driver,
  model,
  onChange,
  effort,
  busy,
}: {
  agents: MenuAgent[]
  /** The agent picked; the first when none is. */
  driver: string | undefined
  model: string | undefined
  /** Set the agent and model together (a model is always picked within its agent). */
  onChange: (driver: string, model: string) => void
  effort?: EffortChoice | undefined
  busy: boolean
}) {
  const current = agents.find(a => a.value === driver) ?? agents[0]
  const picked = current?.value
  const currentModelLabel = modelLabel(current, model)
  const levels = effort?.levels ?? []
  // A level the model does not offer is still what a run would be given, so it is said rather than
  // silently read as the default.
  const level = effort?.level !== undefined ? effortLabel(effort.level) : undefined
  // Spelled out rather than left to the rendered text (#1143): with no model pinned the trigger is
  // a mark and a chevron, which names nothing at all to a screen reader.
  const said = saidOf(current, model, levels, level)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={said} className={rowButtonClass} />}>
          <ModelWords logo={current?.logo} name={current?.logo !== undefined ? currentModelLabel : [current?.label, currentModelLabel].filter(Boolean).join(' ')} effort={level} />
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Coding agent</DropdownMenuLabel>
          {agents.map(a => (
            <DropdownMenuSub key={a.value}>
              {/* The tick leads every row of this menu (his pick): the rows' ends carry the account and the way into its models. */}
              <DropdownMenuSubTrigger>
                <Check className={cn('h-3.5 w-3.5 shrink-0', a.value === picked ? 'opacity-100' : 'opacity-0')} aria-hidden />
                {a.logo !== undefined && <PackageLogo svg={a.logo} className="size-4" />}
                <span className="flex-1">{a.label}</span>
                {/* A long name gives way, never how full the account is. */}
                {a.account && (
                  <Facts oneLine facts={[{ fact: a.account.name, className: 'not-last:shrink' }, a.account.percent !== undefined && { fact: a.account.percent, className: 'shrink-0' }]} className="max-w-48 text-muted-foreground" />
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[15rem]">
                {a.models.length === 0 && <DropdownMenuItem disabled>{a.modelsNote}</DropdownMenuItem>}
                {a.models.map(m => (
                  <DropdownMenuItem key={m.value} onClick={() => onChange(a.value, m.value)}>
                    <Check className={cn('h-3.5 w-3.5 shrink-0', a.value === picked && m.value === model ? 'opacity-100' : 'opacity-0')} aria-hidden />
                    {m.label}
                  </DropdownMenuItem>
                ))}
                {a.accounts}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuGroup>
        {levels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Effort</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => effort!.onChange(undefined)}>
                <Check className={cn('h-3.5 w-3.5 shrink-0', effort?.level === undefined ? 'opacity-100' : 'opacity-0')} aria-hidden />
                The coding agent's default
              </DropdownMenuItem>
              {levels.map(one => (
                <DropdownMenuItem key={one} onClick={() => effort!.onChange(one)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', effort?.level === one ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  {effortLabel(one)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's agents, each with its accounts on this computer where it has a list of them: none for an agent not installed here, which has none to pick. */
function useMenuAgents(agents: AgentOption[], on: boolean): MenuAgent[] {
  const host = useModuleHost()
  const { views, pick } = useAllAccounts(host, on)
  return agents.map(agent => {
    const view = agent.list !== undefined ? views?.[agent.list] : undefined
    if (!view || view.accounts.length === 0 || agent.missing) return agent
    return {
      ...agent,
      account: firstAccount(view),
      accounts: <AgentAccountItems view={view} onPick={account => void pick(agent.list!, account)} onAdd={() => host.openPage('permissions')} />,
    }
  })
}

/** The control under the message box: the launcher's pick, the session's said, the profile's. */
export function AgentControl(props: UiComposerControlProps) {
  if (props.in === 'session') return <SessionAgent {...props} />
  return <PickAgent {...props} />
}

/** In a session: the agent and model its record keeps, said, not offered. */
function SessionAgent({ options, say }: UiComposerControlProps) {
  const host = useModuleHost()
  const agents = useAgentsOffered(host)
  const { driver, model, effort } = sliceOf(options)
  const agent = agents?.find(one => one.id === driver)
  const name = model !== undefined ? modelName(agent, model) : undefined
  const level = effort !== undefined ? effortLabel(effort) : undefined
  useEffect(() => say(undefined), [say])
  if (name === undefined && level === undefined) return null
  return (
    <span className={rowItemClass}>
      <ModelWords logo={agent?.logo} name={name} effort={level} />
    </span>
  )
}

/** In the launcher and in a profile's editor: the menu, and in a profile its accounts. */
function PickAgent({ in: box, options, onChange, busy, say }: UiComposerControlProps) {
  const host = useModuleHost()
  const offered = useAgentsOffered(host)
  const agents = agentOptions(offered)
  // Who runs it is picked where what runs is, in the launcher: a profile's accounts are its own ticks.
  const withAccounts = useMenuAgents(agents, box === 'launcher')
  const { picked, pick } = usePicked(host)
  const slice = sliceOf(options)
  // The launcher's run names its own agent once one is picked for it; else it runs on the one picked for every next run.
  const shown = box === 'launcher' && slice.driver === undefined ? (picked ?? {}) : slice
  const agent = offered?.find(one => one.id === shown.driver) ?? offered?.[0]
  const levels = modelEfforts(agent, shown.model)
  const current = agents.find(one => one.value === agent?.id)
  const said = agents.length > 0 ? saidOf(current, shown.model, levels, shown.effort !== undefined ? effortLabel(shown.effort) : undefined) : undefined
  useEffect(() => say(said !== undefined ? { words: said } : undefined), [said, say])
  const change = (next: Pick<SliceChange, 'driver' | 'model' | 'effort'>): void => {
    const was = { driver: shown.driver, model: shown.model, effort: shown.effort }
    const merged = { ...was, ...next }
    onChange(withSlice(options, { ...slice, ...merged }))
    // The launcher's pick is also every next run's on this computer, as the menu always was.
    if (box === 'launcher') void pick(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)))
  }
  if (agents.length === 0) return null
  const menu = (
    <AgentMenu
      agents={withAccounts}
      driver={agent?.id}
      model={shown.model}
      // A model is always one agent's own, so the effort goes with the model it was picked for.
      onChange={(driver, model) => change({ driver, model, effort: undefined })}
      effort={{ levels, level: shown.effort, onChange: effort => change({ effort }) }}
      busy={busy}
    />
  )
  if (box !== 'profile') return menu
  return (
    <div className="space-y-4">
      {menu}
      {agents.map(one =>
        one.list === 'claude' || one.list === 'codex' ? (
          <ProfileAccounts key={one.value} label={one.label} list={one.list} picked={slice[one.list] ?? []} busy={busy} onChange={accounts => onChange(withSlice(options, { ...slice, [one.list!]: accounts }))} />
        ) : null,
      )}
    </div>
  )
}

/** A profile's accounts of one agent's list, as the profile's editor picks them. */
function ProfileAccounts({ label, list, picked, busy, onChange }: { label: string; list: string; picked: readonly string[]; busy: boolean; onChange: (accounts: string[]) => void }) {
  const { view } = useAccounts(useModuleHost(), list)
  const set = new Set(picked)
  return (
    <AccountPicks
      label={label}
      accounts={view?.accounts ?? []}
      picked={set}
      busy={busy}
      onTick={(id, on) => onChange(on ? [...new Set([...picked, id])] : picked.filter(one => one !== id))}
      onAll={() => onChange([])}
    />
  )
}

/**
 * A coding agent's accounts to pick from: "Every account, also new ones", ticked while none is
 * picked, is every one of this computer's, also one added later; one or more ticked, those alone,
 * where the computer has them. This computer's own login, logged out, is offered only while it is
 * picked, and says so.
 */
export function AccountPicks({ label, accounts: all, picked, busy, onTick, onAll }: { label: string; accounts: readonly AccountRow[]; picked: Set<string>; busy: boolean; onTick: (id: string, on: boolean) => void; onAll: () => void }) {
  const accounts = all.filter(account => !account.loggedOut || picked.has(account.id))
  if (accounts.length === 0) return null
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{`${label} accounts`}</legend>
      <div className="flex flex-wrap gap-3">
        {/* Left by ticking an account, as a radio is left by picking another. */}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={picked.size === 0} onCheckedChange={checked => checked === true && onAll()} disabled={busy} aria-label={`Every ${label} account, also new ones`} />
          Every account, also new ones
        </label>
        {accounts.map(account => {
          const name = account.loggedOut ? `${account.name}, not logged in` : account.name
          return (
            <label key={account.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={picked.has(account.id)} onCheckedChange={checked => onTick(account.id, checked === true)} disabled={busy} aria-label={`${label} account ${name}`} />
              {name}
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{picked.size === 0 ? `All of this computer's ${label} accounts, the next free one taking over at a limit.` : `Only these, where the computer the run goes to has them.`}</p>
    </fieldset>
  )
}
