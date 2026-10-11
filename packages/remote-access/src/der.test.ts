import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { alternativeName, der, oid } from './der.js'

// Checked against bytes worked out by hand, not against the writer itself.

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex')

test('a length is written short below 128 and long from there', () => {
  assert.equal(hex(der(0x04, Buffer.alloc(3, 1))), '0403010101')
  assert.equal(hex(der(0x04, Buffer.alloc(127))).slice(0, 4), '047f')
  assert.equal(hex(der(0x04, Buffer.alloc(128))).slice(0, 6), '048180')
  assert.equal(hex(der(0x04, Buffer.alloc(256))).slice(0, 8), '04820100')
})

test('an object identifier is written from its dotted form', () => {
  assert.equal(hex(oid('2.5.29.17')), '0603551d11')
  assert.equal(hex(oid('1.2.840.10045.4.3.2')), '06082a8648ce3d040302')
  assert.equal(hex(oid('1.2.840.113549.1.9.14')), '06092a864886f70d01090e')
})

test('the name a certificate is for: an IPv4 number, an IPv6 number in any short form, a name', () => {
  assert.equal(hex(alternativeName('203.0.113.5')), '30068704cb007105')
  assert.equal(hex(alternativeName('2001:db8::1')), '3012871020010db8000000000000000000000001')
  assert.equal(hex(alternativeName('::1')), '3012871000000000000000000000000000000001')
  assert.equal(hex(alternativeName('fe80::')), '30128710fe800000000000000000000000000000')
  assert.equal(hex(alternativeName('1:2:3:4:5:6:7:8')), '3012871000010002000300040005000600070008')
  assert.equal(hex(alternativeName('a.io')), '30068204612e696f')
})
