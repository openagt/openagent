import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jobState, startJob } from './job.js'

test('a job goes on after the command answered, says how it ended, and a failed one its last lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-job-'))
  try {
    const files = { log: join(dir, 'j.log'), pid: join(dir, 'j.pid'), exit: join(dir, 'j.exit') }
    assert.equal(jobState(files), undefined)
    await startJob(files, 'echo "one-time code: ABCD-1234"; sleep 0.3; echo "$1"', ['done'])
    assert.equal(jobState(files)?.running, true)
    await new Promise(resolve => setTimeout(resolve, 900))
    assert.deepEqual(jobState(files), { running: false, said: 'one-time code: ABCD-1234\ndone\n' })
    await startJob(files, 'echo "curl: could not resolve"; exit 6')
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.deepEqual(jobState(files), { running: false, failed: 'curl: could not resolve', said: 'curl: could not resolve\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
