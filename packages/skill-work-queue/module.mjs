// work-queue, a plugin kept per project (#2394) until it is one of the queue's commands: where its
// Enabled row is on, the project's runs get its skill.
// The package is the skill's text and this module alone, with no build of its own: what the module
// says is what `@openagt/hooks`' `defineModule` types.
export default {
  name: 'work-queue',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'work-queue', dir: new URL('.', import.meta.url) }] },
}
