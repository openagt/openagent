import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, withTextsApart } from './cli.js'
import { handDownAgents, removeRepo, testRepo } from './test-repo.js'

// The contract on top of the functions: JSON on stdout, a line for a person on stderr, and an
// exit code that says refusal or failure. The commands that spawn or talk to Claude are covered
// by their modules; here the command line's own refusals.

interface Ran {
  code: number
  out: unknown
  err: string
}

async function run(cwd: string, ...argv: string[]): Promise<Ran> {
  const outLines: string[] = []
  const errLines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => outLines.push(line), stderr: line => errLines.push(line) })
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n') }
}

test('usage errors exit 2 with what was wrong on stderr and nothing on stdout; outside a repository is a refusal', async () => {
  const repo = await testRepo()
  const elsewhere = await mkdtemp(join(tmpdir(), 'not-a-repo-'))
  try {
    for (const argv of [[], ['nope'], ['check', 'extra'], ['init', 'extra'], ['tick'], ['status']]) {
      const bad = await run(repo, ...argv)
      assert.equal(bad.code, 2, argv.join(' '))
      assert.equal(bad.out, undefined)
      assert.match(bad.err, argv.length ? /\nRun `agent-runner --help` for usage\.$/ : /^usage: agent-runner/)
    }
    // A driver the distribution has no coding agent for, and a driver named for a run that already has one.
    const noAgents = await run(repo, 'run', 'Read the docs', '--driver', 'codex')
    assert.equal(noAgents.code, 2)
    assert.match(noAgents.err, /No coding agent was handed down to this process/)
    const handBack = await handDownAgents(elsewhere)
    try {
      const unknown = await run(repo, 'run', 'Read the docs', '--driver', 'pi')
      assert.equal(unknown.code, 2)
      assert.match(unknown.err, /unknown driver "pi"; the drivers are claude-code and codex/)
      const unknownCheck = await run(repo, 'check', '--driver', 'pi')
      assert.equal(unknownCheck.code, 2)
      assert.match(unknownCheck.err, /unknown driver "pi"/)
    } finally {
      handBack()
    }
    const renamed = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--driver', 'codex')
    assert.equal(renamed.code, 2)
    assert.match(renamed.err, /--resume takes no --driver/)
    const relabelled = await run(repo, 'run', '--detach', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--id', 'x')
    assert.equal(relabelled.code, 2)
    assert.match(relabelled.err, /--resume takes no --id/)
    // An image is named by its name in the image store, one this computer keeps: never a path.
    const pathed = await run(repo, 'run', 'What does it say?', '--image', '/etc/passwd')
    assert.equal(pathed.code, 2)
    assert.match(pathed.err, /--image names an image of the image store/)
    const unkept = await run(repo, 'run', 'What does it say?', '--image', `${'d'.repeat(64)}.png`)
    assert.equal(unkept.code, 2)
    assert.match(unkept.err, /is not kept on this computer/)
    const answeredWithImage = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', '--answer', 'Yes', '--image', `${'d'.repeat(64)}.png`)
    assert.equal(answeredWithImage.code, 2)
    assert.match(answeredWithImage.err, /--answer takes no --image/)
    const commanded = await run(repo, 'run', 'Read the docs', '--command', 'x')
    assert.equal(commanded.code, 2, 'a run names no command: a scheduler reads the command off the prompt')
    const retargeted = await run(repo, 'run', '--detach', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--pr-base', 'login-page')
    assert.equal(retargeted.code, 2)
    assert.match(retargeted.err, /--resume takes no --pr-base/)
    // The session's account at the git host is for a new run: a resumed one goes on as its record says.
    process.env['OPENAGENT_GIT_ACCOUNT'] = 'octo-agent'
    try {
      const reaccounted = await run(repo, 'run', '--detach', '--resume', '2026-09-17T20-00-00-000Z', 'go on')
      assert.equal(reaccounted.code, 2)
      assert.match(reaccounted.err, /OPENAGENT_GIT_ACCOUNT is for a new run/)
    } finally {
      delete process.env['OPENAGENT_GIT_ACCOUNT']
    }
    // So is the profile: a resumed run goes on with the one its record names; and a word that is no profile id is refused.
    process.env['OPENAGENT_PROFILE'] = 'reviewer'
    try {
      const reassigned = await run(repo, 'run', '--detach', '--resume', '2026-09-17T20-00-00-000Z', 'go on')
      assert.equal(reassigned.code, 2)
      assert.match(reassigned.err, /OPENAGENT_PROFILE is for a new run/)
      process.env['OPENAGENT_PROFILE'] = 'Not An Id'
      const misnamed = await run(repo, 'run', 'Read the docs')
      assert.equal(misnamed.code, 2)
      assert.match(misnamed.err, /no profile id/)
    } finally {
      delete process.env['OPENAGENT_PROFILE']
    }
    // And the session's picks: a resumed run goes on with the ones its record keeps; a word that is no plugin's name is refused.
    process.env['OPENAGENT_PLUGINS_WITHOUT'] = 'tickets'
    try {
      const repicked = await run(repo, 'run', '--detach', '--resume', '2026-09-17T20-00-00-000Z', 'go on')
      assert.equal(repicked.code, 2)
      assert.match(repicked.err, /OPENAGENT_PLUGINS_WITHOUT and OPENAGENT_PROJECT_SKILLS are for a new run/)
      process.env['OPENAGENT_PLUGINS_WITHOUT'] = 'Not A Plugin'
      const misnamed = await run(repo, 'run', 'Read the docs')
      assert.equal(misnamed.code, 2)
      assert.match(misnamed.err, /OPENAGENT_PLUGINS_WITHOUT is no list of plugin names: Not A Plugin/)
    } finally {
      delete process.env['OPENAGENT_PLUGINS_WITHOUT']
    }
    const noTarget = await run(repo, 'run', 'Read the docs', '--pr-base', ' ')
    assert.equal(noTarget.code, 2)
    const unknownLevel = await run(repo, 'run', 'Read the docs', '--publish', 'push')
    assert.equal(unknownLevel.code, 2)
    assert.match(unknownLevel.err, /unknown publish level "push"; the levels are commit, branch, pr, merge/)
    // A resume may give the run a level from there on, or take it away with `nothing`; a new run has none to take away.
    const relevelled = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--publish', 'push')
    assert.equal(relevelled.code, 2)
    assert.match(relevelled.err, /unknown publish level "push"; the levels are commit, branch, pr, merge, or nothing/)
    const nothingNew = await run(repo, 'run', 'Read the docs', '--publish', 'nothing')
    assert.equal(nothingNew.code, 2)
    assert.match(nothingNew.err, /unknown publish level "nothing"; the levels are commit, branch, pr, merge$/m)
    const reattached = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--attach', 'Found: 1')
    assert.equal(reattached.code, 2)
    assert.match(reattached.err, /--resume takes no --attach/)
    const emptyHanded = await run(repo, 'run', 'Read the docs', '--attach', '  ')
    assert.equal(emptyHanded.code, 2)
    assert.match(emptyHanded.err, /--attach needs a text/)
    const unresumed = await run(repo, 'run', 'Read the docs', '--by', 'reply')
    assert.equal(unresumed.code, 2)
    assert.match(unresumed.err, /--by names who resumes a run, with --resume/)
    const restarted = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--started', '2026-10-09T10:00:00.000Z')
    assert.equal(restarted.code, 2)
    assert.match(restarted.err, /--resume takes no --started/)
    const noTime = await run(repo, 'run', 'Read the docs', '--id', 'r1', '--started', 'this morning')
    assert.equal(noTime.code, 2)
    assert.match(noTime.err, /--started is the time a run spawned with --id was asked for/)
    const noId = await run(repo, 'run', 'Read the docs', '--started', '2026-10-09T10:00:00.000Z')
    assert.equal(noId.code, 2)
    assert.match(noId.err, /--started is the time a run spawned with --id was asked for/)
    // A run that continues keeps the branch its record names.
    const rebased = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', '--base', 'main')
    assert.equal(rebased.code, 2)
    assert.match(rebased.err, /--resume takes no --base/)
    for (const [flag, value] of [['--branch', 'dark-mode'], ['--for', 'https://github.com/o/r/issues/5']] as const) {
      const again = await run(repo, 'run', '--resume', '2026-09-17T20-00-00-000Z', 'go on', flag, value)
      assert.equal(again.code, 2)
      assert.match(again.err, new RegExp(`--resume takes no ${flag}`))
    }
    // A branch that exists is worked on as it is: no other branch to start it from.
    const both = await run(repo, 'run', 'Fix it', '--branch', 'dark-mode', '--base', 'main')
    assert.equal(both.code, 2)
    assert.match(both.err, /--branch takes no --base/)
    const outside = await run(elsewhere, 'check')
    assert.equal(outside.code, 1)
    assert.deepEqual(outside.out, { ok: false, reason: 'not-a-repo' })
    assert.equal(outside.err, 'not inside a git repository')
  } finally {
    await removeRepo(repo)
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('a text may open with a dash: only one of the command\'s own flags is a flag, a flag that takes a text takes the next argument whole, and everything else is handed over as a text', async () => {
  const options = { detach: { type: 'boolean' }, model: { type: 'string' }, attach: { type: 'string' }, answer: { type: 'string' } } as const
  // A detached start whose prompt is typed as a list.
  assert.deepEqual(withTextsApart(['--detach', '- fix the tests', '--model', 'opus', '--attach', '- then tidy'], options), ['--detach', '--model=opus', '--attach=- then tidy', '--', '- fix the tests'])
  // A text that opens like a flag and goes on, and a lone dash: texts. One word behind a dash that is no flag of the command stays where the reader refuses it.
  assert.deepEqual(withTextsApart(['--force push it', '-x y', '-', '--model=fast'], options), ['--model=fast', '--', '--force push it', '-x y', '-'])
  assert.deepEqual(withTextsApart(['do it', '--help', '-h', '--detatch', '--constructor'], options), ['--help', '-h', '--detatch', '--constructor', '--', 'do it'])
  // A flag that takes a text does not take another of the command's flags for it: a prompt that is a flag's name starts no run under another prompt.
  assert.deepEqual(withTextsApart(['fix it', '--model', '--detach'], options), ['--model', '--detach', '--', 'fix it'])
  assert.deepEqual(withTextsApart(['--detach', '--attach', '--model', 'opus'], options), ['--detach', '--attach', '--model=opus', '--'])
  // An answer and a text that both open with a dash stay what they are.
  assert.deepEqual(withTextsApart(['--detach', '--answer', '- yes', '-- and more'], options), ['--detach', '--answer=- yes', '--', '-- and more'])
  // After `--` nothing is a flag; a flag written with its value keeps a value that holds `=` and line ends.
  assert.deepEqual(withTextsApart(['--answer=a=b\nc', '--', '--detach'], options), ['--answer=a=b\nc', '--', '--detach'])
  // A flag that takes a text and is given none stays as it is, for the reader to refuse.
  assert.deepEqual(withTextsApart(['x', '--model'], options), ['--model', '--', 'x'])

  // Through the command line: such a prompt is read, and the run is refused for where it was asked, not for how it was typed.
  const elsewhere = await mkdtemp(join(tmpdir(), 'not-a-repo-'))
  try {
    for (const argv of [['run', '--detach', '- fix the tests'], ['run', '--detach', '--resume', 'r1', '--answer', '- yes', '-- and more']]) {
      const ran = await run(elsewhere, ...argv)
      assert.deepEqual([ran.code, ran.out], [1, { ok: false, reason: 'not-a-repo' }], argv.join(' '))
    }
    // What nobody's prompt is stays a usage error: a flag misspelled, alone or beside a prompt, `--help`, and a flag left with no text.
    for (const argv of [['run', 'do it', '--modle', 'opus'], ['run', '--help'], ['run', '-h'], ['run', '--resume', 'r1', '--detatch'], ['run', 'fix it', '--model', '--detach'], ['run', '--detach', '--attach', '--model', 'opus']]) {
      const refused = await run(elsewhere, ...argv)
      assert.deepEqual([refused.code, refused.out], [2, undefined], argv.join(' '))
    }
  } finally {
    await rm(elsewhere, { recursive: true, force: true })
  }
})
