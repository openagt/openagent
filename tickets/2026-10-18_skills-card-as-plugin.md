Topics: skills, dashboard, plugins
Issue: [#2144](https://github.com/openagt/openagent/issues/2144)

# The skills card as a plugin of the package that installs skills

## TLDR

The card that adds and updates a project's skills (#2117; today `ProjectSkillsLine` on the New agent page, built into the dashboard, its sending code calling `@openagt/init`) becomes a UI plugin of the package that installs skills, the way Tickets and Queue bring their own pages and cards. Add a card on the Overview showing the same data. The dashboard core then knows nothing about skills.

Open: which package owns it — `@openagt/init`, or Rom's skills tool (`use-skills` / GemSkills).

## Why it matters

Keeps the dashboard core free of skill-specific code, consistent with how other features plug in.
