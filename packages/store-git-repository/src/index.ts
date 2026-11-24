// `@openagt/store-git-repository`: the person's own folder as a git repository. Its module is
// `./module`, its UI part `./dashboard`, its server part `./server`. What store-git-branch shares
// with it: the folder as a page shows it, and what of a shared project's data is not backed up.
export { gitRepositoryBackend, gitRepositoryStore } from './backend.js'
export { backUpProjectAs, originHost, projectGap, sendProjectDataAs, type BackupGap } from './gaps.js'
export { gapDetail } from './backup-attention.js'
export { SYNC_ENTRY } from './entry.js'
export { personalFolderShown, type PersonalFolderShown } from './shown.js'
