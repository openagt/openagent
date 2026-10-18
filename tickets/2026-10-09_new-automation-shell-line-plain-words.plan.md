Effort: 4
Uncertainty: 3

# [Plan] New automation: say the shell line in plain words

How the "New automation" form turns a person's plain words into a shell line, written by a short agent session and put in the line's box, with nothing saved.

## Problems

1. **Time.** The form reaches the scheduler only through `host.runCommand`, which a dashboard ends at 30 seconds (`TRY_TIMEOUT_MS` and `NOW_READY_MS` in `packages/agent-scheduler/src/names.ts` are both kept under it). A full agent run in the project, with tools, takes far longer and cannot answer inside one command.
2. **What the agent knows.** To write `gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq …` it must know the line's contract (runs in the project's checkout, `$LAST_RUN` is an ISO time, printing nothing or `[]` starts nothing, what it prints is handed to the agent) and where the project is hosted.
3. **The ticket's two open questions:** whether the form says what a press costs, and whether the agent may run the line itself.

## Solutions

1. Do it the way a run is named (`packages/agent-runner/src/title.ts`, `nameRun`): one throwaway session through the coding agent's `Driver`, `noTools: true`, in an empty temporary folder, one prompt, disposed straight after. With the tools off Claude Code sends ~3,600 tokens for such a turn: a few seconds, a fraction of a cent, well inside 30 seconds. A long-lived run with its own record, polled by the form, would be a second kind of run for a one-line answer: rejected.
2. Hand it everything it would have looked up, in the prompt: the contract above (the same words as the hint under the line's box in `fields.tsx`), the project's `origin` URL, whether `gh` is on this machine's `PATH`, and that `gh api` fills `{owner}/{repo}` itself. The person's words are fenced off as text, as `titlePrompt` does.
3. Decided:
   - **Cost:** said beside the button, as "Try it" says what it does beside it: "Asks <agent> once; costs a fraction of a cent. Nothing is saved." No confirm step: a press costs less than the name every run already gets.
   - **Running the line:** the agent only writes it. It has no tools (cheaper, and nothing runs that the person did not see). Checking is "Try it", which the person presses on the line as written, as today.

## Implementation

1. **`packages/agent-scheduler/src/write-line.ts`** (new), beside `tryCheck`:
   - `WRITE_LINE_SYSTEM` and `writeLinePrompt(words, { remote, hasGh })`: you write one POSIX shell line; answer with the line alone, no fences, no explanation; or answer `NONE: <why>` in one sentence when the words cannot be met by a line (nothing to watch from the command line).
   - `lineOf(said)`: strips a ``` fence or a leading `$ ` a model adds, keeps it only if it is one line (joined `\` continuations allowed) and under `OWN_TEXT_MAX`; else `undefined`.
   - `writeLine(repo, words, driver, { timeoutMs })`: `mkdtemp` an empty folder, `driver.start({ cwd: empty, system, noTools: true, signal })`, one `prompt`, dispose, remove the folder. Returns `{ line }`, `{ none: why }`, or `{ failed: reason }`; never throws. Timeout `WRITE_LINE_TIMEOUT_MS = 25_000` in `names.ts`, with the 30-second reason in its comment like its neighbours.
   - The driver: the coding agent a new row starts on (the scheduler's `DEFAULT_AGENT` / the project's runner config, whatever a new automation's runs use), built with `driverFor` from `@openagt/agent-runner`; no model passed, so the agent's own default writes it (a small model writes jq poorly; the turn is cheap either way).
2. **`packages/agent-scheduler/src/cli.ts`**: a command `write-line --words <plain words>` printing `{ ok: true, line }` / `{ ok: true, none }`, refusing with the reason on failure; listed in `USAGE` beside `try`. Nothing is written to the state.
3. **`packages/agent-scheduler/dashboard/fields.tsx`, `SaidFields`**: the existing "What the line waits for, in plain words" input is the box: show it always (not only once a line is typed), above the line's box, so the same words are both what the agent is asked and what the row says. Beside it a button "Write the line" (disabled while empty or writing; "Writing…" while in flight), with the cost hint. Its answer replaces the line's box (`onChange({ when: line })`), which drops any "Try it" answer as a typed change does; a late answer is dropped with the same `asked` counter pattern. `none` and failures show in a `role="status"` line under the button, the box untouched. Writing over a line the person typed: the line goes into the box anyway, it is undone by typing; no prompt.
   - Applies to the Edit panel as well as the form, since both use `SaidFields`: no reason to hide it there.
4. **`packages/agent-scheduler/dashboard/automation-form.ts`**: if `draftSentence`/the row's words assumed `waitsFor` only exists with a line, keep that rule at save time (words without a line are not saved as `waits-for`), so the box being shown earlier changes nothing saved.
5. **`packages/agent-scheduler/DECISIONS.md`**: a line: the shell line can be written from plain words by one tool-less session of the project's coding agent; it is never run nor saved by it.

## Tests

- `write-line.test.ts`: with the core `FakeDriver`, the prompt holds the words fenced, the remote and the `gh` answer; `lineOf` takes a fenced answer, a `$ ` lead, rejects two lines and an empty answer; `NONE:` comes back as `none`; a driver that hangs ends at the timeout as `failed`; the temporary folder is gone afterwards.
- `cli.test.ts`: `write-line` with no `--words` is a usage error; with a fake driver prints the line.
- `AutomationsPage.test.tsx`: in "New automation", the plain-words box shows with no line; "Write the line" runs `['write-line', '--words=…']` and fills the line's box; "Try it" is then enabled and nothing was saved (no `add` call); a `none` answer shows its reason and leaves the box; a late answer after the person typed in the line is dropped.

## Considerations

- A project not on GitHub: the remote is in the prompt, so the agent can use `glab`, `curl` or `git` instead, or answer `NONE`.
- A shell line from a model is run on this machine only when the person presses "Try it" or saves and switches the row on; both are theirs, after reading it. Nothing here runs it.
- Not part of this (from the ticket): the agent saving the row.
