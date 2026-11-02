import { expect, test } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { languageOf, useHighlighted } from './highlight.js'

test('a file’s language is read from its extension, or from its whole name', () => {
  expect(languageOf('src/app.ts')).toBe('typescript')
  expect(languageOf('web/App.TSX')).toBe('tsx')
  expect(languageOf('Dockerfile')).toBe('docker')
  expect(languageOf('notes.txt')).toBeUndefined()
  expect(languageOf('LICENSE')).toBeUndefined()
})

test('a file’s lines come back in pieces, each with its colour in the light theme and in the dark one', async () => {
  const { result } = renderHook(() => useHighlighted('const a = 1\nexport default a', 'a.ts'))
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
  const lines = result.current!
  expect(lines).toHaveLength(2)
  expect(lines[0]!.map(piece => piece.text).join('')).toBe('const a = 1')
  const keyword = lines[0]!.find(piece => piece.text === 'const')!
  expect(keyword.light).toMatch(/^#/)
  expect(keyword.dark).toMatch(/^#/)
  expect(keyword.light).not.toBe(keyword.dark)
})

test('a file of no language listed, and one too long to colour at once, stay plain', async () => {
  const plain = renderHook(() => useHighlighted('hello', 'notes.txt'))
  const long = renderHook(() => useHighlighted('x'.repeat(300_000), 'big.ts'))
  // Once a file asked for after them is coloured, these two would have been too.
  const colored = renderHook(() => useHighlighted('let b = 2', 'b.ts'))
  await waitFor(() => expect(colored.result.current).not.toBeNull(), { timeout: 5000 })
  expect(plain.result.current).toBeNull()
  expect(long.result.current).toBeNull()
})
