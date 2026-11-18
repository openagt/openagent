/** A project, as a hook is given it. */
export interface ProjectRef {
  /** The registry's id for it: what the store's project scope names. */
  id: string
  /** Its name, as a person reads it. */
  name: string
  /** Its folder on this computer. */
  dir: string
  /** Its repository's address, origin's; none for a project with no remote. */
  remote?: string
}
