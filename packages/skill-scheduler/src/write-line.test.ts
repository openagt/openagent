import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver, type Driver, type DriverSession, type DriverStartOptions } from '@openagt/agent-driver'
import { WRITE_LINE_SYSTEM, lineContext, lineOf, writeLine, writeLinePrompt, writtenOf } from './write-line.js'

// A shell line written from plain words: what the agent is asked, what is taken from its answer,
// and that the asking is one tool-less session in a folder of its own that is gone afterwards.

/** A fake agent that answers with `said` and records how it was started and what it was asked. */
function writing(said: string): Driver & { starts: DriverStartOptions[]; prompts: string[] } {
  const fake = new FakeDriver({ respond: prompt => (prompts.push(prompt), said) })
  const starts: DriverStartOptions[] = []
  const prompts: string[] = []
  return {
    id: 'claude-code',
    starts,
    prompts,
    start: opts => {
      starts.push(opts)
      return fake.start(opts)
    },
  }
}

const GH = { remote: 'https://github.com/org/repo.git', hasGh: true }

test('the prompt holds the line contract, what this machine has, and the words fenced off as text', () => {
  const asked = writeLinePrompt('when someone comments on an issue', GH)
  assert.match(asked, /--------\nwhen someone comments on an issue\n--------/)
  assert.match(asked, /\$LAST_RUN/)
  assert.match(asked, /empty JSON list/)
  assert.match(asked, /origin is https:\/\/github\.com\/org\/repo\.git/)
  assert.match(asked, /gh, is on this machine/)
  assert.match(writeLinePrompt('x', { hasGh: false }), /no remote[\s\S]*gh, is not on this machine/)
  assert.match(WRITE_LINE_SYSTEM, /Never use a tool/)
})

test('the line is taken free of a fence or a prompt sign; two lines or nothing is no line', () => {
  assert.equal(lineOf('gh api x --jq .'), 'gh api x --jq .')
  assert.equal(lineOf('```sh\ngh api x\n```'), 'gh api x')
  assert.equal(lineOf('$ gh api x'), 'gh api x')
  assert.equal(lineOf('`gh api x`'), 'gh api x')
  assert.equal(lineOf('gh api x \\\n  --jq .'), 'gh api x --jq .')
  assert.equal(lineOf('Here it is:\ngh api x'), undefined)
  assert.equal(lineOf('  '), undefined)
})

test('NONE: comes back as why no line can do it', () => {
  assert.deepEqual(writtenOf('NONE: nothing on the command line says when you are hungry.'), { none: 'nothing on the command line says when you are hungry.' })
  assert.deepEqual(writtenOf('one\ntwo'), { failed: 'the agent did not answer with one shell line' })
})

test('the agent is asked in one session with no tools, in an empty folder that is gone afterwards', async () => {
  const driver = writing('gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq \'[.[].html_url]\'')
  const written = await writeLine(driver, 'when someone comments on an issue', GH)
  assert.deepEqual(written, { line: 'gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq \'[.[].html_url]\'' })
  assert.equal(driver.starts.length, 1)
  assert.equal(driver.starts[0]?.noTools, true)
  assert.equal(driver.starts[0]?.system, WRITE_LINE_SYSTEM)
  assert.match(driver.prompts[0]!, /when someone comments on an issue/)
  await assert.rejects(access(driver.starts[0]!.cwd))
})

test('an agent that hangs ends at the timeout as failed', async () => {
  let cwd = ''
  const hanging: Driver = {
    id: 'claude-code',
    start: async opts => {
      cwd = opts.cwd
      return { id: 'hang', cwd: opts.cwd, prompt: () => new Promise(() => {}), dispose: async () => {} } as unknown as DriverSession
    },
  }
  assert.deepEqual(await writeLine(hanging, 'anything', GH, 50), { failed: 'the agent took longer than 0.05 seconds' })
  await assert.rejects(access(cwd))
})

test('the context names origin without its credentials, and whether gh is on the PATH', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'write-line-bin-'))
  try {
    await writeFile(join(bin, 'gh'), '#!/bin/sh\n')
    await chmod(join(bin, 'gh'), 0o755)
    const git = async () => 'https://x-access-token:secret@github.com/org/repo.git\n'
    assert.deepEqual(await lineContext('/repo', git, bin), { remote: 'https://github.com/org/repo.git', hasGh: true })
    const none = async () => {
      throw new Error('error: No such remote')
    }
    assert.deepEqual(await lineContext('/repo', none, ''), { remote: undefined, hasGh: false })
  } finally {
    await rm(bin, { recursive: true, force: true })
  }
})
