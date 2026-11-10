import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { GIT_FAILED, Refused, UsageError, inRepo, parseCommandArgs, runCommandLine, type CommandLine } from './command-line.js'

/** Run `argv` against `line`, keeping what went to each stream. */
async function run(argv: string[], line: CommandLine<[string]>): Promise<{ code: number; stdout: unknown[]; stderr: string[] }> {
  const stdout: unknown[] = []
  const stderr: string[] = []
  const code = await runCommandLine(argv, { stdout: text => stdout.push(JSON.parse(text)), stderr: text => stderr.push(text) }, line, 'the context')
  return { code, stdout, stderr }
}

const LINE: CommandLine<[string]> = {
  usage: 'usage: tool <command>',
  commands: {
    async echo(args, context) {
      return { args, context }
    },
    async refuse() {
      throw new Refused({ ok: false, reason: 'no-such', id: 'x' }, 'there is no x')
    },
    async misread() {
      throw new UsageError('that is not a number')
    },
    async fail() {
      throw new Error('the disk is gone')
    },
  },
}

test('a result is JSON on stdout and exit 0; each command gets its arguments and the context', async () => {
  assert.deepEqual(await run(['echo', 'a', '--b'], LINE), { code: 0, stdout: [{ args: ['a', '--b'], context: 'the context' }], stderr: [] })
})

test('a refusal is the outcome on stdout and the line on stderr, exit 1; a failure says its reason and detail the same way', async () => {
  assert.deepEqual(await run(['refuse'], LINE), { code: 1, stdout: [{ ok: false, reason: 'no-such', id: 'x' }], stderr: ['there is no x'] })
  assert.deepEqual(await run(['fail'], LINE), { code: 1, stdout: [{ ok: false, reason: 'failed', detail: 'the disk is gone' }], stderr: ['the disk is gone'] })
  const git = new Error('Command failed: git push\nfatal: the remote hung up')
  const failing: CommandLine<[string]> = { ...LINE, failure: GIT_FAILED, commands: { async push() { throw git } } }
  assert.deepEqual((await run(['push'], failing)).stdout, [{ ok: false, reason: 'git-failed', detail: 'fatal: the remote hung up' }])
})

test('a line that cannot be read is the usage on stderr, exit 2: no command, an unknown one, or a misread argument', async () => {
  assert.deepEqual(await run([], LINE), { code: 2, stdout: [], stderr: ['usage: tool <command>'] })
  assert.deepEqual(await run(['--local'], LINE), { code: 2, stdout: [], stderr: ['usage: tool <command>'] })
  assert.deepEqual(await run(['toString'], LINE), { code: 2, stdout: [], stderr: ['usage: tool <command>'] })
  assert.deepEqual(await run(['misread'], LINE), { code: 2, stdout: [], stderr: ['that is not a number\n\nusage: tool <command>'] })
})

test('a line that names no command runs the bare one, with every argument', async () => {
  const line: CommandLine<[string]> = { ...LINE, bare: async args => ({ bare: args }) }
  assert.deepEqual((await run([], line)).stdout, [{ bare: [] }])
  assert.deepEqual((await run(['--local', '--full'], line)).stdout, [{ bare: ['--local', '--full'] }])
  assert.equal((await run(['nope'], line)).code, 2, 'a word that is no command is still a usage error')
})

test('the arguments are read strictly: an unknown flag, or too few or too many positionals, is a usage error', () => {
  assert.equal(parseCommandArgs(['a', '--local'], { local: { type: 'boolean' } }, 1).values.local, true)
  assert.deepEqual(parseCommandArgs(['a'], {}, 0, 1).positionals, ['a'])
  assert.throws(() => parseCommandArgs(['--nope'], {}, 0), UsageError)
  assert.throws(() => parseCommandArgs([], {}, 1), { name: 'Error', message: 'expected 1 argument(s), got 0' })
  assert.throws(() => parseCommandArgs(['a', 'b', 'c'], {}, 0, 2), { message: 'expected at most 2 argument(s), got 3' })
  assert.throws(() => parseCommandArgs(['a'], {}, 2, 3), { message: 'expected 2 to 3 argument(s), got 1' })
  assert.throws(() => parseCommandArgs([], {}, 1, Infinity), { message: 'expected at least 1 argument(s), got 0' })
})

test('outside a repository is a refusal; any other failure stays what it is', async () => {
  await assert.rejects(
    inRepo(async () => {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    }),
    (err: unknown) => err instanceof Refused && err.outcome.reason === 'not-a-repo',
  )
  const timeout = new Error('git timed out')
  await assert.rejects(
    inRepo(async () => {
      throw timeout
    }),
    timeout,
  )
  assert.equal(await inRepo(async () => 'root'), 'root')
})
