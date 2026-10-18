Topics: dependencies, dashboard
Issue: [#2143](https://github.com/openagt/openagent/issues/2143)

# base-ui rename warnings at install

## TLDR

Installing the dashboard from npm prints two "deprecated" warnings: `@base-ui-components/react` and `@base-ui-components/utils` were renamed to `@base-ui/react` and `@base-ui/utils`. We pin `@base-ui-components/react@1.0.0-rc.0` in three packages (`openagent`, `files`, `changes`), imported by 17 source files. Move to `@base-ui/react`.

## Why it matters

A new user's install should print no warning.
