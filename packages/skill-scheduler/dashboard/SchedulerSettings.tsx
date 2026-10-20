import { useEffect, useRef, useState } from 'react'
import { Input, SettingsRow, SettingsSection, useModuleHost, usePolled, type ModuleSettingsProps } from '@openagt/dashboard/module'
import { MAX_SPEND_OFFSET, loosestSpendOffset, offsetsThatDiffer, readSchedulers, saveSpendOffset, typedOffset, type SchedulerRow } from './schedulers.js'

// Settings › Scheduler: how far past the quota boundary scheduled work may still start. Each
// project keeps its own, read with `scheduler status` and saved with `scheduler offset`
// in each project Settings shows: one, or every project that has this package. What each
// project's scheduler starts is not here: it is on the Automations page.

const EMPTY: SchedulerRow[] = []

/** How long the offset rests before it is saved: typing a number is several changes, each a command per project. */
const OFFSET_SAVE_DELAY_MS = 500

export function SchedulerSettings({ projects }: ModuleSettingsProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: rows, reload } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key])
  const [error, setError] = useState<string | undefined>()

  // The offset as typed, kept until a read made after the save brings it back.
  const read = loosestSpendOffset(rows)
  const [typed, setTyped] = useState<number | undefined>()
  const [text, setText] = useState<string | undefined>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Saves go one at a time: each is a command per project that reads the state file, changes it and writes it back.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    if (typed !== undefined && read === typed) setTyped(undefined)
  }, [read, typed])
  useEffect(() => () => clearTimeout(timer.current), [])
  const offset = typed ?? read
  const setOffset = (points: number): void => {
    setTyped(points)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setError(undefined)
      queue.current = queue.current.then(async () => {
        // A command that could not even be asked is a save not taken, and the next save still runs.
        const saved = await saveSpendOffset(host, projects, points).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
        if (!saved.ok) {
          setTyped(undefined)
          setError(`The spend offset was not saved: ${saved.error}`)
        }
        await reload().catch(() => {})
      })
    }, OFFSET_SAVE_DELAY_MS)
  }

  const differing = offsetsThatDiffer(rows)
  const unread = rows.filter(row => row.error !== undefined)
  if (projects.length === 0) return null
  return (
    <SettingsSection description="How far past the quota scheduled work may go, on this machine. What a project starts by itself is on the Automations page.">
      {offset !== undefined && (
        <SettingsRow
          label="Spend offset"
          description={`How far the scheduler may start work past the quota boundary, in percentage points (max ${MAX_SPEND_OFFSET}). Negative holds it back; positive lets it borrow from the days ahead. The handle on the usage bar moves the same number.${differing.length > 0 ? ` Shown: the loosest. ${differing.map(d => `${d.name} is at ${d.offset}`).join(', ')}; saving sets each of them to the same number.` : ''}`}
          control={
            <Input
              type="number"
              // The text as typed while the field has the focus, so a number can be typed through a state that is none yet ("-").
              value={text ?? String(Math.round(offset * 10) / 10)}
              min={-MAX_SPEND_OFFSET}
              max={MAX_SPEND_OFFSET}
              onChange={e => {
                const raw = e.target.value
                setText(raw)
                // Held to the handle's reach here as well as on the input: `min`/`max` only constrain the spinner.
                const points = typedOffset(raw)
                if (points !== undefined) setOffset(points)
              }}
              onBlur={() => setText(undefined)}
              aria-label="Spend offset"
              className="h-8 w-24 bg-background px-2"
            />
          }
        />
      )}
      {unread.map(row => (
        <p key={row.project.id} role="alert" className="py-2 text-xs text-danger">{`The scheduler of ${row.project.name} could not be read: ${row.error}`}</p>
      ))}
      {error !== undefined && (
        <p role="alert" className="py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
