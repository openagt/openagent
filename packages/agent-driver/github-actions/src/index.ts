// `readZip`/`ZipEntry` are deliberately absent (#947): the Actions driver's internal zip reader
// has no importer outside the driver and its own test, both of which take the module by path.
// An accidental export is a one-way door once released.
export { ActionsDriver, type ActionsDriverOptions, type FetchLike } from './actions.js'
