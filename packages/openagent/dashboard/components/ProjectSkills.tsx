import { useEffect, useState } from 'react'
import { onProjectSkills, sendChangeSkills, sendCommitSkills, type ProjectSkills, type ProjectSkill } from '../rpc/skills.js'
import { useAction } from '../lib/use-action.js'
import { usePolled } from '../lib/use-async.js'
import { Button } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'
import { Dialog } from './ui/dialog.js'

// A project's skills, on its own page (#2023). The door to them is "Skills…" in the project's ⋮
// menu: it opens the same list with ticks `npx @openagt/init` shows in a terminal. This line shows
// only while it has something to say: a project with no skill yet, which needs the door in plain
// sight; a newer text to take; files not committed yet; and the skills that are in the folder but
// not yet on the branch agents start from. A project with its skills in order has no line.

const held = (skill: ProjectSkill): boolean => skill.standing !== 'absent'
const all = (skills: ProjectSkills): ProjectSkill[] => skills.groups.flatMap(group => group.skills)
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What stands beside a skill's name in the list when its text is not simply the one the dashboard carries. */
const NOTES: Partial<Record<ProjectSkill['standing'], string>> = {
  newer: 'a newer text is there',
  changed: 'changed by hand',
  own: 'your own text',
}

export const SCHEDULER_LINE = 'Starts the automations you switch on, while the dashboard is open. This machine only, nothing to commit.'

export function ProjectSkillsLine({
  projectId,
  onChanged,
  door,
}: {
  projectId: string
  onChanged?: (() => void) | undefined
  /** The list as the project's menu opens it: `open` once "Skills…" was picked, `onClose` when the list is closed again. */
  door?: { open: boolean; onClose: () => void } | undefined
}) {
  const { value: skills, reload } = usePolled<ProjectSkills | null>(() => onProjectSkills(projectId), null, 15_000, [projectId], 'previous')
  // The list opens on the project as it stands at that moment: a later read must not change it under the person's ticks.
  const [adding, setAdding] = useState<ProjectSkills | null>(null)
  const [committed, setCommitted] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  // The note of a commit made here holds until skill files stand uncommitted again.
  const uncommitted = skills?.uncommitted ?? 0
  useEffect(() => {
    if (uncommitted > 0) setCommitted(null)
  }, [uncommitted])
  // "Skills…" in the menu opens the list on the project as it stands then; picked before the skills were read, it opens once they are.
  const asked = door?.open ?? false
  useEffect(() => {
    if (asked && skills) setAdding(current => current ?? skills)
  }, [asked, skills])
  if (!skills) return null

  const changed = async (): Promise<void> => {
    await reload()
    onChanged?.()
  }
  const newer = all(skills).filter(skill => skill.standing === 'newer').map(skill => skill.name)
  const waiting = all(skills).filter(skill => skill.waiting).map(skill => skill.name)
  const update = async (): Promise<void> => {
    if ((await run(() => sendChangeSkills(projectId, { write: newer }), 'Could not update the skills.')).ok) await changed()
  }
  const commit = async (): Promise<void> => {
    const outcome = await run(() => sendCommitSkills(projectId), 'Could not commit the skill files.')
    if (!outcome.ok) return
    setCommitted(outcome.value.commit ?? null)
    await changed()
  }

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
  const none = skills.has === 0
  const note = skills.uncommitted === 0 && committed !== null
  const late = waiting.length > 0 && skills.startBranch !== undefined
  // Nothing to say: the list alone, when the menu opened it.
  if (!none && newer.length === 0 && skills.uncommitted === 0 && !note && !late && !error) return list || null

  return (
    <div role="status" aria-label="This project's skills" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      {none && (
        <span className="flex items-center gap-2">
          This project has no skills yet.
          <Button type="button" variant="outline" size="xs" onClick={() => setAdding(skills)}>
            Add skills
          </Button>
        </span>
      )}
      {newer.length > 0 && (
        <span className="flex items-center gap-2">
          {count(newer.length, 'skill has', 'skills have')} a newer text.
          <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => void update()}>
            Update
          </Button>
        </span>
      )}
      {skills.uncommitted > 0 && (
        <span className="flex items-center gap-2">
          {count(skills.uncommitted, 'skill file is', 'skill files are')} not committed.
          <Button type="button" variant="outline" size="xs" disabled={busy} onClick={() => void commit()}>
            Commit
          </Button>
        </span>
      )}
      {note && <span>Committed as {committed}. Nothing was pushed.</span>}
      {late && (
        <span>
          <span className="text-foreground">{waiting.length > 4 ? `${waiting.length} skills` : waiting.join(', ')}</span>: waiting to reach {skills.startBranch}. An agent started from {skills.startBranch} does not have {waiting.length === 1 ? 'it' : 'them'}.
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
  const [commit, setCommit] = useState<{ commit?: string | undefined; committed: boolean } | null>(null)
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

  const save = async (): Promise<void> => {
    const outcome = await run(() => sendChangeSkills(projectId, { write, remove, ...(scheduler !== skills.scheduler ? { scheduler } : {}) }), 'Could not change the skills.')
    if (!outcome.ok) return
    setSaved(outcome.value)
    onSaved()
  }
  const commitNow = async (): Promise<void> => {
    // The files this save wrote or deleted, and no other skill file that stands uncommitted.
    const outcome = await run(() => sendCommitSkills(projectId, [...(saved?.written ?? []), ...(saved?.removed ?? [])]), 'Could not commit the skill files.')
    if (!outcome.ok) return
    setCommit(outcome.value)
    onSaved()
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }} title="Add skills">
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
          {saved.written.length + saved.removed.length > 0 && skills.git && commit === null && (
            <p>The files are in the project&rsquo;s folder, not committed. A commit holds these files alone, on the branch the folder is on. Nothing is pushed.</p>
          )}
          {commit !== null && !commit.committed && <p>Nothing to commit: git already has these files as they are.</p>}
          {commit?.committed && skills.remote && <p>Committed as {commit.commit}, these files alone. Nothing was pushed: push it, or open a pull request where the default branch is protected.</p>}
          {commit?.committed && !skills.remote && <p>Committed as {commit.commit}, these files alone.{saved.written.length > 0 ? ' Your agents have these skills from their next start.' : ''}</p>}
          {saved.written.length > 0 && skills.startBranch !== undefined && !(commit?.committed && !skills.remote) && <p>Your agents get these skills once they are on {skills.startBranch}.</p>}
          {error && <p className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            {saved.written.length + saved.removed.length > 0 && skills.git && commit === null && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void commitNow()}>
                {busy ? 'Committing…' : 'Commit these files'}
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
            A ticked skill is written into the project&rsquo;s folder as a file you commit; an unticked one is deleted. Branches, logs, question, and github on a GitHub project come with every run and are not here.
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
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
