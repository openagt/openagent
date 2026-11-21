import { useContext } from 'react'
import { Bot, Check, Settings2 } from 'lucide-react'
import type { Preset } from '../rpc/presets.js'
import { DEFAULT_PRESET } from '../../src/client.js'
import { PRESETS_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { cn } from '../lib/utils.js'
import { RowSaid, rowButtonClass, RowChevron } from './ui/row-item.js'
import { usePresetName } from './PresetsPage.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.js'

/**
 * The launcher's "Preset" menu, first under the box: which preset the session is on, by name. Its
 * options are the session's where the session picks none: the accounts it works as, and the
 * project's own skills it gets. The pick is saved, as the model's is, and "Manage presets…" opens
 * the Presets page. Drawn once the presets are read, so the name lands whole.
 */
export function PresetMenu({ presets, picked, busy, onPick }: { presets: readonly Preset[] | undefined; picked: string | undefined; busy: boolean; onPick: (id: string) => void }) {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  if (!presets) return null
  const on = presets.find(preset => preset.id === picked) ?? presets[0]
  if (!on) return null
  const account = on.options.github?.account
  const said = `This session is on the preset ${on.name}${account !== undefined ? `, as @${account} on GitHub` : ''}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label={`Preset: ${on.name}`} className={rowButtonClass} />}>
          <Bot className="size-4 shrink-0" aria-hidden />
          <span className="max-w-32 truncate @max-xl:max-w-20">{on.name}</span>
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Preset</DropdownMenuLabel>
          {/* The tick leads here: the row's end is for the GitHub account a preset works as. */}
          {presets.map(preset => (
            <DropdownMenuItem key={preset.id} onClick={() => onPick(preset.id)}>
              <Check className={cn('h-3.5 w-3.5 shrink-0', preset.id === on.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <span className="flex-1 truncate">{preset.name}</span>
              {preset.options.github?.account !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{`@${preset.options.github.account}`}</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => services.openPage(PRESETS_PAGE)}>
          <Settings2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Manage presets…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The session page's "Preset", in the launcher's place, as words, not a press: the preset the session
 * is on, as its record says, Default where it names none. Drawn once the presets are read, as the menu is.
 */
export function PresetOff({ preset }: { preset: string | undefined }) {
  const name = usePresetName(preset ?? DEFAULT_PRESET)
  if (name === undefined) return null
  return (
    <RowSaid tip={`This session is on the preset ${name}: its accounts, and the project skills it gets`}>
      <Bot className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Preset: </span>
      <span className="max-w-32 truncate @max-xl:max-w-20">{name}</span>
    </RowSaid>
  )
}
