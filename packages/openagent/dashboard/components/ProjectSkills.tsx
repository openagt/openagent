import { useEffect, useState } from 'react'
import { onProjectSkills, sendChangeSkills, sendProjectSkills, type ProjectSkills, type ProjectSkill, type SendSkillsResult } from '../rpc/skills.js'
import { useAction } from '../lib/use-action.js'
import { usePolled } from '../lib/use-async.js'
import { Button, buttonVariants } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'
import { Dialog } from './ui/dialog.js'

// A project's skills, on its own page (#2023). The door to them is "Skills", after "Auto" under the
// launcher's box: it opens the same list with ticks `npx @openagt/init` shows in a terminal, the skills a
// project picks beyond the ones every run gets by default. The card under the agents that wait on
// the person shows only while it has something to say: a newer version to take, and skills that
// have not reached the branch agents start from, with the one press that sends them. Once agents
// have every skill there is no card.

const held = (skill: ProjectSkill): boolean => skill.standing !== 'absent'
const all = (skills: ProjectSkills): ProjectSkill[] => skills.groups.flatMap(group => group.skills)
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * Skills as the subject of a sentence: "The orchestration skill", "The tickets and queue skills",
 * and more than three counted ("21 skills"). "skill" is said, since many names are plain words
 * (plan, research, ux) that alone do not say what is meant.
 */
function Subject({ names }: { names: readonly string[] }) {
  if (names.length > 3) return <span className="text-foreground">{names.length} skills</span>
  return (
    <>
      The{' '}
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 && (index === names.length - 1 ? ' and ' : ', ')}
          <span className="text-foreground">{name}</span>
        </span>
      ))}{' '}
      {names.length === 1 ? 'skill' : 'skills'}
    </>
  )
}
const is = (names: readonly string[]): string => (names.length === 1 ? 'is' : 'are')
const it = (names: readonly string[]): string => (names.length === 1 ? 'it' : 'them')

/** What stands beside a skill's name in the list when its text is not simply the one the dashboard carries. */
const NOTES: Partial<Record<ProjectSkill['standing'], string>> = {
  newer: 'a newer version is there',
  changed: 'changed by hand',
  own: 'your own text',
}

export const SCHEDULER_LINE = 'Starts the automations you switch on, while the dashboard is open. This machine only, nothing to commit.'

/** The words of the one press that takes skills to agents: a send where there is a remote, a commit where there is none. */
const sendWord = (skills: ProjectSkills): string => (skills.remote ? `Send to ${skills.remote}` : 'Commit')

export function ProjectSkillsLine({
  projectId,
  onChanged,
  door,
}: {
  projectId: string
  onChanged?: (() => void) | undefined
  /** The list as its door opens it: `open` once "Skills" was pressed, `onClose` when the list is closed again. */
  door?: { open: boolean; onClose: () => void } | undefined
}) {
  // A read that fails answers like a project unknown here: no skills to show. `loaded` then tells "not read yet" from "nothing to read".
  const { value: skills, reload, loaded } = usePolled<ProjectSkills | null>(() => onProjectSkills(projectId).catch(() => null), null, 15_000, [projectId], 'previous')
  // The list opens on the project as it stands at that moment: a later read must not change it under the person's ticks.
  const [adding, setAdding] = useState<ProjectSkills | null>(null)
  const [pending, setPending] = useState<'update' | 'send' | null>(null)
  const { error, run } = useAction()
  // "Skills" opens the list on the project as it stands then; picked before the skills were read, it opens once they are.
  const asked = door?.open ?? false
  useEffect(() => {
    if (asked && skills) setAdding(current => current ?? skills)
  }, [asked, skills])
  if (!skills) {
    // Asked for from the menu, and there is nothing to open: said, since a menu item that does nothing reads as broken.
    return asked && loaded ? (
      <p role="alert" className="m-3 rounded-lg border border-border px-3 py-2 text-sm text-danger">
        This project&rsquo;s skills could not be read.
      </p>
    ) : null
  }

  const changed = async (): Promise<void> => {
    await reload()
    onChanged?.()
  }
  const act = async (which: 'update' | 'send', action: () => Promise<{ ok: boolean }>): Promise<void> => {
    setPending(which)
    try {
      if ((await action()).ok) await changed()
    } finally {
      setPending(null)
    }
  }
  const newer = all(skills).filter(skill => skill.standing === 'newer').map(skill => skill.name)
  const waiting = all(skills).filter(skill => skill.waiting).map(skill => skill.name)
  // What a pull request, or the branch a send left, already holds is said with it; what is still on this computer only, apart.
  const here = skills.request || skills.branch ? skills.uncommitted : [...new Set([...skills.uncommitted, ...waiting])]
  const update = () =>
    act('update', async () => {
      const written = await run(() => sendChangeSkills(projectId, { write: newer }), 'Could not update the skills.')
      if (!written.ok || !skills.git) return written
      return run(() => sendProjectSkills(projectId, newer), 'Could not send the skills.')
    })
  const send = () => act('send', () => run(() => sendProjectSkills(projectId), 'Could not send the skills.'))

  const list = adding && (
    <AddSkillsDialog
      projectId={projectId}
      skills={adding}
      onClose={() => {
        setAdding(null)
        door?.onClose()
      }}
      onSaved={() => void changed()}
    />
  )
  const sending = skills.git && here.length > 0
  const inRequest = skills.request !== undefined && waiting.length > 0
  const onBranch = !inRequest && skills.branch !== undefined && waiting.length > 0
  // Nothing to say: the list alone, when the menu opened it.
  if (newer.length === 0 && !sending && !inRequest && !onBranch && !error) return list || null

  return (
    <div role="status" aria-label="This project's skills" className="m-3 flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
      {newer.length > 0 && (
        <span className="flex items-center justify-between gap-3">
          <span>
            <Subject names={newer} /> {newer.length === 1 ? 'has a newer version' : 'have newer versions'}.
          </span>
          <Button type="button" variant="outline" size="xs" className="shrink-0" disabled={pending !== null} onClick={() => void update()}>
            {pending === 'update' ? 'Updating…' : 'Update'}
          </Button>
        </span>
      )}
      {sending && (
        <span className="flex items-center justify-between gap-3">
          <span>
            <Subject names={here} /> {is(here)} {skills.remote ? 'on this computer only' : 'not committed'}, so your agents do not have {it(here)} yet.
            {skills.local && skills.remote && ' Or pick My local branch when you start an agent.'}
          </span>
          <Button type="button" variant="outline" size="xs" className="shrink-0" disabled={pending !== null} onClick={() => void send()}>
            {pending === 'send' ? 'Sending…' : sendWord(skills)}
          </Button>
        </span>
      )}
      {inRequest && (
        <span className="flex items-center justify-between gap-3">
          <span>
            <Subject names={waiting} /> {is(waiting)} in pull request #{skills.request!.number}. Your agents get {it(waiting)} once it is merged.
          </span>
          <a href={skills.request!.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'xs', className: 'shrink-0' })}>
            Open #{skills.request!.number}
          </a>
        </span>
      )}
      {onBranch && (
        <span>
          <Subject names={waiting} /> {is(waiting)} on the branch {skills.branch} on {skills.remote}. Merge it into {skills.startBranch ?? 'the default branch'}, and your agents get {it(waiting)}.
        </span>
      )}
      {error && <span className="text-danger">{error}</span>}
      {list}
    </div>
  )
}

/** What is ticked when the list opens: what the project has; in a project with nothing yet, the default picks. */
function firstTicks(skills: ProjectSkills): { ticked: Set<string>; scheduler: boolean } {
  const has = all(skills).filter(held)
  if (has.length > 0 || skills.scheduler) return { ticked: new Set(has.map(skill => skill.name)), scheduler: skills.scheduler }
  return { ticked: new Set(skills.groups.filter(group => group.ticked).flatMap(group => group.skills.map(skill => skill.name))), scheduler: true }
}

interface Saved {
  written: string[]
  removed: string[]
  left: { path: string; reason: string }[]
  scheduler?: 'on' | 'off' | undefined
  schedulerError?: string | undefined
}

export function AddSkillsDialog({ projectId, skills, onClose, onSaved }: { projectId: string; skills: ProjectSkills; onClose: () => void; onSaved: () => void }) {
  const [first] = useState(() => firstTicks(skills))
  const [ticked, setTicked] = useState(first.ticked)
  const [scheduler, setScheduler] = useState(first.scheduler)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [sent, setSent] = useState<SendSkillsResult | null>(null)
  const { busy, error, run } = useAction()

  const tick = (name: string, on: boolean): void =>
    setTicked(current => {
      const next = new Set(current)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })
  const write = all(skills).filter(skill => ticked.has(skill.name) && !held(skill)).map(skill => skill.name)
  const remove = all(skills).filter(skill => !ticked.has(skill.name) && held(skill)).map(skill => skill.name)
  const nothing = write.length === 0 && remove.length === 0 && scheduler === skills.scheduler

  // A change of skills goes on to where agents start from in the same press; the scheduler alone is this machine's, and nothing is sent.
  const send = async (names: string[]): Promise<void> => {
    setSent(null)
    const outcome = await run(() => sendProjectSkills(projectId, names), 'Could not send the skills.')
    if (outcome.ok) setSent(outcome.value)
    onSaved()
  }
  const save = async (): Promise<void> => {
    const outcome = await run(() => sendChangeSkills(projectId, { write, remove, ...(scheduler !== skills.scheduler ? { scheduler } : {}) }), 'Could not change the skills.')
    if (!outcome.ok) return
    setSaved(outcome.value)
    onSaved()
    const changed = [...outcome.value.written, ...outcome.value.removed]
    if (changed.length > 0 && skills.git) await send(changed)
  }
  const saveWord = nothing || write.length + remove.length === 0 || !skills.git ? 'Save' : skills.remote ? `Save and send to ${skills.remote}` : 'Save and commit'
  const branch = skills.startBranch ?? 'the default branch'

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }} title="Skills">
      {saved ? (
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          {saved.written.length > 0 && (
            <p>
              Wrote {count(saved.written.length, 'skill', 'skills')} in <code className="rounded bg-muted px-1">.agents/skills</code>, linked in{' '}
              <code className="rounded bg-muted px-1">.claude/skills</code>: <span className="text-foreground">{saved.written.join(', ')}</span>.
            </p>
          )}
          {saved.removed.length > 0 && (
            <p>
              Deleted {count(saved.removed.length, 'skill', 'skills')}: <span className="text-foreground">{saved.removed.join(', ')}</span>.
            </p>
          )}
          {saved.scheduler === 'on' && <p>The scheduler is on for this project, on this machine. Every automation starts switched off.</p>}
          {saved.scheduler === 'off' && <p>The scheduler is off for this project on this machine, and stopped.</p>}
          {saved.left.map(({ path, reason }) => (
            <p key={path}>
              Left as it is: <code className="rounded bg-muted px-1">{path}</code> ({reason}).
            </p>
          ))}
          {saved.schedulerError && <p className="text-danger">The scheduler was not switched: {saved.schedulerError}</p>}
          {saved.written.length + saved.removed.length > 0 && !skills.git && <p>This folder is not a git repository, so there is nothing to commit.</p>}
          {sent?.ok && sent.sent === 'committed' && <p>Committed. Your agents get this change from their next start.</p>}
          {sent?.ok && sent.sent === 'pushed' && (
            <p>
              Sent to {skills.remote}, on {sent.branch}. Your agents get this change from their next start.
            </p>
          )}
          {sent?.ok && sent.sent === 'request' && (
            <p>
              {skills.remote} took no push to {branch}, so the change is in{' '}
              <a href={sent.request.url} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
                pull request #{sent.request.number}
              </a>
              . Your agents get it once it is merged.
            </p>
          )}
          {sent?.ok && sent.sent === 'branch' && (
            <p>
              {branch} took no push, so the change is on the branch <code className="rounded bg-muted px-1">{sent.branch}</code>. Merge it into {branch}, and your agents get it.
            </p>
          )}
          {error && <p className="text-danger">{saved.written.length + saved.removed.length > 0 ? `Saved in the project's folder, not sent: ${error}` : error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            {error && saved.written.length + saved.removed.length > 0 && skills.git && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void send([...saved.written, ...saved.removed])}>
                {busy ? 'Sending…' : 'Send again'}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-xs">
          <p className="mb-2 leading-relaxed text-muted-foreground">
            A ticked skill is written into the project&rsquo;s folder and an unticked one is deleted{skills.remote ? `; Save sends the change to ${skills.remote}, where your agents start from` : skills.git ? '; Save commits the change' : ''}. The skills every agent gets by default come with every run and are not here.
          </p>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {skills.groups.map(group => (
              <fieldset key={group.title}>
                <legend className="mb-1 font-medium text-foreground">{group.title}</legend>
                {group.skills.map(skill => (
                  <label key={skill.name} className="flex cursor-pointer items-start gap-2 py-0.5">
                    <Checkbox checked={ticked.has(skill.name)} onCheckedChange={checked => tick(skill.name, checked === true)} disabled={busy} className="mt-0.5" aria-label={skill.name} />
                    <span className="min-w-0">
                      <span className="text-foreground">{skill.name}</span>
                      {NOTES[skill.standing] && <span className="text-warning"> ({NOTES[skill.standing]})</span>}
                      {skill.waiting && skills.startBranch !== undefined && <span className="text-warning"> (waiting to reach {skills.startBranch})</span>}
                      <span className="block text-muted-foreground">{skill.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <fieldset>
              <legend className="mb-1 font-medium text-foreground">The scheduler</legend>
              <label className="flex cursor-pointer items-start gap-2 py-0.5">
                <Checkbox checked={scheduler} onCheckedChange={checked => setScheduler(checked === true)} disabled={busy} className="mt-0.5" aria-label="scheduler" />
                <span className="min-w-0">
                  <span className="text-foreground">scheduler</span>
                  <span className="block text-muted-foreground">{SCHEDULER_LINE}</span>
                </span>
              </label>
            </fieldset>
          </div>
          {error && <p className="mt-2 text-danger">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="mr-auto text-muted-foreground">
              {nothing ? 'Nothing to change.' : [write.length > 0 ? `${count(write.length, 'skill', 'skills')} to write` : '', remove.length > 0 ? `${count(remove.length, 'skill', 'skills')} to delete` : '', scheduler !== skills.scheduler ? `the scheduler ${scheduler ? 'on' : 'off'}` : ''].filter(Boolean).join(', ') + '.'}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy || nothing} onClick={() => void save()}>
              {busy ? 'Saving…' : saveWord}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
