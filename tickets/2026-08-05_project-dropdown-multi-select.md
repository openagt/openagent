Topics: dashboard, ux
Issue: [#1513](https://github.com/openagt/openagent/issues/1513)
PR: [#2371](https://github.com/openagt/openagent/pull/2371)

# Project dropdown

## TLDR

A project select at the top of the sidebar that filters every page. First cut done in PR #1923: a single select (one project or "All") at the top of the sidebar, set apart by a rule, filtering every page.

Left: make it a multi-select —
- a checkbox per project, plus the special value "All";
- clicking a checkbox adds/removes that project; clicking elsewhere on the project's line selects only that project;
- the selected projects shown at the top of the dropdown;
- tooltips to clarify how to use it.

Labelled `only-if-quick-win`.

## Why it matters

Lets people with several projects focus the whole dashboard on a subset of them.
