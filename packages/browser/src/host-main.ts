import { parseArgs } from 'node:util'
import { runHost } from './host.js'

/**
 * The entry the command starts, detached, when a project has no browser open. The run's diary
 * comes from `AGENT_DIARY`, which a tool running the agent sets when it keeps one.
 */
const { values } = parseArgs({ options: { state: { type: 'string' }, chrome: { type: 'string' }, 'idle-ms': { type: 'string' } } })
const diary = process.env['AGENT_DIARY']
await runHost({
  stateFile: values.state!,
  chromePath: values.chrome!,
  idleMs: Number(values['idle-ms']),
  ...(diary ? { diary } : {}),
})
process.exit(0)
