import { describe, expect, test } from 'vitest'
import { promptWithContext } from './use-context-set.js'

describe('promptWithContext (#439)', () => {
  test('no Context leaves the prompt as typed', () => {
    expect(promptWithContext('/research src ', [])).toBe('/research src ')
  })

  test('the Context is one line at the end, so a command still leads the prompt', () => {
    expect(promptWithContext('/research src \n', new Set(['/repos/other', 'README.md']))).toBe('/research src\n\nContext: /repos/other, README.md')
  })
})
