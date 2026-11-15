import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { nameOf } from './names.js'

test('a person is a name in any language, spaces made one; a name with nothing but letters, digits, spaces, dots, apostrophes and dashes', () => {
  assert.deepEqual(['Rom', ' Rom  Brillout ', 'רום', "Dani O'Neil", 'José', 'a'.repeat(40)].map(nameOf), ['Rom', 'Rom Brillout', 'רום', "Dani O'Neil", 'José', 'a'.repeat(40)])
  assert.deepEqual(['-rom', 'a'.repeat(41), 'rom\nx', 'rom/x', '<rom>', ''].map(nameOf), [undefined, undefined, undefined, undefined, undefined, undefined])
})
