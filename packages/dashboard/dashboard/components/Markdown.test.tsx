import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FileLinks, IssueLinks, Markdown } from './Markdown.js'

afterEach(cleanup)

// #869 + #948: the dependency-free renderer grew pipe tables and links without giving up
// the no-injected-HTML property.
describe('Markdown tables (#869)', () => {
  test('a pipe table renders as a real table', () => {
    render(<Markdown text={'| col a | col b |\n| --- | --- |\n| one | two |'} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'col a' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'two' })).toBeTruthy()
  })

  test('pipes without a separator row stay prose, not a mangled table', () => {
    render(<Markdown text={'| just | pipes |\n| in prose |'} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('| just | pipes |')).toBeTruthy()
  })

  test('a short row leaves its missing cells empty instead of collapsing the column', () => {
    render(<Markdown text={'| a | b |\n| --- | --- |\n| only |'} />)
    expect(screen.getAllByRole('cell')).toHaveLength(2)
  })

  test("a reply's table being written fades its words in with the rest of the message", () => {
    render(<Markdown text={'| col a | col b |\n| --- | --- |\n| one | two |'} fade />)
    expect(screen.getByRole('cell', { name: 'two' }).querySelector('.word-in')?.textContent).toBe('two')
  })
})

describe('Markdown links (#948)', () => {
  test('[text](url) renders an anchor', () => {
    render(<Markdown text={'See [the PR](https://github.com/x/y/pull/1) for detail'} />)
    const a = screen.getByRole('link', { name: 'the PR' })
    expect(a.getAttribute('href')).toBe('https://github.com/x/y/pull/1')
    expect(a.getAttribute('rel')).toContain('noreferrer')
  })

  test('a bare URL autolinks', () => {
    render(<Markdown text={'Deployed at https://example.com/app now'} />)
    expect(screen.getByRole('link', { name: 'https://example.com/app' })).toBeTruthy()
  })

  test('a link to a file path is the file\'s name as code, with the path on hover, and no link', () => {
    render(<Markdown text={'Added [PROJECT.md](/Users/me/repo/PROJECT.md) and [the test](src/a.test.ts).'} />)
    expect(screen.queryByRole('link')).toBeNull()
    const name = screen.getByText('PROJECT.md')
    expect(name.tagName).toBe('CODE')
    expect(name.getAttribute('title')).toBe('/Users/me/repo/PROJECT.md')
    expect(screen.getByText('the test').getAttribute('title')).toBe('src/a.test.ts')
    expect(document.body.textContent).toContain('Added PROJECT.md and the test.')
  })

  test('a javascript: target stays plain text', () => {
    render(<Markdown text={'[click](javascript:alert(1))'} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.body.textContent).toContain('[click](javascript:alert(1))')
  })

  test('a URL inside backticks stays literal code', () => {
    render(<Markdown text={'run `curl https://example.com` locally'} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('curl https://example.com')).toBeTruthy()
  })
})

// `compact` shrinks the renderer a notch so a reply reads at the density of the event log.
describe('Markdown compact', () => {
  test('the body renders at text-xs', () => {
    const { container } = render(<Markdown text="hello" compact />)
    expect(container.querySelector('.text-xs')).toBeTruthy()
  })

  test('a heading is smaller than its full-size counterpart', () => {
    const { unmount } = render(<Markdown text={'# Section'} compact />)
    expect(screen.getByText('Section').className).toContain('text-sm')
    unmount()
    render(<Markdown text={'# Section'} />)
    expect(screen.getByText('Section').className).toContain('text-[17px]')
  })

  test("in a reply, headings are medium, not bold, and a nested bullet list is circles; a done task is struck through", () => {
    const { container } = render(<Markdown text={'# Title\n\n## Part\n\n- one\n  - inner\n\n- [x] done\n- [ ] todo'} />)
    expect(screen.getByText('Title').className).toContain('font-medium')
    expect(screen.getByText('Part').className).not.toContain('font-semibold')
    expect(container.querySelector('ul ul')!.className).toContain('list-[circle]')
    expect(screen.getByText('done').className).toContain('line-through')
    expect(screen.getByText('todo').className ?? '').not.toContain('line-through')
  })
})

// What an agent's answer is made of beyond paragraphs: each of these used to print its own
// Markdown signs (`1.`, `>`, the backticks inside bold) as text.
describe('Markdown lists', () => {
  test('numbered lines are one numbered list, also with blank lines between them', () => {
    render(<Markdown text={'Steps:\n\n1. read\n\n2. write\n\n3. check\n\nDone.'} />)
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(1)
    expect(lists[0]!.tagName).toBe('OL')
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['read', 'write', 'check'])
    expect(screen.getByText('Done.').tagName).toBe('P')
  })

  test('a list in a message is set as Claude Code sets one: its words 35px in, 3px between two items, 21px under it before what follows', () => {
    render(<Markdown text={'Kept:\n\n- a\n- b\n\nAfter.'} />)
    const list = screen.getByRole('list')
    for (const look of ['ml-7', '[&>li]:pl-[7px]', 'space-y-[3px]', '[&:not(:last-child)]:mb-[21px]']) expect(list.className.split(' ')).toContain(look)
  })

  test('a numbered list keeps the number it starts at', () => {
    render(<Markdown text={'3. third\n4. fourth'} />)
    expect(screen.getByRole('list').getAttribute('start')).toBe('3')
  })

  test('a list under an item is drawn inside that item', () => {
    render(<Markdown text={'- skills:\n  - tickets\n  - queue\n- hooks'} />)
    const [outer, inner] = screen.getAllByRole('list')
    expect(outer!.children).toHaveLength(2)
    expect(inner!.parentElement).toBe(outer!.children[0])
    expect(Array.from(inner!.children).map(li => li.textContent)).toEqual(['tickets', 'queue'])
  })

  test('numbers under a bullet are a numbered list inside it', () => {
    render(<Markdown text={'- first\n  1. one\n  2. two'} />)
    const [outer, inner] = screen.getAllByRole('list')
    expect(outer!.tagName).toBe('UL')
    expect(inner!.tagName).toBe('OL')
  })

  test('bullets after numbers are a list of their own', () => {
    render(<Markdown text={'1. one\n2. two\n- a bullet'} />)
    expect(screen.getAllByRole('list').map(list => list.tagName)).toEqual(['OL', 'UL'])
  })

  test('a code block under an item stays in the item', () => {
    render(<Markdown text={'1. run it:\n   ```\n   npm test\n   ```\n2. read the output'} />)
    expect(screen.getAllByRole('list')).toHaveLength(1)
    expect(screen.getByText('npm test').closest('li')).toBe(screen.getAllByRole('listitem')[0])
  })

  test('a code block under an item is the item\'s up to its closing fence, however it is indented', () => {
    // The code at the left edge, with a line that looks like an item, and the closing fence there too.
    render(<Markdown text={'1. Changed the title:\n   ```diff\n-<title>Hello</title>\n- one more\n```\n2. Next step\n\nAll done.\n\n```\nlater\n```'} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector('pre')!.textContent).toBe('-<title>Hello</title>\n- one more')
    expect(items[1]!.textContent).toBe('Next step')
    expect(screen.getByText('All done.').tagName).toBe('P')
    expect(screen.getByText('later').closest('pre')).toBeTruthy()
  })

  test('code under an item keeps its shape, whatever its indent against the fence', () => {
    render(<Markdown text={'1. Changed:\n   ```js\nfunction f() {\n  if (x) {\n\treturn 1\n  }\n}\n   ```\n2. next'} />)
    expect(document.querySelector('pre')!.textContent).toBe('function f() {\n  if (x) {\n\treturn 1\n  }\n}')
    cleanup()
    // Indented with its fence: the indent they share is cut, a diff's unchanged lines keep their own space.
    render(<Markdown text={'- the diff:\n  ```diff\n   same\n  -old\n  +new\n  ```'} />)
    expect(document.querySelector('pre')!.textContent).toBe(' same\n-old\n+new')
  })

  test('a code block is a card with no strip naming its language, its lines wrapped, and a copy button that takes the code', async () => {
    const written: string[] = []
    Object.assign(navigator, { clipboard: { writeText: (text: string) => { written.push(text); return Promise.resolve() } } })
    render(<Markdown text={'```bash\nnpm test\n```'} />)
    expect(screen.queryByText('bash')).toBeNull()
    expect(document.querySelector('pre')!.className).toContain('whitespace-pre-wrap')
    fireEvent.click(screen.getByRole('button', { name: 'Copy the code' }))
    await waitFor(() => expect(written).toEqual(['npm test']))
  })

  test('a closing fence written at the left edge leaves the code as it is under a well-closed one', () => {
    render(<Markdown text={'1. run:\n   ```bash\n   npm test\n   npm run build\n```\n2. next'} />)
    expect(document.querySelector('pre')!.textContent).toBe('npm test\nnpm run build')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  test('a code block after a list inside a list is the outer item\'s, not the last inner item\'s', () => {
    render(<Markdown text={'- a\n  - b\n  ```\ncode\n  ```\n- d'} />)
    const [outer, inner] = screen.getAllByRole('list')
    expect(inner!.querySelector('pre')).toBeNull()
    // The block is the outer item's own child: its card, with the code in it.
    expect(outer!.children[0]!.querySelector(':scope > div > pre')!.textContent).toBe('code')
  })

  test('items written at uneven indents are still one list', () => {
    render(<Markdown text={'  - a\n- b'} />)
    expect(screen.getAllByRole('list')).toHaveLength(1)
  })

  test('a sentence that opens with a year is no list', () => {
    render(<Markdown text={'2024. That was the year.'} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('a task list keeps its checkboxes', () => {
    render(<Markdown text={'- [x] done\n- [ ] left'} />)
    expect(screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  test('the text after a list is not part of it', () => {
    render(<Markdown text={'- one\n- two\nAfter.'} />)
    expect(screen.getByText('After.').closest('li')).toBeNull()
  })
})

describe('Markdown quotes and rules', () => {
  test('lines that start with > are one quote, without the sign', () => {
    render(<Markdown text={'It now reads:\n\n> A static page.\n> **No build step.**\n\nSay if you want other words.'} />)
    const quote = document.querySelector('blockquote')!
    expect(quote.textContent).toBe('A static page.No build step.')
    expect(quote.querySelector('strong')?.textContent).toBe('No build step.')
    expect(document.body.textContent).not.toContain('>')
  })

  test('quotes in quotes without end stay text past a depth, and a huge list is drawn', () => {
    render(<Markdown text={`${'>'.repeat(5000)} deep`} />)
    expect(document.querySelectorAll('blockquote').length).toBeLessThan(20)
    expect(document.body.textContent).toContain('deep')
    cleanup()
    render(<Markdown text={`- item\n${'  under\n'.repeat(130_000)}`} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  test('the first characters of a bullet that opens in bold are no rule', () => {
    render(<Markdown text={'* **'} />)
    expect(screen.queryByRole('separator')).toBeNull()
  })

  test('--- alone on a line is a rule', () => {
    render(<Markdown text={'above\n\n---\n\nbelow'} />)
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(document.body.textContent).toBe('abovebelow')
  })
})

describe('Markdown inline code', () => {
  test('a name in bold is still code, with no backticks printed', () => {
    render(<Markdown text={'**`index.html`** is the whole site'} />)
    const name = screen.getByText('index.html')
    expect(name.tagName).toBe('CODE')
    expect(name.parentElement!.tagName).toBe('STRONG')
    expect(document.body.textContent).toBe('index.html is the whole site')
  })
})

describe('Markdown diffs', () => {
  test('a diff block colours what was added and what was removed', () => {
    render(<Markdown text={'```diff\n-<title>Hello</title>\n+<title>Hello page</title>\n same\n```'} />)
    expect(screen.getByText(/^-<title>Hello<\/title>/).className).toBe('text-danger')
    expect(screen.getByText(/^\+<title>Hello page<\/title>/).className).toBe('text-success')
    expect(document.querySelector('pre')!.textContent).toBe('-<title>Hello</title>\n+<title>Hello page</title>\n same')
  })

  test('a code block that is no diff is left as it is', () => {
    render(<Markdown text={'```\n- not a removal\n```'} />)
    expect(document.querySelector('pre span')).toBeNull()
  })
})

describe('Markdown issue and pull request numbers', () => {
  test('#12 is a link to that number on the project\'s GitHub page, where the page gives one', () => {
    render(
      <IssueLinks.Provider value="https://github.com/me/shop">
        <Markdown text={'Both merged from PRs #4 and #3.'} />
      </IssueLinks.Provider>,
    )
    expect(screen.getByRole('link', { name: '#4' }).getAttribute('href')).toBe('https://github.com/me/shop/issues/4')
    expect(screen.getByRole('link', { name: '#3' }).getAttribute('href')).toBe('https://github.com/me/shop/issues/3')
  })

  test('without a GitHub page, and where the number is no reference, #12 stays text', () => {
    render(<Markdown text={'PR #4 is open.'} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('PR #4 is open.')).toBeTruthy()
    cleanup()
    render(
      <IssueLinks.Provider value="https://github.com/me/shop">
        <Markdown text={'The colour #0f172a, C#7, a#2, see https://x.dev/a#3 and `#5`.'} />
      </IssueLinks.Provider>,
    )
    expect(screen.queryAllByRole('link').map(a => a.textContent)).toEqual(['https://x.dev/a#3'])
  })
})

describe('Markdown code blocks in colour', () => {
  const colours = (container: HTMLElement) => [...container.querySelectorAll('pre code span')].filter(span => (span as HTMLElement).style.color.startsWith('var(--code-'))

  test('a block of a language the dashboard knows comes in colour once its grammar is loaded, the text unchanged', async () => {
    const { container } = render(<Markdown text={'```bash\ngit checkout -b feature/x\ngit add .\n```'} />)
    expect(container.querySelector('pre code')?.textContent).toBe('git checkout -b feature/x\ngit add .')
    await waitFor(() => expect(colours(container).length).toBeGreaterThan(1))
    expect(container.querySelector('pre code')?.textContent).toBe('git checkout -b feature/x\ngit add .')
  })

  test('a block with no language, or one not known, stays plain, and a diff keeps its own colours', () => {
    const { container } = render(<Markdown text={'```\nplain text\n```\n\n```klingon\nqapla\n```\n\n```diff\n+added\n```'} />)
    expect(colours(container)).toHaveLength(0)
    expect(container.querySelector('.text-success')?.textContent).toBe('+added')
  })
})

// A file read as a page, as the Files pane shows a Markdown file.
describe('Markdown as a page', () => {
  test('the lines of a paragraph wrapped in its source are one paragraph; in a reply, each line is its own', () => {
    const text = 'A single static page. It shows a\n**centered\nheading**, and a line ending in two spaces  \nbreaks there.\n\nNext paragraph.'
    const { container } = render(<Markdown text={text} document />)
    const paragraphs = Array.from(container.querySelectorAll('p'))
    expect(paragraphs.map(p => p.textContent)).toEqual(['A single static page. It shows a centered heading, and a line ending in two spacesbreaks there.', 'Next paragraph.'])
    expect(paragraphs[0]!.querySelector('strong')!.textContent).toBe('centered heading')
    expect(paragraphs[0]!.querySelectorAll('br')).toHaveLength(1)
    cleanup()
    const reply = render(<Markdown text={'one\ntwo'} />)
    expect(Array.from(reply.container.querySelectorAll('p')).map(p => p.textContent)).toEqual(['one', 'two'])
  })

  test("a list item's wrapped line goes on with its words", () => {
    const { container } = render(<Markdown text={'- first item that\n  wraps here\n- second'} document />)
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['first item that wraps here', 'second'])
  })

  test('headings are headings, and a link to one scrolls to it', () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? '')
    }
    render(<Markdown text={'# Hello\n\nSee [Deploy](#deploy).\n\n## Deploy Steps\n\n## Deploy'} document />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Hello')
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Deploy Steps', 'Deploy'])
    fireEvent.click(screen.getByRole('link', { name: 'Deploy' }))
    expect(scrolled).toEqual(['Deploy'])
  })

  test('a table is a card whose header row is shaded and whose first column stays on one line', () => {
    const { container } = render(<Markdown text={'| Path | Purpose |\n| --- | --- |\n| `index.html` | The page |\n| `a.svg` | An icon |'} document />)
    expect(container.querySelector('table')!.parentElement!.className).toContain('rounded-lg')
    expect(container.querySelector('th')!.className).toContain('bg-muted')
    const cells = container.querySelectorAll('tbody td')
    expect(cells[0]!.className).toContain('whitespace-nowrap')
    expect(cells[1]!.className).not.toContain('border-t')
    expect(cells[2]!.className).toContain('border-t')
  })

  test('a code block names its language and keeps its lines whole; in a reply it does neither', () => {
    const { container } = render(<Markdown text={'```sh\nopen index.html        # macOS\n```'} document />)
    expect(screen.getByText('sh')).toBeTruthy()
    expect(container.querySelector('pre')!.className).toMatch(/whitespace-pre(\s|$)/)
    cleanup()
    const reply = render(<Markdown text={'```sh\nopen index.html\n```'} />)
    expect(screen.queryByText('sh')).toBeNull()
    expect(reply.container.querySelector('pre')!.className).toContain('whitespace-pre-wrap')
  })

  test('a path of a file of the project opens it; a bare name, and a path to no file, are code', () => {
    const opened: string[] = []
    const files = new Set(['.github/workflows/deploy.yml', 'index.html', 'docs/a.md'])
    render(
      <FileLinks.Provider value={path => (files.has(path) ? () => opened.push(path) : undefined)}>
        <Markdown text={'Driven by `.github/workflows/deploy.yml`, see `index.html`, `src/gone.ts` and [the notes](docs/a.md).'} document />
      </FileLinks.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '.github/workflows/deploy.yml' }))
    fireEvent.click(screen.getByRole('button', { name: 'the notes' }))
    expect(opened).toEqual(['.github/workflows/deploy.yml', 'docs/a.md'])
    expect(screen.getByText('index.html').tagName).toBe('CODE')
    expect(screen.getByText('src/gone.ts').tagName).toBe('CODE')
  })
})

// A README's own layout: HTML tags and images, as Claude Code on the web's file preview shows them.
describe('Markdown images and a README’s HTML', () => {
  const readme = [
    '<img src="./logo.svg?v=2" alt="OpenAgent" align="left" width="170" />',
    '',
    '### OpenAgent',
    '',
    '[![npm](https://img.shields.io/npm/v/x)](https://www.npmjs.com/package/x) [![License: MIT](https://img.shields.io/badge/MIT.svg)](./LICENSE) ![Logo](./logo.svg)',
    '',
    '<br clear="left" />',
    '<p align="center">',
    '<h2 align="center">Get started</h2>',
    '</p>',
    'Read <a href="https://example.test/docs">the docs</a>.',
  ].join('\n')

  test('images are chips with their words, linked when a link holds them; nothing is loaded', () => {
    const { container } = render(<Markdown text={readme} document />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('OpenAgent', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('npm').closest('a')!.getAttribute('href')).toBe('https://www.npmjs.com/package/x')
    expect(screen.getByText('License: MIT').closest('a')).toBeNull()
    expect(screen.getByText('Logo').closest('a')).toBeNull()
  })

  test('a tag that only lays out is no text, a heading in HTML is a heading, and a link in HTML a link', () => {
    const { container } = render(<Markdown text={readme} document />)
    expect(container.textContent).not.toMatch(/<br|<p|<\/p|<img|align=/)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('OpenAgent')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Get started')
    expect(screen.getByRole('link', { name: 'the docs' }).getAttribute('href')).toBe('https://example.test/docs')
  })
})
