import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { deviceName } from './device-name.js'

test('a device is named by its kind and its browser', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone, Safari')
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1'), 'iPhone, Chrome')
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'), 'Android phone, Chrome')
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), 'Android tablet, Chrome')
  assert.equal(deviceName('Mozilla/5.0 (Android 15; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0'), 'Android phone, Firefox')
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), 'Mac, Safari')
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), 'Windows, Edge')
  assert.equal(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Linux, Firefox')
})

test('a browser that says nothing known is still a device', () => {
  assert.equal(deviceName(undefined), 'A device')
  assert.equal(deviceName('curl/8.7.1'), 'A device')
  assert.equal(deviceName('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'iPad')
})
