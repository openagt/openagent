import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { resolveAgentCheckout, resolveAgentDiary } from './agent-checkout.js'
import type { BranchesFor, Checkout } from './branches.js'
import { OPENAGENT_DIR } from '../openagent-dir.js'
import { noRuns } from './runs.js'
import { testRuns } from './test-runs.js'
import { testBranches } from './test-branches.js'
// Both resolutions ask the project's branches provider for the checkouts (#1774), and the finished
// runs come from a test provider: nothing here touches disk.

const CWD = '/ws'
const RUN_ID = '2026-07-04T00-00-00-000Z'
const DIARY = [{ kind: 'said', text: 'Reading.' }, { kind: 'ended', status: 'done' }]
const CHECKOUT: Checkout = { id: RUN_ID, path: join(CWD, '.branches', `agent-${RUN_ID}`), branch: `agent-${RUN_ID}` }

/** Where the run's diary is while it has a checkout: written there by the run's tool. */
const liveDiary = join(CHECKOUT.path, OPENAGENT_DIR, `${RUN_ID}.jsonl`)

const withCheckout = () => testBranches({ [CWD]: [CHECKOUT] })
const noCheckout = () => testBranches({ [CWD]: [] })
const finishedRun = (status: 'done' | 'running' = 'done') => testRuns({ [CWD]: [{ card: { id: RUN_ID, status }, diary: status === 'done' ? DIARY : [] }] })

test('resolveAgentCheckout: the checkout the provider lists for the run, else the project root; no id, an unsafe id and a project with no provider resolve to the root', async () => {
  assert.equal(await resolveAgentCheckout(CWD, RUN_ID, withCheckout()), CHECKOUT.path)
  assert.equal(await resolveAgentCheckout(CWD, RUN_ID, noCheckout()), CWD)
  assert.equal(await resolveAgentCheckout(CWD, RUN_ID, testBranches({})), CWD)
  assert.equal(await resolveAgentCheckout(CWD, undefined, withCheckout()), CWD)
  assert.equal(await resolveAgentCheckout(CWD, '../escape', withCheckout()), CWD)
})

test('resolveAgentCheckout: a run missing from the shared list is asked for once more, fresh (#766/#1774)', async () => {
  // The provider's list is a few seconds old; the run started since. The second, fresh ask finds it.
  const asks: boolean[] = []
  const branches: BranchesFor = async () => ({
    ...(await withCheckout()(CWD))!,
    async list(opts = {}) {
      asks.push(opts.fresh === true)
      return opts.fresh ? [CHECKOUT] : []
    },
  })
  assert.equal(await resolveAgentCheckout(CWD, RUN_ID, branches), CHECKOUT.path)
  assert.deepEqual(asks, [false, true], 'the shared read first, then one fresh read')
})

test('resolveAgentDiary, cached: a run missing from the shared list is not asked for fresh', async () => {
  // A finished run's feed asks for as long as it is open, in case the run is resumed: shared reads only.
  const asks: boolean[] = []
  const branches: BranchesFor = async () => ({
    ...(await withCheckout()(CWD))!,
    async list(opts = {}) {
      asks.push(opts.fresh === true)
      return []
    },
  })
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, finishedRun(), branches, { cached: true }), { finished: DIARY })
  assert.deepEqual(asks, [false])
})

test('resolveAgentDiary: no run id, and an unsafe one, have no diary', async () => {
  assert.equal(await resolveAgentDiary(CWD, undefined, finishedRun(), withCheckout()), undefined)
  assert.equal(await resolveAgentDiary(CWD, '../escape', finishedRun(), withCheckout()), undefined)
})

test('resolveAgentDiary: a run with a checkout resolves to the diary file in it, even when it has a record (a resumed run)', async () => {
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, noRuns, withCheckout()), { file: liveDiary })
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, finishedRun(), withCheckout()), { file: liveDiary })
})

test("resolveAgentDiary: an ended run (checkout gone) resolves to the finished run's lines, from the runs provider (#1472/#1769)", async () => {
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, finishedRun(), noCheckout()), { finished: DIARY })
})

test('resolveAgentDiary: a run started a moment ago, with no checkout and no finished record, is nowhere yet, and the tail asks again (#1774)', async () => {
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, noRuns, noCheckout()), { pending: true })
  // The start's marker may be recorded already, a card still `running`: not finished, still to come in a checkout.
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, finishedRun('running'), noCheckout()), { pending: true })
  assert.deepEqual(await resolveAgentDiary(CWD, RUN_ID, noRuns, testBranches({})), { pending: true }, 'a project with no branches provider has no checkout to answer with')
})
