import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { DEFAULT_STATE, readState, statePath, updateState, writeState, type State, type ListedCommand, agentInForce, modelInForce, withAgent, withModel, isSwitchedOn, switchedOnAt, withoutCommand, withSwitch, publishInForce, withPace, withPublish, capInForce, withAgents, namesGivenUp, withoutName, withoutListed } from './state.js'
import { STATE_DIR } from './names.js'

const git = nodeGitRunner()

/** A command as a tick's record lists it: made for Claude Code, which alone can run it, unless said otherwise. */
const row = <T extends object>(command: string, over?: T) => ({ command, agent: 'claude-code' as const, able: ['claude-code' as const], ...over }) as ListedCommand & T

async function repo(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-state-')))
  await git(['init', '-q', '-b', 'main'], path)
  return path
}

test('no state file reads as the default: off, no keep-alive, opus, the half-day cushion', async () => {
  const root = await repo()
  try {
    assert.deepEqual(await readState(root), DEFAULT_STATE)
    assert.equal(DEFAULT_STATE.on, false)
    assert.equal(DEFAULT_STATE.model, 'opus')
    assert.ok(Math.abs(DEFAULT_STATE.spendOffset - 100 / 14) < 1e-9)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the first write hides the directory from git through the exclude file; a read gives back what was written, defaults filled', async () => {
  const root = await repo()
  try {
    await writeState(root, { ...DEFAULT_STATE, on: true, pid: 4242 })
    assert.match(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8'), new RegExp(`^/${STATE_DIR}$`, 'm'))
    assert.equal((await git(['status', '--porcelain'], root)).trim(), '', 'nothing of the state shows in the project')
    await writeFile(statePath(root), '{"on": true}')
    assert.deepEqual(await readState(root), { ...DEFAULT_STATE, on: true })
    const next = await updateState(root, s => ({ ...s, model: 'sonnet' }))
    assert.equal(next.model, 'sonnet')
    assert.equal((await readState(root)).model, 'sonnet')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a state file that does not parse reads as the default rather than stopping the tick', async () => {
  const root = await repo()
  try {
    await writeState(root, DEFAULT_STATE)
    await writeFile(statePath(root), '{not json')
    assert.deepEqual(await readState(root), DEFAULT_STATE)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every command starts switched off; only a command switched on is kept, so switching it off leaves no trace', () => {
  assert.equal(isSwitchedOn(DEFAULT_STATE, 'work-queue'), false)
  const MORNING = '2026-10-09T07:00:00.000Z'
  const NOON = '2026-10-09T12:00:00.000Z'
  const on = withSwitch(DEFAULT_STATE, 'post-merge-cleanup', MORNING)
  assert.deepEqual(on.switches, { 'post-merge-cleanup': MORNING }, 'the switch holds when it was switched on')
  assert.equal(isSwitchedOn(on, 'post-merge-cleanup'), true)
  assert.equal(switchedOnAt(on, 'post-merge-cleanup'), MORNING)
  assert.equal(isSwitchedOn(on, 'work-queue'), false)
  assert.equal(switchedOnAt(on, 'work-queue'), undefined)
  // Switching off a command nobody switched on keeps nothing of it.
  const both = withSwitch(withSwitch(on, 'triage quick', NOON), 'work-queue', undefined)
  assert.deepEqual(both.switches, { 'post-merge-cleanup': MORNING, 'triage quick': NOON })
  const back = withSwitch(withSwitch(both, 'triage quick', undefined), 'post-merge-cleanup', undefined)
  assert.equal('switches' in back, false)
  // A state edited by hand: anything but a time is off.
  assert.equal(isSwitchedOn({ ...DEFAULT_STATE, switches: { 'work-queue': 'on' } }, 'work-queue'), false)
  assert.equal(isSwitchedOn({ ...DEFAULT_STATE, switches: { 'work-queue': true as never } }, 'work-queue'), false)
  // Text a date would read loosely is no time either: `1` reads as the year 2001.
  for (const loose of ['1', '2026', 'October 9']) assert.equal(isSwitchedOn({ ...DEFAULT_STATE, switches: { 'work-queue': loose } }, 'work-queue'), false, loose)
})

test('a scheduler ending clears its own pid only: a pid another scheduler wrote meanwhile stays', async () => {
  const { withoutPid } = await import('./state.js')
  const mine: State = { ...DEFAULT_STATE, on: true, pid: 100, startedAt: '2026-01-01T00:00:00.000Z' }
  assert.deepEqual(withoutPid(mine, 100), { ...DEFAULT_STATE, on: true })
  const theirs: State = { ...mine, pid: 200 }
  assert.deepEqual(withoutPid(theirs, 100), theirs, 'the next scheduler keeps its pid')
  assert.deepEqual(withoutPid({ ...DEFAULT_STATE, on: true }, 100), { ...DEFAULT_STATE, on: true })
})

test('a run of a scheduled command commits its work until a person picks a level on this machine; nothing is a pick too', () => {
  assert.equal(publishInForce(DEFAULT_STATE, 'work-queue'), 'commit')

  const picked = withPublish(withPublish(DEFAULT_STATE, 'work-queue', 'nothing'), 'triage quick', 'pr')
  assert.deepEqual(picked.publishes, { 'work-queue': 'nothing', 'triage quick': 'pr' })
  assert.equal(publishInForce(picked, 'work-queue'), undefined)
  assert.equal(publishInForce(picked, 'triage quick'), 'pr')
  // Another command is still nobody's pick.
  assert.equal(publishInForce(picked, 'post-merge-cleanup'), 'commit')

  // A pick of commit is kept like any other.
  assert.deepEqual(withPublish(DEFAULT_STATE, 'work-queue', 'commit').publishes, { 'work-queue': 'commit' })

  // A hand-edited state with a word that is no pick: as if nobody picked.
  assert.equal(publishInForce({ ...DEFAULT_STATE, publishes: { 'work-queue': 'push' as never } }, 'work-queue'), 'commit')
})

test("a pace is kept only where a person set one: taking it back leaves no trace, and the command runs at its skill's pace again", () => {
  const since = '2026-10-08T07:00:00.000Z'
  const one = withPace(DEFAULT_STATE, 'update-tickets', { every: '1h', since })
  const two = withPace(one, 'work-queue', { work: true })
  assert.deepEqual(two.paces, { 'update-tickets': { every: '1h', since }, 'work-queue': { work: true } })
  // A new pick replaces the old one.
  assert.deepEqual(withPace(two, 'update-tickets', { every: '2d', at: '10:00', since }).paces!['update-tickets'], { every: '2d', at: '10:00', since })
  const back = withPace(withPace(two, 'update-tickets', undefined), 'work-queue', undefined)
  assert.equal('paces' in back, false)
  // Taking back a pace nobody set changes nothing.
  assert.deepEqual(withPace(one, 'triage quick', undefined), one)
})

test("the cap in force is this machine's number of agents at once, else the skill's; it is kept only where a person set one", () => {
  const skill = { name: 'work-queue', cap: 1 }
  assert.equal(capInForce(DEFAULT_STATE, skill), 1)
  assert.equal(capInForce(DEFAULT_STATE, { name: 'plan-tickets', cap: 2 }), 2)
  const mine = withAgents(withAgents(DEFAULT_STATE, 'work-queue', 3), 'triage quick', 1)
  assert.deepEqual(mine.agents, { 'work-queue': 3, 'triage quick': 1 })
  assert.equal(capInForce(mine, skill), 3)
  // 99 is the top, and a pick.
  assert.equal(capInForce({ ...DEFAULT_STATE, agents: { 'work-queue': 99 } }, skill), 99)
  // A number below the skill's is a pick too.
  assert.equal(capInForce(mine, { name: 'triage quick', cap: 4 }), 1)
  // Another command still has its skill's.
  assert.equal(capInForce(mine, { name: 'plan-tickets', cap: 2 }), 2)
  // A state edited by hand: a value that is no whole number above 0 is no number set.
  for (const odd of [0, -1, 1.5, 100, '3', null, Number.NaN]) assert.equal(capInForce({ ...DEFAULT_STATE, agents: { 'work-queue': odd as never } }, skill), 1, String(odd))
  const back = withAgents(withAgents(mine, 'work-queue', undefined), 'triage quick', undefined)
  assert.equal('agents' in back, false)
  assert.deepEqual(withAgents(mine, 'plan-tickets', undefined), mine)
})

test("the coding agent a run is on is this machine's pick, else the one the command is made for; its model is this machine's pick, else its skill's on the agent the skill is made for, else the scheduler's own on Claude Code, and none on any other agent", () => {
  const CLAUDE = '.claude/skills'
  const CODEX = '.agents/skills'
  const both = { name: 'update-tickets', dirs: [CLAUDE, CODEX] }
  const state = { ...DEFAULT_STATE, model: 'opus' }
  // Nobody picked, and the skill names nothing: Claude Code, on the scheduler's model.
  assert.deepEqual([agentInForce(state, both), modelInForce(state, both, 'claude-code')], ['claude-code', 'opus'])
  // The skill names its model: it goes with the agent the skill is made for, and with no other.
  const cheap = { ...both, model: 'haiku' }
  assert.deepEqual([modelInForce(state, cheap, 'claude-code'), modelInForce(state, cheap, 'codex')], ['haiku', undefined])
  // The skill names Codex: its runs are on Codex, on Codex's own default unless the skill names a model too.
  const forCodex = { ...both, agent: 'codex' as const }
  assert.deepEqual([agentInForce(state, forCodex), modelInForce(state, forCodex, 'codex'), modelInForce(state, { ...forCodex, model: 'gpt-5.5' }, 'codex')], ['codex', undefined, 'gpt-5.5'])
  // A person switched that row to Claude Code here: the skill's model was for Codex, so the scheduler's own.
  assert.equal(modelInForce({ ...state, runsOn: { 'update-tickets': 'claude-code' } }, { ...forCodex, model: 'gpt-5.5' }, 'claude-code'), 'opus')
  // A skill only in Codex's folder is made for Codex; an automation kept on this machine for Claude Code.
  assert.equal(agentInForce(state, { name: 'review', dirs: [CODEX] }), 'codex')
  assert.equal(agentInForce(state, { name: 'tidy', dirs: ['.scheduler/automations'], text: 'Tidy up.' }), 'claude-code')
  // This machine's picks win over what the skill says. The state is a file a person may edit: a word that names no agent, or an empty model, is no pick.
  const picked = { ...state, runsOn: { 'update-tickets': 'codex' as const }, models: { 'update-tickets': { agent: 'codex' as const, model: 'gpt-5.5' } } }
  assert.deepEqual([agentInForce(picked, cheap), modelInForce(picked, cheap, 'codex')], ['codex', 'gpt-5.5'])
  assert.equal(modelInForce({ ...state, models: { 'update-tickets': { agent: 'claude-code', model: 'sonnet' } } }, cheap, 'claude-code'), 'sonnet')
  // A model is one agent's: a pick made for Codex is none once the command runs on Claude Code, however that came about (the agent pick taken back by hand in the file, the skill reaching another folder).
  assert.equal(modelInForce({ ...state, models: picked.models }, cheap, 'claude-code'), 'haiku')
  assert.equal(modelInForce({ ...state, models: { 'update-tickets': { agent: 'claude-code', model: 'sonnet' } } }, cheap, 'codex'), undefined)
  // A skill's model with no agent named is Claude Code's, wherever the skill lives: a skill only in Codex's folder does not send it to Codex.
  assert.deepEqual([modelInForce(state, { name: 'review', model: 'haiku' }, 'codex'), modelInForce(state, { name: 'review', model: 'haiku' }, 'claude-code')], [undefined, 'haiku'])
  const odd = { ...state, runsOn: { 'update-tickets': 'cursor' }, models: { 'update-tickets': ' ' } } as unknown as State
  assert.deepEqual([agentInForce(odd, cheap), modelInForce(odd, cheap, 'claude-code')], ['claude-code', 'haiku'])
  const blank = { ...state, models: { 'update-tickets': { agent: 'claude-code', model: ' ' } } } as unknown as State
  assert.equal(modelInForce(blank, cheap, 'claude-code'), 'haiku')
})

test("a pick of a coding agent, and of a model, is kept only where a person made one; picking an agent, or taking the pick back, takes the command's model pick with it, since a model is one agent's", () => {
  const gpt = { agent: 'codex' as const, model: 'gpt-5.5' }
  const haiku = { agent: 'claude-code' as const, model: 'haiku' }
  const picked = withModel(withAgent(DEFAULT_STATE, 'update-tickets', 'codex'), 'update-tickets', gpt)
  assert.deepEqual(picked, { ...DEFAULT_STATE, runsOn: { 'update-tickets': 'codex' }, models: { 'update-tickets': gpt } })
  // Another agent: the model that was Codex's is no model of its own.
  assert.deepEqual(withAgent(picked, 'update-tickets', 'claude-code'), { ...DEFAULT_STATE, runsOn: { 'update-tickets': 'claude-code' } })
  // Taken back: no trace of either.
  assert.deepEqual(withAgent(picked, 'update-tickets', undefined), DEFAULT_STATE)
  assert.deepEqual(withModel(picked, 'update-tickets', undefined), { ...DEFAULT_STATE, runsOn: { 'update-tickets': 'codex' } })
  // Another command's picks stay.
  const two = withModel(withAgent(picked, 'triage', 'codex'), 'work-queue', haiku)
  assert.deepEqual(withAgent(two, 'update-tickets', undefined), { ...DEFAULT_STATE, runsOn: { triage: 'codex' }, models: { 'work-queue': haiku } })
  assert.deepEqual(withModel(two, 'work-queue', { agent: 'claude-code', model: 'sonnet' }).models, { 'update-tickets': gpt, 'work-queue': { agent: 'claude-code', model: 'sonnet' } })
})

test('nothing left of one command: its switch, publish pick, pace, number of agents, coding agent and model go, the others stay; a state that holds nothing of it is answered as it is', () => {
  const at = '2026-10-09T07:00:00.000Z'
  const state = { ...DEFAULT_STATE, switches: { tidy: at, 'work-queue': at }, publishes: { tidy: 'merge' as const }, paces: { tidy: { every: '5m', since: at }, 'work-queue': { work: true as const } }, agents: { tidy: 3 }, runsOn: { tidy: 'codex' as const }, models: { tidy: { agent: 'codex' as const, model: 'gpt-5.5' }, 'work-queue': { agent: 'claude-code' as const, model: 'haiku' } } }
  assert.deepEqual(withoutCommand(state, 'tidy'), { ...DEFAULT_STATE, switches: { 'work-queue': at }, paces: { 'work-queue': { work: true } }, models: { 'work-queue': { agent: 'claude-code', model: 'haiku' } } })
  assert.equal(withoutCommand(state, 'never-heard-of'), state)
  assert.equal(withoutCommand(DEFAULT_STATE, 'tidy'), DEFAULT_STATE)
})

test("a command removed since the last tick is taken off that tick's record, the schedule it read and what it decided, and nothing else of the state changes", () => {
  const at = '2026-10-09T07:00:00.000Z'
  const lastTick = { at, note: 'off', decisions: [{ command: 'tidy', outcome: 'not due' }, { command: 'work-queue', outcome: 'started r1', run: 'r1' }], schedule: [row('tidy', { every: '1d', onThisMachine: true as const, editable: true as const }), row('work-queue', { when: 'npx queue' })] }
  const state = { ...DEFAULT_STATE, switches: { tidy: at }, lastTick }
  assert.deepEqual(withoutListed(state, 'tidy'), { ...DEFAULT_STATE, switches: { tidy: at }, lastTick: { at, note: 'off', decisions: [{ command: 'work-queue', outcome: 'started r1', run: 'r1' }], schedule: [row('work-queue', { when: 'npx queue' })] } })
  // A line that says an automation of that name is not listed goes too: its file is gone.
  assert.deepEqual(withoutListed({ ...DEFAULT_STATE, lastTick: { at, decisions: [{ command: 'tidy', outcome: 'unlisted automation: it has no schedule' }], schedule: [] } }, 'tidy').lastTick, { at, decisions: [], schedule: [] })
  // Nothing of that name on the record, and no record: the state itself, so a caller can tell there is nothing to write.
  assert.equal(withoutListed(state, 'never-heard-of'), state)
  assert.equal(withoutListed(DEFAULT_STATE, 'tidy'), DEFAULT_STATE)
})

test("what an automation kept on this machine was given goes when it goes, and when a skill has its name too: the names given up, and the state with nothing left under a name, a skill's commands with a word included", () => {
  const at = '2026-10-09T07:00:00.000Z'
  const lastTick = { at, decisions: [], schedule: [row('answer-comments', { onThisMachine: true as const }), row('watch-competitor', { onThisMachine: true as const }), row('work-queue')] }
  const kept = { name: 'watch-competitor', text: 'Look.' }
  // Its file was removed, or renamed: the last tick listed it, this one does not.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept, { name: 'work-queue' }] }), ['answer-comments'])
  // Still kept here: nothing is given up. A skill that is gone gives nothing up either: its switch can be taken back by hand.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept, { name: 'answer-comments', text: 'Answer.' }] }), [])
  // The name went to a skill of the project: given up, so the skill starts off like any that arrives.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept, { name: 'answer-comments' }] }), ['answer-comments'])
  // Its file is still there, with a slip that keeps it off the list: its picks wait for the fix.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept], unreadable: [{ skill: 'answer-comments', own: true }] }), [])
  // A skill of that name whose schedule cannot be read is no such file.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept], unreadable: [{ skill: 'answer-comments' }] }), ['answer-comments'])
  // A name a skill and an automation kept here both have, each named once.
  assert.deepEqual(namesGivenUp(lastTick, { commands: [kept], clashes: ['answer-comments', 'triage'] }), ['answer-comments', 'triage'])
  assert.deepEqual(namesGivenUp(undefined, { commands: [kept] }), [])

  const state = { ...DEFAULT_STATE, switches: { triage: at, 'triage quick': at, 'triage-all': at }, publishes: { 'triage quick': 'merge' as const }, paces: { 'triage consensual': { work: true as const } }, agents: { triage: 3, 'work-queue': 2 }, runsOn: { 'triage quick': 'codex' as const, 'triage-all': 'codex' as const }, models: { 'triage consensual': { agent: 'codex' as const, model: 'haiku' } } }
  assert.deepEqual(withoutName(state, 'triage'), { ...DEFAULT_STATE, switches: { 'triage-all': at }, agents: { 'work-queue': 2 }, runsOn: { 'triage-all': 'codex' } })
  assert.equal(withoutName(state, 'never-heard-of'), state)
})
