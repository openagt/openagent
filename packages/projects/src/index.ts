// `@openagt/projects`: what other modules ask of a project beside its hooks. Making a folder a
// project (`install.ts`, the dashboard's ignore file), the id a project's folder gets on the list,
// the repositories the person owns, and a module's own directory at a project's root removed
// again. Its module is `./module`, its server `./server`, its dashboard `./dashboard`.
export { installProject, nodeInstallFs, FIRST_COMMIT_MESSAGE, type InstallResult, type InstallDeps, type InstallFs } from './install.js'
export { gitignorePath, openagentGitignore } from './openagent-gitignore.js'
export { projectId } from './project-id.js'
export { REPO_OWNERS_FILE, isRepoOwner, readRepoOwners, writeRepoOwners } from './repo-owners.js'
export { removeOwnDirectory, type KeptEntry, type OwnDirectoryRemoval } from './own-directory.js'
