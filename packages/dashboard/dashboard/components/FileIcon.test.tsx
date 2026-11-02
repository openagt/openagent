import { expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { FileIcon, iconOf } from './FileIcon.js'

test('a file’s icon is by its whole name first, then its longest extension, else the plain file', () => {
  expect(iconOf('package.json')).toBe('nodejs')
  expect(iconOf('web/README.md')).toBe('readme')
  expect(iconOf('src/app.ts')).toBe('typescript')
  expect(iconOf('src/types.d.ts')).not.toBe('typescript')
  expect(iconOf('notes.MD')).toBe('markdown')
  expect(iconOf('LICENSE')).toBe('license')
  expect(iconOf('data.unknownkind')).toBe('file')
  expect(iconOf('Makefile')).toBe(iconOf('makefile'))
})

test('an icon with a light variant has one picture per theme', () => {
  const { container } = render(<FileIcon path="pnpm-lock.yaml" />)
  const pictures = [...container.querySelectorAll('span[aria-hidden]')]
  expect(pictures).toHaveLength(2)
  expect(pictures[0]!.className).toContain('dark:hidden')
  expect(pictures[1]!.className).toContain('dark:inline-flex')
  expect(render(<FileIcon path="a.ts" />).container.querySelectorAll('span[aria-hidden] svg')).toHaveLength(1)
})
