// A `node --test` reporter for test-node.mjs: the run's own summary (the counts, the time, whether it
// passed), as JSON, for the runner to say once every other report is out.
export default async function* summary(source) {
  for await (const event of source) {
    // The run's own summary names no file; each file's has its file.
    if (event.type === 'test:summary' && event.data.file === undefined) yield JSON.stringify(event.data)
  }
}
