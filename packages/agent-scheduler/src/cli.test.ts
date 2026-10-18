import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordRun } from '@openagt/agent-runner'
import { runCli } from './cli.js'
import { DEFAULT_STATE, readState, statePath, writeState } from './state.js'
import { removeRepo, testRepo, writeSkill } from './test-repo.js'

// The contract on top of the functions: JSON on stdout, a line for a person on stderr, and an
// exit code that says refusal or failure. The commands that spawn or talk to Claude are covered
// by their modules; here the file-only ones run for real. `run` and `check` are agent-runner's.

interface Ran {
  code: number
  out: unknown
  err: string
}

/** An answer that names an automation's version, with the version checked and taken off: it has a test of its own. */
function unversioned(out: unknown): unknown {
  const { version, ...rest } = out as { version?: unknown }
  assert.equal(typeof version === 'string' && version !== '', true, 'it names a version')
  return rest
}

async function run(cwd: string, ...argv: string[]): Promise<Ran> {
  const outLines: string[] = []
  const errLines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => outLines.push(line), stderr: line => errLines.push(line) })
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n') }
}

test('status reads the state; model and offset write it; stop turns it off; every answer is one JSON object', async () => {
  const repo = await testRepo()
  try {
    const fresh = await run(repo, 'status')
    assert.equal(fresh.code, 0)
    assert.deepEqual(fresh.out, { ok: true, on: false, keepAlive: false, model: 'opus', spendOffset: 100 / 14, running: false, schedule: [], unreadable: [] })

    const model = await run(repo, 'model', 'sonnet')
    assert.equal(model.code, 0)
    assert.equal((model.out as { model: string }).model, 'sonnet')
    const offset = await run(repo, 'offset', '50')
    assert.equal((offset.out as { spendOffset: number }).spendOffset, 50)
    assert.equal((await readState(repo)).model, 'sonnet')
    assert.match(await readFile(statePath(repo), 'utf8'), /"spendOffset": 50/)

    const stopped = await run(repo, 'stop')
    assert.equal(stopped.code, 0)
    assert.equal((stopped.out as { on: boolean }).on, false)

    // From inside a checkout the same command still acts on the project.
    const nested = await run(join(repo, '.claude'), 'status')
    assert.equal((nested.out as { model: string }).model, 'sonnet')
  } finally {
    await removeRepo(repo)
  }
})

test('usage errors exit 2 with the usage on stderr and nothing on stdout; outside a repository is a refusal', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'not-a-repo-'))
  try {
    for (const argv of [[], ['nope'], ['model'], ['offset', 'many'], ['status', 'extra'], ['init', 'extra'], ['run', 'Read the docs'], ['check'], ['now'], ['now', 'work-queue', 'twice'], ['model', 'work-queue', 'haiku', 'extra'], ['agent'], ['agent', 'work-queue'], ['agent', 'work-queue', 'cursor'], ['agent', 'work-queue', 'codex', 'extra'], ['switch', 'work-queue'], ['switch', 'work-queue', 'maybe'], ['publish', 'work-queue'], ['publish', 'work-queue', 'push'], ['publish', 'work-queue', 'file']]) {
      const bad = await run(repo, ...argv)
      assert.equal(bad.code, 2, argv.join(' '))
      assert.equal(bad.out, undefined)
      assert.match(bad.err, /usage: agent-scheduler/)
    }
    const outside = await run(elsewhere, 'status')
    assert.equal(outside.code, 1)
    assert.deepEqual(outside.out, { ok: false, reason: 'not-a-repo' })
    assert.equal(outside.err, 'not inside a git repository')
  } finally {
    await removeRepo(repo)
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('stop --unless-keep-alive leaves a keep-alive scheduler running, and stops any other', async () => {
  const repo = await testRepo()
  try {
    // This test's own process stands in for the scheduler's: a stop that signalled it would end the test.
    await writeState(repo, { ...DEFAULT_STATE, on: true, keepAlive: true, pid: process.pid, startedAt: '2026-01-01T00:00:00.000Z' })
    const kept = await run(repo, 'stop', '--unless-keep-alive')
    assert.equal(kept.code, 0)
    assert.equal(kept.err, 'keep-alive is on, the scheduler keeps running')
    const out = kept.out as { ok: boolean; on: boolean; kept: boolean; pid?: number }
    assert.equal(out.kept, true)
    assert.equal(out.on, true)
    assert.equal(out.pid, process.pid)
    const after = await readState(repo)
    assert.equal(after.on, true)
    assert.equal(after.pid, process.pid, 'the state is untouched')

    // Without keep-alive the flag changes nothing: off, no pid (the pid here is a dead one, so nothing is signalled).
    await writeState(repo, { ...DEFAULT_STATE, on: true, keepAlive: false, pid: 2 ** 31 - 1 })
    const stopped = await run(repo, 'stop', '--unless-keep-alive')
    assert.equal(stopped.code, 0)
    assert.equal(stopped.err, '')
    assert.deepEqual(stopped.out, { ok: true, on: false, keepAlive: false, model: 'opus', spendOffset: 100 / 14, kept: false })

    // A plain stop stops a keep-alive scheduler too: it is how a person turns the thing off.
    await writeState(repo, { ...DEFAULT_STATE, on: true, keepAlive: true, pid: 2 ** 31 - 1 })
    const plain = await run(repo, 'stop')
    assert.equal((plain.out as { on: boolean; kept: boolean }).on, false)
    assert.equal((plain.out as { kept: boolean }).kept, false)
  } finally {
    await removeRepo(repo)
  }
})

test('switch writes this machine\'s switch for a scheduled command: only a command switched on is kept; switching on a command no skill schedules is refused, with why when its skill\'s schedule cannot be read; off is taken for any name', async () => {
  const repo = await testRepo()
  try {
    // The project's one skill schedules nothing.
    const none = await run(repo, 'switch', 'work-queue', 'on')
    assert.equal(none.code, 1)
    assert.deepEqual(none.out, { ok: false, reason: 'not-scheduled', command: 'work-queue' })
    assert.equal(none.err, 'no skill of this project schedules work-queue')

    await writeSkill(repo, 'work-queue', 'schedule:\n  when: npx queue\n')
    await writeSkill(repo, 'triage', 'schedule:\n  - word: quick\n    every: 6h\n  - word: consensual\n    every: 7d\n')
    const on = await run(repo, 'switch', 'triage quick', 'on')
    assert.equal(on.code, 0)
    // The switch holds when it was switched on: a check of a command that never started asks what is new since then.
    const before = Date.now()
    const switched = (on.out as { switches: Record<string, string> }).switches
    assert.deepEqual(Object.keys(switched), ['triage quick'])
    const at = Date.parse(switched['triage quick']!)
    assert.ok(at <= before && at > before - 60_000, `switched on just now, not at ${switched['triage quick']}`)
    await run(repo, 'switch', 'work-queue', 'on')
    // Switching off a command nobody switched on changes nothing, and switching on one that is on keeps its time.
    await run(repo, 'switch', 'triage consensual', 'off')
    await run(repo, 'switch', 'triage quick', 'on')
    const both = (await readState(repo)).switches!
    assert.deepEqual(Object.keys(both), ['triage quick', 'work-queue'])
    assert.equal(both['triage quick'], switched['triage quick'])
    // Everything off again: nothing kept.
    await run(repo, 'switch', 'triage quick', 'off')
    await run(repo, 'switch', 'work-queue', 'off')
    assert.equal((await readState(repo)).switches, undefined)

    // The skill alone is no command when its rows carry a word.
    const unknown = await run(repo, 'switch', 'triage', 'on')
    assert.equal(unknown.code, 1)
    assert.deepEqual(unknown.out, { ok: false, reason: 'not-scheduled', command: 'triage' })
    assert.equal(unknown.err, 'no skill of this project schedules triage')

    // A skill whose schedule cannot be read: the refusal says why, not that nothing schedules it.
    await run(repo, 'switch', 'triage quick', 'on')
    await writeSkill(repo, 'triage', 'schedule:\n  word: quick\n  evry: 6h\n')
    const typo = await run(repo, 'switch', 'triage quick', 'on')
    assert.equal(typo.code, 1)
    assert.deepEqual(typo.out, { ok: false, reason: 'unreadable-schedule', skill: 'triage', detail: 'unknown key evry' })
    assert.equal(typo.err, 'the schedule of triage cannot be read: unknown key evry')
    assert.equal((await run(repo, 'publish', 'triage quick', 'pr')).err, 'the schedule of triage cannot be read: unknown key evry')
    // A switch left on can always be taken back, whatever became of the skill.
    assert.deepEqual(Object.keys((await readState(repo)).switches ?? {}), ['triage quick'])
    const off = await run(repo, 'switch', 'triage quick', 'off')
    assert.equal(off.code, 0)
    assert.equal((await readState(repo)).switches, undefined)
    assert.equal((await run(repo, 'switch', 'never-heard-of', 'off')).code, 0)
  } finally {
    await removeRepo(repo)
  }
})

test('publish writes this machine\'s publish pick for a scheduled command; a command no skill schedules is refused', async () => {
  const repo = await testRepo()
  try {
    const none = await run(repo, 'publish', 'work-queue', 'pr')
    assert.equal(none.code, 1)
    assert.deepEqual(none.out, { ok: false, reason: 'not-scheduled', command: 'work-queue' })

    await writeSkill(repo, 'work-queue', 'schedule:\n  when: npx queue\n')
    await writeSkill(repo, 'triage', 'schedule:\n  word: quick\n  every: 6h\n')
    const nothing = await run(repo, 'publish', 'work-queue', 'nothing')
    assert.equal(nothing.code, 0)
    assert.deepEqual((nothing.out as { publishes: unknown }).publishes, { 'work-queue': 'nothing' })
    await run(repo, 'publish', 'triage quick', 'pr')
    assert.deepEqual((await readState(repo)).publishes, { 'work-queue': 'nothing', 'triage quick': 'pr' })
    // A pick of what nobody picking gives, commit, is kept all the same.
    await run(repo, 'publish', 'work-queue', 'commit')
    assert.deepEqual((await readState(repo)).publishes, { 'work-queue': 'commit', 'triage quick': 'pr' })

    const unknown = await run(repo, 'publish', 'triage-quick', 'pr')
    assert.equal(unknown.code, 1)
    assert.deepEqual(unknown.out, { ok: false, reason: 'not-scheduled', command: 'triage-quick' })
    assert.equal(unknown.err, 'no skill of this project schedules triage-quick')
  } finally {
    await removeRepo(repo)
  }
})

test("pace writes this machine's pace for a scheduled command: an interval, a time of day with days or more, whenever there is work, and `skill` takes it back", async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'work-queue', 'schedule:\n  when: npx queue\n')
    await writeSkill(repo, 'triage', 'schedule:\n  word: quick\n  every: 6h\n')
    const slower = await run(repo, 'pace', 'triage quick', '2d')
    assert.equal(slower.code, 0)
    const picked = (slower.out as { paces: Record<string, { every: string; at?: string; since: string }> }).paces['triage quick']!
    assert.equal(picked.every, '2d')
    assert.equal('at' in picked, false)
    assert.equal(new Date(picked.since).toISOString(), picked.since, 'when it was picked is recorded')
    await run(repo, 'pace', 'triage quick', '2w', '9:05')
    const timed = (await readState(repo)).paces!['triage quick'] as { every: string; at: string; since: string }
    assert.deepEqual({ ...timed, since: '' }, { every: '2w', at: '09:05', since: '' })
    // The same pace picked again keeps when it was first made, so a time that was missed is still due; another one is a new pick.
    await new Promise(resolve => setTimeout(resolve, 5))
    await run(repo, 'pace', 'triage quick', '2w', '09:05')
    assert.equal(((await readState(repo)).paces!['triage quick'] as { since: string }).since, timed.since)
    await run(repo, 'pace', 'triage quick', '2w', '10:00')
    assert.notEqual(((await readState(repo)).paces!['triage quick'] as { since: string }).since, timed.since)
    await run(repo, 'pace', 'work-queue', 'work')
    assert.deepEqual((await readState(repo)).paces!['work-queue'], { work: true })
    // The skill's own pace again: nothing kept.
    await run(repo, 'pace', 'triage quick', 'skill')
    await run(repo, 'pace', 'work-queue', 'skill')
    assert.equal((await readState(repo)).paces, undefined)

    // A state edited by hand: a pace that is no pick at all is simply replaced.
    await writeState(repo, { ...(await readState(repo)), paces: { 'triage quick': null as never, 'work-queue': 'daily' as never } })
    assert.equal((await run(repo, 'pace', 'triage quick', '2d')).code, 0)
    assert.equal((await run(repo, 'pace', 'work-queue', '1h')).code, 0)
    await run(repo, 'pace', 'triage quick', 'skill')
    await run(repo, 'pace', 'work-queue', 'skill')

    // Switching a command on counts its time of day from then, so a row ticked after its time waits for the next one.
    await run(repo, 'pace', 'triage quick', '1d', '10:00')
    const pickedAt = ((await readState(repo)).paces!['triage quick'] as { since: string }).since
    await new Promise(resolve => setTimeout(resolve, 5))
    await run(repo, 'switch', 'triage quick', 'on')
    const switched = (await readState(repo)).paces!['triage quick'] as { every: string; at: string; since: string }
    assert.deepEqual({ ...switched, since: '' }, { every: '1d', at: '10:00', since: '' })
    assert.ok(switched.since > pickedAt, 'counted from the switch')
    // Switched on again while already on: nothing moves, so a missed time is not put off.
    await new Promise(resolve => setTimeout(resolve, 5))
    await run(repo, 'switch', 'triage quick', 'on')
    assert.equal(((await readState(repo)).paces!['triage quick'] as { since: string }).since, switched.since)
    await run(repo, 'switch', 'triage quick', 'off')
    assert.equal(((await readState(repo)).paces!['triage quick'] as { since: string }).since, switched.since, 'off changes nothing of the pace')
    await run(repo, 'pace', 'triage quick', 'skill')
    // A command with no time of day is switched on with nothing else written.
    await run(repo, 'switch', 'work-queue', 'on')
    assert.equal((await readState(repo)).paces, undefined)
    await run(repo, 'switch', 'work-queue', 'off')

    // "Whenever there is work" needs a check to ask.
    const noCheck = await run(repo, 'pace', 'triage quick', 'work')
    assert.equal(noCheck.code, 1)
    assert.deepEqual(noCheck.out, { ok: false, reason: 'no-check', command: 'triage quick' })
    assert.equal(noCheck.err, 'triage quick has no check, so nothing would say when there is work')
    const unknown = await run(repo, 'pace', 'triage', '1h')
    assert.equal(unknown.code, 1)
    assert.deepEqual(unknown.out, { ok: false, reason: 'not-scheduled', command: 'triage' })
    assert.equal((await readState(repo)).paces, undefined, 'a refusal writes nothing')
    // A pace left for a skill that is gone, or cannot be read any more, can always be taken back.
    await run(repo, 'pace', 'triage quick', '2d')
    await writeSkill(repo, 'triage', 'schedule:\n  word: quick\n  evry: 6h\n')
    assert.equal((await run(repo, 'pace', 'triage quick', '3d')).err, 'the schedule of triage cannot be read: unknown key evry')
    assert.equal((await run(repo, 'pace', 'triage quick', 'skill')).code, 0)
    assert.equal((await readState(repo)).paces, undefined)
    assert.equal((await run(repo, 'pace', 'never-heard-of', 'skill')).code, 0)

    for (const argv of [['pace', 'work-queue'], ['pace', 'work-queue', 'often'], ['pace', 'work-queue', '0h'], ['pace', 'work-queue', '10000d'], ['pace', 'work-queue', '2d', '25:00'], ['pace', 'work-queue', '6h', '10:00'], ['pace', 'work-queue', 'work', '10:00'], ['pace', 'work-queue', '2d', '10:00', 'extra']]) {
      const bad = await run(repo, ...argv)
      assert.equal(bad.code, 2, argv.join(' '))
      assert.equal(bad.out, undefined)
    }
    assert.match((await run(repo, 'pace', 'work-queue', '6h', '10:00')).err, /^a time of day goes with days, weeks or months/)
  } finally {
    await removeRepo(repo)
  }
})

test("agents writes this machine's number of agents at once for a scheduled command, and `skill` takes it back, for any name", async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'work-queue', 'schedule:\n  when: npx queue\n')
    const three = await run(repo, 'agents', 'work-queue', '3')
    assert.equal(three.code, 0)
    assert.deepEqual((three.out as { agents: unknown }).agents, { 'work-queue': 3 })
    await run(repo, 'agents', 'work-queue', '1')
    assert.deepEqual((await readState(repo)).agents, { 'work-queue': 1 }, 'one is a pick too, kept')
    await run(repo, 'agents', 'work-queue', '099')
    assert.deepEqual((await readState(repo)).agents, { 'work-queue': 99 }, 'the top, a leading zero dropped')
    await run(repo, 'agents', 'work-queue', 'skill')
    assert.equal((await readState(repo)).agents, undefined)

    const unknown = await run(repo, 'agents', 'triage', '2')
    assert.equal(unknown.code, 1)
    assert.deepEqual(unknown.out, { ok: false, reason: 'not-scheduled', command: 'triage' })
    // A number left for a skill that is gone can always be taken back.
    assert.equal((await run(repo, 'agents', 'never-heard-of', 'skill')).code, 0)
    // A skill whose schedule cannot be read: the refusal says why.
    await writeSkill(repo, 'triage', 'schedule:\n  evry: 6h\n')
    const typo = await run(repo, 'agents', 'triage', '2')
    assert.equal(typo.code, 1)
    assert.equal(typo.err, 'the schedule of triage cannot be read: unknown key evry')

    for (const argv of [['agents', 'work-queue'], ['agents', 'work-queue', '0'], ['agents', 'work-queue', '1.5'], ['agents', 'work-queue', '-2'], ['agents', 'work-queue', 'many'], ['agents', 'work-queue', '100'], ['agents', 'work-queue', '2', 'extra']]) {
      const bad = await run(repo, ...argv)
      assert.equal(bad.code, 2, argv.join(' '))
      assert.equal(bad.out, undefined)
    }
    assert.match((await run(repo, 'agents', 'work-queue', 'many')).err, /^many is neither skill nor a whole number from 1 to 99/)
    assert.equal((await readState(repo)).agents, undefined, 'a usage error writes nothing')
  } finally {
    await removeRepo(repo)
  }
})

test("model writes the scheduler's own model with one word, and with a command and a word the model this machine's runs of that command start on; agent writes the coding agent they are on, refused for one whose skills folder does not hold the command's skill, and takes the command's model pick back; `skill` takes either back, for any name", async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'update-tickets', 'schedule:\n  every: 15m\n  model: haiku\n')
    // In both agents' folders, the way a project shares one copy: either can run it.
    await writeSkill(repo, 'review', 'schedule:\n  every: 1d\n')
    await mkdir(join(repo, '.agents', 'skills'), { recursive: true })
    await symlink(join('..', '..', '.claude', 'skills', 'review'), join(repo, '.agents', 'skills', 'review'))
    type Rows = { schedule: Record<string, unknown>[] }
    const listed = async (): Promise<unknown[]> => ((await run(repo, 'status')).out as Rows).schedule.map(c => [c['command'], c['agent'], c['model'], c['able']])
    // What the skills say: the agent each is made for, its model when it names one, and who can run it.
    assert.deepEqual(await listed(), [['review', 'claude-code', undefined, ['claude-code', 'codex']], ['update-tickets', 'claude-code', 'haiku', ['claude-code']]])

    // One word: the scheduler's own model, as before. A command and a word: that command's, on this machine.
    assert.equal(((await run(repo, 'model', 'sonnet')).out as { model: string }).model, 'sonnet')
    const cheap = await run(repo, 'model', 'review', 'haiku')
    assert.deepEqual([cheap.code, (cheap.out as { models: unknown; model: string }).models, (cheap.out as { model: string }).model], [0, { review: { agent: 'claude-code', model: 'haiku' } }, 'sonnet'])
    await run(repo, 'model', 'update-tickets', 'opus')
    assert.deepEqual((await readState(repo)).models, { review: { agent: 'claude-code', model: 'haiku' }, 'update-tickets': { agent: 'claude-code', model: 'opus' } })
    await run(repo, 'model', 'update-tickets', 'skill')
    assert.deepEqual((await readState(repo)).models, { review: { agent: 'claude-code', model: 'haiku' } })
    // The id forgotten: a command's name, or `skill`, is no model for every row. Refused as a usage error, and the scheduler's model stays.
    for (const word of ['review', 'update-tickets', 'skill']) assert.equal((await run(repo, 'model', word)).code, 2, word)
    assert.equal((await readState(repo)).model, 'sonnet')
    assert.equal((await run(repo, 'model', 'review', ' ')).code, 2)
    // What the skills say is listed as before: this machine's picks are the state's.
    assert.deepEqual(await listed(), [['review', 'claude-code', undefined, ['claude-code', 'codex']], ['update-tickets', 'claude-code', 'haiku', ['claude-code']]])

    // An agent picked: the model picked for the command goes with it, since a model is one agent's.
    const codex = await run(repo, 'agent', 'review', 'codex')
    assert.deepEqual([codex.code, (codex.out as { runsOn: unknown }).runsOn, (codex.out as { models?: unknown }).models], [0, { review: 'codex' }, undefined])
    await run(repo, 'model', 'review', 'gpt-5.5')
    assert.deepEqual([(await readState(repo)).runsOn, (await readState(repo)).models], [{ review: 'codex' }, { review: { agent: 'codex', model: 'gpt-5.5' } }])
    // The agent the command is made for is no pick to keep: the command follows its skill again, and Codex's model goes.
    await run(repo, 'agent', 'review', 'claude-code')
    assert.deepEqual([(await readState(repo)).runsOn, (await readState(repo)).models], [undefined, undefined])
    await run(repo, 'model', 'review', 'haiku')
    await run(repo, 'agent', 'review', 'skill')
    assert.deepEqual([(await readState(repo)).runsOn, (await readState(repo)).models], [undefined, undefined], 'taken back: no trace of either')

    // An agent whose own skills folder does not hold the command's skill cannot run it: refused, in a sentence, and nothing is written.
    const elsewhere = await run(repo, 'agent', 'update-tickets', 'codex')
    assert.deepEqual([elsewhere.code, elsewhere.out, elsewhere.err], [1, { ok: false, reason: 'no-skill-there', command: 'update-tickets', agent: 'codex' }, "Codex reads a project's skills from .agents/skills, and the skill of update-tickets is only under .claude/skills"])
    await mkdir(join(repo, '.agents', 'skills', 'codex-only'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'codex-only', 'SKILL.md'), '---\nname: codex-only\nschedule:\n  every: 1d\n---\nDo the job.\n')
    assert.equal((await run(repo, 'agent', 'codex-only', 'claude-code')).err, "Claude Code reads a project's skills from .claude/skills, and the skill of codex-only is only under .agents/skills")
    // Codex is the agent it is made for: taken, and nothing is kept, since it follows its skill.
    assert.equal((await run(repo, 'agent', 'codex-only', 'codex')).code, 0)
    assert.equal((await readState(repo)).runsOn, undefined)
    // A model picked for it is kept with the agent it runs on here.
    assert.equal((await run(repo, 'model', 'codex-only', 'gpt-5.5')).code, 0)
    assert.deepEqual((await readState(repo)).models, { 'codex-only': { agent: 'codex', model: 'gpt-5.5' } })
    assert.equal((await run(repo, 'agent', 'review', 'codex')).code, 0)
    // An automation kept on this machine is no skill: any agent can run it.
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy up.', '--every', '1d', '--private')).code, 0)
    assert.equal((await run(repo, 'agent', 'tidy', 'codex')).code, 0)
    assert.equal((await run(repo, 'model', 'tidy', 'gpt-5.5')).code, 0)

    // A command no skill schedules is refused; a pick left for a skill that is gone can always be taken back.
    assert.deepEqual((await run(repo, 'model', 'triage', 'haiku')).out, { ok: false, reason: 'not-scheduled', command: 'triage' })
    assert.deepEqual((await run(repo, 'agent', 'triage', 'codex')).out, { ok: false, reason: 'not-scheduled', command: 'triage' })
    assert.deepEqual([(await run(repo, 'model', 'never-heard-of', 'skill')).code, (await run(repo, 'agent', 'never-heard-of', 'skill')).code], [0, 0])
    const before = await readState(repo)
    assert.match((await run(repo, 'agent', 'review', 'cursor')).err, /^cursor is none of skill, claude-code, codex/)
    assert.deepEqual(await readState(repo), before, 'a usage error writes nothing')

    // Removed, or saved anew under its name: its coding agent and its model go like its other picks.
    assert.equal((await run(repo, 'remove', 'tidy')).code, 0)
    const after = await readState(repo)
    assert.deepEqual([after.runsOn, after.models], [{ review: 'codex' }, { 'codex-only': { agent: 'codex', model: 'gpt-5.5' } }])
    await writeState(repo, { ...after, runsOn: { ...after.runsOn, 'new-one': 'codex' }, models: { ...after.models, 'new-one': { agent: 'codex', model: 'gpt-5.5' } } })
    assert.equal((await run(repo, 'add', 'new-one', '--prompt', 'Do the new thing.', '--every', '1d', '--private')).code, 0)
    const anew = await readState(repo)
    assert.deepEqual([anew.runsOn, anew.models], [{ review: 'codex' }, { 'codex-only': { agent: 'codex', model: 'gpt-5.5' } }], 'a name saved anew starts with nothing a command of that name left behind')
  } finally {
    await removeRepo(repo)
  }
})

test("add saves a person's own automation as a command skill of the project, which its switch then takes; what cannot be saved is refused with why, and a text that opens with a dash is the flag's own", async () => {
  const repo = await testRepo()
  try {
    const added = await run(repo, 'add', 'answer-comments', '--prompt=- Answer each new comment below.', '--every', '15m', '--when=gh api comments --jq .', '--waits-for', 'when someone commented')
    assert.deepEqual([added.code, added.out, added.err], [0, { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', startsFrom: 'origin/main' }, ''])
    const text = await readFile(join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md'), 'utf8')
    assert.equal(text, '---\nname: answer-comments\ndescription: "- Answer each new comment below."\ndisable-model-invocation: true\nschedule:\n  every: 15m\n  waits-for: "when someone commented"\n  when: |-\n    gh api comments --jq .\n---\n\n- Answer each new comment below.\n')
    // A row like any other: its switch is this machine's.
    assert.equal((await run(repo, 'switch', 'answer-comments', 'on')).code, 0)
    assert.deepEqual(Object.keys((await readState(repo)).switches ?? {}), ['answer-comments'])

    // Saved anew under a name a command had before: what that one left on this machine does not decide for the new one.
    await run(repo, 'publish', 'answer-comments', 'merge')
    await run(repo, 'pace', 'answer-comments', '5m')
    await run(repo, 'agents', 'answer-comments', '3')
    await run(repo, 'switch', 'work-queue-like', 'off')
    await rm(join(repo, '.claude', 'skills', 'answer-comments'), { recursive: true })
    const anew = await run(repo, 'add', 'answer-comments', '--prompt', 'Delete nothing.', '--every', '1d')
    assert.equal(anew.code, 0)
    const state = await readState(repo)
    assert.deepEqual([state.switches, state.publishes, state.paces, state.agents], [undefined, undefined, undefined, undefined], 'it starts switched off, at its own pace, like any new row')

    // A name nothing was left for: the state file is not written, so a save of the page's own in flight loses nothing.
    const stateBefore = await readFile(statePath(repo), 'utf8')
    assert.equal((await run(repo, 'add', 'brand-new', '--prompt', 'p', '--every', '1d')).code, 0)
    assert.equal(await readFile(statePath(repo), 'utf8'), stateBefore)

    const again = await run(repo, 'add', 'answer-comments', '--prompt', 'Other words.', '--every', '1d')
    assert.deepEqual([again.code, again.out, again.err], [1, { ok: false, reason: 'taken', folder: '.claude/skills/answer-comments' }, 'that name is taken: .claude/skills/answer-comments'])
    const unnamed = await run(repo, 'add', 'Answer Comments', '--prompt', 'p', '--every', '1d')
    assert.deepEqual([unnamed.code, unnamed.err], [1, 'a name is lower-case letters, digits and single or double dashes, and starts with a letter or a digit'])
    const silent = await run(repo, 'add', 'x', '--prompt', '  ', '--every', '1d')
    assert.deepEqual([silent.code, silent.out, silent.err], [1, { ok: false, reason: 'no-prompt' }, 'the prompt is empty'])
    const never = await run(repo, 'add', 'x', '--prompt', 'p')
    assert.deepEqual([never.code, never.out, never.err], [1, { ok: false, reason: 'bad-schedule', detail: 'neither every nor when says when' }, 'it cannot run as written: neither every nor when says when'])
    const promptless = await run(repo, 'add', 'x', '--every', '1d')
    assert.equal(promptless.code, 2)
    assert.match(promptless.err, /^add needs --prompt, what the agent is told/)
    assert.equal((await run(repo, 'add', '--prompt', 'p', '--every', '1d')).code, 2, 'no name')
  } finally {
    await removeRepo(repo)
  }
})

test('add --private keeps the automation on this machine alone: one file in the tool\'s own folder, nothing in git, a row its switch takes like any other', async () => {
  const repo = await testRepo()
  try {
    const added = await run(repo, 'add', 'watch-competitor', '--prompt', 'Look for new threads.', '--every', '1h', '--private')
    assert.deepEqual([added.code, added.out, added.err], [0, { ok: true, command: 'watch-competitor', file: '.agent-scheduler/automations/watch-competitor.md', startsFrom: 'origin/main', onThisMachine: true }, ''])
    assert.equal((await run(repo, 'switch', 'watch-competitor', 'on')).code, 0)
    assert.equal((await run(repo, 'pace', 'watch-competitor', '2h')).code, 0)
    const again = await run(repo, 'add', 'watch-competitor', '--prompt', 'Other.', '--every', '1d')
    assert.deepEqual([again.code, again.err], [1, 'that name is taken: .agent-scheduler/automations/watch-competitor.md'])
  } finally {
    await removeRepo(repo)
  }
})

test("an automation kept on this machine that is not listed is refused in its own words; a tick takes back what it was given once its file is gone, so a skill that takes the name starts off", async () => {
  const repo = await testRepo()
  try {
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy up.', '--every', '1d', '--private')).code, 0)
    assert.equal((await run(repo, 'switch', 'tidy', 'on')).code, 0)
    assert.equal((await run(repo, 'publish', 'tidy', 'merge')).code, 0)
    assert.equal((await run(repo, 'agents', 'tidy', '5')).code, 0)
    assert.equal((await run(repo, 'tick')).code, 0)
    assert.deepEqual(((await readState(repo)).lastTick?.schedule ?? []).map(c => [c.command, c.onThisMachine]), [['tidy', true]])
    assert.deepEqual(Object.keys((await readState(repo)).switches ?? {}), ['tidy'], 'a tick leaves the picks of an automation that is there')
    // A skill of the project gets the name: neither is listed, and the command line says so of the automation.
    await writeSkill(repo, 'tidy', 'schedule:\n  every: 1h\n')
    const refused = await run(repo, 'switch', 'tidy', 'on')
    assert.equal(refused.code, 1)
    assert.deepEqual(refused.out, { ok: false, reason: 'unlisted-automation', automation: 'tidy', detail: 'a skill of the project has this name too, so neither is listed: rename or remove .agent-scheduler/automations/tidy.md, then switch on what you want' })
    assert.equal(refused.err, 'the automation tidy, kept on this machine, is not listed: a skill of the project has this name too, so neither is listed: rename or remove .agent-scheduler/automations/tidy.md, then switch on what you want')
    assert.equal((await run(repo, 'tick')).code, 0)
    const cleared = await readState(repo)
    assert.deepEqual([cleared.switches, cleared.publishes, cleared.agents], [undefined, undefined, undefined], 'what the automation was given is taken back')
    // The person removes their file: the skill's command is listed, and it is off, like any skill that arrives.
    await rm(join(repo, '.agent-scheduler', 'automations', 'tidy.md'))
    assert.equal((await run(repo, 'tick')).code, 0)
    const after = await readState(repo)
    assert.deepEqual((after.lastTick?.schedule ?? []).map(c => [c.command, c.onThisMachine]), [['tidy', undefined]])
    assert.equal(after.switches, undefined)

    // Removed with no skill of that name around: the switch does not wait for whatever takes the name next.
    assert.equal((await run(repo, 'add', 'notes', '--prompt', 'Write notes.', '--every', '1d', '--private')).code, 0)
    assert.equal((await run(repo, 'switch', 'notes', 'on')).code, 0)
    assert.equal((await run(repo, 'tick')).code, 0)
    await rm(join(repo, '.agent-scheduler', 'automations', 'notes.md'))
    assert.equal((await run(repo, 'tick')).code, 0)
    assert.equal((await readState(repo)).switches, undefined)
    // A prompt too long for a run to be handed is refused in a sentence.
    const long = await run(repo, 'add', 'endless', `--prompt=${'x'.repeat(32_001)}`, '--every', '1d', '--private')
    assert.deepEqual([long.code, long.err], [1, 'the prompt is 32001 characters, and one kept on this machine has 32000 at most'])
  } finally {
    await removeRepo(repo)
  }
})

test("show answers an automation as it stands; edit saves it again under its name and leaves what this machine holds for it; remove deletes it, takes that back, and takes it off the last tick's record; a skill of the project is refused by all three", async () => {
  const repo = await testRepo()
  try {
    assert.equal((await run(repo, 'add', 'answer-comments', '--prompt', 'Answer each new comment below.', '--every', '15m', '--when=gh api comments --jq .', '--waits-for', 'when someone commented')).code, 0)
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy up.', '--every', '1d', '--private')).code, 0)
    const shown = await run(repo, 'show', 'answer-comments')
    assert.deepEqual([shown.code, unversioned(shown.out), shown.err], [0, { ok: true, name: 'answer-comments', prompt: 'Answer each new comment below.', every: '15m', when: 'gh api comments --jq .', waitsFor: 'when someone commented', file: '.claude/skills/answer-comments/SKILL.md' }, ''])
    assert.deepEqual(unversioned((await run(repo, 'show', 'tidy')).out), { ok: true, name: 'tidy', prompt: 'Tidy up.', every: '1d', file: '.agent-scheduler/automations/tidy.md', onThisMachine: true })

    for (const name of ['answer-comments', 'tidy']) {
      assert.equal((await run(repo, 'switch', name, 'on')).code, 0)
      assert.equal((await run(repo, 'pace', name, '2h')).code, 0)
      assert.equal((await run(repo, 'agents', name, '3')).code, 0)
      assert.equal((await run(repo, 'publish', name, 'branch')).code, 0)
    }
    assert.equal((await run(repo, 'tick')).code, 0)
    const before = await readState(repo)
    assert.deepEqual((before.lastTick?.schedule ?? []).map(c => [c.command, c.editable]), [['answer-comments', true], ['tidy', true]])

    // Saved again: a text that opens with a dash is the flag's own; the flags left out leave their parts as the file says them, and the state is as it was.
    const edited = await run(repo, 'edit', 'answer-comments', '--prompt=- Answer in one line.', '--every', '1h')
    assert.deepEqual([edited.code, unversioned(edited.out), edited.err], [0, { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', startsFrom: 'origin/main' }, ''])
    assert.deepEqual(unversioned((await run(repo, 'show', 'answer-comments')).out), { ok: true, name: 'answer-comments', prompt: '- Answer in one line.', every: '1h', when: 'gh api comments --jq .', waitsFor: 'when someone commented', file: '.claude/skills/answer-comments/SKILL.md' })
    // A schedule flag given empty takes its part out: the check, and what it waited for with it.
    assert.equal((await run(repo, 'edit', 'answer-comments', '--when=')).code, 0)
    assert.deepEqual(unversioned((await run(repo, 'show', 'answer-comments')).out), { ok: true, name: 'answer-comments', prompt: '- Answer in one line.', every: '1h', file: '.claude/skills/answer-comments/SKILL.md' })
    assert.deepEqual(unversioned((await run(repo, 'edit', 'tidy', '--prompt', 'Tidy up, gently.', '--when', 'true', '--every=')).out), { ok: true, command: 'tidy', file: '.agent-scheduler/automations/tidy.md', startsFrom: 'origin/main', onThisMachine: true })
    assert.deepEqual(unversioned((await run(repo, 'show', 'tidy')).out), { ok: true, name: 'tidy', prompt: 'Tidy up, gently.', when: 'true', file: '.agent-scheduler/automations/tidy.md', onThisMachine: true })
    assert.deepEqual(await readState(repo), before, 'its switch, its pace, its number of agents and its publish pick stay its own')
    const unsaid = await run(repo, 'edit', 'tidy')
    assert.deepEqual([unsaid.code, unsaid.out], [2, undefined], 'nothing to change: a command line that cannot be read')
    const never = await run(repo, 'edit', 'tidy', '--when=')
    assert.deepEqual([never.code, never.err], [1, 'it cannot run as written: neither every nor when says when'])
    const silent = await run(repo, 'edit', 'tidy', '--prompt', ' ')
    assert.deepEqual([silent.code, silent.err], [1, 'the prompt is empty'])

    // Removed: the file, what this machine held for it, and its line on the last tick's record; the other one keeps its own.
    const removed = await run(repo, 'remove', 'tidy')
    assert.deepEqual([removed.code, removed.out, removed.err], [0, { ok: true, command: 'tidy', file: '.agent-scheduler/automations/tidy.md', onThisMachine: true }, ''])
    const after = await readState(repo)
    assert.deepEqual([after.switches, after.paces, after.agents, after.publishes], [{ 'answer-comments': before.switches!['answer-comments'] }, { 'answer-comments': before.paces!['answer-comments'] }, { 'answer-comments': 3 }, { 'answer-comments': 'branch' }])
    assert.deepEqual((after.lastTick?.schedule ?? []).map(c => c.command), ['answer-comments'])
    assert.deepEqual((after.lastTick?.decisions ?? []).map(d => d.command), (before.lastTick?.decisions ?? []).map(d => d.command).filter(c => c !== 'tidy'))
    assert.deepEqual((await run(repo, 'remove', 'answer-comments')).out, { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'nothing', startsFrom: 'origin/main' })
    const last = await readState(repo)
    assert.deepEqual([last.switches, last.paces, last.agents, last.publishes], [undefined, undefined, undefined, undefined])
    assert.deepEqual((last.lastTick?.schedule ?? []).map(c => c.command), [])
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills')), ['work-queue'])
    // A name saved anew after a removal starts off: nothing was left under it.
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy again.', '--every', '1d', '--private')).code, 0)
    assert.equal((await run(repo, 'tick')).code, 0)
    assert.equal((await readState(repo)).switches, undefined)

    // A skill of the project, and a name nothing has: refused by all three, in a sentence, and nothing changes.
    await writeSkill(repo, 'triage', 'schedule:\n  every: 6h\n')
    const triage = await readFile(join(repo, '.claude', 'skills', 'triage', 'SKILL.md'), 'utf8')
    for (const args of [['show', 'triage'], ['edit', 'triage', '--prompt', 'Mine now.'], ['remove', 'triage']]) {
      const refused = await run(repo, ...args)
      assert.deepEqual([refused.code, refused.out, refused.err], [1, { ok: false, reason: 'not-an-automation', detail: '.claude/skills/triage is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself' }, '.claude/skills/triage is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself'], args.join(' '))
    }
    assert.equal(await readFile(join(repo, '.claude', 'skills', 'triage', 'SKILL.md'), 'utf8'), triage)
    assert.deepEqual([(await run(repo, 'remove', 'never-saved')).err, (await run(repo, 'show')).code, (await run(repo, 'remove')).code], ['the schedule lists nothing named never-saved', 2, 2])
  } finally {
    await removeRepo(repo)
  }
})

test('a removal that finds nothing of the command in the state writes no state: a project that never had one gets none; and a command removed while a tick runs is not on that tick\'s record', async () => {
  const repo = await testRepo()
  try {
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy up.', '--every', '1d', '--private')).code, 0)
    assert.equal((await run(repo, 'remove', 'tidy')).code, 0)
    assert.deepEqual(await readdir(join(repo, '.agent-scheduler')), [], 'no state file was made for nothing')

    // An automation whose check deletes the automation's own file, as its person's `remove` would while the tick runs the check.
    await writeState(repo, { ...DEFAULT_STATE, on: true })
    assert.equal((await run(repo, 'add', 'gone-midway', '--prompt', 'p', '--when', 'rm .agent-scheduler/automations/gone-midway.md', '--private')).code, 0)
    assert.equal((await run(repo, 'add', 'stays', '--prompt', 'p', '--when', 'true', '--private')).code, 0)
    assert.equal((await run(repo, 'switch', 'gone-midway', 'on')).code, 0)
    const ticked = await run(repo, 'tick')
    assert.equal(ticked.code, 0)
    const state = await readState(repo)
    assert.deepEqual((ticked.out as { schedule: { command: string }[] }).schedule.map(c => c.command), ['stays'], 'the answer is the record as written')
    assert.deepEqual((state.lastTick?.schedule ?? []).map(c => c.command), ['stays'], 'what lists the record shows no row for a file that is gone')
    assert.deepEqual((state.lastTick?.decisions ?? []).map(d => [d.command, d.outcome]), [['stays', 'switched off on this machine']])
    assert.equal(state.switches, undefined, 'and what it was given is taken back with it: off the record, the next tick would not know to')
  } finally {
    await removeRepo(repo)
  }
})

test("status lists the schedule as the project's files say it at that moment, with no tick and no scheduler: a command saved a moment ago, its new words once saved again, and none once removed; what cannot be listed is named with why; each command's last run is the one the last tick recorded", async () => {
  const repo = await testRepo()
  try {
    type Listed = { schedule: Record<string, unknown>[]; unreadable: unknown[]; lastTick?: unknown; running: boolean }
    const status = async (): Promise<Listed> => {
      const answered = await run(repo, 'status')
      assert.equal(answered.code, 0)
      return answered.out as Listed
    }
    assert.deepEqual([(await status()).schedule, (await status()).unreadable], [[], []])
    // Saved a moment ago: listed, though nothing ever ticked here and no scheduler runs.
    assert.equal((await run(repo, 'add', 'answer-comments', '--prompt', 'Answer each new comment below.', '--every', '15m', '--when=gh api comments', '--waits-for', 'when someone commented')).code, 0)
    assert.equal((await run(repo, 'add', 'tidy', '--prompt', 'Tidy up.', '--every', '1d', '--private')).code, 0)
    const added = await status()
    assert.deepEqual([added.running, added.lastTick], [false, undefined])
    assert.deepEqual(added.schedule, [
      // Each with the coding agent it is made for and the ones that can run it: a shared one's skill is in Claude Code's folder alone, one kept on this machine is handed to any.
      { command: 'answer-comments', every: '15m', when: 'gh api comments', waitsFor: 'when someone commented', description: 'Answer each new comment below.', editable: true, agent: 'claude-code', able: ['claude-code'] },
      { command: 'tidy', every: '1d', description: 'Tidy up.', onThisMachine: true, editable: true, agent: 'claude-code', able: ['claude-code', 'codex'] },
    ])
    // Saved again: its new words and its new pace at once.
    assert.equal((await run(repo, 'edit', 'tidy', '--prompt', 'Tidy up, gently.', '--every', '2d')).code, 0)
    assert.deepEqual((await status()).schedule[1], { command: 'tidy', every: '2d', description: 'Tidy up, gently.', onThisMachine: true, editable: true, agent: 'claude-code', able: ['claude-code', 'codex'] })
    // A skill of the project counts the same, with how many at once when its skill says more than one.
    await writeSkill(repo, 'triage', 'description: Put the ready tickets on the queue.\nschedule:\n  every: 6h\n  agents: 2\n')
    assert.deepEqual((await status()).schedule.map(c => [c['command'], c['agents'], c['editable']]), [['answer-comments', undefined, true], ['triage', 2, undefined], ['tidy', undefined, true]])

    // What cannot be listed, read now: a skill whose schedule cannot be read, and an automation kept on this machine that has none.
    await writeSkill(repo, 'plan', 'schedule:\n  evry: 6h\n')
    await writeFile(join(repo, '.agent-scheduler', 'automations', 'notes.md'), '---\nname: notes\n---\nWrite notes.\n')
    const partly = await status()
    assert.deepEqual(partly.schedule.map(c => c['command']), ['answer-comments', 'triage', 'tidy'])
    assert.equal(partly.unreadable.length, 2)
    assert.deepEqual(partly.unreadable.map(u => [(u as { skill: string }).skill, (u as { own?: true }).own, typeof (u as { reason: unknown }).reason]), [['plan', undefined, 'string'], ['notes', true, 'string']])
    assert.deepEqual((partly.unreadable[1] as { reason: string }).reason, 'it has no schedule')
    // Mended: named no more, with no tick in between.
    await rm(join(repo, '.claude', 'skills', 'plan'), { recursive: true })
    await rm(join(repo, '.agent-scheduler', 'automations', 'notes.md'))
    assert.deepEqual((await status()).unreadable, [])

    // The last run of each command is read off the run records, with no tick: a skill's command counts every machine's runs, an automation kept here this machine's.
    const at = '2026-10-09T10:00:00.000Z'
    await recordRun(repo, { id: 'r1', startedAt: at, status: 'failed', intent: 'tidy', caller: { runner: { host: hostname() } } }, [])
    await recordRun(repo, { id: 'r2', startedAt: at, status: 'done', intent: '/triage', caller: { runner: { host: 'another-box' } } }, [])
    await recordRun(repo, { id: 'r0', startedAt: at, status: 'done', intent: '/gone', caller: { runner: { host: hostname() } } }, [])
    const ran = await status()
    assert.deepEqual(ran.schedule.map(c => [c['command'], c['every'], c['lastRun']]), [['answer-comments', '15m', undefined], ['triage', '6h', { id: 'r2', at }], ['tidy', '2d', { id: 'r1', at, failed: true }]])
    assert.equal((await readState(repo)).lastTick, undefined)
    // Removed: gone at once, whatever the last tick's record still says.
    assert.equal((await run(repo, 'remove', 'answer-comments')).code, 0)
    assert.equal((await run(repo, 'remove', 'tidy')).code, 0)
    assert.deepEqual((await status()).schedule.map(c => c['command']), ['triage'])
    // Reading it wrote nothing.
    const before = await readFile(statePath(repo), 'utf8').catch(() => 'no state')
    await status()
    assert.equal(await readFile(statePath(repo), 'utf8').catch(() => 'no state'), before)
  } finally {
    await removeRepo(repo)
  }
})

test('show names the version of what the file says, and edit --was is held against it: a file changed by hand since is not written over, in a sentence; the version an edit answers is the one the next edit is held against', async () => {
  const repo = await testRepo()
  try {
    assert.equal((await run(repo, 'add', 'answer-comments', '--prompt', 'Answer each new comment below.\n\nBe short.', '--every', '15m')).code, 0)
    const file = join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md')
    const version = async (): Promise<string> => ((await run(repo, 'show', 'answer-comments')).out as { version: string }).version
    const opened = await version()
    assert.match(opened, /^\S+$/)
    assert.equal(await version(), opened)
    const byHand = (await readFile(file, 'utf8')).replace('Be short.', 'Be short, and kind.')
    await writeFile(file, byHand)
    assert.notEqual(await version(), opened)
    const refused = await run(repo, 'edit', 'answer-comments', '--prompt=From a form opened a while ago.', '--every=1h', '--when=', '--waits-for=', `--was=${opened}`)
    const why = '.claude/skills/answer-comments/SKILL.md was changed since it was opened here: open it again to see what it says now'
    assert.deepEqual([refused.code, refused.out, refused.err], [1, { ok: false, reason: 'changed-since', detail: why }, why])
    assert.equal(await readFile(file, 'utf8'), byHand)
    // Held against what it says now, it is saved, and the answer names what was written.
    const saved = await run(repo, 'edit', 'answer-comments', '--every=1h', `--was=${await version()}`)
    assert.equal(saved.code, 0)
    const written = (saved.out as { version: string }).version
    assert.equal(written, await version())
    assert.equal((await run(repo, 'edit', 'answer-comments', '--every=2h', '--was', written)).code, 0)
    assert.equal((await run(repo, 'edit', 'answer-comments', '--every=3h', '--was', written)).code, 1, 'its own earlier save changed the file too')
    // With no --was it is held against nothing.
    assert.equal((await run(repo, 'edit', 'answer-comments', '--every=4h')).code, 0)
    assert.match(await readFile(file, 'utf8'), /every: 4h/)
  } finally {
    await removeRepo(repo)
  }
})

test('try runs a check once in the project and answers what it printed and whether an agent would start; nothing is saved', async () => {
  const repo = await testRepo()
  try {
    const before = await readFile(statePath(repo), 'utf8').catch(() => 'no state')
    const tried = await run(repo, 'try', '--when=printf \'["%s"]\' "$(basename "$PWD")"')
    assert.equal(tried.code, 0)
    const out = tried.out as { ok: boolean; lastRun: string; ran: boolean; due: boolean; printed: string }
    assert.deepEqual([out.ok, out.ran, out.due, out.printed], [true, true, true, '["repo"]'], 'run at the repository root')
    assert.match(out.lastRun, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    const age = Date.now() - Date.parse(out.lastRun)
    assert.ok(age >= 24 * 60 * 60 * 1000 && age < 24 * 60 * 60 * 1000 + 60_000, `since a day ago, not ${out.lastRun}`)
    const failing = await run(repo, 'try', '--when', 'echo nope >&2; exit 1')
    assert.deepEqual([failing.code, (failing.out as { ran: boolean }).ran, (failing.out as { error: string }).error], [0, false, 'nope'], 'a check that fails is an answer, not a failure of the command')
    assert.equal((await run(repo, 'try')).code, 2)
    assert.equal((await run(repo, 'try', '--when', '  ')).code, 2)
    assert.equal(await readFile(statePath(repo), 'utf8').catch(() => 'no state'), before)
  } finally {
    await removeRepo(repo)
  }
})

test('write-line needs the words and an agent it knows: a usage error, with no agent asked', async () => {
  const repo = await testRepo()
  try {
    assert.equal((await run(repo, 'write-line')).code, 2)
    assert.equal((await run(repo, 'write-line', '--words', '  ')).code, 2)
    assert.equal((await run(repo, 'write-line', '--words', 'when someone comments', '--agent', 'nope')).code, 2)
  } finally {
    await removeRepo(repo)
  }
})

test('now starts nothing for a command no skill schedules, or one its coding agent cannot run, and says why: a refusal, with the decision in the tick\'s words', async () => {
  const repo = await testRepo()
  try {
    const unknown = await run(repo, 'now', 'nope')
    assert.deepEqual([unknown.code, unknown.out], [1, { ok: false, reason: 'not-scheduled', command: 'nope' }])
    // Made for Codex, as its skill says, and only in Claude Code's folder: Codex would find no skill of that name.
    await writeSkill(repo, 'for-codex', 'schedule:\n  every: 1d\n  agent: codex\n')
    const elsewhere = await run(repo, 'now', 'for-codex')
    const outcome = 'not a command of Codex: its skill is only under .claude/skills, not .agents/skills'
    assert.deepEqual([elsewhere.code, elsewhere.out, elsewhere.err.split('\n').at(-1)], [1, { ok: false, reason: 'not-started', command: 'for-codex', outcome }, outcome])
    // A skill that is only in Codex's folder is Codex's to run: it gets as far as where a run's checkout starts, where nobody published it.
    await mkdir(join(repo, '.agents', 'skills', 'codex-only'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'codex-only', 'SKILL.md'), '---\nname: codex-only\nschedule:\n  every: 1d\n---\nDo the job.\n')
    assert.equal(((await run(repo, 'now', 'codex-only')).out as { outcome: string }).outcome, "not on origin/main: a run's checkout starts from origin/main, and the command's skill is not there")
    // Nothing was written for a run that never was.
    assert.equal((await readState(repo)).lastTick, undefined)
  } finally {
    await removeRepo(repo)
  }
})

test('tick on a project with the scheduler off: the branch is pulled, nothing is decided, the state remembers the tick', async () => {
  const repo = await testRepo()
  try {
    await writeSkill(repo, 'work-queue', 'schedule:\n  when: echo []\n  waits-for: when the queue holds a task\n')
    const ticked = await run(repo, 'tick')
    assert.equal(ticked.code, 0)
    const out = ticked.out as { ok: boolean; note?: string; decisions: unknown[]; schedule: unknown[] }
    assert.equal(out.note, 'off')
    assert.deepEqual(out.decisions, [])
    // The tick lists the commands the project's skills schedule, on or off: what a dashboard draws.
    assert.deepEqual(out.schedule, [{ command: 'work-queue', when: 'echo []', waitsFor: 'when the queue holds a task', agent: 'claude-code', able: ['claude-code'] }])
    assert.equal((await readState(repo)).lastTick?.note, 'off')
  } finally {
    await removeRepo(repo)
  }
})
