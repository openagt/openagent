import { useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { Button, PathStrip, Section, SettingsItem, SettingsItems, SettingsRowShapes, SettingsSection, Slot, useAction, useLoaded, useModuleHost } from '@openagt/ui/module'
import { addFolderToSearch, readRepoFolders, removeFolderToSearch } from './calls.js'

/**
 * Settings › Repos: where the project picker finds repos on this computer besides the projects
 * (Rom's design: "repos crawled from the filesystem, plus added directories"): the home folder,
 * and the folders the person added, this computer's.
 */
export function RepoFolders() {
  const host = useModuleHost()
  const [read, setRead] = useState(0)
  // `undefined` is not read yet; a read that fails is `null`. A read again after a change keeps the list in place.
  const folders = useLoaded<string[] | null | undefined>(() => readRepoFolders(host).then(answer => answer.folders, () => null), undefined, [read], 'previous')
  return (
    <Slot of={{ value: folders, state: folders === undefined ? 'unknown' : 'fresh' }} shape={<SettingsRowShapes />}>
      {folders =>
        folders ? (
          <Folders folders={folders} onChanged={() => setRead(k => k + 1)} />
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
function Folders({ folders, onChanged }: { folders: string[]; onChanged: () => void }) {
  const host = useModuleHost()
  const { busy, error, run } = useAction()
  const again = (outcome: { ok: boolean }) => {
    if (outcome.ok) onChanged()
    return outcome
  }
  const removeFolder = (folder: string) => void run(() => removeFolderToSearch(host, folder), 'Could not remove it.').then(again)
  // The picker's own "Search another folder…": this computer's folder dialog, the folder picked added.
  const addFolder = () => void run(() => addFolderToSearch(host), 'Could not add it.').then(again)

  return (
    <SettingsSection description="Where the project picker finds repos on this computer, besides your projects.">
      {/* Its press stands at the heading's right on a desktop; on a phone, where both would cut the heading, under the
          heading's line of help, the three one group. */}
      <Section title="Folders searched on this computer" className="relative">
        <p className="max-w-md text-xs text-faint-foreground">Your home folder, and the folders added here or with &ldquo;Search another folder&hellip;&rdquo; in the picker.</p>
        <Button variant="ghost" size="sm" className="max-md:-ml-2 max-md:h-11 md:absolute md:-top-0.5 md:right-0" disabled={busy} onClick={addFolder}>
          <FolderPlus className="size-4" aria-hidden />
          Search another folder&hellip;
        </Button>
        <div className="mt-6 space-y-6 max-md:mt-2">
          {folders.length > 0 ? (
            <SettingsItems aria-label="Folders searched">
              {folders.map(folder => (
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
      {error && <p className="text-xs text-danger">{error}</p>}
    </SettingsSection>
  )
}
