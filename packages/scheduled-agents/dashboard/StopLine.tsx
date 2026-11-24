// The scheduler's stop line on the usage bar (`usage.line`): the spend offset in force across the
// projects, read every 10 seconds, drawn on the bar, whose handle saves a new one in every
// project. The bar says under it why a save failed.
import { useModuleHost, usePolled, type UiUsageLineProps } from '@openagt/ui/module'
import { loosestSpendOffset, readSchedulers, saveSpendOffset } from './schedulers.js'

export function StopLine({ projects, Bar }: UiUsageLineProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: saved } = usePolled<number | undefined>(async () => loosestSpendOffset(await readSchedulers(host, projects)), undefined, 10_000, [host.package, key], { remember: `usage-limit:${host.package}:${key}`, stored: true })
  return <Bar {...(saved !== undefined ? { offset: saved, onChangeOffset: (points: number) => saveSpendOffset(host, projects, points) } : {})} />
}
