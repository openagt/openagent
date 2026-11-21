// `@openagt/store-filesystem`: the store on this computer, the end of the store's chain. Its
// module is `./module`; what this entry exports is for the stores that keep files too: where
// each scope's folder is, and the reader and writer of a folder's files.
export { filesystemBackend, filesystemStore, madeAtEachCall } from './backend.js'
export { filesIn, listIn, readIn, watchIn, writeIn } from './files.js'
export { COMPUTER_DIR, LOCKS_DIR, PERSON_DIR, PROJECTS_DIR, foldersOf, lockFile, projectKey, scopeFolder, type Folders } from './folders.js'
