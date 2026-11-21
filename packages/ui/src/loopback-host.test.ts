import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isLoopbackHost, hostnameFromHostHeader } from './loopback-host.js'

test('the names and addresses that reach this machine without leaving it are local', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, host)
  }
})

test('the whole 127.0.0.0/8 range is local, not just the first address', () => {
  // A daemon bound anywhere in the range is still only reachable from this machine. The dashboard
  // kept a copy that compared against `127.0.0.1` alone, so it called these remote.
  for (const host of ['127.0.0.2', '127.1.2.3', '127.255.255.255']) {
    assert.equal(isLoopbackHost(host), true, host)
  }
})

test('a name that merely starts with 127. is not local — that is the rebound host', () => {
  // The DNS-rebinding case the guard exists for: `127.evil.com` resolves to 127.0.0.1, so a
  // prefix test would let it through. Bind-all and routable addresses are not local either.
  for (const host of ['127.evil.com', '127.0.0.1.evil.com', '0.0.0.0', '::', '10.0.0.5', '']) {
    assert.equal(isLoopbackHost(host), false, host)
  }
})

test('a Host header is read without its port, and an IPv6 literal keeps its brackets', () => {
  assert.equal(hostnameFromHostHeader('127.0.0.1:4200'), '127.0.0.1')
  assert.equal(hostnameFromHostHeader('localhost'), 'localhost')
  // Splitting on the first colon would mangle this into `[`.
  assert.equal(hostnameFromHostHeader('[::1]:4200'), '[::1]')
  assert.equal(hostnameFromHostHeader('[::1]'), '[::1]')
})
