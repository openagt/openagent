import type { ReactNode } from 'react'
import type { UiMarkdownProps } from '@openagt/hooks/ui'
import { blockRender, renderFor, useMountedModules } from '../lib/use-modules.js'
import { cn } from '../lib/utils.js'
import { ModuleSlot } from './ModulePageView.js'

// A text in markdown, wherever the dashboard shows one (an agent's reply, a ticket, a file read as a
// page): as the module that draws markdown draws it (`ui.render`), in its slot (#2394: ui draws no
// kind of content itself). Where none does, it is the text as written, its lines kept; before the
// modules have come, nothing yet.

export function Markdown(props: UiMarkdownProps) {
  const modules = useMountedModules()
  const render = renderFor(modules, 'markdown')
  // Nothing while the modules are still coming: shown as written first, a page loaded again had
  // every answer as its raw text for a moment, then drawn, at another size.
  if (!render) return modules.loaded ? <AsWritten {...props} /> : null
  const Render = render.Render
  return (
    <ModuleSlot package={render.package} label="markdown">
      <Render {...props} />
    </ModuleSlot>
  )
}

/**
 * One line said by a tool (a check's problem, a hook's refusal) with its inline marks drawn as the
 * chat draws them: what it puts in backticks is code, and an address is a link. For a sentence
 * that sits in a box of its own rather than in a block of text.
 */
export function InlineMarkdown({ text }: { text: string }) {
  return <Markdown text={text} look="inline" />
}

/** Each look's type, as the text is set as written. */
const AS_WRITTEN: Record<Exclude<UiMarkdownProps['look'], undefined | 'inline'>, string> = {
  chat: 'text-chat',
  compact: 'text-xs leading-relaxed',
  document: 'font-serif text-base',
  page: 'text-sm',
}

/** The text as written, its lines kept: where no module draws markdown. */
function AsWritten({ text, look = 'chat' }: UiMarkdownProps) {
  if (look === 'inline') return <>{text}</>
  return (
    <div data-markdown className={cn('break-words whitespace-pre-wrap', AS_WRITTEN[look])}>
      {text}
    </div>
  )
}

/**
 * A fenced block of `language` in a text in markdown as the module that names its language draws
 * it (`ui.render`: a mermaid block's diagram), in that module's slot; `otherwise` where none draws
 * it, or the one that names it shows it elsewhere (the chat leaves those out where they are shown).
 */
export function ModuleBlock({ language, content, otherwise }: { language: string; content: string; otherwise: ReactNode }) {
  const render = blockRender(useMountedModules(), language)
  const Render = render?.Render
  if (!render || !Render) return <>{otherwise}</>
  return (
    <ModuleSlot package={render.package} label={`${language} block`}>
      <Render content={content} />
    </ModuleSlot>
  )
}
