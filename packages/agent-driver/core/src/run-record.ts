// The run's record as a browser reads it too (#2394, decision 15): its card and its diary, how they
// read, and the runs walked through a reader of the files it is handed. Nothing here reaches past
// that reader, so a module's dashboard bundles it; the package's root holds the engine beside it,
// which is Node's.
export * from './record.js'
export * from './records.js'
