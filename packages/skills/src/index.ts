// `@openagt/skills`: the skills module (#2394), a project's own skills. Its UI part is Settings ›
// Skills (`./dashboard`), which lists them and installs nothing, and its server part what that page
// reads (`./server`). From here, the readers the shell's message box uses for the commands it
// offers, until the box's controls are the modules' own.
export { readProjectSkills, type ProjectSkill } from './project-skills.js'
export { skillsOn, startBranch, type OnBranch, type StartBranch } from './on-branch.js'
