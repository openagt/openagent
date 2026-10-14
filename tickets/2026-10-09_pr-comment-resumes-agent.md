Topics: automations, scheduler, github
Issue: [#2042](https://github.com/openagt/openagent/issues/2042)

# A comment on an agent's pull request resumes that agent

## TLDR

Today a comment on a pull request an agent opened starts a new agent, which knows nothing of the first one's conversation. Instead:

1. **The comment resumes the run that opened the pull request.** The scheduler finds new comments, looks up the run whose record names that pull request, and resumes it with the comments handed over.
2. **The resumed agent reads the thread again first**, and answers from the thread as it stands.
3. **Fallback when the run cannot be resumed here** (it ran on another machine, or its conversation is gone): a new agent starts, told to read the first agent's record and the thread first.
4. **One agent per pull request**: a comment never reaches two agents.
5. **A row on the Automations page**, off by default like every row, with its pace and its publish level.

Not part of this: GitHub calling the machine when a comment arrives (the scheduler asks, as every row does); a session that stays alive between comments.

## Why it matters

The agent that wrote the code knows why it is so, what was tried and dropped, and what was promised on the thread; a fresh agent does not. Every run's record already keeps its pull request, and runs can already be resumed: nothing connects the two yet.

## Open questions

1. Whose comments count: anyone's, or only people who can write to the repository. The agent's own comments must never count.
2. Line review comments and failing checks: the same way, or later.
3. A pull request a person opened, with no run behind it: nothing, or a new agent.
4. Which machine: only the one that ran the first agent holds its conversation.

## Notes

- https://github.com/nitedani/mergeworthy works this way ("the session is the agent"): a watcher per thread only records events and adds 👀; the session that opened the pull request is woken and drafts its answer from one file holding the whole thread and the threads it links to.
