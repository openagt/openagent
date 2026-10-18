Topics: skills, plugins, dashboard
Issue: [#2144](https://github.com/openagt/openagent/issues/2144)

# The skills card as a plugin of the package that installs skills

## TLDR

The card that adds and updates a project's skills (#2117) becomes a UI plugin of the package that installs skills, the way Tickets and Queue bring their own pages and cards, plus a card on the Overview showing the same data. Today it is built into the dashboard (`ProjectSkillsLine` on the New agent page) and its sending code calls `@openagt/init`.

Open: which package owns it: `@openagt/init`, or Rom's skills tool (`use-skills` / GemSkills).

## Why it matters

With the plugin, the dashboard core knows nothing about skills.
