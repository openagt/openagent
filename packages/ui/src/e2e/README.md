# End to end

The dashboard as a person meets it, offline. Every project here is a fixture repo (`fixture.ts`),
and its runs are the scripted host's (`fake-runs.ts`): this computer's own host, agent-runner's,
whose runs' processes are `fake-run-bin.ts` in place of agent-runner's, a scripted coding agent in
the seat of `claude` or `codex`. A Start goes the whole production way — the dashboard's call, the
host, a detached run writing the files the dashboard reads — and costs nothing. A session with no
project is not scripted: the host refuses it.

A word in the prompt picks what the scripted agent does:

| Word | The run |
|---|---|
| `ask` | asks "Which way?" and waits for the answer |
| `hold` | waits for `<checkout>/.openagent/go` before its first turn, so it is certainly still working |
| `commit` | commits a file, so its branch holds work to push |
| `refuse` | the host refuses it, and the page says why |
| `agents` | its coding agent starts subagents of its own, one of which fails, and it keeps working until it is stopped; with `many`, more of them |
| anything else | answers `done: <prompt>`, and the run ends |

## The backend stories: `story-*.test.ts`

The daemon's own functions, wired as `runDaemon` wires them (`harness.ts`) and called as the page
calls them: what each flow leaves on disk, and what the reads then say. No browser.

## The demo: `pnpm demo`

The real dashboard, started by its built CLI on a throwaway home (`demo.ts`) and handed the
distribution whose host scripts the runs (`distribution.ts`): a project "shop" with
two tickets, a working, a waiting and a done run, and the Logs and Automations pages, and a project "blog" to add
from the picker, whose runs are scripted too. Walk any flow by
hand. Ctrl+C stops the runs and the dashboard, and removes the home.

## The browser smoke stories: `smoke-*.test.ts`

The demo in Chrome, driven by playwright-core (`smoke.ts`): the flows people go through most,
checked as a person sees them, with the page laid out and run, its calls over HTTP, the host and
the run's files. They need `pnpm build` and a Chrome (`CHROME_PATH`, or one where Chrome usually
is), and are skipped without one. A flow that fails leaves a screenshot in
`packages/ui/test-results/`, which CI keeps.

In a script of your own, `waitUntil: 'networkidle'` never comes: the page keeps a stream to the
daemon open. Wait for `load` and the element you need.
