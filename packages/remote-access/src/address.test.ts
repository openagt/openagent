import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { NetworkInterfaceInfo } from 'node:os'
import { nameAddress, numberAddress, onOwnNetwork, plainAddress, urlHost, type AddressDeps } from './address.js'

const v4 = (address: string, cidr: string, internal = false): NetworkInterfaceInfo => ({ address, netmask: '', family: 'IPv4', mac: '', internal, cidr })
const v6 = (address: string, cidr: string, internal = false): NetworkInterfaceInfo => ({ address, netmask: '', family: 'IPv6', mac: '', internal, cidr, scopeid: 0 })

/** A laptop on a home Wi-Fi, with an address the whole internet could reach beside it. */
const HOME: AddressDeps = {
  interfaces: () => ({
    lo0: [v4('127.0.0.1', '127.0.0.1/8', true), v6('::1', '::1/128', true)],
    en0: [v6('fe80::c9e:d2c3:804a:1cbe', 'fe80::c9e:d2c3:804a:1cbe/64'), v4('192.168.1.23', '192.168.1.23/24'), v6('2a02:6680:2105:49d7::1aa4', '2a02:6680:2105:49d7::1aa4/64')],
    utun3: [v4('169.254.10.9', '169.254.10.9/16')],
  }),
  hostname: () => 'Adas-MacBook.local',
}

test('the number is the first address a network handed out', () => {
  assert.equal(numberAddress(HOME), '192.168.1.23')
  assert.equal(numberAddress({ interfaces: () => ({ lo0: [v4('127.0.0.1', '127.0.0.1/8', true)] }) }), undefined, 'a computer on no network has none')
})

test('the name is taken only when it answers with one of this computer\'s own addresses', async () => {
  assert.equal(await nameAddress({ ...HOME, lookup: async name => (name === 'adas-macbook.local' ? ['192.168.1.23'] : []) }), 'adas-macbook.local')
  assert.equal(await nameAddress({ ...HOME, lookup: async () => ['fe80::c9e:d2c3:804a:1cbe%en0'] }), 'adas-macbook.local', 'an address with its zone is the same address')
  assert.equal(await nameAddress({ ...HOME, lookup: async () => ['192.168.1.99'] }), undefined, 'a name another machine holds')
  assert.equal(await nameAddress({ ...HOME, lookup: async () => Promise.reject(new Error('ENOTFOUND')) }), undefined)
  assert.equal(await nameAddress({ ...HOME, hostname: () => 'devbox', lookup: async name => (name === 'devbox.local' ? ['192.168.1.23'] : []) }), 'devbox.local', 'a bare host name is asked under .local')
  assert.equal(await nameAddress({ ...HOME, hostname: () => 'box.example.com', lookup: async () => ['192.168.1.23'] }), undefined, 'a name of the internet is not a name on the Wi-Fi')
})

test('a name nobody answers to does not hold the answer up', async () => {
  const started = Date.now()
  assert.equal(await nameAddress({ ...HOME, lookup: () => new Promise(() => {}) }), undefined)
  assert.ok(Date.now() - started < 4_000)
})

test('only an address on one of this computer\'s own networks may knock', () => {
  assert.equal(onOwnNetwork('192.168.1.50', HOME), true, 'a phone on the same Wi-Fi')
  assert.equal(onOwnNetwork('::ffff:192.168.1.50', HOME), true, 'the same phone as an IPv6 socket names it')
  assert.equal(onOwnNetwork('fe80::1%en0', HOME), true)
  assert.equal(onOwnNetwork('2a02:6680:2105:49d7::77', HOME), true, 'a phone on the same network by its IPv6 address')
  assert.equal(onOwnNetwork('127.0.0.1', HOME), true, 'this computer itself')
  assert.equal(onOwnNetwork('::1', HOME), true)
  assert.equal(onOwnNetwork('192.168.2.50', HOME), false, 'another network')
  assert.equal(onOwnNetwork('8.8.8.8', HOME), false, 'the internet')
  assert.equal(onOwnNetwork('2a02:6680:2105:aaaa::1', HOME), false, 'the internet, by IPv6')
  assert.equal(onOwnNetwork(undefined, HOME), false)
  assert.equal(onOwnNetwork('not an address', HOME), false)
})

test('addresses are read without their zone and unmapped, and written into a URL with brackets for IPv6', () => {
  assert.equal(plainAddress('fe80::1%en0'), 'fe80::1')
  assert.equal(plainAddress('::ffff:10.0.0.5'), '10.0.0.5')
  assert.equal(urlHost('fe80::1'), '[fe80::1]')
  assert.equal(urlHost('192.168.1.23'), '192.168.1.23')
  assert.equal(urlHost('adas-macbook.local'), 'adas-macbook.local')
})
