// `@openagt/store-filesystem`: the store on this computer, the end of the store's chain. Its
// module is `./module`; what this entry exports is for the stores that keep files too: where
// each scope's folder is, and the reader and writer of a folder's files. Beside them, the files
// OpenAgent writes outside the store's chain: the person's own folder and its writes, a project's
// data in it or on the repository's `agent-data` branch, and a module's command's reads and
// writes of that data.
export { filesystemBackend, filesystemStore, madeAtEachCall } from './backend.js'
export { filesIn, listIn, readIn, watchIn, writeIn } from './files.js'
export { COMPUTER_DIR, LOCKS_DIR, PERSON_DIR, PROJECTS_DIR, foldersOf, lockFile, projectKey, scopeFolder, type Folders } from './folders.js'
export { FOLDER_BRANCH, personalFolder, plainReason, withPersonalFolder, withPersonalFolderLock, type PersonalFolderDeps } from './personal-folder.js'
export {
  SHARE_SETTING,
  branchReach,
  clearSharing,
  commitChange,
  ensureFileBranch,
  fileBranchPath,
  fileBranchRepo,
  isGitLocked,
  listBranchDir,
  listBranchFiles,
  nodeBranchFileFs,
  openBranchReader,
  pullFileBranch,
  readBranchFile,
  readSharing,
  removeFileBranch,
  withFileBranch,
  writeFileBranchDetached,
  writeFileWhole,
  writeSharing,
  type BranchFileFs,
  type BranchReach,
  type BranchReader,
  type CommitMessage,
  type DetachedWrite,
  type FileBranchDeps,
  type FileBranchRemoval,
  type FileBranchSync,
  type FileBranchWrite,
} from './file-branch.js'
export {
  SESSIONS_DIR,
  listProjectDir,
  openProjectReader,
  projectDataDir,
  projectDataDirs,
  projectDataPlace,
  projectKeyAt,
  pullProjectData,
  readProjectFile,
  removePersonalData,
  withProjectData,
  writeProjectDataDetached,
  type DataPlace,
  type ProjectDataDeps,
  type ProjectReader,
} from './project-data.js'
export { commandReader, commandWrite } from './command-data.js'
