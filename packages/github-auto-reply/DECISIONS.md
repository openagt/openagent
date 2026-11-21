Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The command
- The agent that worked on an issue or a pull request answers what came on it, on the
  coding agent and model it ran on: the scheduler resumes that run, and this command is
  what it is told.
  Picked over a new agent for each comment, which knew nothing of the work.
- Its own package, a skill file, the plugin that gives it to runs and the command its row
  checks with (`github-auto-reply`, #2394): its front matter is the scheduler's row. Picked
  over a row in the GitHub skill, whose skill is the agent's guide to GitHub, not a command.
- It is GitHub's (#2394): its check is its own command, `github-auto-reply replies`, which
  reads GitHub through the github package; another git host's would be a package of its
  own. Picked over a check that named no git host and asked whichever package was the
  project's git host (`agent-runner git-host replies`), which the runner carried a command
  for. The agent still posts the way its git host skill says.
- Only maintainers' comments and reviews count, people who can write to the repository, and
  only those that call the agent with `/agent`, a word of its own, on the agent's own pull
  request too. Picked over every maintainer's words waking the agent, where people talking
  on the pull request woke it too. An agent posts with a person's account, so what it posts
  carries the 🤖 line, and is never counted.
- On its own pull request, red checks and conflicts with the base branch wake the agent
  too, with no word: nobody writes one. A conflict is resolved by merging the base branch
  in, never by a rebase or a forced push; one it cannot resolve with confidence is said on
  the pull request for a person.
- Each comment and review the agent is woken for gets 👀 at once; the agent posts its answer
  as a new comment, and first a short one saying what it will do when its work takes more
  than about 5 minutes. Every comment is new, never an edit: a new comment reaches people by
  email, an edit reaches nobody. Picked over one comment kept and rewritten while the agent
  works, and over a timer posting for the agent.
- The row's check runs every 15 seconds, so an answer starts within seconds of a comment.
  Picked over the scheduler's minute.

## Flow: the check
- `replies` is the check of the scheduler's row with each: what came on the open issues and
  pull requests this machine's agents worked on, since each agent ended, one item per run,
  and the open ones no run was on where a maintainer called the agent. Picked over a
  watcher of its own that wakes the agent: the scheduler asks, as every row does.
- Issues and pull requests, not discussions yet: picked over discussions too, a second read
  of another shape, which can come later.
- New is after the run last ended; no time is kept. Picked over a time kept since the last
  look, where something that came while the run worked was lost, and a red check the agent
  chose to leave woke it again and again.
- Only this machine's runs: only it holds the conversation.
- `/agent` on an issue or a pull request no run was on starts a run for it, whose record
  names it, and the next `/agent` there continues that run. Picked over answering only on
  the agent's own pull requests. A call made before the row was switched on starts nothing:
  picked over answering every call still open.
- On a person's pull request the agent was called on, the agent works on its branch and
  pushes there, and only a call wakes it again: its red checks and conflicts are the
  person's. One from a fork, which it cannot push to, it answers. Picked over a pull
  request of the agent's own on top of the person's, and over answering only.
- A pull request is a run's when its branch is the run's branch, as the run's record keeps
  it, so a run started with no dashboard and no git host behind it is answered too. Picked
  over the pull request the record names, which only a run with a git host learns, and
  over the runner handing every run the basic skills itself.
- About one GitHub call a minute, not one per pull request.
- A look first asks whether any issue or comment of the repository changed, by its last answer
  (ETag): "not modified" costs no call of the hour's, and then nothing is read, so the row
  can look every few seconds. Reviews, checks and conflicts have no such question: the
  whole read is made at least once a minute. Picked over the whole read at every look.
- Each comment and review a look hands a run gets 👀 from the look itself, so who wrote sees
  within seconds that an agent saw it. Picked over the agent putting it once it started.
