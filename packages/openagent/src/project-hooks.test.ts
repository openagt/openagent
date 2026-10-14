import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { PROJECT_HOOKS_FILE, parseProjectHooks, readProjectHooks, runCheckHook, runProjectHooks, runResumeHook, runStartHook, startLineTakesBase } from './project-hooks.js'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { initHooks } from '@openagt/agent-runner'

// The hooks file and the runner (#1774), for real: `sh -c` in a throwaway project, the lines
// leaving traces in files the assertions read back.

async function project(hooks?: string): Promise<string> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'openagent-hooks-')))
  await mkdir(join(cwd, OPENAGENT_DIR), { recursive: true })
  if (hooks !== undefined) await writeFile(join(cwd, PROJECT_HOOKS_FILE), hooks)
  return cwd
}

test('the file: open and close lists of shell lines; missing means none; the wrong shape is refused and named', async () => {
  assert.deepEqual(parseProjectHooks(''), { open: [], close: [] })
  assert.deepEqual(parseProjectHooks('open:\n  - npx agent-scheduler start\nclose:\n  - npx agent-scheduler stop --unless-keep-alive\n'), {
    open: ['npx agent-scheduler start'],
    close: ['npx agent-scheduler stop --unless-keep-alive'],
  })
  assert.deepEqual(parseProjectHooks('open:\n  - echo one\n  - echo two\n'), { open: ['echo one', 'echo two'], close: [] })
  assert.deepEqual(parseProjectHooks('open:\nclose:\n'), { open: [], close: [] })
  assert.throws(() => parseProjectHooks('- echo hi\n'), /hooks\.yml must be a YAML map; the keys are open, close, start, resume and check$/)
  assert.throws(() => parseProjectHooks('opne:\n  - echo hi\n'), /unknown key "opne"; the keys are open, close, start, resume and check$/)
  assert.throws(() => parseProjectHooks('open: echo hi\n'), /"open" must be a list of shell lines/)
  assert.throws(() => parseProjectHooks('close:\n  - 3\n'), /"close" must be a list of shell lines/)
  assert.deepEqual(parseProjectHooks('start: npx agent-runner run --detach "$PROMPT"\nresume:\n'), { open: [], close: [], start: 'npx agent-runner run --detach "$PROMPT"' })
  assert.throws(() => parseProjectHooks('start:\n  - echo hi\n'), /"start" must be one shell line/)
  assert.throws(() => parseProjectHooks('resume: 3\n'), /"resume" must be one shell line/)
  // A scheduler setting is no hook of the dashboard's: its line is an unknown key like any other.
  for (const key of ['offset', 'switch', 'publish']) assert.throws(() => parseProjectHooks(`${key}: echo hi\n`), new RegExp(`unknown key "${key}"`))

  const none = await project()
  const broken = await project('open: [\n')
  const warnings: string[] = []
  try {
    assert.deepEqual(await readProjectHooks(none, m => warnings.push(m)), { open: [], close: [] })
    assert.equal(warnings.length, 0)
    assert.deepEqual(await readProjectHooks(broken, m => warnings.push(m)), { open: [], close: [] })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /^ignoring /)
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(broken, { recursive: true, force: true })
  }
})

test('the lines run in order, in the project, through the shell; a failing line is logged and the next one still runs', async () => {
  const cwd = await project('open:\n  - echo open-1 >> hooks.log\n  - pwd -P >> hooks.log\n  - echo said-so >&2; exit 3\n  - echo open-2 >> hooks.log\nclose:\n  - echo close >> hooks.log\n')
  const log: string[] = []
  try {
    await runProjectHooks(cwd, 'open', { log: line => log.push(line) })
    assert.equal(await readFile(join(cwd, 'hooks.log'), 'utf8'), `open-1\n${cwd}\nopen-2\n`)
    assert.deepEqual(log, [
      `[openagent] open hook (${cwd.split('/').pop()}): echo open-1 >> hooks.log: exit 0`,
      `[openagent] open hook (${cwd.split('/').pop()}): pwd -P >> hooks.log: exit 0`,
      `[openagent] open hook (${cwd.split('/').pop()}): echo said-so >&2; exit 3: exit 3`,
      '[openagent]   said-so',
      `[openagent] open hook (${cwd.split('/').pop()}): echo open-2 >> hooks.log: exit 0`,
    ])
    await runProjectHooks(cwd, 'close', { log: line => log.push(line) })
    assert.equal(await readFile(join(cwd, 'hooks.log'), 'utf8'), `open-1\n${cwd}\nopen-2\nclose\n`)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a line that hangs is killed at the bound and logged as timed out; the next one still runs', async () => {
  const cwd = await project('open:\n  - sleep 30\n  - echo after >> hooks.log\n')
  const log: string[] = []
  try {
    const started = Date.now()
    await runProjectHooks(cwd, 'open', { log: line => log.push(line), timeoutMs: 300 })
    assert.ok(Date.now() - started < 10_000, 'the bound, not the sleep, decided')
    assert.match(log[0]!, /sleep 30: timed out after 0s$/)
    assert.equal(await readFile(join(cwd, 'hooks.log'), 'utf8'), 'after\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('no file runs nothing and logs nothing; a broken file logs why it was ignored and runs nothing', async () => {
  const none = await project()
  const broken = await project('open: [\n')
  const log: string[] = []
  try {
    await runProjectHooks(none, 'open', { log: line => log.push(line) })
    assert.equal(log.length, 0)
    await runProjectHooks(broken, 'close', { log: line => log.push(line) })
    assert.equal(log.length, 1)
    assert.match(log[0]!, /^\[openagent\] close hook \(.*\): ignoring .*hooks\.yml/)
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(broken, { recursive: true, force: true })
  }
})

test('a start line that names the coding agent of its run is taken at its word; a name that is no word is none', async () => {
  const answering = (answer: string): Promise<string> => project(`start: 'echo ${JSON.stringify(answer).replaceAll("'", "''")}'\n`)
  const named = await answering('{"id":"run-2","driver":"codex"}')
  const odd = await answering('{"id":"run-3","driver":7}')
  const empty = await answering('{"id":"run-4","driver":""}')
  try {
    assert.deepEqual(await runStartHook(named, { prompt: 'x' }), { ok: true, id: 'run-2', driver: 'codex' })
    assert.deepEqual(await runStartHook(odd, { prompt: 'x' }), { ok: true, id: 'run-3' })
    assert.deepEqual(await runStartHook(empty, { prompt: 'x' }), { ok: true, id: 'run-4' })
  } finally {
    for (const cwd of [named, odd, empty]) await rm(cwd, { recursive: true, force: true })
  }
})

test('naming a run off reaches the run\'s own tool through the environment, with no line of any hooks.yml changed', async () => {
  // The line below never mentions it: the run's tool is the line's own child and reads it there.
  const cwd = await project(`start: 'printf "%s\\n" "\${OPENAGENT_NAME_RUN-unset}" >> named.txt; echo "{\\"ok\\":true,\\"id\\":\\"run-1\\"}"'\n`)
  try {
    assert.deepEqual(await runStartHook(cwd, { prompt: 'x' }), { ok: true, id: 'run-1' })
    assert.deepEqual(await runStartHook(cwd, { prompt: 'x', nameRun: false }), { ok: true, id: 'run-1' })
    assert.deepEqual(await runStartHook(cwd, { prompt: 'x', nameRun: true }), { ok: true, id: 'run-1' })
    assert.equal(await readFile(join(cwd, 'named.txt'), 'utf8'), 'unset\n0\nunset\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the start line gets the prompt and the picks in its environment, and the id it answers on stdout comes back', async () => {
  const cwd = await project(`start: 'printf "%s|%s|%s|%s|%s|%s\\n" "$PROMPT" "$DRIVER" "\${MODEL-unset}" "\${THEN-unset}" "\${PUBLISH-unset}" "\${BASE-unset}" >> started.txt; echo "{\\"ok\\":true,\\"id\\":\\"run-1\\"}"'\n`)
  try {
    assert.deepEqual(await runStartHook(cwd, { prompt: '/work-queue "now"', driver: 'codex' }), { ok: true, id: 'run-1' })
    assert.deepEqual(await runStartHook(cwd, { prompt: 'Fix it', then: '/post-merge-cleanup', publish: 'merge', base: 'my-branch' }), { ok: true, id: 'run-1' })
    assert.equal(await readFile(join(cwd, 'started.txt'), 'utf8'), '/work-queue "now"|codex|unset|unset|unset|unset\nFix it||unset|/post-merge-cleanup|merge|my-branch\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a start line takes the branch to start from when it mentions BASE, in either spelling, and no other variable counts', () => {
  assert.equal(startLineTakesBase('agent-runner run --detach "$PROMPT" ${BASE:+--base "$BASE"}'), true)
  assert.equal(startLineTakesBase('./start.sh "$PROMPT" "$BASE"'), true)
  assert.equal(startLineTakesBase('./start.sh "$PROMPT" "${BASE}"'), true)
  assert.equal(startLineTakesBase('agent-runner run --detach "$PROMPT" ${PUBLISH:+--publish "$PUBLISH"}'), false)
  assert.equal(startLineTakesBase('./start.sh "$BASELINE" "${BASE_DIR}" --base main'), false)
})

test('the resume line gets the run and the text or the answer', async () => {
  const cwd = await project(`resume: 'printf "%s|%s|%s" "$RUN_ID" "\${TEXT-unset}" "\${ANSWER-unset}" >> resumed.txt; echo "{\\"id\\":\\"$RUN_ID\\"}"'\n`)
  try {
    assert.deepEqual(await runResumeHook(cwd, { runId: 'run-1', text: 'go on' }), { ok: true, id: 'run-1' })
    assert.deepEqual(await runResumeHook(cwd, { runId: 'run-2', answer: 'Yes' }), { ok: true, id: 'run-2' })
    assert.equal(await readFile(join(cwd, 'resumed.txt'), 'utf8'), 'run-1|go on|unsetrun-2|unset|Yes')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('no start line, a broken file, a failing line, a line that answers no id, a line that hangs: each is an error in words', async () => {
  const none = await project('open:\n  - echo hi\n')
  const broken = await project('start: [\n')
  const failing = await project('start: echo "the project has no such command" >&2; exit 1\n')
  const mute = await project('start: echo done\n')
  const hanging = await project('start: sleep 30\n')
  try {
    assert.deepEqual(await runStartHook(none, { prompt: 'x' }), { ok: false, error: 'this project has no start hook' })
    assert.deepEqual(await runResumeHook(none, { runId: 'r', text: 'x' }), { ok: false, error: 'this project has no resume hook' })
    const said = await runStartHook(broken, { prompt: 'x' })
    assert.ok(!said.ok && /^ignoring .*hooks\.yml/.test(said.error), JSON.stringify(said))
    assert.deepEqual(await runStartHook(failing, { prompt: 'x' }), { ok: false, error: 'the start hook: the project has no such command' })
    assert.deepEqual(await runStartHook(mute, { prompt: 'x' }), { ok: false, error: 'the start hook: it answered no run id' })
    assert.deepEqual(await runStartHook(hanging, { prompt: 'x' }, { timeoutMs: 300 }), { ok: false, error: 'the start hook: timed out after 0s' })
  } finally {
    for (const dir of [none, broken, failing, mute, hanging]) await rm(dir, { recursive: true, force: true })
  }
})

test('the check line gets the picked agent and answers its problems and warnings; no line, a failing line and a wrong answer are each an answer in words', async () => {
  const cwd = await project(`check: 'printf "{\\"problems\\":[\\"%s is missing\\"],\\"warnings\\":[]}" "\${DRIVER:-default}"'\n`)
  const none = await project('start: echo hi\n')
  const failing = await project('check: echo "not inside a git repository" >&2; exit 1\n')
  const mute = await project('check: echo "{}"\n')
  try {
    assert.deepEqual(await runCheckHook(cwd, { driver: 'codex' }), { ok: true, problems: ['codex is missing'], warnings: [] })
    assert.deepEqual(await runCheckHook(cwd, {}), { ok: true, problems: ['default is missing'], warnings: [] })
    assert.deepEqual(await runCheckHook(none, {}), { ok: false, error: 'this project has no check hook', noHook: true })
    assert.deepEqual(await runCheckHook(failing, {}), { ok: false, error: 'the check hook: not inside a git repository' })
    assert.deepEqual(await runCheckHook(mute, {}), { ok: false, error: 'the check hook: it answered no problems and warnings' })
  } finally {
    for (const dir of [cwd, none, failing, mute]) await rm(dir, { recursive: true, force: true })
  }
})

test('a line reaches its tool with nothing installed in the project: the dashboard brings the runner, and the project\'s own copy goes first', async () => {
  // An empty folder with the runner's own lines, as adding a project writes them: no package.json, no node_modules.
  const cwd = await project()
  try {
    execFileSync('git', ['init', '-q'], { cwd })
    const written = await initHooks(cwd)
    assert.ok(written.ok && written.added.includes('start') && written.added.includes('check'), JSON.stringify(written))
    assert.ok(!(await readFile(join(cwd, PROJECT_HOOKS_FILE), 'utf8')).includes('npx'), 'no line asks npx for a package by name')
    // A PATH with node and the shell's tools and no runner on it: the line still finds the dashboard's copy.
    const bare = ['/usr/bin', '/bin', dirname(process.execPath)].join(delimiter)
    const checked = await runCheckHook(cwd, {}, { env: { ...process.env, PATH: bare } })
    assert.ok(checked.ok, JSON.stringify(checked))

    // The project installed a copy of its own: the dashboard's still answers, the one its pages go through too.
    await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true })
    const own = join(cwd, 'node_modules', '.bin', 'agent-runner')
    await writeFile(own, '#!/bin/sh\necho \'{"problems":["the project\'"\'"\'s own copy answered"],"warnings":[]}\'\n')
    await chmod(own, 0o755)
    assert.deepEqual(await runCheckHook(cwd, {}, { env: { ...process.env, PATH: bare } }), checked)
    // A tool that is not OpenAgent's is the project's installed one.
    const other = join(cwd, 'node_modules', '.bin', 'their-tool')
    await writeFile(other, '#!/bin/sh\necho \'{"problems":["their tool answered"],"warnings":[]}\'\n')
    await chmod(other, 0o755)
    await writeFile(join(cwd, PROJECT_HOOKS_FILE), 'check: their-tool\n')
    assert.deepEqual(await runCheckHook(cwd, {}, { env: { ...process.env, PATH: bare } }), { ok: true, problems: ['their tool answered'], warnings: [] })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
