import { useContext, useMemo, useState, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import type { Attention } from '@openagt/hooks'
import type { UiActionResult } from '../module/index.js'
import { useMountedModules } from '../lib/use-modules.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'
import { SESSIONS_ID } from '../../src/project-address.js'
import { Button } from './ui/button.js'
import { InlineMarkdown } from './Markdown.js'
import { useRunOffer, type Offered } from './Places.js'

// What needs the person (`app.attention`), as the shell's own chrome draws it: each item's words,
// what it is about, and the press that fixes it — one of the module's own actions
// (`attention.fix`), a page to open, or an entry of Settings. The shell says nothing of its own here. Where each kind is
// drawn: the onboarding card and the person's menu the `setup` items about this computer, the line
// above the message box those about the run it would start (`scope: 'run'`, asked with the picks),
// a project's banner those about the project.

/** A key an item is told apart by among a list's, as its module says it. */
export function attentionKey(item: Attention): string {
  return `${item.module}\n${item.id ?? `${item.scope}:${item.run ?? ''}`}`
}

/** What an item says after its words: what it is about, and what it adds. */
export function attentionDetail(item: Attention): string | undefined {
  const said = [item.title, item.detail].filter(Boolean).join(' · ')
  return said || undefined
}

/**
 * What fixes the items of a list: for each, what a press does (the module's action the item names,
 * its dialog opened or its run run; or the page or the Settings entry it names), or nothing for an item with no fix, or
 * whose action no module brings here. `overlay` is drawn where it outlives a menu that closed.
 * `onFixed` is told when a fix is done, so the list is asked again.
 */
export function useAttentionFixes(projectId: string | undefined, onFixed?: () => void): { fixOf: (item: Attention) => (() => void) | undefined; pending: boolean; overlay: ReactNode } {
  const services = useContext(HostServicesContext) ?? INERT_HOST_SERVICES
  const actions = useMountedModules().actions['attention.fix']
  const [item, setItem] = useState<string | undefined>()
  const on = useMemo(() => ({ ...(projectId !== undefined && projectId !== SESSIONS_ID ? { projectId } : {}), ...(item !== undefined ? { item } : {}) }), [projectId, item])
  const { press, pending, overlay } = useRunOffer<'attention.fix'>(on, (_offered, _result: UiActionResult) => onFixed?.())
  const fixOf = (attention: Attention): (() => void) | undefined => {
    const fix = attention.fix
    if (!fix) return undefined
    if ('settings' in fix) return () => services.openSettings(fix.settings)
    if ('href' in fix) {
      return () => {
        if (!fix.href.startsWith('/')) return void window.open(fix.href, '_blank', 'noreferrer')
        const [segment = '', ...path] = fix.href.slice(1).split('/')
        services.openPage(segment, path)
      }
    }
    const action = actions.find(each => each.module === attention.module && each.id === fix.action)
    if (!action) return undefined
    const offered: Offered<'attention.fix'> = { key: `${action.package}/${action.id}`, action, offer: {} }
    return () => {
      setItem(attention.id)
      press(offered)
    }
  }
  return { fixOf, pending: pending !== null, overlay }
}

/**
 * The `setup` items about the run a box would start (`scope: 'run'`), in the line above it: what
 * stops that run, as the modules say it for the picks made there, each with its fix, over the page.
 */
export function SetupItemsLine({ items, projectId, onFixed }: { items: readonly Attention[]; projectId?: string | undefined; onFixed?: () => void }) {
  const { fixOf, pending, overlay } = useAttentionFixes(projectId, onFixed)
  return (
    <>
      {items
        .filter(item => item.kind === 'setup' && item.scope === 'run')
        .map(item => {
          const fix = fixOf(item)
          const detail = attentionDetail(item)
          return (
            <div key={attentionKey(item)} role="alert" className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-background))] px-3 py-2 text-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <p className="text-sm font-medium">
                  <InlineMarkdown text={item.words} />
                </p>
                {detail !== undefined && (
                  <p className="mt-0.5 text-xs">
                    <InlineMarkdown text={detail} />
                  </p>
                )}
                {fix && item.fix && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground max-md:[&_button]:h-11">
                    <Button size="sm" variant="outline" loading={pending} onClick={fix}>
                      {item.fix.label}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      {overlay}
    </>
  )
}
