import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { startDaemonTick, type TickJob } from './daemon-tick.js'

// E4: one clock, and each job says how many ticks it wants between turns. The tests drive `tick()`
// rather than the interval, which is the point of the tick being awaitable.

/** A clock whose interval never fires in the test's lifetime, driven by hand. */
function clock(jobs: readonly TickJob[]) {
  const logs: string[] = []
  const tick = startDaemonTick({ jobs, intervalMs: 60 * 60_000, log: line => logs.push(line) })
  return { tick, logs }
}

test('a job runs every Nth tick, and its own turn is skipped rather than queued', async () => {
  const ran: string[] = []
  const { tick } = clock([
    { name: 'fast', run: async () => void ran.push('fast') },
    { name: 'slow', every: 3, run: async () => void ran.push('slow') },
  ])
  try {
    // The constructor fires tick 0, which both jobs take.
    await tick.tick()
    for (let i = 0; i < 3; i++) await tick.tick()
    // Ticks 0,1,2,3 for `fast`; ticks 0 and 3 for `slow`.
    assert.deepEqual(ran, ['fast', 'slow', 'fast', 'fast', 'fast', 'slow'])
  } finally {
    await tick.stop()
  }
})

test('a job can sit out the start-up tick, which every other job takes', async () => {
  // The first tick fires at start-up rather than an interval later, because the case most of these
  // jobs exist for is a machine that was off while something happened.
  const ran: string[] = []
  const { tick } = clock([
    { name: 'seeds', run: async () => void ran.push('seeds') },
    { name: 'waits', onStart: false, run: async () => void ran.push('waits') },
  ])
  try {
    await tick.tick()
    assert.deepEqual(ran, ['seeds'])
    await tick.tick()
    assert.deepEqual(ran, ['seeds', 'seeds', 'waits'])
  } finally {
    await tick.stop()
  }
})

test('a job that throws costs its own turn and nothing else, and is named in the log', async () => {
  // A sweep failing silently is indistinguishable from one that was never scheduled at all.
  const ran: string[] = []
  const { tick, logs } = clock([
    {
      name: 'CI watch',
      run: async () => {
        throw new Error('gh is down')
      },
    },
    { name: 'after', run: async () => void ran.push('after') },
  ])
  try {
    await tick.tick()
    assert.deepEqual(ran, ['after'], 'the rest of the tick still ran')
    assert.equal(logs.length, 1)
    assert.match(logs[0]!, /CI watch failed this tick: gh is down/)
  } finally {
    await tick.stop()
  }
})

test('jobs run in order, one at a time: a slow one holds the tick rather than overlapping it', async () => {
  const order: string[] = []
  const { tick } = clock([
    {
      name: 'slow',
      run: async () => {
        order.push('slow:start')
        await new Promise(resolve => setTimeout(resolve, 5))
        order.push('slow:end')
      },
    },
    { name: 'next', run: async () => void order.push('next') },
  ])
  try {
    await tick.tick()
    assert.deepEqual(order, ['slow:start', 'slow:end', 'next'])
  } finally {
    await tick.stop()
  }
})

test('an overlapping tick joins the one already running, so awaiting it means it finished', async () => {
  let running = 0
  let peak = 0
  const { tick } = clock([
    {
      name: 'job',
      run: async () => {
        peak = Math.max(peak, ++running)
        await new Promise(resolve => setTimeout(resolve, 5))
        running--
      },
    },
  ])
  try {
    await Promise.all([tick.tick(), tick.tick(), tick.tick()])
    assert.equal(peak, 1, 'never two turns of the same job at once')
    assert.equal(running, 0, 'and awaiting the tick means it finished')
  } finally {
    await tick.stop()
  }
})

test('a stopped clock runs nothing further', async () => {
  let ran = 0
  const { tick } = clock([{ name: 'job', run: async () => void ran++ }])
  await tick.tick()
  await tick.stop()
  await tick.tick()
  assert.equal(ran, 1)
})

test('stopping waits out the turn already in flight, rather than only the next one', async () => {
  // These jobs commit and push. Clearing the interval stops the *next* turn; the one inside a job
  // runs to the end regardless, and a shutdown that does not wait for it tears down underneath it.
  let finished = false
  const { tick } = clock([
    {
      name: 'slow sweep',
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        finished = true
      },
    },
  ])
  const turn = tick.tick()
  await tick.stop()
  assert.equal(finished, true, 'stop resolved only once the sweep had finished')
  await turn
})

test('a firing that lands mid-turn still counts, so one slow job cannot stretch every other cadence', async () => {
  // #1607: a cadence was measured in turns that *ran*, and a firing arriving mid-turn joined the
  // one in flight without being counted anywhere. A job that blocked for minutes — the case seen
  // live was a data sync failing slowly against an unreachable remote — therefore pushed every
  // other `every: N` job out by its own duration: a ten-minute pass came round every twenty-six.
  let rare = 0
  let slowTurns = 0
  let releaseSlow = (): void => {}
  const blocked = new Promise<void>(resolve => {
    releaseSlow = resolve
  })
  const tick = startDaemonTick({
    intervalMs: 5,
    log: () => {},
    jobs: [
      { name: 'rare', every: 5, run: async () => void rare++ },
      { name: 'slow', run: async () => void (slowTurns++ === 0 && (await blocked)) },
    ],
  })
  try {
    // The constructor's tick 0: `rare` takes its start-up turn, then `slow` holds the turn open.
    const turn0 = tick.tick()
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(rare, 1, 'only the start-up turn so far — the clock is still inside tick 0')

    // ~10 firings came round at 5ms apart while that one turn was in flight.
    releaseSlow()
    await turn0
    await tick.tick()

    // Well past tick 5, so `rare` is due now — not five *further* turns from now, which is what
    // counting only the turns that ran used to mean.
    assert.equal(rare, 2, 'the firings that landed mid-turn counted towards the cadence')
    // And each job took exactly one further turn: the ones they missed are skipped, never queued
    // up to be worked through one after another.
    assert.equal(slowTurns, 2, 'one further turn, not one per firing that was missed')
  } finally {
    // Before `stop()`, which waits out the turn in flight: a turn still blocked here would
    // deadlock the shutdown rather than fail the assertion above.
    releaseSlow()
    await tick.stop()
  }
})
