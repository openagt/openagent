import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { GitRunner } from '@openagt/agent-data'
import { nameBranch } from './name.js'

test('nameBranch: a rename lost to a sibling naming the same thing at the same moment takes the next suffix (review)', async () => {
  // The branches read says `agent-x` is free; the rename then loses the race; the re-read shows it taken.
  let renames = 0
  const racing: GitRunner = async (args, cwd) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return cwd + '\n'
    if (args[0] === 'rev-parse') return 'agent-1\n'
    if (args[0] === 'for-each-ref') return renames === 0 ? 'refs/heads/agent-1\n' : 'refs/heads/agent-1\nrefs/heads/agent-x\n'
    if (args[0] === 'branch' && args[1] === '-m') {
      if (renames++ === 0) throw new Error("fatal: a branch named 'agent-x' already exists")
      return ''
    }
    throw new Error(`unexpected git ${args.join(' ')}`)
  }
  const wt = await realpath(tmpdir())
  assert.deepEqual(await nameBranch(wt, 'x', racing), { ok: true, branch: 'agent-x-2' })
  assert.equal(renames, 2)

  // Any other rename failure is the caller's to see.
  const broken: GitRunner = async (args, cwd) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return cwd + '\n'
    if (args[0] === 'rev-parse') return 'agent-1\n'
    if (args[0] === 'for-each-ref') return ''
    throw new Error('fatal: disk full')
  }
  await assert.rejects(() => nameBranch(wt, 'x', broken), /disk full/)
})
