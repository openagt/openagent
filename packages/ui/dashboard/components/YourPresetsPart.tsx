import { useContext } from 'react'
import { onPresetsList, type PresetsView } from '../rpc/presets.js'
import { usePolled } from '../lib/use-async.js'
import { PRESETS_PAGE } from '../lib/use-route.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { LinePart, counted } from './LinePart.js'

// The Overview's line on the person's presets: how many, by name on a hover, and their page a press
// away. The Presets page's own read, kept under its name, so either shows the other's at once.

/** Read again this seldom: presets change when the person changes them, on their page. */
const EVERY_MS = 60_000

export function YourPresetsPart() {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const { value } = usePolled<PresetsView | undefined>(onPresetsList, undefined, EVERY_MS, [], { remember: 'presets' })
  return (
    <LinePart reading={value === undefined} note={value?.presets.map(preset => preset.name).join(', ')} href={`/${PRESETS_PAGE}`} onClick={() => services.openPage(PRESETS_PAGE)}>
      {counted(value?.presets.length ?? 0, 'preset', 'presets', 'no presets')}
    </LinePart>
  )
}
