Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The git host as a skill
- GitHub is a skill: this package teaches an agent how to work with GitHub and declares the
  one command OpenAgent and the scheduler run for the git host
  (`"openagent": { "git-host": "github" }`). `gh` runs in this package only; no other skill
  names GitHub or `gh`. Another git host is another package answering the same command;
  OpenAgent and the scheduler name none. Picked over a git host adapter inside the
  branches package, which would have kept a request half in a skill about git.
- Pushing is not this package's: the branches package pushes, and the agent, OpenAgent
  and the scheduler compose push then open through the two declared commands. Picked over
  one `publish` that pushed and opened, which was one skill naming another.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-github@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx github` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.

## Flow: open
- The agent opens its pull request only when asked to publish, by its task or by the
  person: `npx @openagt/skill-github@0.1 open` with the title and body the agent wrote,
  and the merge armed on green when whoever asked says the work may land on its own.
  Opening it when it finishes was the earlier rule and was dropped: a pull request is
  the person's act. Picked over whoever started the agent opening it, which needed a run
  process that knew the agent's words: the agent knows them.
- `open` opens no second request for a branch that has one open, and never opens a draft
  when the merge is armed.
- The branch must be on the remote already; `open` neither pushes nor checks, GitHub's own
  refusal is the answer.

## Flow: merge
- `merge <number>` lands a request for a person or the scheduler: a draft is marked ready,
  then the merge is armed exactly as `--merge` arms it; a request no longer open is refused.
  Picked over the dashboard merging with `gh` itself.
- Where the repository allows no auto-merge, this package's own watcher waits for the checks
  and merges, as its own detached process; a red request is left open for a person. Picked
  over merging at once, which would land work whose checks had not run.

## Flow: requests
- One read answers every question about pull requests (a branch's, the open ones, the ones
  merged since a time), in one shape; a read `gh` cannot answer is a refusal, never an
  empty list, so "none" and "could not tell" never look alike to a caller.

## Flow: replies
- `replies` is the check of the scheduler's row that resumes runs: what came on the open
  pull requests this machine's agents opened, since each agent ended, one item per run.
  Picked over a watcher of its own that wakes the agent: the scheduler asks, as every row
  does.
- New is after the run last ended; no time is kept. Picked over a time kept since the last
  look, where something that came while the run worked was lost, and a red check the agent
  chose to leave woke it again and again.
- Only maintainers' comments and reviews that call the agent with `/agent`, a word of its
  own, count, on the agent's own pull request too; red checks and a conflict with the base
  branch count with no word: nobody writes one. Picked over every maintainer's words waking
  the agent, where people talking on the pull request woke it too. Only this machine's runs: only it holds the conversation. A pull request
  with no run behind it gets nothing.
- A pull request is a run's when its branch is the run's branch, as the run's record keeps
  it, so a run started with no dashboard and no git host behind it is answered too. Picked
  over the pull request the record names, which only a run with a git host learns, and
  over the runner handing every run the basic skills itself.
- About one GitHub call a minute, not one per pull request.
- A look first asks whether any comment of the repository changed, by its last answer
  (ETag): "not modified" costs no call of the hour's, and then nothing is read, so the row
  can look every few seconds. Reviews, checks and conflicts have no such question: the
  whole read is made at least once a minute. Picked over the whole read at every look.
- A comment `comment` writes opens with the coding agent's logo, the model and the effort,
  as the agent's run record names them (`<logo> sonnet-5-5 · high effort`), else the 🤖
  line. Picked over the 🤖 line on every comment, and over the agent's name beside its logo.
- It ends with a hidden mark, and `replies` never counts one that carries it: it is posted
  with a person's account, and an agent's own words must never wake it.
- Each comment and review a look hands a run gets 👀 from the look itself, so who wrote sees
  within seconds that an agent saw it. Picked over the agent putting it once it started.

## The command
- Every command prints one JSON document on stdout: the result or the refusal. A refusal
  adds one line for a person on stderr and exits 1. A malformed command line: the usage on
  stderr, exit 2. The same contract as the other skills' commands, but for `watch`: it
  logs one line per read on stderr and exits 0 whatever its outcome, `ok` only when it
  merged.
- `create` makes the project's repository on GitHub, for a project with no `origin`: private,
  named `<account>/<folder>`, set as `origin` and pushed, in one `gh` step. `--check` only
  names it. The package declares it under `"openagent": { "repository": "github" }`, so a
  dashboard offers it without naming GitHub. Always private: making code public is never this
  command's choice. Picked over a name the person types, which is one more thing to ask, and
  over moving a project that already has a remote.
