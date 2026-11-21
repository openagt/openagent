// `@openagt/skills`: the skills module (#2394). Its Node part links a run's skills where it works
// (`./module`); its UI part is Settings › Skills (`./dashboard`), which lists a project's own
// skills and installs nothing, and its server part what that page reads (`./server`). From here,
// the readers the shell's message box uses for the commands and skills it offers, until the box's
// controls are the modules' own.
export { readProjectSkills, type ProjectSkill } from './project-skills.js'
export { leavingOut, leftOutSkillPaths, projectSkillNames } from './left-out.js'
export { skillsOn, startBranch, type OnBranch, type StartBranch } from './on-branch.js'
