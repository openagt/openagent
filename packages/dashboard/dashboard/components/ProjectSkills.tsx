import { useEffect, useState } from 'react'
import { onProjectSkills, sendChangeSkills, sendProjectSkills, type ProjectSkills, type ProjectSkill, type SendSkillsResult } from '../rpc/skills.js'
import { useAction } from '../lib/use-action.js'
import { useLoaded, usePolled } from '../lib/use-async.js'
import { onSkillsSaved, skillsSaved } from '../lib/skills-saved.js'
import { useSettingsHold } from '../lib/settings-hold.js'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import { Checkbox } from './ui/checkbox.js'
import { Skeleton, useSkeleton } from './ui/skeleton.js'

// A project's skills (#2023). The "Skills" menu under the box (SkillsMenu.tsx) opens Settings on
// the project's Skills page: a card with a tick for each skill a project picks beyond the ones
// every run gets by default. The card on the project's own page, under the agents that wait on the
// person, shows only while it has something to say: a newer version to take, and skills that have
// not reached the branch agents start from, with the one press that sends them. Once agents have
// every skill there is no card.

/** The Settings entry, in the Project group. */
export const SKILLS_ENTRY = 'skills'

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

/** What a skill's card says under its name when its text is not simply the one the dashboard carries. */
const NOTES: Partial<Record<ProjectSkill['standing'], string>> = {
  newer: 'a newer version is there',
  changed: 'changed by hand',
  own: 'your own text',
}

/** The words of the one press that takes skills to agents: a send where there is a remote, a commit where there is none. */
export const sendWord = (skills: ProjectSkills): string => (skills.remote ? `Send to ${skills.remote}` : 'Commit')

export function ProjectSkillsLine({ projectId, onChanged }: { projectId: string; onChanged?: (() => void) | undefined }) {
  // A read that fails answers like a project unknown here: no skills to show.
  const { value: skills, reload } = usePolled<ProjectSkills | null>(() => onProjectSkills(projectId).catch(() => null), null, 15_000, [projectId], 'previous')
  const [pending, setPending] = useState<'update' | 'send' | null>(null)
  const { error, run } = useAction()
  // Saved on the Skills page, over this page: said here at once, not at the next read.
  useEffect(() => onSkillsSaved(() => void reload()), [reload])
  if (!skills) return null

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
  const { newer, waiting, here, sending, inRequest, onBranch } = skillsSay(skills)
  const update = () => act('update', () => updateSkills(projectId, skills, run))
  const send = () => act('send', () => run(() => sendProjectSkills(projectId), 'Could not send the skills.'))

  // Nothing to say: no card.
  if (newer.length === 0 && !sending && !inRequest && !onBranch && !error) return null

  return (
    <div role="status" aria-label="This project's skills" className="m-3 flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
      {newer.length > 0 && (
        <span className="flex items-center justify-between gap-3">
          <span>
            <Subject names={newer} /> {newer.length === 1 ? 'has a newer version' : 'have newer versions'}.
          </span>
          <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={pending !== null} onClick={() => void update()}>
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
          <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={pending !== null} onClick={() => void send()}>
            {pending === 'send' ? 'Sending…' : sendWord(skills)}
          </Button>
        </span>
      )}
      {inRequest && (
        <span className="flex items-center justify-between gap-3">
          <span>
            <Subject names={waiting} /> {is(waiting)} in pull request #{skills.request!.number}. Your agents get {it(waiting)} once it is merged.
          </span>
          <a href={skills.request!.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })}>
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
    </div>
  )
}

/**
 * What a project's skills say to the person, as this notice and the Overview's Skills card say it:
 * the skills with a newer version; the ones not yet where agents start from; of those, the ones
 * still on this computer only (a pull request, or the branch a send left, already holds the rest);
 * and whether they wait in a pull request or on a branch to merge.
 */
export function skillsSay(skills: ProjectSkills) {
  const newer = all(skills).filter(skill => skill.standing === 'newer').map(skill => skill.name)
  const waiting = all(skills).filter(skill => skill.waiting).map(skill => skill.name)
  const here = skills.request || skills.branch ? skills.uncommitted : [...new Set([...skills.uncommitted, ...waiting])]
  const sending = skills.git && here.length > 0
  const inRequest = skills.request !== undefined && waiting.length > 0
  const onBranch = !inRequest && skills.branch !== undefined && waiting.length > 0
  const heldNames = all(skills).filter(held).map(skill => skill.name)
  return { newer, waiting, here, sending, inRequest, onBranch, held: heldNames.length, heldNames }
}

/** Take the newer versions of a project's skills, and send them where agents start from when the folder is a repository. */
export async function updateSkills(projectId: string, skills: ProjectSkills, run: ReturnType<typeof useAction>['run']): Promise<{ ok: boolean }> {
  const { newer } = skillsSay(skills)
  const written = await run(() => sendChangeSkills(projectId, { write: newer }), 'Could not update the skills.')
  if (!written.ok || !skills.git) return written
  return run(() => sendProjectSkills(projectId, newer), 'Could not send the skills.')
}

/** What is ticked when the page opens: what the project has, so nothing in a project with none yet. */
function firstTicks(skills: ProjectSkills): Set<string> {
  return new Set(all(skills).filter(held).map(skill => skill.name))
}

interface Saved {
  written: string[]
  removed: string[]
  left: { path: string; reason: string }[]
  scheduler?: 'on' | 'off' | undefined
  schedulerError?: string | undefined
}

/** Settings › Project › Skills, for one project. */
export function SkillsSettings({ projectId }: { projectId: string }) {
  // Read once a visit, not polled: a later read must not change the page under the person's ticks. Done, after a save, is the next visit.
  const [visit, setVisit] = useState(0)
  // `undefined` is not read yet; a read that fails answers like a project unknown here.
  const skills = useLoaded<ProjectSkills | null | undefined>(() => onProjectSkills(projectId).catch(() => null), undefined, [projectId, visit])
  const reading = useSkeleton(skills === undefined)
  if (skills === undefined || reading) {
    return (
      <div aria-label="Reading the skills" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>
    )
  }
  if (skills === null) {
    return (
      <p role="alert" className="rounded-lg border border-border px-3 py-2 text-sm text-danger">
        This project&rsquo;s skills could not be read.
      </p>
    )
  }
  return <SkillCards key={visit} projectId={projectId} skills={skills} onDone={() => setVisit(next => next + 1)} />
}

function SkillCards({ projectId, skills, onDone }: { projectId: string; skills: ProjectSkills; onDone: () => void }) {
  const [ticked, setTicked] = useState(() => firstTicks(skills))
  const [saved, setSaved] = useState<Saved | null>(null)
  const [sent, setSent] = useState<SendSkillsResult | null>(null)
  const { busy, error, reset, run } = useAction()

  const tick = (name: string, on: boolean): void =>
    setTicked(current => {
      const next = new Set(current)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })
  const write = all(skills).filter(skill => ticked.has(skill.name) && !held(skill)).map(skill => skill.name)
  const remove = all(skills).filter(skill => !ticked.has(skill.name) && held(skill)).map(skill => skill.name)
  const nothing = write.length === 0 && remove.length === 0
  useSettingsHold(!nothing && !saved)

  // A change of skills goes on to where agents start from in the same press.
  const send = async (names: string[]): Promise<void> => {
    setSent(null)
    const outcome = await run(() => sendProjectSkills(projectId, names), 'Could not send the skills.')
    if (outcome.ok) setSent(outcome.value)
    skillsSaved()
  }
  const save = async (): Promise<void> => {
    const outcome = await run(() => sendChangeSkills(projectId, { write, remove }), 'Could not change the skills.')
    if (!outcome.ok) return
    setSaved(outcome.value)
    skillsSaved()
    const changed = [...outcome.value.written, ...outcome.value.removed]
    if (changed.length > 0 && skills.git) await send(changed)
  }
  const saveWord = nothing || !skills.git ? 'Save' : skills.remote ? `Save and send to ${skills.remote}` : 'Save and commit'
  const branch = skills.startBranch ?? 'the default branch'
  const cancel = (): void => {
    setTicked(firstTicks(skills))
    reset()
  }

  if (saved) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
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
        {sent?.ok && sent.sent === 'committed' && <p>Committed.{sent.unsent !== undefined && ` Nothing was sent: ${sent.unsent}.`} Your agents get this change from their next start.</p>}
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
            <Button type="button" disabled={busy} onClick={() => void send([...saved.written, ...saved.removed])}>
              {busy ? 'Sending…' : 'Send again'}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A ticked skill is written into the project&rsquo;s folder and an unticked one is deleted{skills.remote ? `; Save sends the change to ${skills.remote}, where your agents start from` : skills.git ? '; Save commits the change' : ''}. The skills every agent gets by default come with every run and are not here.
      </p>
      {skills.groups.map(group => (
        <fieldset key={group.title}>
          <legend className="mb-2 text-sm font-medium">{group.title}</legend>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {group.skills.map(skill => {
              const notes = [NOTES[skill.standing], skill.waiting && skills.startBranch !== undefined ? `waiting to reach ${skills.startBranch}` : undefined].filter(Boolean)
              return (
                <label key={skill.name} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors', ticked.has(skill.name) ? 'border-primary/60' : 'border-border hover:border-muted-foreground/40')}>
                  <Checkbox checked={ticked.has(skill.name)} onCheckedChange={checked => tick(skill.name, checked === true)} disabled={busy} className="mt-0.5" aria-label={skill.name} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{skill.name}</span>
                    {notes.length > 0 && <span className="block text-xs text-warning">{notes.join(' · ')}</span>}
                    <span className="mt-0.5 block text-xs text-muted-foreground">{skill.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      {/* In sight while the cards scroll under it: a tick at the top of the page has its Save at hand. */}
      <div className="sticky bottom-0 -mx-4 -mb-6 border-t border-border bg-background px-4 py-3">
        {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {nothing ? 'Nothing to change.' : [write.length > 0 ? `${count(write.length, 'skill', 'skills')} to write` : '', remove.length > 0 ? `${count(remove.length, 'skill', 'skills')} to delete` : ''].filter(Boolean).join(', ') + '.'}
          </span>
          <Button type="button" variant="outline" disabled={busy || nothing} onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || nothing} onClick={() => void save()}>
            {busy ? 'Saving…' : saveWord}
          </Button>
        </div>
      </div>
    </div>
  )
}
