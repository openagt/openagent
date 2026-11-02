import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  PACKAGE_NAME,
  checkForUpdate,
  compareVersions,
  formatUpdateStatus,
  type VersionFetcher,
} from './update-check.js'

/** A {@link VersionFetcher} that always resolves `latest`, never hitting the network. */
function fakeFetcher(latest: string | undefined): VersionFetcher {
  return async () => latest
}

test('compareVersions: equal versions -> 0', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('compareVersions: 1.9.0 vs 1.10.0 compares numerically, not as strings', () => {
  assert.ok(compareVersions('1.9.0', '1.10.0') < 0)
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0)
})

test('compareVersions: 2.0.0 vs 1.9.9 -> positive', () => {
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0)
})

test('compareVersions: prerelease/build suffix is stripped', () => {
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.3+build.5', '1.2.3'), 0)
})

test('compareVersions: missing parts read as 0', () => {
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  assert.ok(compareVersions('1.2', '1.2.1') < 0)
})

test('checkForUpdate: same version -> up-to-date', async () => {
  const status = await checkForUpdate('1.2.3', fakeFetcher('1.2.3'))
  assert.deepEqual(status, { kind: 'up-to-date', current: '1.2.3' })
})

test('checkForUpdate: higher latest -> update-available with latest', async () => {
  const status = await checkForUpdate('1.2.3', fakeFetcher('1.3.0'))
  assert.deepEqual(status, { kind: 'update-available', current: '1.2.3', latest: '1.3.0' })
})

test('checkForUpdate: lower latest (local build ahead) -> up-to-date', async () => {
  const status = await checkForUpdate('2.0.0', fakeFetcher('1.9.9'))
  assert.deepEqual(status, { kind: 'up-to-date', current: '2.0.0' })
})

test('checkForUpdate: fetcher returns undefined -> unknown', async () => {
  const status = await checkForUpdate('1.2.3', fakeFetcher(undefined))
  assert.deepEqual(status, { kind: 'unknown', current: '1.2.3' })
})

test('checkForUpdate: passes the package name to the fetcher (default + override)', async () => {
  const seen: string[] = []
  const spy: VersionFetcher = async pkg => {
    seen.push(pkg)
    return '1.0.0'
  }
  await checkForUpdate('1.0.0', spy)
  await checkForUpdate('1.0.0', spy, 'some-other-pkg')
  assert.deepEqual(seen, [PACKAGE_NAME, 'some-other-pkg'])
})

test('formatUpdateStatus: up-to-date line', () => {
  assert.equal(formatUpdateStatus({ kind: 'up-to-date', current: '1.2.3' }), '✅ Up to date (v1.2.3)')
})

test('formatUpdateStatus: update-available line', () => {
  assert.equal(
    formatUpdateStatus({ kind: 'update-available', current: '1.2.3', latest: '1.3.0' }),
    `⬆️  Update available: v1.3.0 (you have v1.2.3). Run: npm i -g ${PACKAGE_NAME}`,
  )
})

test('formatUpdateStatus: unknown -> undefined (print nothing)', () => {
  assert.equal(formatUpdateStatus({ kind: 'unknown', current: '1.2.3' }), undefined)
})
