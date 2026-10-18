Topics: dashboard, ui
Issue: [#2142](https://github.com/openagt/openagent/issues/2142)

# The project select: same-name projects, and what shows before the first reads

## TLDR

- **Same-name projects look the same**: two repos named "shop" both read "shop" in the sidebar's project select, though their addresses differ (`/shop`, `/shop-nkp028`). Wanted: a way to tell them apart there, such as the parent folder when two names clash.
- **What shows before the first reads land**, on a project's address: the select says "All projects" for about 130 ms before naming the project, and the sidebar says "No agents yet" until the agent list is read. Wanted: nothing untrue while the reads are out.

## Why it matters

The select is how a person knows which project they are in; a wrong or ambiguous name there sends work to the wrong place.
