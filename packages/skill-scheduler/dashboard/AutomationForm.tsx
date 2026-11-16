import { useEffect, useState } from 'react'
import { Button, Input, RadioGroup, RadioGroupOption, useKeptDraft, useOpenAgentDown, type ModuleCommandResult, type ModuleProject } from '@openagt/dashboard/module'
import { EMPTY_DRAFT, addArgs, draftProblem, draftSentence, isUntouched, nameProblem, ownPaceArgs, savedFile, savedWords, whereHint, type AutomationDraft, type OwnPace } from './automation-form.js'
import { FormFoot, PaceFields, SaidFields, SaveWords, Section } from './fields.js'
import { DEFAULT_AGENT } from '../src/names.js'

// The "New automation" form of the Automations page: a person's own prompt, saved as a command of
// the project with a row like any skill's. A name; what it does, the same fields a row's Edit panel
// has for it: what the agent is told and an optional shell line that prints what is new, with "Try
// it"; when it runs, the same pace control; and who gets it.
//
// Saving (`scheduler add`) is the person's choice of two: shared with the project, a skill
// file of theirs to commit, whose row cannot start before it is where an agent's checkout starts;
// or only on this machine, where nothing is to commit and the row can start at once. A time of day
// is this machine's, kept with a second command (`pace`). Once saved the form says where the file
// is and what is left for the person to do.

export function AutomationForm({
  project,
  schedulerRuns,
  run,
  onDirty,
  onClose,
  onSaved,
}: {
  project: ModuleProject
  /** Whether the project's scheduler is on and running: else a row switched on does not start yet. */
  schedulerRuns: boolean
  /** Run one command of the scheduler in the project, in turn with the page's other saves. */
  run: (args: string[]) => Promise<ModuleCommandResult>
  /** Whether something is typed and not saved: closing the form then would lose it. */
  onDirty: (dirty: boolean) => void
  onClose: () => void
  onSaved: () => void
}) {
  // What is typed is kept in this browser until it is saved or put away with Cancel: a reload, or a closed tab, loses none of it.
  const [draft, setDraft, forget] = useKeptDraft<AutomationDraft>(`automation:${project.id}`, EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const down = useOpenAgentDown()
  const [failed, setFailed] = useState<string | undefined>()
  const [saved, setSaved] = useState<{ command: string; file: string; startsFrom: string; onThisMachine: boolean; timeNotKept?: string } | undefined>()
  const set = (change: Partial<AutomationDraft>): void => {
    setDraft(current => ({ ...current, ...change }))
    setFailed(undefined)
  }
  const problem = draftProblem(draft)
  const badName = nameProblem(draft.name)
  const sentence = draftSentence(draft)
  const dirty = !isUntouched(draft) && !saved
  useEffect(() => onDirty(dirty), [dirty])
  useEffect(() => () => onDirty(false), [])

  const save = async (): Promise<void> => {
    const args = addArgs(draft)
    const time = ownPaceArgs(draft)
    if (!args || !time) return
    setSaving(true)
    setFailed(undefined)
    const answer = await run(args)
    if (!answer.ok) {
      setSaving(false)
      return setFailed(`Not saved: ${answer.error}`)
    }
    // The time of day is this machine's: kept once the automation is there to keep it for.
    const kept = time[0] === 'skill' ? undefined : await run(['pace', draft.name.trim(), ...time])
    setSaving(false)
    forget()
    setSaved({ command: draft.name.trim(), ...savedFile(answer.output), ...(kept && !kept.ok ? { timeNotKept: kept.error } : {}) })
    onSaved()
  }

  if (saved) {
    return (
      <div role="group" aria-label="New automation" className="mb-8 rounded-lg border border-hairline p-4 text-sm">
        <p>
          Saved <span className="font-mono">{saved.onThisMachine ? saved.command : `/${saved.command}`}</span> as <span className="font-mono">{saved.file}</span>.
        </p>
        <p className="mt-2">{savedWords(saved, schedulerRuns)}</p>
        {saved.timeNotKept !== undefined && (
          <p role="alert" className="mt-2 text-danger">
            Its time of day was not kept: {saved.timeNotKept}. Its row's Edit sets it.
          </p>
        )}
        <p className="mt-2 text-muted-foreground">Its row is in the list now, switched off.</p>
        <div className="mt-3 flex justify-end">
          <Button autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label="New automation"
      onKeyDown={e => {
        // Escape closes a form that has nothing to lose. Any other is closed with Cancel, so a slip of a key loses no prompt.
        if (e.key === 'Escape' && !saving && isUntouched(draft)) onClose()
      }}
      className="mb-8 max-w-180 space-y-6"
    >
      <h3 className="text-base font-semibold">New automation</h3>
      <fieldset disabled={saving} className="min-w-0 space-y-6">
        <Section title="Name">
          <div className="flex items-center gap-1 text-sm">
            {/* A shared one is a command a person can type; one kept on this machine is no command, so it has no slash. */}
            {!draft.onThisMachine && <span className="font-mono text-muted-foreground">/</span>}
            <Input
              type="text"
              id="automation-name"
              autoFocus
              value={draft.name}
              onChange={e => set({ name: e.target.value })}
              placeholder="answer-comments"
              aria-label="Name"
              aria-invalid={badName !== undefined}
              {...(badName !== undefined ? { 'aria-describedby': 'automation-name-problem' } : {})}
              className="w-64 max-w-full font-mono"
            />
          </div>
          {badName !== undefined && (
            <p id="automation-name-problem" className="mt-1.5 text-xs text-danger">
              {badName}
            </p>
          )}
        </Section>
        <Section title="What it does">
          <SaidFields project={project} said={draft} agent={DEFAULT_AGENT} autoFocus={false} onChange={set} />
        </Section>
        <Section title="When it runs">
          <PaceFields
            name="How long the new automation waits after a start"
            draft={draft.pace}
            work={draft.when.trim() !== '' ? { waitsFor: draft.waitsFor.trim() || undefined } : undefined}
            noWait={draft.when.trim() !== ''}
            start={{ count: 1, unit: 'd' }}
            counted="Counted from its last start."
            disabled={saving}
            autoFocus={false}
            onChange={next => set({ pace: next as OwnPace })}
          />
        </Section>
        <Section title="Who gets it">
          <RadioGroup aria-label="Who gets the automation" value={draft.onThisMachine ? 'machine' : 'project'} onValueChange={who => set({ onThisMachine: who === 'machine' })} disabled={saving}>
            <RadioGroupOption value="project">
              Shared with the project
              <span className="text-xs text-muted-foreground">a file you commit, for everyone</span>
            </RadioGroupOption>
            <RadioGroupOption value="machine">
              Only on this machine
              <span className="text-xs text-muted-foreground">nothing to commit, for you alone</span>
            </RadioGroupOption>
          </RadioGroup>
        </Section>
      </fieldset>
      <p className="text-sm">{problem ?? `${sentence}.`}</p>
      {failed !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {failed}
        </p>
      )}
      <FormFoot where={whereHint(draft, schedulerRuns)}>
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => {
            forget()
            onClose()
          }}
        >
          Cancel
        </Button>
        <Button disabled={saving || down || problem !== undefined} onClick={() => void save()}>
          <SaveWords saving={saving} />
        </Button>
      </FormFoot>
    </div>
  )
}
