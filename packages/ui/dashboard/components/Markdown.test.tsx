import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { UiMarkdownProps } from '@openagt/hooks/ui'
import { InlineMarkdown, Markdown, ModuleBlock } from './Markdown.js'
import { ModulesContext, mountedOf } from '../lib/use-modules.js'

afterEach(cleanup)

/** A module's markdown, as a test draws it: the text, and how it was asked to be set. */
const Drawn = ({ text, look = 'chat', fade = false }: UiMarkdownProps) => (
  <output data-look={look} data-fade={String(fade)}>
    {text}
  </output>
)
const withMarkdown = (node: ReactNode, computer = true) =>
  render(
    <ModulesContext.Provider value={mountedOf({ renders: [{ kind: 'markdown', Render: Drawn, package: '@acme/markdown', projects: [], ...(computer ? { computer: true as const } : {}) }] })}>
      {node}
    </ModulesContext.Provider>,
  )
const drawn = () => [...document.querySelectorAll('output')].map(each => [each.textContent, each.dataset['look'], each.dataset['fade']])

describe('a text in markdown (#2394: the shell draws no kind of content itself)', () => {
  test('where no module draws markdown, it is the text as written, its lines kept', () => {
    const { container } = render(<Markdown text={'# Title\n\n- **one**'} />)
    expect(container.querySelector('[data-markdown]')!.textContent).toBe('# Title\n\n- **one**')
    expect(container.querySelector('[data-markdown]')!.className).toContain('whitespace-pre-wrap')
    cleanup()
    const inline = render(
      <p>
        <InlineMarkdown text="Run `pnpm install`." />
      </p>,
    )
    expect(inline.container.querySelector('p')!.innerHTML).toBe('Run `pnpm install`.')
  })

  test('while the modules are still coming, a text is not drawn yet: never as written first, then drawn', () => {
    const coming = render(
      <ModulesContext.Provider value={mountedOf({ loaded: false })}>
        <Markdown text={'# Title'} />
      </ModulesContext.Provider>,
    )
    expect(coming.container.textContent).toBe('')
    cleanup()
    const come = render(
      <ModulesContext.Provider value={mountedOf({ loaded: true })}>
        <Markdown text={'# Title'} />
      </ModulesContext.Provider>,
    )
    expect(come.container.querySelector('[data-markdown]')!.textContent).toBe('# Title')
  })

  test("a module of the computer's that draws markdown draws it on every page, given the text and how it is set", () => {
    withMarkdown(
      <>
        <Markdown text="a ticket" look="page" />
        <Markdown text="being written" fade />
        <InlineMarkdown text="a line" />
      </>,
    )
    expect(drawn()).toEqual([
      ['a ticket', 'page', 'false'],
      ['being written', 'chat', 'true'],
      ['a line', 'inline', 'false'],
    ])
  })

  test("a project's module that draws markdown does not draw it on a page of no project", () => {
    withMarkdown(<Markdown text="hello" />, false)
    expect(drawn()).toEqual([])
    expect(document.querySelector('[data-markdown]')!.textContent).toBe('hello')
  })
})

describe('a fenced block another module draws (ui.render)', () => {
  const Diagram = ({ content }: { content: string }) => <figure aria-label="diagram">{content}</figure>
  const modules = mountedOf({
    renders: [
      { kind: 'mermaid', Render: Diagram, package: 'mermaid', projects: ['p1'] },
      { kind: 'await-choices', package: 'ask', projects: ['p1'] },
    ],
  })
  const block = (language: string) =>
    render(
      <ModulesContext.Provider value={modules}>
        <ModuleBlock language={language} content="graph TD" otherwise={<pre>as code</pre>} />
      </ModulesContext.Provider>,
    )

  test("a block of a language a module draws is the module's; one a module shows elsewhere, or that none draws, is drawn otherwise", () => {
    block('mermaid')
    expect(screen.getByRole('figure', { name: 'diagram' }).textContent).toBe('graph TD')
    cleanup()
    block('await-choices')
    expect(document.querySelector('pre')!.textContent).toBe('as code')
    cleanup()
    block('ts')
    expect(document.querySelector('pre')!.textContent).toBe('as code')
  })

  test('a block named for a kind of content of its own (markdown, a question) is never a module text', () => {
    render(
      <ModulesContext.Provider value={mountedOf({ renders: [{ kind: 'markdown', Render: Drawn, package: '@acme/markdown', projects: [], computer: true }] })}>
        <ModuleBlock language="markdown" content="# Title" otherwise={<pre>as code</pre>} />
      </ModulesContext.Provider>,
    )
    expect(document.querySelector('pre')!.textContent).toBe('as code')
  })
})
