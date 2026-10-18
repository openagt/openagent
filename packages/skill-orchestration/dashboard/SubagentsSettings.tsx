import { useEffect, useRef, useState } from 'react'
import { SettingsSection, SettingsSelectRow, useCodingAgents, useModuleHost, usePolled, type ModuleProject, type ModuleSettingsProps, type SettingsOption } from '@openagt/dashboard/module'
import { DEFAULT_AT_ONCE, LEVELS, type Level, type Runner, type Settings } from '../src/levels.js'
import { runnerChoices, runnerOf, runnerValue } from './choices.js'

// Settings › Orchestration: which coding agent and model a main agent's subagents run on, by how
// hard the main agent says their task is, and how many of one main agent's subagents run at once.
// Each project keeps its own, read with `orchestration settings` and saved whole with
// `orchestration settings <json>` in each project Settings shows: one, or every project that has
// this package. A pick changes that one setting in each of them and leaves the rest as each has it,
// and a setting the projects hold differently reads as "Mixed".

/** Each project's settings, or why none could be read. */
interface Read {
  of: { project: ModuleProject; settings: Settings }[]
  error?: string
}

const NOTHING_READ: Read = { of: [] }

/** The settings a pick changed, laid over each project's own until a read has them; `null` unsets a level. */
type Picks = { [L in Level]?: Runner | null } & { atOnce?: number }

/** What a menu shows when the projects hold different picks. */
const MIXED = '(mixed)'

/** A project's settings with the picks laid over them. */
function withPicks(settings: Settings, picks: Picks): Settings {
  const next: Settings = { ...settings }
  for (const name of LEVELS) {
    const runner = picks[name]
    if (runner === null) delete next[name]
    else if (runner !== undefined) next[name] = runner
  }
  if (picks.atOnce !== undefined) next.atOnce = picks.atOnce
  return next
}

export function SubagentsSettings({ projects }: ModuleSettingsProps) {
  const host = useModuleHost()
  const agents = useCodingAgents()
  const key = projects.map(p => p.id).join(',')
  const { value: read, reload } = usePolled<Read>(
    async () => {
      const of: Read['of'] = []
      let error: string | undefined
      for (const project of projects) {
        const answer = await host.runCommand(project.id, ['settings'])
        if (!answer.ok) {
          error ??= `${project.name}: ${answer.error}`
          continue
        }
        const { ok: _ok, ...settings } = (answer.output ?? {}) as Settings & { ok?: boolean }
        of.push({ project, settings })
      }
      // A project that cannot be read says so only when none could: the others still show.
      return { of, ...(of.length === 0 && error !== undefined ? { error } : {}) }
    },
    NOTHING_READ,
    10_000,
    [key],
  )
  // What was picked, shown until a read made after the last save brings it back: each save lays
  // every pick so far over each project's own, so a second pick made before the first is saved
  // keeps the first. Saves go one at a time: a pick made while one is on its way waits, and the
  // picks as they then are go next.
  const [picks, setPicks] = useState<Picks>({})
  const latest = useRef<Picks>({})
  const sending = useRef(false)
  const waiting = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    if (sending.current) return
    latest.current = {}
    setPicks({})
  }, [read])
  const shown = read.of.map(({ project, settings }) => ({ project, settings: withPicks(settings, picks) }))
  // What the menus show: each project's settings, or with none read the picks over nothing saved.
  const views = shown.length > 0 ? shown.map(({ settings }) => settings) : [withPicks({}, picks)]

  if (projects.length === 0) return null

  const send = async (): Promise<void> => {
    sending.current = true
    const answers = await Promise.all(
      projects.map(async project => {
        const own = read.of.find(r => r.project.id === project.id)?.settings ?? {}
        return { project, answer: await host.runCommand(project.id, ['settings', JSON.stringify(withPicks(own, latest.current))]) }
      }),
    )
    const failed = answers.flatMap(({ project, answer }) => (answer.ok ? [] : [`${project.name}: ${answer.error}`]))
    // The line says how the latest save went: a refused one before it was overtaken by this one.
    setError(failed.length > 0 ? failed.join('; ') : undefined)
    if (waiting.current) {
      waiting.current = false
      return send()
    }
    sending.current = false
    setSaving(false)
    // A refused save shows what is saved again; a saved one stays shown until the read has it.
    if (failed.length > 0) {
      latest.current = {}
      setPicks({})
    }
    reload()
  }
  const save = (pick: Picks): void => {
    latest.current = { ...latest.current, ...pick }
    setPicks(latest.current)
    setSaving(true)
    setError(undefined)
    if (sending.current) waiting.current = true
    else void send()
  }
  const level = (name: Level) => (value: string) => save({ [name]: runnerOf(value) ?? null })
  const levelRow = (name: Level, label: string, description: string) => {
    const values = views.map(settings => runnerValue(settings[name]))
    // Every project's saved pick is a choice, also one only another project holds.
    const options = views.flatMap(settings => runnerChoices(agents, settings[name])).filter((option, i, all) => all.findIndex(o => o.value === option.value) === i)
    return <SettingsSelectRow label={label} description={description + differing(shown, values, value => options.find(o => o.value === value)?.label ?? value)} {...mixed(values, options)} onChange={level(name)} />
  }
  const atOnces = views.map(settings => String(settings.atOnce ?? DEFAULT_AT_ONCE))
  const most = Math.max(8, ...atOnces.map(Number))

  return (
    <SettingsSection description="The models a main agent's subagents run on, by how hard the main agent says each task is, and how many run at once.">
      {levelRow('simple', 'Simple tasks', 'A task the main agent marks simple.')}
      {levelRow('hard', 'Hard tasks', 'A task the main agent marks hard.')}
      <SettingsSelectRow
        label="At once"
        description={'How many of one main agent\'s subagents run at the same time. It starts the next when one ends.' + differing(shown, atOnces, value => value)}
        {...mixed(atOnces, Array.from({ length: most }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })))}
        onChange={value => save({ atOnce: Number(value) })}
      />
      {saving && <p className="py-2 text-xs text-muted-foreground">Saving…</p>}
      {(error ?? read.error) !== undefined && (
        <p role="alert" className="py-2 text-xs text-danger">
          {error !== undefined ? `The subagent settings were not saved: ${error}` : `The subagent settings could not be read: ${read.error}`}
        </p>
      )}
    </SettingsSection>
  )
}

/** A menu's value and choices: the one value every project holds, or "Mixed", a line that cannot be picked. */
function mixed(values: string[], options: SettingsOption[]): { value: string; options: SettingsOption[] } {
  const [first = ''] = values
  if (values.every(value => value === first)) return { value: first, options }
  return { value: MIXED, options: [{ value: MIXED, label: 'Mixed', disabled: true }, ...options] }
}

/** The words after a setting's description when the projects hold it differently: each project's value. */
function differing(shown: { project: ModuleProject }[], values: string[], label: (value: string) => string): string {
  if (values.every(value => value === values[0])) return ''
  return ` ${shown.map(({ project }, i) => `${project.name}: ${label(values[i]!)}`).join(' · ')}.`
}
