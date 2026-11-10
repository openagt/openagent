# End to end

The dashboard as a person meets it, offline. Every project here is a fixture repo (`fixture.ts`)
whose start and resume lines run `fake-run-bin.ts`: the tool a real project's hooks name, with a
scripted coding agent in the seat of `claude` or `codex`. A Start goes the whole production way —
the dashboard's call, the project's hook, a detached run writing the files the dashboard reads —
and costs nothing.

A word in the prompt picks what the scripted agent does:

| Word | The run |
|---|---|
| `ask` | asks "Which way?" and waits for the answer |
| `hold` | waits for `<checkout>/.openagent/go` before its first turn, so it is certainly still working |
| `commit` | commits a file, so its branch holds work to push |
| `refuse` | its start hook fails, and the page says why |
| anything else | answers `done: <prompt>`, and the run ends |

## The backend stories: `story-*.test.ts`

The daemon's own functions, wired as `runDaemon` wires them (`harness.ts`) and called as the page
calls them: what each flow leaves on disk, and what the reads then say. No browser.

## The demo: `pnpm demo`

The real dashboard, started by its built CLI on a throwaway home (`demo.ts`): a project "shop" with
two tickets and a run in each state, and a project "blog" to add from the picker. Walk any flow by
hand. Ctrl+C stops the runs and the dashboard, and removes the home.

## The browser smoke stories: `smoke-*.test.ts`

The demo in Chrome, driven by playwright-core (`smoke.ts`): the flows people go through most,
checked as a person sees them, with the page laid out and run, its calls over HTTP, the hooks and
the run's files. They need `pnpm build` and a Chrome (`CHROME_PATH`, or one where Chrome usually
is), and are skipped without one. A flow that fails leaves a screenshot in
`packages/dashboard/test-results/`, which CI keeps.

In a script of your own, `waitUntil: 'networkidle'` never comes: the page keeps a stream to the
daemon open. Wait for `load` and the element you need.
