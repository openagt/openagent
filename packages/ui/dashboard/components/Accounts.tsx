import { Skeleton } from './ui/skeleton.js'
import { SentenceShape, Slot } from './ui/slot.js'
import { useMountedModules } from '../lib/use-modules.js'
import { ModuleSlot } from './ModulePageView.js'
import { Page } from './Page.js'

// The Permissions page: every account OpenAgent's agents work with, in one place. An agent can
// reach what its accounts can, and nothing else is a permission. Every part of the page is a
// module's (`permissions.section`): the coding agents' accounts, where an agent with no account has
// a row that adds one, and the git hosts'.

/** The Permissions page. */
export function PermissionsPage() {
  return (
    <Page title="Permissions" description="The accounts your agents work with: what an agent can reach is what these accounts can.">
      <AccountsList />
    </Page>
  )
}

/** Every account, as the page lists them. */
export function AccountsList() {
  return (
    <div className="space-y-8">
      <ModuleSections />
    </div>
  )
}

/**
 * The modules' parts of the page (`permissions.section`), in their order. While the modules load,
 * they wait in the room of one part's emptiest answer: its heading and one sentence.
 */
function ModuleSections() {
  const { views, loaded } = useMountedModules()
  const sections = views['permissions.section']
  return (
    <Slot of={{ value: sections, state: sections.length > 0 || loaded ? 'fresh' : 'unknown' }} shape={<CardShape />}>
      {sections =>
        sections.length > 0 && (
          <div className="space-y-8">
            {sections.map(section => (
              <ModuleSlot key={`${section.package} ${section.id}`} package={section.package} label={section.label}>
                <section.View />
              </ModuleSlot>
            ))}
          </div>
        )
      }
    </Slot>
  )
}

/** A part's heading and its one sentence, while they are read. */
function CardShape() {
  return (
    <>
      {/* As high as a part's heading row (`PanelGroup`): the card that lands moves nothing under it. */}
      <div className="mb-2 flex h-5 items-center">
        <Skeleton className="h-4 w-48" />
      </div>
      <SentenceShape />
      {/* The emptiest answer's sentence takes a second line on a phone. */}
      <div className="md:hidden">
        <SentenceShape />
      </div>
    </>
  )
}
