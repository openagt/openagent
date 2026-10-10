import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { provideTestContext } from './test-context.js'
import { dispatchRelayRpc, RELAY_RPC_NAMES } from './relay-dispatch.js'

// The machine-side whitelist dispatcher (#1067 slice 2): a daemon that relayed an agent here calls one of a
// fixed set of run-scoped RPCs against this machine's own copy of the project the call named. These assert the whitelist is
// exactly the run-scoped read/steer/handoff surface (and excludes start/delete), and that an unknown
// name is refused. The real HTTP round-trip through /_relay/rpc is in remote-run.integration.test.ts.

test('RELAY_RPC_NAMES is the run-scoped read/steer/handoff surface and excludes start/delete (#1067 slice 2)', () => {
  for (const name of [
    'onProjectFiles', 'readModule',
    'onGitStatus', 'onAgentWorktree', 'onAgentHandoff', 'onAgent',
    'sendStop', 'sendChoice', 'sendMessage', 'sendOpenPullRequest', 'sendPush', 'sendMerge',
  ]) {
    assert.ok(RELAY_RPC_NAMES.includes(name), `expected ${name} on the relay whitelist`)
  }
  // Starting an agent, deleting a session, and removing a worktree are NOT relayable: a machine runs its
  // own guarded start, and destroying history/checkouts is not something a relaying daemon may reach.
  // A module's command may write the project's data, so only its reads are relayable (#1774).
  for (const off of ['sendStart', 'sendDeleteAgent', 'sendRemoveWorktree', 'sendPreview', 'runModuleCommand']) {
    assert.ok(!RELAY_RPC_NAMES.includes(off), `${off} must not be relayable`)
  }
})

test('dispatchRelayRpc rejects an unknown rpc name (#1067 slice 2)', async () => {
  await assert.rejects(dispatchRelayRpc('home', 'sendStart', ['pid']), /unknown relay rpc/)
  await assert.rejects(dispatchRelayRpc('home', 'nope', []), /unknown relay rpc/)
})

test('dispatchRelayRpc runs a whitelisted rpc against the project id it is given and returns its empty shape (#1067 slice 2)', async () => {
  // No project is registered under this id, so onGitStatus resolves no checkout and returns null - proof
  // the call reached the whitelisted impl with that id (the caller's arg[0] project id is dropped).
  provideTestContext()
  const result = await dispatchRelayRpc('openagent:no-such-home', 'onGitStatus', ['remote-project-id', 'run-1'])
  assert.equal(result, null)
})
