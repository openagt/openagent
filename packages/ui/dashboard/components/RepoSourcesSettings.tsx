import { useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { onRepoSources, sendAddRepoFolder, sendRemoveRepoFolder, type RepoSources } from '../rpc/projects.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Section } from './ui/section.js'
import { PathStrip } from './PathStrip.js'
import { SettingsItem, SettingsItems, SettingsRowShapes, SettingsSection } from './SettingsRows.js'
import { Slot } from './ui/slot.js'

/** The Settings entry's id. */
export const REPO_SOURCES_ENTRY = 'repos'

/**
 * Settings › Repos: where the project picker finds repos on this computer besides the projects
 * (Rom's design: "repos crawled from the filesystem, plus added directories"). The folders added
 * are this computer's; the repos the modules' accounts reach are theirs (`composer.where`).
 */
export function RepoSourcesSettings() {
  const [read, setRead] = useState(0)
  // `undefined` is not read yet; a read that fails is `null`. A read again after a change keeps the lists in place.
  const sources = useLoaded<RepoSources | null | undefined>(() => onRepoSources().catch(() => null), undefined, [read], 'previous')
  return (
    <Slot of={{ value: sources, state: sources === undefined ? 'unknown' : 'fresh' }} shape={<SettingsRowShapes />}>
      {sources =>
        sources ? (
          <Sources sources={sources} onChanged={() => setRead(k => k + 1)} />
        ) : (
          <p role="alert" className="text-sm text-danger">
            Where the picker looks could not be read.
          </p>
        )
      }
    </Slot>
  )
}

/** The folders added, with the presses that change them. */
function Sources({ sources, onChanged }: { sources: RepoSources; onChanged: () => void }) {
  const { busy, error, run } = useAction()
  const again = (outcome: { ok: boolean }) => {
    if (outcome.ok) onChanged()
    return outcome
  }

  const removeFolder = (folder: string) => void run(() => sendRemoveRepoFolder(folder), 'Could not remove it.').then(again)
  // The picker's own "Search another folder…": this computer's folder dialog, the folder picked added.
  const addFolder = () => void run(() => sendAddRepoFolder(), 'Could not add it.').then(again)

  return (
    <SettingsSection description="Where the project picker finds repos on this computer, besides your projects.">
      <div className="flex flex-col gap-8">
        {/* Its press stands at the heading's right on a desktop; on a phone, where both would cut the heading, under the
            heading's line of help, the three one group. */}
        <Section title="Folders searched on this computer" className="relative">
          <p className="max-w-md text-xs text-faint-foreground">Your home folder, and the folders added here or with &ldquo;Search another folder&hellip;&rdquo; in the picker.</p>
          <Button variant="ghost" size="sm" className="max-md:-ml-2 max-md:h-11 md:absolute md:-top-0.5 md:right-0" disabled={busy} onClick={addFolder}>
            <FolderPlus className="size-4" aria-hidden />
            Search another folder&hellip;
          </Button>
          <div className="mt-6 space-y-6 max-md:mt-2">
            {sources.folders.length > 0 ? (
              <SettingsItems aria-label="Folders searched">
                {sources.folders.map(folder => (
                  <SettingsItem
                    key={folder}
                    title={<PathStrip path={folder} />}
                    actions={
                      <Button variant="ghost" size="icon-sm" className="-mr-1.5" aria-label={`Remove ${folder}`} disabled={busy} onClick={() => removeFolder(folder)}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    }
                  />
                ))}
              </SettingsItems>
            ) : (
              <p className="text-sm text-muted-foreground">No folder added yet: only your home folder is searched.</p>
            )}
          </div>
        </Section>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
