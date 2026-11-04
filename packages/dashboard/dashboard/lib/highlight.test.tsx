import { expect, test } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { languageOf, useHighlighted, useHighlightedIn, type Piece } from './highlight.js'

test('a file’s language is read from its extension, or from its whole name', () => {
  expect(languageOf('src/app.ts')).toBe('typescript')
  expect(languageOf('web/App.TSX')).toBe('tsx')
  expect(languageOf('Dockerfile')).toBe('docker')
  expect(languageOf('notes.txt')).toBeUndefined()
  expect(languageOf('LICENSE')).toBeUndefined()
})

test('a file’s lines come back in pieces, each the kind of word it is', async () => {
  const { result } = renderHook(() => useHighlighted('const a = 1\nexport default a', 'a.ts'))
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
  const lines = result.current!
  expect(lines).toHaveLength(2)
  expect(lines[0]!.map(piece => piece.text).join('')).toBe('const a = 1')
  expect(lines[0]!.find(piece => piece.text === 'const')!.kind).toBe('keyword')
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

/** Each piece's text, trimmed, with its kind. */
const kinds = (lines: Piece[][]) => new Map(lines.flat().filter(piece => piece.text.trim() !== '').map(piece => [piece.text.trim(), piece.kind]))

test('code is told apart by kind of word: commands, their arguments and strings, keywords, numbers…', async () => {
  const shell = renderHook(() => useHighlightedIn('grep -rn "TODO" src/ | wc -l\nhead -n 5', 'shellscript'))
  await waitFor(() => expect(shell.result.current).not.toBeNull(), { timeout: 5000 })
  const sh = kinds(shell.result.current!)
  expect(sh.get('grep')).toBe('function')
  expect(sh.get('wc')).toBe('function')
  expect(sh.get('-rn')).toBe('string')
  expect(sh.get('"TODO"')).toBe('string')
  expect(sh.get('|')).toBe('operator')
  expect(sh.get('5')).toBe('number')

  const ts = renderHook(() => useHighlightedIn('// retry\nconst config = { retries: 3 }\nfunction canRetry(attempt: number): boolean | null {\n  return true\n}', 'typescript'))
  await waitFor(() => expect(ts.result.current).not.toBeNull(), { timeout: 5000 })
  const t = kinds(ts.result.current!)
  expect(t.get('// retry')).toBe('comment')
  expect(t.get('const')).toBe('keyword')
  expect(t.get('retries')).toBe('property')
  expect(t.get('canRetry')).toBe('function')
  expect(t.get('attempt')).toBe('parameter')
  expect(t.get('number')).toBe('type')
  expect(t.get('true')).toBe('number')
})

test('markup and styles are told apart as Claude Code on the web tells them: a tag as a property, an attribute its own, a number with its unit and a colour with its # as one', async () => {
  const { result } = renderHook(() => useHighlighted('grep -rn x', 'run.sh'))
  await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
  expect(kinds(result.current!).get('grep')).toBe('function')

  const html = renderHook(() => useHighlighted('<meta charset="UTF-8">\n<style>\n  h1 { margin: 0 0 1rem; color: #f8fafc; width: 100%; }\n</style>', 'index.html'))
  await waitFor(() => expect(html.result.current).not.toBeNull(), { timeout: 5000 })
  const h = kinds(html.result.current!)
  expect(h.get('meta')).toBe('property')
  expect(h.get('charset')).toBe('attribute')
  expect(h.get('margin')).toBe('property')
  // A number with its unit, and a colour with its #, are one teal word.
  for (const value of ['1rem', '#f8fafc', '100%']) expect(h.get(value), value).toBe('number')
})
