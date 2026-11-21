import type { UiQuestionProps } from '../module/index.js'
import { renderFor, useMountedModules } from '../lib/use-modules.js'
import { ModuleSlot } from './ModulePageView.js'

/**
 * A question a run stopped on, in the chat: drawn by the module that asks (`ui.render`, kind
 * `question`, ask's card), in its slot, where it is on in the run's project. Where none is, the
 * question in words, what it asks and what it offers: the person replies with a message.
 */
export function AskedQuestion(props: UiQuestionProps) {
  const render = renderFor(useMountedModules(), 'question', props.projectId)
  if (!render) return <QuestionInWords question={props.question} />
  const { Render } = render
  return (
    <ModuleSlot package={render.package} label="question">
      <Render {...props} />
    </ModuleSlot>
  )
}

/** A question as words: its title, then each option, with its detail. */
function QuestionInWords({ question }: Pick<UiQuestionProps, 'question'>) {
  return (
    <section aria-label={question.title} className="flex w-full max-w-140 flex-col gap-2 font-sans text-sm">
      <p>{question.title}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        {question.options.map(option => (
          <li key={option.id}>
            <span className="text-foreground">{option.label}</span>
            {option.detail && ` — ${option.detail}`}
          </li>
        ))}
      </ul>
    </section>
  )
}
