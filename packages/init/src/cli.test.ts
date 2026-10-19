import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { carriedSkills, GROUPS } from './catalogue.js'
import { runCli, type CliIo } from './cli.js'
import { commitPaths } from './commit.js'
import { held, readProject } from './project.js'
import { draw, LIST_KEYS, press, startList, type Row, type Terminal } from './prompt.js'
import { stamped } from './skill-file.js'
import { folder, gone, run } from './test-project.js'

/** One run of the command as a script makes it: no terminal. What it printed, parsed, and how it ended. */
async function cli(root: string, ...argv: string[]): Promise<{ code: number; out: any; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { cwd: root, stdout: line => out.push(line), stderr: line => err.push(line) })
  return { code, out: out.length ? JSON.parse(out.join('')) : undefined, err: err.join('\n') }
}

test('the one commit holds the skill files alone: a file the person staged stays staged, their edits stay theirs, and nothing is pushed', async () => {
  const root = await folder(true)
  try {
    await run(root, 'init', '-q', '--bare', join(root, '..', `${root.split('/').pop()}.git`))
    await run(root, 'remote', 'add', 'origin', join(root, '..', `${root.split('/').pop()}.git`))
    await run(root, 'push', '-q', 'origin', 'main')
    await writeFile(join(root, 'staged.txt'), 'theirs\n')
    await run(root, 'add', 'staged.txt')
    await writeFile(join(root, 'README.md'), '# edited\n')

    const added = await cli(root, 'add', 'maintenance', 'readability', '--commit')
    assert.equal(added.code, 0)
    assert.deepEqual(added.out.written, ['maintenance', 'readability'])
    assert.match(added.out.commit, /^[0-9a-f]{7,}$/)
    assert.equal(await run(root, 'show', '--format=%s', '--name-only', 'HEAD'), 'Add OpenAgent skills\n\n.agents/skills/maintenance/SKILL.md\n.agents/skills/readability/SKILL.md\n.claude/skills/maintenance\n.claude/skills/readability\n')
    assert.equal(await run(root, 'status', '--porcelain'), ' M README.md\nA  staged.txt\n', 'what the person had open is as they left it')
    assert.equal((await run(root, 'rev-list', '--count', 'origin/main..main')).trim(), '1', 'the commit is on this machine only')
    assert.equal((await run(root, 'ls-remote', 'origin', 'main')).slice(0, 40), (await run(root, 'rev-parse', 'main~1')).trim(), 'nothing was pushed')

    const removed = await cli(root, 'remove', 'readability', '--commit')
    assert.deepEqual(removed.out.removed, ['readability'])
    assert.equal(await run(root, 'show', '--format=%s', '--name-status', 'HEAD'), 'Remove OpenAgent skills\n\nD\t.agents/skills/readability/SKILL.md\nD\t.claude/skills/readability\n')
    assert.equal(await run(root, 'status', '--porcelain'), ' M README.md\nA  staged.txt\n')

    // Nothing changed at the paths: no commit, and no error.
    assert.deepEqual(await commitPaths(root, ['.agents/skills/maintenance/SKILL.md', '.agents/skills/never/SKILL.md'], 'again'), { ok: true, committed: false })
  } finally {
    await gone(root)
    await gone(`${root}.git`)
  }
})

test('add, remove, update and list for a script: JSON, no question, no commit unless asked; a name init does not know is refused', async () => {
  const root = await folder(true)
  try {
    const empty = await cli(root, 'list')
    assert.deepEqual({ code: empty.code, skills: empty.out.skills.filter((skill: { standing: string }) => skill.standing !== 'absent'), scheduler: empty.out.scheduler }, { code: 0, skills: [], scheduler: false })

    const added = await cli(root, 'add', 'plan', 'ux', 'plan')
    assert.deepEqual({ code: added.code, written: added.out.written, already: added.out.already, commit: added.out.commit }, { code: 0, written: ['plan', 'ux'], already: [], commit: undefined })
    assert.equal((await run(root, 'log', '--format=%s')).trim(), 'init', 'no commit was asked for')

    const unknown = await cli(root, 'add', 'maintenance', 'nope')
    assert.deepEqual({ code: unknown.code, out: unknown.out }, { code: 1, out: { ok: false, reason: 'unknown-skill', name: 'nope' } })
    assert.match(unknown.err, /^no skill nope: the skills are plan, plan-tickets, /)
    assert.deepEqual(held(await readProject(root)), ['plan', 'ux'], 'nothing of a refused command was written')
    for (const basic of ['logs', 'tickets']) assert.equal((await cli(root, 'add', basic)).out.reason, 'unknown-skill', `${basic} comes with every run: init writes none`)

    for (const argv of [['add'], ['remove'], ['list', 'extra'], ['add', 'plan', '--push'], ['nonsense']]) assert.equal((await cli(root, ...argv)).code, 2, argv.join(' '))
    const bare = await cli(root)
    assert.equal(bare.code, 2)
    assert.match(bare.err, /^not a terminal: the list with ticks needs one\./)
    assert.equal((await cli(root, '--help')).code, 0)

    // update: a text an older init wrote is written again; one changed by hand only when it is named.
    const carried = await carriedSkills()
    const reworded = (name: string): string => carried.get(name)!.text.replace(/\n---\n/, '\n---\nA line of the old text.\n')
    await writeFile(join(root, '.agents/skills/plan/SKILL.md'), stamped(reworded('plan'), '0.0.1'))
    await writeFile(join(root, '.agents/skills/ux/SKILL.md'), stamped(reworded('ux'), carried.get('ux')!.version))
    const standings = async (): Promise<Record<string, string>> => Object.fromEntries((await cli(root, 'list')).out.skills.filter((s: any) => s.standing !== 'absent').map((s: any) => [s.name, s.standing]))
    assert.deepEqual(await standings(), { plan: 'newer', ux: 'changed' })
    assert.deepEqual((await cli(root, 'update')).out.written, ['plan'])
    assert.deepEqual(await standings(), { plan: 'current', ux: 'changed' }, 'a text changed by hand is not written over unasked')
    // add leaves a skill the project holds as it is, whatever its text: only update writes over one.
    const again = await cli(root, 'add', 'ux', 'readability')
    assert.deepEqual({ written: again.out.written, already: again.out.already }, { written: ['readability'], already: ['ux'] })
    assert.equal((await standings())['ux'], 'changed')
    await cli(root, 'remove', 'readability')
    assert.deepEqual((await cli(root, 'update', 'ux')).out.written, ['ux'])
    assert.deepEqual(await standings(), { plan: 'current', ux: 'current' })
    const absent = await cli(root, 'update', 'readability')
    assert.deepEqual({ code: absent.code, reason: absent.out.reason }, { code: 1, reason: 'not-here' })

    // The scheduler by name: its lines, this machine's, nothing for git to see.
    const on = await cli(root, 'add', 'scheduler')
    assert.deepEqual(on.out.scheduler, { on: true, changed: true })
    assert.equal((await cli(root, 'list')).out.scheduler, true)
    assert.deepEqual(on.out.paths, [], 'nothing to commit')
    assert.deepEqual((await cli(root, 'remove', 'scheduler')).out.scheduler, { on: false, changed: true })
    assert.equal((await cli(root, 'list')).out.scheduler, false)
  } finally {
    await gone(root)
  }
})

const ROWS: Row[] = [{ label: 'Group one' }, { name: 'a', label: 'a', hint: 'the first' }, { name: 'b', label: 'b' }, { label: 'Group two' }, { name: 'c', label: 'c' }]

test('the list: the cursor skips titles and stops at the ends, space ticks, a and n tick all and none, Enter and q end it', () => {
  let state = startList(ROWS, ['b'])
  assert.equal(state.cursor, 1, 'on the first row that has a name')
  state = press(state, 'up')
  assert.equal(state.cursor, 1)
  state = press(press(state, 'down'), 'down')
  assert.equal(state.cursor, 4, 'over the title')
  assert.equal(press(state, 'down').cursor, 4)
  state = press(state, 'space')
  assert.deepEqual([...state.ticked].sort(), ['b', 'c'])
  assert.deepEqual([...press(state, 'space').ticked], ['b'], 'space again unticks')
  assert.deepEqual([...press(state, 'all').ticked].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...press(state, 'none').ticked], [])
  assert.equal(press(state, 'enter').done, 'enter')
  assert.equal(press(state, 'quit').done, 'quit')
})

test('the list drawn: a mark on the cursor\'s row, a tick in the box, a long line cut to the width, and only the rows around the cursor when the terminal is short', () => {
  const state = { ...startList(ROWS, ['b']), cursor: 2 }
  assert.deepEqual(draw(state, 80, 24), ['  Group one', '  [ ] a  the first', '> [x] b', '  Group two', '  [ ] c', '', LIST_KEYS])
  assert.equal(draw(state, 12, 24)[1], '  [ ] a  th…')
  assert.equal(draw(state, 12, 24).at(-1), '↑↓ space a n', 'the keys are cut to the width too')
  // Six rows hold three of the five: the ones around the cursor, a line saying there are more, and never as many lines as the terminal has.
  assert.deepEqual(draw({ ...state, cursor: 4 }, 80, 6), ['  ↑ more', '  Group two', '> [ ] c', '', LIST_KEYS])
  assert.deepEqual(draw({ ...state, cursor: 1 }, 80, 6), ['  Group one', '> [ ] a  the first', '  ↓ more', '', LIST_KEYS])
  assert.deepEqual(draw(state, 80, 6), ['  ↑ more', '> [x] b', '  ↓ more', '', LIST_KEYS])
  for (const height of [6, 10, 24]) assert.ok(draw(state, 80, height).length < height, `fewer lines than a terminal of ${height} rows`)
})

/** A terminal a test types into: keys go in as a person's would, and everything shown is kept. */
function fakeTerminal(): Terminal & { shown: () => string; type: (keys: string) => void } {
  const input = Object.assign(new PassThrough(), { setRawMode: () => input, isTTY: true }) as unknown as NodeJS.ReadStream
  let shown = ''
  const output = { write: (text: string) => ((shown += text), true), columns: 100, rows: 60 } as unknown as NodeJS.WriteStream
  return { input, output, shown: () => shown.replace(/\x1b\[[0-9?]*[A-Za-z]/g, ''), type: keys => void (input as unknown as PassThrough).write(keys) }
}

/** Type `keys` one at a time, each once the conversation has said `after` since the last one. */
async function converse(root: string, steps: readonly { after: string; keys: string }[], more: Partial<CliIo> = {}): Promise<{ code: number; shown: string }> {
  const terminal = fakeTerminal()
  const ended = runCli([], { cwd: root, stdout: () => {}, stderr: () => {}, terminal, ...more })
  let seen = 0
  for (const { after, keys } of steps) {
    const deadline = Date.now() + 10_000
    while (!terminal.shown().slice(seen).includes(after)) {
      if (Date.now() > deadline) throw new Error(`never said ${JSON.stringify(after)}:\n${terminal.shown().slice(seen)}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    seen = terminal.shown().length
    terminal.type(keys)
  }
  return { code: await ended, shown: terminal.shown() }
}

const DOWN = '\x1b[B'

test('in a terminal, a new project: Enter takes the default picks, the files are written and committed alone, and the dashboard is started in the folder on a yes', async () => {
  const root = await folder(true)
  try {
    const opened: string[] = []
    const { code, shown } = await converse(
      root,
      [
        { after: LIST_KEYS, keys: '\r' },
        { after: 'Commit these files now? (Y/n)', keys: '\r' },
        { after: 'Open the dashboard? (Y/n)', keys: 'y' },
      ],
      { openDashboard: async cwd => (opened.push(cwd), 7) },
    )
    assert.equal(code, 7, 'the dashboard\'s own exit code')
    assert.deepEqual(opened, [root])
    const defaults = GROUPS.filter(group => group.ticked).flatMap(group => group.skills)
    assert.deepEqual(held(await readProject(root)), defaults)
    assert.equal((await readProject(root)).scheduler, true, 'the scheduler is ticked by default')
    assert.match(shown, /Every agent OpenAgent starts already gets its default skills, with nothing written here\. These are more\./)
    assert.doesNotMatch(shown, /not on GitHub/, 'a project with no remote is told nothing about a git host')
    assert.match(shown, /\[ \] browser/)
    assert.match(shown, /Wrote 17 skills in \.agents\/skills, each linked in \.claude\/skills: plan, plan-tickets, /)
    assert.match(shown, /The scheduler starts with the dashboard, on this machine\. Every automation starts switched off\./)
    assert.match(shown, /Committed as [0-9a-f]{7,}, these files alone\. Nothing was pushed/)
    assert.equal((await run(root, 'log', '--format=%s')).trim(), 'Add OpenAgent skills\ninit')
    assert.equal(await run(root, 'status', '--porcelain'), '', 'the hooks file is outside git, and every skill file is committed')
    assert.equal((await run(root, 'show', '--format=', '--name-only', 'HEAD')).trim().split('\n').length, 34, '17 texts and 17 links')
  } finally {
    await gone(root)
  }
})

test('run again, the ticks show what the project has; a tick removed deletes, a tick added writes, a no to the commit leaves the files, q changes nothing', async () => {
  const root = await folder(true)
  try {
    await run(root, 'remote', 'add', 'origin', 'git@github.com:someone/project.git')
    await cli(root, 'add', 'maintenance', 'readability', '--commit')
    const left = await converse(root, [{ after: LIST_KEYS, keys: 'q' }])
    assert.equal(left.code, 0)
    assert.match(left.shown, /This project has 2 of these 19\. The ticks show what it has now\./)
    assert.doesNotMatch(left.shown, /not on GitHub/)
    await run(root, 'remote', 'set-url', 'origin', 'https://gitlab.com/someone/project.git')
    const elsewhere = await converse(root, [{ after: LIST_KEYS, keys: 'q' }])
    assert.match(elsewhere.shown, /This project is not on GitHub: agents push their branch, and you open the request yourself\. There is no skill for another git host yet\./)
    assert.match(left.shown, /\[x\] maintenance/)
    assert.match(left.shown, /\[ \] plan /)
    assert.match(left.shown, /\[ \] scheduler/, 'the scheduler is not ticked in a project that has skills and no scheduler')
    assert.match(left.shown, /Left as it is\.\n$/)
    assert.deepEqual(held(await readProject(root)), ['maintenance', 'readability'])

    // The cursor starts on plan, the first row: tick it, go down eight rows to maintenance and untick it.
    const { shown } = await converse(root, [
      { after: LIST_KEYS, keys: ` ${DOWN.repeat(8)} \r` },
      { after: 'Commit these files now? (Y/n)', keys: 'n' },
      { after: 'Open the dashboard? (Y/n)', keys: 'n' },
    ])
    assert.match(shown, /Wrote 1 skill in \.agents\/skills, linked in \.claude\/skills: plan\./)
    assert.match(shown, /Deleted 1 skill: maintenance\./)
    assert.match(shown, /Not committed\. The files are in your folder\./)
    assert.deepEqual(held(await readProject(root)), ['plan', 'readability'])
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), ' D .agents/skills/maintenance/SKILL.md\n D .claude/skills/maintenance\n?? .agents/skills/plan/SKILL.md\n?? .claude/skills/plan\n')
  } finally {
    await gone(root)
  }
})

test('a newer text is told and written only on a yes; a text changed by hand is named and left; a folder that is no git repository has nothing to commit', async () => {
  const root = await folder(false)
  try {
    const carried = await carriedSkills()
    const reworded = (name: string): string => carried.get(name)!.text.replace(/\n---\n/, '\n---\nA line of the old text.\n')
    for (const [name, version] of [['plan', '0.0.1'], ['ux', carried.get('ux')!.version]] as const) {
      await mkdir(join(root, '.agents/skills', name), { recursive: true })
      await writeFile(join(root, '.agents/skills', name, 'SKILL.md'), stamped(reworded(name), version))
    }
    const no = await converse(root, [
      { after: LIST_KEYS, keys: '\r' },
      { after: '1 skill has a newer text: plan. Update it? (y/N)', keys: '\r' },
      { after: 'Open the dashboard? (Y/n)', keys: 'n' },
    ])
    assert.match(no.shown, /\(a newer text is there\) Write a ticket/)
    assert.match(no.shown, /\(changed by hand\) Review every UI flow/)
    assert.match(no.shown, /Changed by hand, left as it is: ux\. `npx @openagt\/init update <name>` writes the text over yours\./)
    assert.match(no.shown, /Nothing to change\./)
    assert.equal(await readFile(join(root, '.agents/skills/plan/SKILL.md'), 'utf8'), stamped(reworded('plan'), '0.0.1'), 'Enter is no: the old text stays')

    const yes = await converse(root, [
      { after: LIST_KEYS, keys: '\r' },
      { after: '1 skill has a newer text: plan. Update it? (y/N)', keys: 'y' },
      { after: 'Open the dashboard? (Y/n)', keys: 'n' },
    ])
    assert.match(yes.shown, /Wrote 1 skill in \.agents\/skills, linked in \.claude\/skills: plan\./)
    assert.match(yes.shown, /This folder is not a git repository, so there is nothing to commit\. Adding it in the dashboard makes it one\./)
    assert.doesNotMatch(yes.shown, /Commit these files now/)
    assert.equal(await readFile(join(root, '.agents/skills/plan/SKILL.md'), 'utf8'), stamped(carried.get('plan')!.text, carried.get('plan')!.version))
    assert.equal(await readFile(join(root, '.agents/skills/ux/SKILL.md'), 'utf8'), stamped(reworded('ux'), carried.get('ux')!.version), 'the text changed by hand is as the person left it')
  } finally {
    await gone(root)
  }
})

const CTRL_C = '\x03'

test('Ctrl-C at a question ends it there: nothing is written at the newer-text question, nothing committed at the commit question, and no later question is asked', async () => {
  const root = await folder(true)
  try {
    const carried = await carriedSkills()
    await cli(root, 'add', 'plan')
    const old = stamped(carried.get('plan')!.text.replace(/\n---\n/, '\n---\nA line of the old text.\n'), '0.0.1')
    await writeFile(join(root, '.agents/skills/plan/SKILL.md'), old)
    // Tick maintenance too, eight rows below plan, then leave at the question about the newer text.
    const atNewer = await converse(root, [
      { after: LIST_KEYS, keys: `${DOWN.repeat(8)} \r` },
      { after: 'Update it? (y/N)', keys: CTRL_C },
    ])
    assert.equal(atNewer.code, 130)
    assert.deepEqual(held(await readProject(root)), ['plan'], 'the tick was not written')
    assert.equal(await readFile(join(root, '.agents/skills/plan/SKILL.md'), 'utf8'), old)
    assert.doesNotMatch(atNewer.shown, /Open the dashboard/)

    const atCommit = await converse(root, [
      { after: LIST_KEYS, keys: `${DOWN.repeat(8)} \r` },
      { after: 'Update it? (y/N)', keys: 'n' },
      { after: 'Commit these files now? (Y/n)', keys: CTRL_C },
    ])
    assert.equal(atCommit.code, 130)
    assert.deepEqual(held(await readProject(root)), ['plan', 'maintenance'], 'the files were written before the question')
    assert.equal((await run(root, 'log', '--format=%s')).trim(), 'init', 'nothing was committed')
    assert.doesNotMatch(atCommit.shown, /Open the dashboard/)
  } finally {
    await gone(root)
  }
})

test('a project whose ignore rules cover the skill folders is told so in one line, and nothing is left staged', async () => {
  const root = await folder(true)
  try {
    await writeFile(join(root, '.gitignore'), '.claude/\n')
    await run(root, 'add', '.gitignore')
    await run(root, 'commit', '-q', '-m', 'ignore')
    const refused = await cli(root, 'add', 'maintenance', '--commit')
    assert.equal(refused.code, 1)
    assert.equal(refused.err, 'the files are written, but the commit failed: git ignores .claude/skills/maintenance: an ignore rule of this project, or of yours, covers it')
    assert.equal(await run(root, 'status', '--porcelain', '-uall'), '?? .agents/skills/maintenance/SKILL.md\n', 'written, and nothing staged')
    const { shown } = await converse(root, [
      { after: LIST_KEYS, keys: `${DOWN.repeat(7)} \r` },
      { after: 'Commit these files now? (Y/n)', keys: 'y' },
      { after: 'Open the dashboard? (Y/n)', keys: 'n' },
    ])
    assert.match(shown, /Not committed: git ignores \.claude\/skills\/maintainability: an ignore rule of this project, or of yours, covers it\. The files are in your folder\./)
  } finally {
    await gone(root)
  }
})
