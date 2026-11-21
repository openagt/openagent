// The scheduler's stop line on the usage bar (`usage.line`): the spend offset in force across the
// projects, read every 10 seconds, drawn on the shell's bar, whose handle saves a new one in every
// project. A save that fails says why under the bar.
import { useModuleHost, usePolled, useSpendOffset, type UiUsageLineProps } from '@openagt/ui/module'
import { loosestSpendOffset, readSchedulers, saveSpendOffset } from './schedulers.js'

export function StopLine({ projects, Bar }: UiUsageLineProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: saved } = usePolled<number | undefined>(async () => loosestSpendOffset(await readSchedulers(host, projects)), undefined, 10_000, [host.package, key], { remember: `usage-limit:${host.package}:${key}`, stored: true })
  const [offset, setOffset, error] = useSpendOffset(saved, points => saveSpendOffset(host, projects, points))
  return (
    <>
      <Bar {...(offset !== undefined ? { offset, onChangeOffset: setOffset } : {})} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          The limit was not saved: {error}
        </p>
      )}
    </>
  )
}
