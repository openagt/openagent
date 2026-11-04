---
name: ask
description: Required for every question to the person: a question written as plain text never reaches them, only one asked with this skill does.
---

# Question

Ask only when the choice is the person's to make and the work depends on it: which of two designs, which license, whether to drop a feature. Decide everything else yourself, and say what you decided. When your task says nobody will answer you, never ask: take the option you would recommend, and say so.

Ask with the block as the very last thing in your reply, and end your reply there: do not go on, and do not pick for them. Their answer comes back to you as a message.

```await-choices
{ "title": "Where should the saved settings live?", "header": "Settings", "options": [{ "label": "In the project", "detail": "shared with everyone who clones it" }, { "label": "In the user's home", "detail": "one copy per person, never committed" }], "recommended": "In the user's home" }
```

The block starts with the line ```await-choices and ends with the line ```, as above: without those two lines the person sees raw JSON, not a question. Inside, the block is one JSON object: `title` is the question; `header` names it in a word or two ("Settings"); `options` are the choices, two to four, each a `label` and a one-line `detail` saying what picking it does; `recommended` is the exact label you would pick, one label. Add `"multi": true` to the object when the person may pick several. A block that does not parse, or has no labelled option, is ignored as if you never asked. Write the block only to ask: one quoted in your last reply counts as asking. One question per reply. Write nothing before the block, not the question again: the card shows it. Anything they need to know to decide goes in an option's detail.

Ask every question this way, a follow-up too: a question in plain words is not shown as a question. The person may answer in their own words instead of an option, so when you need a value (an address, a name), offer the likely ones as options; never an option that needs words typed after it.

An agent that has a tool of its own for asking, as Claude Code in a terminal has its AskUserQuestion, uses that instead of the block.
