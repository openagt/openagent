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

/** Each piece's text, trimmed, with its colour in the dark theme and the light one. */
const colours = (lines: Piece[][]) => new Map(lines.flat().filter(piece => piece.text.trim() !== '').map(piece => [piece.text.trim(), [piece.dark?.toLowerCase(), piece.light?.toLowerCase()]]))

test('code is drawn in one hue per kind of word: commands blue, their arguments and strings green', async () => {
  const shell = renderHook(() => useHighlightedIn('grep -rn "TODO" src/ | wc -l\nhead -n 5', 'shellscript'))
  await waitFor(() => expect(shell.result.current).not.toBeNull(), { timeout: 5000 })
  const sh = colours(shell.result.current!)
  expect(sh.get('grep')).toEqual(['#70b8ff', '#0051c2'])
  expect(sh.get('wc')).toEqual(['#70b8ff', '#0051c2'])
  expect(sh.get('-rn')).toEqual(['#9be963', '#008000'])
  expect(sh.get('"TODO"')).toEqual(['#9be963', '#008000'])
  expect(sh.get('|')).toEqual(['#eaecf0', '#14181f'])
  expect(sh.get('5')).toEqual(['#5eeded', '#008080'])

  const ts = renderHook(() => useHighlightedIn('// retry\nconst config = { retries: 3 }\nfunction canRetry(attempt: number): boolean | null {\n  return true\n}', 'typescript'))
  await waitFor(() => expect(ts.result.current).not.toBeNull(), { timeout: 5000 })
  const t = colours(ts.result.current!)
  expect(t.get('// retry')).toEqual(['#818898', '#6e7687'])
  expect(t.get('const')).toEqual(['#cc7bf4', '#8100c2'])
  expect(t.get('retries')).toEqual(['#f47b85', '#b80a18'])
  expect(t.get('canRetry')).toEqual(['#70b8ff', '#0051c2'])
  expect(t.get('attempt')).toEqual(['#f7ab5f', '#b84f05'])
  expect(t.get('number')).toEqual(['#fbad60', '#b34a00'])
  expect(t.get('true')).toEqual(['#5eeded', '#008080'])
})

test('a file is drawn in the same colours as the chat; markup and styles as Claude Code on the web draws them', async () => {
  const { result } = renderHook(() => useHighlighted('grep -rn x', 'run.sh'))
  await waitFor(() => expect(result.current).not.toBeNull(), { timeout: 5000 })
  expect(colours(result.current!).get('grep')).toEqual(['#70b8ff', '#0051c2'])

  const html = renderHook(() => useHighlighted('<meta charset="UTF-8">\n<style>\n  h1 { margin: 0 0 1rem; color: #f8fafc; width: 100%; }\n</style>', 'index.html'))
  await waitFor(() => expect(html.result.current).not.toBeNull(), { timeout: 5000 })
  const h = colours(html.result.current!)
  expect(h.get('meta')).toEqual(['#f47b85', '#b80a18'])
  expect(h.get('charset')).toEqual(['#f0757f', '#bd0f1e'])
  expect(h.get('margin')).toEqual(['#f47b85', '#b80a18'])
  // A number with its unit, and a colour with its #, are one teal word.
  for (const value of ['1rem', '#f8fafc', '100%']) expect(h.get(value), value).toEqual(['#5eeded', '#008080'])
})
