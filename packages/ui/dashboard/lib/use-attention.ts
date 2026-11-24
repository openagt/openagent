import type { Attention, RunOptions } from '@openagt/hooks'
import { onAttention } from '../rpc/attention.js'
import { usePolled } from './use-async.js'
import { pluginsAgain } from './plugins-switched.js'

/** How often what needs the person is asked again, besides when a plugin is switched. */
const ATTENTION_MS = 15_000

/**
 * What the modules on say needs the person (`app.attention`): about this computer, and with a
 * project, about it and the run options picked there. `null` until first read; kept in this
 * browser per project, so a page opened again says it from its first frame.
 */
export function useAttention(projectId: string | null, options?: RunOptions): Attention[] | null {
  const key = `${projectId ?? ''}\n${JSON.stringify(options ?? {})}`
  const read = usePolled<Attention[] | null>(
    async () => (await onAttention(projectId, options)).items,
    null,
    ATTENTION_MS,
    [key],
    { remember: `attention:${projectId ?? ''}` },
    pluginsAgain,
  )
  return read.value
}
