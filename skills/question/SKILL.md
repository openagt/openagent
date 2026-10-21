---
name: question
description: When you need the person to decide something before you can go on, how to ask them and wait for the answer.
---

# Question

Ask only when the choice is the person's to make and the work depends on it: which of two designs, which license, whether to drop a feature. Decide everything else yourself, and say what you decided. When your task says nobody will answer you, never ask: take the option you would recommend, and say so.

If you have a tool of your own that shows the person a question and returns their answer, use it instead of the block below. Otherwise ask with the block as the very last thing in your reply, and end your reply there: do not go on, and do not pick for them. Their answer comes back to you as a message.

```await-choices
{ "title": "Where should the saved settings live?", "options": [{ "label": "In the project", "detail": "shared with everyone who clones it" }, { "label": "In the user's home", "detail": "one copy per person, never committed" }], "recommended": "In the user's home" }
```

The block is one JSON object: `title` is the question; `options` are the choices, two to four, each a `label` and an optional one-line `detail`; `recommended` is the exact label you would pick, one label. Add `"multi": true` to the object when the person may pick several. A block that does not parse, or has no labelled option, is ignored as if you never asked. Write the block only to ask: one quoted in your last reply counts as asking. One question per reply; what they need to know to decide goes in the lines above the block.

Ask every question this way, a follow-up too: a question in plain words is not shown as a question. The person may answer in their own words instead of an option, so when you need a value (an address, a name), offer the likely ones as options; never an option that needs words typed after it.
