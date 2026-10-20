import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAutomation, automationProblem, editAutomation, removeAutomation, savedAutomation, tryCheck } from './automation.js'
import { automationOf, automationSkill, type NewAutomation } from './automation-file.js'
import { FOUND_MAX, MAX_NAME, TRY_TIMEOUT_MS } from './names.js'
import { readSchedule, skillSchedule } from './schedule.js'
import { runCheck } from './tick.js'
import { RETRIED_RM, git, removeRepo, testRepo, writeSkill } from './test-repo.js'

// A person's own automation: the skill file it becomes, what is refused, the file written into the project, and a check tried once.

/** An automation where it is saved, or what saving it again answered, with its version checked and taken off: a name for what the file says, which has a test of its own. */
function unversioned<T extends object>(answer: T): Omit<T, 'version'> {
  const { version, ...rest } = answer as T & { version?: unknown }
  assert.equal(typeof version === 'string' && version !== '', true, 'it names a version')
  return rest
}

const CHECK = `gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq '[.[] | select(.body | startswith("🤖") | not) | {url: .html_url}]'`
const ANSWER: NewAutomation = { name: 'answer-comments', prompt: 'Answer: each new comment below.\n\nBe short.\n', every: '15m', when: CHECK, waitsFor: 'when someone commented: at last' }

test('an automation becomes a command skill: the prompt is its text, its first line the description, and the schedule reads back exactly as typed, quotes, colons and several lines alike', () => {
  const text = automationSkill(ANSWER)
  assert.equal(
    text,
    [
      '---',
      'name: answer-comments',
      'description: "Answer: each new comment below."',
      'disable-model-invocation: true',
      'schedule:',
      '  every: 15m',
      '  waits-for: "when someone commented: at last"',
      '  when: |-',
      `    ${CHECK}`,
      '---',
      '',
      'Answer: each new comment below.',
      '',
      'Be short.',
      '',
    ].join('\n'),
  )
  assert.deepEqual(skillSchedule('answer-comments', text, '.claude/skills'), {
    commands: [{ name: 'answer-comments', when: CHECK, every: { count: 15, unit: 'm', ms: 15 * 60_000, text: '15m' }, waitsFor: 'when someone commented: at last', cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'], description: 'Answer: each new comment below.' }],
    unreadable: [],
  })
  // A check of several lines, and a prompt whose own text holds a line of dashes.
  const lines = 'since="$LAST_RUN"\n  echo "[\\"$since\\"]" # new'
  const several = automationSkill({ name: 'm', prompt: 'First.\n---\nLast.', when: lines })
  assert.equal(skillSchedule('m', several, '.claude/skills').commands[0]!.when, lines)
  assert.ok(several.endsWith('---\n\nFirst.\n---\nLast.\n'))
  // By a pace alone: no check, and no line saying what one waits for.
  assert.deepEqual(skillSchedule('daily', automationSkill({ name: 'daily', prompt: 'Tidy up.', every: '1d' }), '.claude/skills').commands, [{ name: 'daily', every: { count: 1, unit: 'd', ms: 86_400_000, text: '1d' }, cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'], description: 'Tidy up.' }])
  // A long first line is cut for the description, never for the prompt.
  const long = 'x'.repeat(400)
  const cut = automationSkill({ name: 'long', prompt: long, every: '1d' })
  assert.equal(skillSchedule('long', cut, '.claude/skills').commands[0]!.description, `${'x'.repeat(149)}…`)
  assert.ok(cut.endsWith(`\n\n${long}\n`))
})

test('whatever a person types changes no other key of the file, and reads the same to a coding agent, whose reader ends the front matter at the first three dashes anywhere', () => {
  // How Claude Code finds a skill's front matter.
  const agentReads = (text: string): string | undefined => /^---\s*\n([\s\S]*?)---\s*\n?/.exec(text)?.[1]
  const odd = ['a --- b', '---', '...', 'x: y', '# no comment', '| pipe', '> fold', '! tag', '& anchor', '* alias', '% dir', '@ at', '`tick`', "it's", 'say "hi"', 'tab\there', 'cr\rhere', 'esc\u001bhere', 'emoji 😀 here', 'disable-model-invocation: false', 'allowed-tools: Bash', 'echo "---"', "grep -- '---' x", 'a\\b \\n c', '\u2028sep', '\u0085nel', '\ufeffbom', '- item', 'null', 'true', '123']
  for (const text of odd) {
    for (const automation of [
      { name: 'x', prompt: text, every: '1d' },
      { name: 'x', prompt: 'Do it.', when: text, waitsFor: text },
      { name: 'x', prompt: `${text}\n${text}`, every: '1d', when: `first\n${text}\n\nlast` },
    ]) {
      const file = automationSkill(automation)
      assert.equal(automationProblem(automation), undefined, JSON.stringify(automation))
      const whole = file.slice(4, file.indexOf('\n---\n', 4) + 1)
      assert.equal(agentReads(file), whole, `the agent's reader sees the whole front matter: ${JSON.stringify(automation)}`)
      assert.ok(whole.includes('\ndisable-model-invocation: true\n') && !/^disable-model-invocation: false/m.test(whole) && !/^allowed-tools:/m.test(whole), `no key of the file's own level is added or changed: ${JSON.stringify(automation)}`)
      const read = skillSchedule('x', file, '.claude/skills').commands[0]!
      assert.equal(read.when, automation.when?.trim(), JSON.stringify(automation))
      assert.equal(read.waitsFor, 'waitsFor' in automation ? automation.waitsFor?.trim() : undefined, JSON.stringify(automation))
      assert.ok(file.endsWith(`\n---\n\n${automation.prompt.trim()}\n`), 'the prompt as typed')
      const back = automationOf('x', file)
      assert.equal(back && automationSkill(back), file, `the file reads back as the automation it was written from: ${JSON.stringify(automation)}`)
    }
  }
  // Three dashes in the prompt's first line: the description holds them as an escape, and the agent's text still has them.
  const dashed = automationSkill({ name: 'mine', prompt: 'Review open PRs --- only mine', every: '1d' })
  assert.ok(dashed.includes('description: "Review open PRs --\\u002d only mine"\n'))
  assert.ok(dashed.endsWith('\n\nReview open PRs --- only mine\n'))
  // A description cut inside an emoji keeps whole characters, and half a character typed is replaced.
  const cut = automationSkill({ name: 'e', prompt: `${'x'.repeat(148)}😀😀😀`, every: '1d' })
  assert.equal(skillSchedule('e', cut, '.claude/skills').commands[0]!.description, `${'x'.repeat(148)}😀…`)
  assert.equal(skillSchedule('h', automationSkill({ name: 'h', prompt: 'p', when: 'echo \ud83d' }), '.claude/skills').commands[0]!.when, 'echo \ufffd')
  // A check a block cannot hold as typed is written quoted, and reads back the same.
  for (const when of ['a\n \nb', 'trail \nnext', 'tab\tin', 'cr\rin', 'echo "---"']) {
    const file = automationSkill({ name: 'q', prompt: 'p', when })
    assert.ok(!file.includes('when: |-'), when)
    assert.equal(skillSchedule('q', file, '.claude/skills').commands[0]!.when, when.trim())
  }
  // A check of several lines with its own indents stays a block, line for line.
  const indented = 'if true; then\n  echo "[1]"\n\nfi'
  assert.ok(automationSkill({ name: 'b', prompt: 'p', when: indented }).includes('  when: |-\n    if true; then\n      echo "[1]"\n\n    fi\n---'))
  assert.equal(skillSchedule('b', automationSkill({ name: 'b', prompt: 'p', when: indented }), '.claude/skills').commands[0]!.when, indented)
})

test('what cannot be saved says why: a name that is no command, no prompt, and a schedule the tick could not read, in the reader\'s own words', () => {
  assert.equal(automationProblem(ANSWER), undefined)
  assert.deepEqual(automationProblem({ ...ANSWER, name: 'Answer comments' }), { ok: false, reason: 'bad-name', detail: 'a name is lower-case letters, digits and single or double dashes, and starts with a letter or a digit' })
  assert.deepEqual(automationProblem({ ...ANSWER, name: '-x' }), { ok: false, reason: 'bad-name', detail: 'a name is lower-case letters, digits and single or double dashes, and starts with a letter or a digit' })
  assert.equal(automationProblem({ ...ANSWER, name: 'a'.repeat(MAX_NAME) }), undefined)
  // Three dashes in a row would end the file's front matter for a coding agent, in the name as anywhere.
  assert.deepEqual(automationProblem({ ...ANSWER, name: 'a---b' }), { ok: false, reason: 'bad-name', detail: 'a name is lower-case letters, digits and single or double dashes, and starts with a letter or a digit' })
  assert.equal(automationProblem({ ...ANSWER, name: 'a--b' }), undefined)
  assert.deepEqual(automationProblem({ ...ANSWER, name: 'a'.repeat(MAX_NAME + 1) }), { ok: false, reason: 'bad-name', detail: `a name is ${MAX_NAME} characters at most` })
  assert.deepEqual(automationProblem({ ...ANSWER, prompt: ' \n ' }), { ok: false, reason: 'no-prompt' })
  assert.deepEqual(automationProblem({ ...ANSWER, prompt: '\0\0' }), { ok: false, reason: 'no-prompt' }, 'a NUL character is no text')
  assert.deepEqual(automationProblem({ name: 'x', prompt: 'p' }), { ok: false, reason: 'bad-schedule', detail: 'neither every nor when says when' })
  assert.deepEqual(automationProblem({ name: 'x', prompt: 'p', every: 'often' }), { ok: false, reason: 'bad-schedule', detail: 'every is a number from 1 to 9999 and a unit, m, h, d, w or mo (15m, 6h, 7d, 2w, 1mo)' })
  assert.deepEqual(automationProblem({ name: 'x', prompt: 'p', every: '1d', waitsFor: 'when it rains' }), { ok: false, reason: 'bad-schedule', detail: 'waits-for says what when waits for, and there is no when' })
  assert.deepEqual(automationProblem({ name: 'x', prompt: 'p', when: 'true', waitsFor: 'one\ntwo' }), { ok: false, reason: 'bad-schedule', detail: 'waits-for is one line of text' })
  assert.deepEqual(automationProblem({ name: 'x', prompt: 'p', when: '  ' }), { ok: false, reason: 'bad-schedule', detail: 'when is a shell command line' })
})

test('saving writes the skill file into the folder the coding agent reads, and the project schedules it at once; a name any skill of the project has is refused and nothing is written', async () => {
  const repo = await testRepo()
  try {
    const saved = await addAutomation(repo, ANSWER, git)
    assert.deepEqual(saved, { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', startsFrom: 'origin/main' })
    assert.equal(await readFile(join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md'), 'utf8'), automationSkill(ANSWER))
    assert.deepEqual((await readSchedule(repo)).commands.map(c => [c.name, c.when]), [['answer-comments', CHECK]])
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '?? .claude/skills/answer-comments/', 'a file of the person\'s to commit: nothing is committed for them')
    // Twice: the first is kept as it is.
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, prompt: 'Other words.' }, git), { ok: false, reason: 'taken', folder: '.claude/skills/answer-comments' })
    assert.equal(await readFile(join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md'), 'utf8'), automationSkill(ANSWER))
    // A skill the project has, in either folder, a link to one included.
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'work-queue' }, git), { ok: false, reason: 'taken', folder: '.claude/skills/work-queue' })
    await mkdir(join(repo, '.agents', 'skills', 'plan'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'plan', 'SKILL.md'), '---\nname: plan\n---\nPlan.\n')
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'plan' }, git), { ok: false, reason: 'taken', folder: '.agents/skills/plan' })
    await symlink('../../.agents/skills/gone', join(repo, '.claude', 'skills', 'linked'))
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'linked' }, git), { ok: false, reason: 'taken', folder: '.claude/skills/linked' })
    // A name that differs from a folder only by its capitals: one folder on a disk that ignores them.
    await mkdir(join(repo, '.claude', 'skills', 'Loud'))
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'loud' }, git), { ok: false, reason: 'taken', folder: '.claude/skills/Loud' })
    // An empty folder of that name is taken too, and stays as it was.
    await mkdir(join(repo, '.claude', 'skills', 'hollow'))
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'hollow' }, git), { ok: false, reason: 'taken', folder: '.claude/skills/hollow' })
    // What cannot be saved writes nothing.
    assert.deepEqual(await addAutomation(repo, { name: 'nothing-says-when', prompt: 'p' }, git), { ok: false, reason: 'bad-schedule', detail: 'neither every nor when says when' })
    assert.deepEqual((await readSchedule(repo)).commands.map(c => c.name), ['answer-comments'])
    assert.deepEqual((await readdir(join(repo, '.claude', 'skills'))).sort(), ['Loud', 'answer-comments', 'hollow', 'linked', 'work-queue'], 'no folder left behind by a save that was refused')
  } finally {
    await removeRepo(repo)
  }
})

test('a project with no remote and no skills folder yet: the folder is made, and the answer says a checkout starts from HEAD; a write that fails leaves no empty folder to be taken for a skill', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-automation-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    assert.deepEqual(await addAutomation(repo, { name: 'daily', prompt: 'Tidy up.', every: '1d' }, git), { ok: true, command: 'daily', file: '.claude/skills/daily/SKILL.md', startsFrom: 'HEAD' })
    assert.deepEqual((await readSchedule(repo)).commands.map(c => c.name), ['daily'])
    // The file cannot be written (a full disk): the save fails, and the folder made for it is taken away again.
    await assert.rejects(addAutomation(repo, { name: 'weekly', prompt: 'Tidy more.', every: '7d' }, git, { write: async () => Promise.reject(new Error('ENOSPC: no space left on device')) }), /ENOSPC/)
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills')), ['daily'])
    assert.equal((await addAutomation(repo, { name: 'weekly', prompt: 'Tidy more.', every: '7d' }, git)).ok, true, 'and the name is free for the next save')
    // Kept on this machine, the same: the folder made for the first one is not left empty.
    await assert.rejects(addAutomation(repo, { name: 'monthly', prompt: 'Tidy most.', every: '1mo' }, git, { onThisMachine: true, write: async () => Promise.reject(new Error('ENOSPC: no space left on device')) }), /ENOSPC/)
    assert.deepEqual(await readdir(join(repo, '.scheduler')).catch(() => 'no folder'), [], 'the tool\'s folder is there, hidden, with nothing in it')
  } finally {
    await rm(repo, RETRIED_RM)
  }
})

test('kept on this machine alone, an automation is one file in the tool\'s own folder, hidden from git, and the project schedules it at once with its text as what a run is sent; a name taken by a skill or by another automation, shared or kept here, is refused both ways', async () => {
  const repo = await testRepo()
  try {
    const kept = await addAutomation(repo, ANSWER, git, { onThisMachine: true })
    assert.deepEqual(kept, { ok: true, command: 'answer-comments', file: '.scheduler/automations/answer-comments.md', startsFrom: 'origin/main', onThisMachine: true })
    assert.equal(await readFile(join(repo, '.scheduler', 'automations', 'answer-comments.md'), 'utf8'), automationSkill(ANSWER), 'written like a skill\'s file')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '', 'nothing of it shows in git: the folder is hidden before the file is written')
    assert.deepEqual((await readSchedule(repo)).commands.map(c => [c.name, c.dir, c.when, c.text]), [['answer-comments', '.scheduler/automations', CHECK, 'Answer: each new comment below.\n\nBe short.']])
    // The name is taken now, for one kept here and for one shared, whatever the capitals of the file there.
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, prompt: 'Other.' }, git, { onThisMachine: true }), { ok: false, reason: 'taken', folder: '.scheduler/automations/answer-comments.md' })
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, prompt: 'Other.' }, git), { ok: false, reason: 'taken', folder: '.scheduler/automations/answer-comments.md' })
    await writeFile(join(repo, '.scheduler', 'automations', 'Loud.md'), 'x')
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'loud' }, git), { ok: false, reason: 'taken', folder: '.scheduler/automations/Loud.md' })
    // A skill of the project keeps its name from an automation kept here too.
    assert.deepEqual(await addAutomation(repo, { ...ANSWER, name: 'work-queue' }, git, { onThisMachine: true }), { ok: false, reason: 'taken', folder: '.claude/skills/work-queue' })
    // And a shared one keeps its name from one kept here.
    assert.equal((await addAutomation(repo, { name: 'shared-one', prompt: 'p', every: '1d' }, git)).ok, true)
    assert.deepEqual(await addAutomation(repo, { name: 'shared-one', prompt: 'p', every: '1d' }, git, { onThisMachine: true }), { ok: false, reason: 'taken', folder: '.claude/skills/shared-one' })
    // What cannot be saved is refused here as there, and writes nothing.
    assert.deepEqual(await addAutomation(repo, { name: 'never', prompt: 'p' }, git, { onThisMachine: true }), { ok: false, reason: 'bad-schedule', detail: 'neither every nor when says when' })
    // A text longer than a run can be handed is refused before it is saved; shared, it is a skill's text and has no such limit.
    assert.deepEqual(await addAutomation(repo, { name: 'endless', prompt: 'x'.repeat(32_001), every: '1d' }, git, { onThisMachine: true }), { ok: false, reason: 'long-prompt', detail: 'the prompt is 32001 characters, and one kept on this machine has 32000 at most' })
    assert.equal((await addAutomation(repo, { name: 'longest', prompt: 'x'.repeat(32_000), every: '1d' }, git, { onThisMachine: true })).ok, true)
    await rm(join(repo, '.scheduler', 'automations', 'longest.md'))
    assert.deepEqual((await readdir(join(repo, '.scheduler', 'automations'))).sort(), ['Loud.md', 'answer-comments.md'])
  } finally {
    await removeRepo(repo)
  }
})

test('an automation saved from here is found again, shared or kept on this machine, by what the schedule says of it; a skill of the project, a file changed by hand into something the tool does not write, and a name the schedule does not list are left alone, each with why', async () => {
  const repo = await testRepo()
  try {
    await addAutomation(repo, ANSWER, git)
    await addAutomation(repo, { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, git, { onThisMachine: true })
    assert.deepEqual(unversioned(await savedAutomation(repo, 'answer-comments')), { automation: { ...ANSWER, prompt: 'Answer: each new comment below.\n\nBe short.' }, file: '.claude/skills/answer-comments/SKILL.md' })
    assert.deepEqual(unversioned(await savedAutomation(repo, 'tidy')), { automation: { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, file: '.scheduler/automations/tidy.md', onThisMachine: true })
    assert.deepEqual((await readSchedule(repo)).commands.map(c => [c.name, c.editable]), [['answer-comments', true], ['tidy', true]], 'and the schedule marks both')

    /** Why a name is left alone; and the schedule, the one place that says what is the tool's, must not mark it. */
    const left = async (name: string): Promise<string> => {
      const found = await savedAutomation(repo, name)
      assert.equal((await readSchedule(repo)).commands.some(c => c.name === name && c.editable), false, `the schedule marks ${name}`)
      return 'reason' in found ? found.detail : assert.fail(`${name} was taken for an automation`)
    }
    const SKILL = 'is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself'
    // The project's own skill, with no schedule: the schedule does not list it.
    assert.equal(await left('work-queue'), 'the schedule lists nothing named work-queue')
    // A skill that schedules itself, in a file a person wrote.
    await writeSkill(repo, 'triage', 'disable-model-invocation: true\nschedule:\n  every: 6h\n')
    assert.equal(await left('triage'), `.claude/skills/triage ${SKILL}`)
    // A file as the tool writes one, alone in its folder, is one, also with what a file manager leaves beside it.
    const text = automationSkill({ name: 'with-script', prompt: 'Run it.', every: '1d' })
    await mkdir(join(repo, '.claude', 'skills', 'with-script'))
    await writeFile(join(repo, '.claude', 'skills', 'with-script', 'SKILL.md'), text)
    assert.equal('reason' in (await savedAutomation(repo, 'with-script')), false, 'alone in its folder, it is one')
    await writeFile(join(repo, '.claude', 'skills', 'with-script', '.DS_Store'), 'x')
    assert.equal('reason' in (await savedAutomation(repo, 'with-script')), false, 'a .DS_Store beside it changes nothing')
    // With a script beside it, in a folder that is a link, or as a link itself: a skill, not an automation.
    await writeFile(join(repo, '.claude', 'skills', 'with-script', 'run.sh'), 'true\n')
    assert.equal(await left('with-script'), `.claude/skills/with-script ${SKILL}`)
    await mkdir(join(repo, 'elsewhere', 'linked'), { recursive: true })
    await writeFile(join(repo, 'elsewhere', 'linked', 'SKILL.md'), automationSkill({ name: 'linked', prompt: 'Run it.', every: '1d' }))
    await symlink('../../elsewhere/linked', join(repo, '.claude', 'skills', 'linked'))
    assert.equal(await left('linked'), `.claude/skills/linked ${SKILL}`)
    await mkdir(join(repo, '.claude', 'skills', 'file-linked'))
    await writeFile(join(repo, 'elsewhere', 'file-linked.md'), automationSkill({ name: 'file-linked', prompt: 'Run it.', every: '1d' }))
    await symlink('../../../elsewhere/file-linked.md', join(repo, '.claude', 'skills', 'file-linked', 'SKILL.md'))
    assert.equal(await left('file-linked'), `.claude/skills/file-linked ${SKILL}`)
    // A skill only in the folder the coding agent of scheduled runs does not read.
    await mkdir(join(repo, '.agents', 'skills', 'plan'), { recursive: true })
    await writeFile(join(repo, '.agents', 'skills', 'plan', 'SKILL.md'), automationSkill({ name: 'plan', prompt: 'Plan.', every: '1d' }))
    assert.equal(await left('plan'), `.agents/skills/plan ${SKILL}`)
    // One kept on this machine whose file is a link: writing it would reach a file kept somewhere else.
    await writeFile(join(repo, 'elsewhere', 'kept.md'), automationSkill({ name: 'kept-link', prompt: 'Run it.', every: '1d' }))
    await symlink('../../elsewhere/kept.md', join(repo, '.scheduler', 'automations', 'kept-link.md'))
    assert.equal(await left('kept-link'), '.scheduler/automations/kept-link.md is a link, or was changed by hand since it was saved: edit or remove the file itself')

    // A prompt changed in the file by hand, its first line too, is still an automation: its description, a line behind, is written anew with the next save.
    const kept = join(repo, '.scheduler', 'automations', 'tidy.md')
    const shared = join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md')
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('\nAnswer: each new comment below.\n', '\nAnswer the newest comment only.\n'))
    assert.deepEqual(unversioned(await savedAutomation(repo, 'answer-comments')), { automation: { ...ANSWER, prompt: 'Answer the newest comment only.\n\nBe short.' }, file: '.claude/skills/answer-comments/SKILL.md' })
    // Anything the tool does not write, one more key, and it is the person's file to edit.
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('schedule:\n', 'schedule:\n  agents: 3\n'))
    assert.equal(await left('answer-comments'), `.claude/skills/answer-comments ${SKILL}`)
    // So is a description a person wrote their own way, or none: saving again would write over a person's words.
    for (const theirs of ['description: My own words.\n', 'description: "Tidy up." # mine\n', '']) {
      await writeFile(kept, automationSkill({ name: 'tidy', prompt: 'Tidy up.', every: '1d' }).replace('description: "Tidy up."\n', theirs))
      assert.equal(await left('tidy'), '.scheduler/automations/tidy.md is a link, or was changed by hand since it was saved: edit or remove the file itself', theirs)
    }
    assert.deepEqual((await readSchedule(repo)).commands.filter(c => c.name === 'answer-comments' || c.name === 'tidy').map(c => c.name), ['answer-comments', 'tidy'], 'both are still listed')

    // One name, a skill and an automation kept here: the schedule lists neither, and says so in its own words.
    await writeFile(join(repo, '.scheduler', 'automations', 'work-queue.md'), automationSkill({ name: 'work-queue', prompt: 'Mine.', every: '1d' }))
    assert.equal(await left('work-queue'), 'the automation work-queue, kept on this machine, is not listed: a skill of the project has this name too: rename or remove .scheduler/automations/work-queue.md, then switch on what you want')
    // A folder of that name with no skill in it is no skill: the automation is listed, and found.
    await mkdir(join(repo, '.claude', 'skills', 'notes'))
    await writeFile(join(repo, '.scheduler', 'automations', 'notes.md'), automationSkill({ name: 'notes', prompt: 'Write notes.', every: '1d' }))
    assert.equal('reason' in (await savedAutomation(repo, 'notes')), false)
    assert.equal((await readSchedule(repo)).commands.find(c => c.name === 'notes')?.editable, true)
    // A skill whose schedule cannot be read, nothing of that name, and a name that is a path.
    await writeSkill(repo, 'broken', 'schedule:\n  every: often\n')
    assert.equal(await left('broken'), 'the schedule of broken cannot be read: every is a number from 1 to 9999 and a unit, m, h, d, w or mo (15m, 6h, 7d, 2w, 1mo)')
    assert.equal(await left('never-saved'), 'the schedule lists nothing named never-saved')
    assert.equal(await left('../../README'), 'the schedule lists nothing named ../../README')
  } finally {
    await removeRepo(repo)
  }
})

test('editing saves an automation again under its name, where it is: what is given takes the place of what the file said, what is left out stays, and what is taken out goes; a shared one is a change to commit; what is no automation, and what could not be saved new, is refused and the file stays', async () => {
  const repo = await testRepo()
  try {
    await addAutomation(repo, ANSWER, git)
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'an automation'], repo)
    const shared = join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md')
    const waitsFor = 'when someone commented: at last'
    // The prompt alone: the pace, the check and its plain words stay.
    assert.deepEqual(unversioned(await editAutomation(repo, 'answer-comments', { prompt: 'Answer each new comment, in one line.' }, git)), { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', startsFrom: 'origin/main' })
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', every: '15m', when: CHECK, waitsFor }))
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), 'M .claude/skills/answer-comments/SKILL.md', 'a change of the person\'s to commit: nothing is committed for them')
    // The pace alone, then the pace taken out: the check stays, and is then all that says when.
    assert.equal((await editAutomation(repo, 'answer-comments', { every: '1h' }, git)).ok, true)
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', every: '1h', when: CHECK, waitsFor }))
    assert.equal((await editAutomation(repo, 'answer-comments', { every: null }, git)).ok, true)
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', when: CHECK, waitsFor }))
    // The check taken out with nothing else to say when: refused, and the file stays.
    assert.deepEqual(await editAutomation(repo, 'answer-comments', { when: null }, git), { ok: false, reason: 'bad-schedule', detail: 'neither every nor when says when' })
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', when: CHECK, waitsFor }))
    // The check taken out for a pace: what it waited for goes with it, unless that is given, which no file can hold.
    assert.deepEqual(await editAutomation(repo, 'answer-comments', { when: null, every: '1d', waitsFor: 'when it rains' }, git), { ok: false, reason: 'bad-schedule', detail: 'waits-for says what when waits for, and there is no when' })
    assert.equal((await editAutomation(repo, 'answer-comments', { when: null, every: '1d' }, git)).ok, true)
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', every: '1d' }))
    // A check given again, and its plain words changed and taken out on their own.
    assert.equal((await editAutomation(repo, 'answer-comments', { when: 'gh api comments', waitsFor: 'when someone commented' }, git)).ok, true)
    assert.equal((await editAutomation(repo, 'answer-comments', { waitsFor: null }, git)).ok, true)
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer each new comment, in one line.', every: '1d', when: 'gh api comments' }))
    assert.deepEqual((await readSchedule(repo)).commands.map(c => [c.name, c.every?.text, c.when, c.description, c.editable]), [['answer-comments', '1d', 'gh api comments', 'Answer each new comment, in one line.', true]])
    // A prompt whose first line was changed in the file by hand: saved again, its description follows it.
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('\nAnswer each new comment, in one line.\n', '\nAnswer the newest comment only.\n'))
    assert.equal((await editAutomation(repo, 'answer-comments', { every: '2d' }, git)).ok, true)
    assert.equal(await readFile(shared, 'utf8'), automationSkill({ name: 'answer-comments', prompt: 'Answer the newest comment only.', every: '2d', when: 'gh api comments' }))

    // Kept on this machine: the same, and git sees nothing.
    await addAutomation(repo, { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, git, { onThisMachine: true })
    await git(['checkout', '-q', '--', '.'], repo)
    assert.deepEqual(unversioned(await editAutomation(repo, 'tidy', { prompt: 'Tidy up, gently.', every: '2d' }, git)), { ok: true, command: 'tidy', file: '.scheduler/automations/tidy.md', startsFrom: 'origin/main', onThisMachine: true })
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '')
    assert.deepEqual((await readSchedule(repo)).commands.filter(c => c.name === 'tidy').map(c => [c.every?.text, c.text]), [['2d', 'Tidy up, gently.']])

    // What is no automation saved from here is not written.
    await writeSkill(repo, 'triage', 'disable-model-invocation: true\nschedule:\n  every: 6h\n')
    const triage = await readFile(join(repo, '.claude', 'skills', 'triage', 'SKILL.md'), 'utf8')
    assert.deepEqual(await editAutomation(repo, 'triage', { prompt: 'Mine now.' }, git), { ok: false, reason: 'not-an-automation', detail: '.claude/skills/triage is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself' })
    assert.equal(await readFile(join(repo, '.claude', 'skills', 'triage', 'SKILL.md'), 'utf8'), triage)
    assert.deepEqual(await editAutomation(repo, 'never-saved', { prompt: 'p' }, git), { ok: false, reason: 'not-an-automation', detail: 'the schedule lists nothing named never-saved' })
    // What could not be saved new cannot be saved again, and the file stays as it was.
    assert.deepEqual(await editAutomation(repo, 'tidy', { prompt: '  ' }, git), { ok: false, reason: 'no-prompt' })
    assert.deepEqual(await editAutomation(repo, 'tidy', { every: 'often' }, git), { ok: false, reason: 'bad-schedule', detail: 'every is a number from 1 to 9999 and a unit, m, h, d, w or mo (15m, 6h, 7d, 2w, 1mo)' })
    assert.deepEqual(await editAutomation(repo, 'tidy', { prompt: 'x'.repeat(32_001) }, git), { ok: false, reason: 'long-prompt', detail: 'the prompt is 32001 characters, and one kept on this machine has 32000 at most' })
    assert.equal((await editAutomation(repo, 'answer-comments', { prompt: 'x'.repeat(32_001) }, git)).ok, true, 'a shared one is a skill\'s text and has no such limit')
    // A write that fails midway, half the text on a full disk: the automation is as it was, and nothing is left beside it.
    const cut = async (path: Parameters<typeof writeFile>[0], text: Parameters<typeof writeFile>[1]): Promise<void> => {
      await writeFile(path, String(text).slice(0, 20))
      throw new Error('ENOSPC: no space left on device')
    }
    await assert.rejects(editAutomation(repo, 'tidy', { prompt: 'Lost?' }, git, { write: cut }), /ENOSPC/)
    assert.deepEqual((await readSchedule(repo)).commands.filter(c => c.name === 'tidy').map(c => [c.every?.text, c.text, c.editable]), [['2d', 'Tidy up, gently.', true]])
    assert.deepEqual(await readdir(join(repo, '.scheduler', 'automations')), ['tidy.md'])
    await assert.rejects(editAutomation(repo, 'answer-comments', { prompt: 'Lost?' }, git, { write: cut }), /ENOSPC/)
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills', 'answer-comments')), ['SKILL.md'])
    assert.equal((await savedAutomation(repo, 'answer-comments') as { automation: NewAutomation }).automation.prompt, 'x'.repeat(32_001))
  } finally {
    await removeRepo(repo)
  }
})

test('an automation has a version, a name for what its file says: the same for the same text, another after any change; a save held against the version last read is refused once the file was changed by hand since, and writes nothing; held against the right one, or against none, it saves and answers the new version', async () => {
  const repo = await testRepo()
  try {
    await addAutomation(repo, ANSWER, git)
    await addAutomation(repo, { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, git, { onThisMachine: true })
    const shared = join(repo, '.claude', 'skills', 'answer-comments', 'SKILL.md')
    const versionOf = async (name: string): Promise<string> => {
      const found = await savedAutomation(repo, name)
      return 'reason' in found ? assert.fail(`${name}: ${found.detail}`) : found.version
    }
    const opened = await versionOf('answer-comments')
    assert.equal(await versionOf('answer-comments'), opened, 'read twice, it is the same')
    assert.notEqual(await versionOf('tidy'), opened, 'another file says something else')

    // Changed by hand since, into what is still an automation the tool reads: a line of the prompt.
    const asSaved = await readFile(shared, 'utf8')
    const byHand = asSaved.replace('Be short.', 'Be short, and kind.')
    assert.notEqual(byHand, asSaved)
    await writeFile(shared, byHand)
    const changed = await versionOf('answer-comments')
    assert.notEqual(changed, opened)
    // A form opened before the change does not write over it, and leaves nothing beside the file.
    assert.deepEqual(await editAutomation(repo, 'answer-comments', { prompt: 'From a form opened a while ago.', every: '1h' }, git, { was: opened }), { ok: false, reason: 'changed-since', detail: '.claude/skills/answer-comments/SKILL.md was changed since it was opened here: open it again to see what it says now' })
    assert.equal(await readFile(shared, 'utf8'), byHand)
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills', 'answer-comments')), ['SKILL.md'])
    // Held against what the file says now, it saves, and answers the version of what it wrote: the next save from the same form is held against that.
    const saved = await editAutomation(repo, 'answer-comments', { every: '1h' }, git, { was: changed })
    assert.equal(saved.ok, true)
    const written = (saved as { version?: string }).version
    assert.equal(written, await versionOf('answer-comments'))
    assert.notEqual(written, changed)
    assert.equal((await editAutomation(repo, 'answer-comments', { every: '2h' }, git, { was: changed })).ok, false, 'the version before its own save is an old one too')
    assert.equal((await editAutomation(repo, 'answer-comments', { every: '2h' }, git, { was: written! })).ok, true)
    // Held against nothing, as from the command line, it saves whatever the file says.
    assert.equal((await editAutomation(repo, 'answer-comments', { every: '3h' }, git)).ok, true)
    // The same text again has the same name, whatever happened in between.
    await writeFile(shared, asSaved)
    assert.equal(await versionOf('answer-comments'), opened)

    // One kept on this machine is held the same way.
    const kept = await versionOf('tidy')
    await writeFile(join(repo, '.scheduler', 'automations', 'tidy.md'), automationSkill({ name: 'tidy', prompt: 'Tidy up, by hand.', every: '1d' }))
    assert.deepEqual(await editAutomation(repo, 'tidy', { prompt: 'Tidy up, from the form.' }, git, { was: kept }), { ok: false, reason: 'changed-since', detail: '.scheduler/automations/tidy.md was changed since it was opened here: open it again to see what it says now' })
    assert.deepEqual((await readSchedule(repo)).commands.filter(c => c.name === 'tidy').map(c => c.text), ['Tidy up, by hand.'])
  } finally {
    await removeRepo(repo)
  }
})

test("what a save that was cut short left beside a shared automation's file, `SKILL.md.new`, is the tool's own: the automation is still found and marked as the tool's, the next save leaves none behind, and removing takes it with the folder; any other file beside it still makes it a skill", async () => {
  const repo = await testRepo()
  try {
    await addAutomation(repo, ANSWER, git)
    const folder = join(repo, '.claude', 'skills', 'answer-comments')
    const editable = async (): Promise<boolean> => (await readSchedule(repo)).commands.some(c => c.name === 'answer-comments' && c.editable === true)
    await writeFile(join(folder, 'SKILL.md.new'), '---\nname: answer-comm')
    assert.equal(await editable(), true)
    assert.equal('reason' in (await savedAutomation(repo, 'answer-comments')), false)
    // Saved again: the half-written file is written over and moved onto the file.
    assert.equal((await editAutomation(repo, 'answer-comments', { prompt: 'Answer in one line.' }, git)).ok, true)
    assert.deepEqual(await readdir(folder), ['SKILL.md'])
    assert.equal(await readFile(join(folder, 'SKILL.md'), 'utf8'), automationSkill({ ...ANSWER, prompt: 'Answer in one line.' }))
    // Removed: it goes with the file and what a file manager left, so the folder goes and the name is free.
    await writeFile(join(folder, 'SKILL.md.new'), 'half')
    await writeFile(join(folder, '.DS_Store'), 'x')
    assert.equal(await editable(), true)
    assert.equal((await removeAutomation(repo, 'answer-comments', git)).ok, true)
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills')), ['work-queue'])
    // Any other file beside it is a person's: a skill with more than its text is no automation.
    await addAutomation(repo, ANSWER, git)
    for (const other of ['SKILL.md.bak', 'SKILL.md.new.txt', 'skill.md.new2']) {
      await writeFile(join(folder, other), 'x')
      assert.equal(await editable(), false, other)
      assert.deepEqual(await removeAutomation(repo, 'answer-comments', git), { ok: false, reason: 'not-an-automation', detail: '.claude/skills/answer-comments is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself' })
      await rm(join(folder, other))
    }
    assert.equal(await editable(), true)
    // A link or a folder of that name is no leftover of a save: writing through a link would reach a file kept elsewhere. Nothing is written or removed.
    await writeFile(join(repo, 'precious.txt'), 'keep me')
    await symlink('../../../precious.txt', join(folder, 'SKILL.md.new'))
    assert.equal(await editable(), false)
    assert.equal(((await editAutomation(repo, 'answer-comments', { prompt: 'Other words.' }, git)) as { reason?: string }).reason, 'not-an-automation')
    assert.equal(await readFile(join(repo, 'precious.txt'), 'utf8'), 'keep me')
    await rm(join(folder, 'SKILL.md.new'))
    await mkdir(join(folder, 'SKILL.md.new'))
    assert.equal(await editable(), false)
    assert.equal(((await removeAutomation(repo, 'answer-comments', git)) as { reason?: string }).reason, 'not-an-automation')
  } finally {
    await removeRepo(repo)
  }
})

test('removing deletes an automation\'s file and the folder that held it alone, commits nothing and changes nothing git holds, and says what git still holds of that one file: nothing, a staged file, or a committed one; what is no automation is left where it is', async () => {
  const repo = await testRepo()
  try {
    // Never committed, while another file of the project is changed: git holds nothing of this one, and it is gone for good.
    await writeFile(join(repo, 'README.md'), '# changed\n')
    await addAutomation(repo, ANSWER, git)
    assert.deepEqual(await removeAutomation(repo, 'answer-comments', git), { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'nothing', startsFrom: 'origin/main' })
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills')), ['work-queue'])
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), 'M README.md')
    // Staged and never committed: git still holds the staged file, and a commit made now would add it.
    await addAutomation(repo, ANSWER, git)
    await git(['add', '.claude'], repo)
    assert.deepEqual(await removeAutomation(repo, 'answer-comments', git), { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'staged', startsFrom: 'origin/main' })
    assert.equal((await git(['status', '--porcelain', '--', '.claude'], repo)).trim(), 'AD .claude/skills/answer-comments/SKILL.md', 'the index is the person\'s: left as it was')
    await git(['rm', '-q', '--cached', '.claude/skills/answer-comments/SKILL.md'], repo)
    // Committed, with what a file manager left beside it: the deletion is a change of the person's, and the folder goes.
    await addAutomation(repo, ANSWER, git)
    await git(['add', '.claude'], repo)
    await git(['commit', '-q', '-m', 'an automation'], repo)
    await writeFile(join(repo, '.claude', 'skills', 'answer-comments', '.DS_Store'), 'x')
    assert.deepEqual(await removeAutomation(repo, 'answer-comments', git), { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'committed', startsFrom: 'origin/main' })
    assert.equal((await git(['status', '--porcelain', '--', '.claude'], repo)).trim(), 'D .claude/skills/answer-comments/SKILL.md')
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills')), ['work-queue'], 'the folder is gone, so the name is free')
    assert.deepEqual((await readSchedule(repo)).commands, [], 'and the schedule lists it no more')
    assert.deepEqual(await removeAutomation(repo, 'answer-comments', git), { ok: false, reason: 'not-an-automation', detail: 'the schedule lists nothing named answer-comments' }, 'twice: nothing is there')

    // Kept on this machine: the file goes, and the folder with the last one.
    await addAutomation(repo, { name: 'tidy', prompt: 'Tidy up.', every: '1d' }, git, { onThisMachine: true })
    await addAutomation(repo, { name: 'notes', prompt: 'Write notes.', every: '1d' }, git, { onThisMachine: true })
    assert.deepEqual(await removeAutomation(repo, 'tidy', git), { ok: true, command: 'tidy', file: '.scheduler/automations/tidy.md', onThisMachine: true })
    assert.deepEqual(await readdir(join(repo, '.scheduler', 'automations')), ['notes.md'])
    assert.equal((await removeAutomation(repo, 'notes', git)).ok, true)
    assert.deepEqual(await readdir(join(repo, '.scheduler')), [], 'the folder made for the first one is not left empty')

    // What is no automation saved from here stays where it is.
    await writeSkill(repo, 'triage', 'disable-model-invocation: true\nschedule:\n  every: 6h\n')
    assert.deepEqual(await removeAutomation(repo, 'triage', git), { ok: false, reason: 'not-an-automation', detail: '.claude/skills/triage is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself' })
    assert.deepEqual(await readdir(join(repo, '.claude', 'skills', 'triage')), ['SKILL.md'])
    // Git cannot be asked: the file is deleted all the same, and the answer says what git holds is not known.
    await addAutomation(repo, ANSWER, git)
    const deaf: typeof git = async (args, cwd) => (args[0] === 'status' ? Promise.reject(new Error('git: not found')) : git(args, cwd))
    assert.deepEqual(await removeAutomation(repo, 'answer-comments', deaf), { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'unknown', startsFrom: 'origin/main' })
  } finally {
    await removeRepo(repo)
  }
})

test('a project whose skills folder is a link to another one: a shared automation is found, saved again and removed through the link, and git is asked about the file where it really is', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'scheduler-automation-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await git(['config', 'user.email', 'tester@example.com'], repo)
    await git(['config', 'user.name', 'tester'], repo)
    await mkdir(join(repo, '.agents', 'skills'), { recursive: true })
    await mkdir(join(repo, '.claude'))
    await symlink('../.agents/skills', join(repo, '.claude', 'skills'))
    assert.equal((await addAutomation(repo, { name: 'daily', prompt: 'Tidy up.', every: '1d' }, git)).ok, true)
    await git(['add', '-A'], repo)
    await git(['commit', '-q', '-m', 'an automation'], repo)
    assert.deepEqual((await readSchedule(repo)).commands.map(c => [c.name, c.editable]), [['daily', true]])
    assert.equal((await editAutomation(repo, 'daily', { prompt: 'Tidy more.' }, git)).ok, true)
    assert.equal(await readFile(join(repo, '.agents', 'skills', 'daily', 'SKILL.md'), 'utf8'), automationSkill({ name: 'daily', prompt: 'Tidy more.', every: '1d' }))
    assert.deepEqual(await removeAutomation(repo, 'daily', git), { ok: true, command: 'daily', file: '.claude/skills/daily/SKILL.md', git: 'committed', startsFrom: 'HEAD' })
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), 'D .agents/skills/daily/SKILL.md')
  } finally {
    await rm(repo, RETRIED_RM)
  }
})

test('trying a check runs it once as a tick would, asking what is new since a day ago, and says what it printed and whether an agent would start; a check that fails says its last line', async () => {
  const now = new Date('2026-10-09T10:00:00.400Z')
  const found = await tryCheck(process.cwd(), 'printf \'["since %s"]\' "$LAST_RUN"', now)
  assert.deepEqual(found, { lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '["since 2026-10-08T10:00:00Z"]' })
  assert.deepEqual(await tryCheck(process.cwd(), 'echo "[]"', now), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '[]' })
  assert.deepEqual(await tryCheck(process.cwd(), 'true', now), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '' })
  const failed = await tryCheck(process.cwd(), 'echo half; echo first >&2; echo "no such thing" >&2; exit 3', now)
  assert.deepEqual(failed, { lastRun: '2026-10-08T10:00:00Z', ran: false, due: false, printed: 'half', error: 'no such thing' })
  // A long output is cut as a run is handed it, and says so.
  const long = await tryCheck(process.cwd(), 'unused', now, async () => ({ ok: true, stdout: 'y'.repeat(FOUND_MAX + 10), stderr: '' }))
  assert.equal(long.printed, `${'y'.repeat(FOUND_MAX)}\n(cut: the check printed ${FOUND_MAX + 10} characters, these are the first ${FOUND_MAX}; it asked what is new since 2026-10-08T10:00:00Z)`)
  // The check is the tick's own runner, with less time: a dashboard waits for the answer and gives up before a tick would.
  const seen: unknown[] = []
  await tryCheck('/repo', 'npx queue', now, async (...args) => (seen.push(args), { ok: true, stdout: '', stderr: '' }))
  assert.deepEqual(seen, [['/repo', 'npx queue', TRY_TIMEOUT_MS, '2026-10-08T10:00:00Z']])
  assert.ok(TRY_TIMEOUT_MS < 30_000, 'under the 30 seconds a dashboard gives a command')
  // A line that outlives its time says so, not the shell's own words; one that reads its input finds none and ends at once.
  const slow = await tryCheck(process.cwd(), 'sleep 5', now, runCheck, 300)
  assert.deepEqual(slow, { lastRun: '2026-10-08T10:00:00Z', ran: false, due: false, printed: '', error: 'it took longer than 0.3 seconds' })
  const reading = Date.now()
  assert.deepEqual(await tryCheck(process.cwd(), 'cat', now, runCheck, 5_000), { lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '' })
  assert.ok(Date.now() - reading < 3_000, 'it did not wait out its time')
  // A very long last line of error is cut.
  const loud = await tryCheck(process.cwd(), 'unused', now, async () => ({ ok: false, stdout: '', stderr: `first\n${'e'.repeat(2000)}\n` }))
  assert.equal(loud.error, `${'e'.repeat(500)}…`)
})
