import { readFile, realpath } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { declaring, packageBins, readManifest, runPackageCommand, SKILLS_ENV, type ProjectPackage, type ProvidedCommand } from '@openagt/agent-data'
import type { SkillLink } from '@openagt/skill-branches'

/**
 * The basic skills (#2023): the ones every run gets, with nothing committed in the project. Each
 * one's text is linked into the agent's checkout, hidden from git, beside the branches skill the
 * checkout already carries, and with it the skill's package and command, so the text's
 * `npx @openagt/skill-logs@0.1` runs that very copy. A project that tracks its own copy of one
 * keeps it: an entry already in the checkout is left alone.
 *
 * This tool names no skill: the package that started OpenAgent owns the list and hands it down in
 * {@link SKILLS_ENV}, the directories of the skills' packages, so a run started by hand, with
 * nothing set, gets none. A git host's skill is linked only where its package answers the
 * project's page there (its `home` command): its text says the project's pull requests are on
 * that host, which is wrong anywhere else.
 */

interface BasicSkill {
  link: SkillLink
  pkg: ProjectPackage
  /** The package's git host command, when it declares one: asked before its skill is linked. */
  gitHost?: ProvidedCommand
}

/** The list as last read, by the value it was read off: the environment is read on each ask. */
let resolved: { from: string; skills: Promise<BasicSkill[]> } | undefined

function basic(): Promise<BasicSkill[]> {
  const from = process.env[SKILLS_ENV] ?? ''
  if (resolved?.from !== from) resolved = { from, skills: resolveBasic(from) }
  return resolved.skills
}

/** The skills of the package directories `from` names; one that is no package with a skill's text is skipped. */
async function resolveBasic(from: string): Promise<BasicSkill[]> {
  const skills: BasicSkill[] = []
  for (const named of from.split(delimiter).filter(Boolean)) {
    const dir = await realpath(named).catch(() => undefined)
    const manifest = dir ? await readManifest(join(dir, 'package.json')) : undefined
    const name = typeof manifest?.name === 'string' ? manifest.name : undefined
    const skill = dir ? skillName(await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => '')) : undefined
    if (!dir || !manifest || !name || !skill) continue
    const bins = packageBins(name, manifest.bin, dir)
    const gitHost = declaring([{ name, dir, manifest }], 'git-host')[0]
    skills.push({ link: { name: skill, dir, ...(Object.keys(bins).length > 0 ? { package: { name, dir, bins } } : {}) }, pkg: { name, dir, manifest }, ...(gitHost ? { gitHost } : {}) })
  }
  return skills
}

/** The `name` a skill's text gives in its front matter: the directory a harness lists it under. */
function skillName(text: string): string | undefined {
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1]
  const name = frontMatter ? /^name:\s*([a-z0-9][a-z0-9-]*)\s*$/m.exec(frontMatter)?.[1] : undefined
  return name
}

/** Every basic skill handed down, whatever the project: what a cleanup takes the rules back for. */
export async function everyBasicSkill(): Promise<SkillLink[]> {
  return (await basic()).map(skill => skill.link)
}

/** The basic skills of the project at `repo`: all of them, a git host's only where it answers for the project. */
export async function basicSkills(repo: string): Promise<SkillLink[]> {
  const skills: SkillLink[] = []
  for (const { link, gitHost } of await basic()) {
    if (gitHost && !(await runPackageCommand(repo, gitHost, ['home'])).ok) continue
    skills.push(link)
  }
  return skills
}

/**
 * The basic packages that answer as the git host of the project at `repo`: what a run reads its
 * pull request back through in a project that installed no git host of its own.
 */
export async function basicGitHosts(repo: string): Promise<ProjectPackage[]> {
  const hosts: ProjectPackage[] = []
  for (const { pkg, gitHost } of await basic()) {
    if (gitHost && (await runPackageCommand(repo, gitHost, ['home'])).ok) hosts.push(pkg)
  }
  return hosts
}

/** The names of the basic skills' packages: a project's own copy of one is never read as its git host. */
export async function basicPackageNames(): Promise<string[]> {
  return (await basic()).map(skill => skill.pkg.name)
}
