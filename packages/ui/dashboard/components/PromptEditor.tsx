import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '../../src/index.js'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { createDocument, type Editor, type JSONContent, type Range } from '@tiptap/core'
import { Token, type TokenSpec } from './prompt-editor/tokens.js'
import { TypedBreak, TypedText } from './prompt-editor/as-typed.js'
import { makeTrigger } from './prompt-editor/suggestion.js'
import { ScrollArea } from './ui/scroll-area.js'
import type { SuggestionItem } from './prompt-editor/SuggestionList.js'
// The same entry the Commands button renders: the `/` menu is the other face of that one list,
// so it reads the shape rather than restating it structurally.
import type { CommandEntry } from './CommandsMenu.js'
import type { OfferedPrompt } from '../lib/use-prompts.js'
import { pressed } from '../lib/shortcut.js'

// The rich prompt editor (#470): a Tiptap surface that replaces the plain textarea. `/` opens
// the project's commands and the saved prompts, `@` the registered projects, `#` the project's
// files. A project or a file is inserted as a chip that serializes back to plain text, so the
// prompt over the wire is what it reads as, and it also adds the project's path or the file to
// the Context (#439/#504); deleting the chip takes it out again. Markdown is live (StarterKit shortcuts) and
// round-trips via tiptap-markdown. Text flows out via onChange, and the handle only clears (handing
// back what it held), restores that, focuses, loads and appends.

/** What a box held, chips and all, as `clear` hands it back for `restore`. */
export type PromptDraft = JSONContent

export interface PromptEditorHandle {
  /** Empty the box, its chips' Context going with them as at any deletion. Returns what it held, for `restore`. */
  clear: () => PromptDraft
  /** Put back a draft `clear` returned, after what is typed: its chips are chips again. The Context they added is the caller's to give back. */
  restore: (draft: PromptDraft) => void
  focus: () => void
  /** Load a text (a command, a saved prompt) into the editor, with the caret unless `focus` is false. Returns whether it replaced a draft. */
  loadTemplate: (text: string, focus?: boolean) => boolean
  /** Add a text after the draft's last line, as lines of its own: the caret, the chips and the scroll stay as they are, and one undo takes it out. */
  append: (text: string) => void
  /** Type `#` or `/` at the caret, after a space where a word ends there, as a person would: its menu opens. */
  type: (trigger: '#' | '/') => void
}

interface PromptEditorProps {
  onChange: (markdown: string) => void
  /** Enter, and Cmd/Ctrl+Enter with `later` set (Claude Code's "queue for later"); Shift+Enter stays a line break (#1510). */
  onSubmit: (later?: boolean) => void
  /** A command or a saved prompt picked from the `/` menu. `replaced` says whether a typed draft
   *  was overwritten — undo brings it back, and the form's note says so. */
  onLoaded?: (label: string, replaced: boolean) => void
  /** A project referenced via `@`, so the form can add its path to the Context. */
  onMentionProject?: (path: string) => void
  /** A file referenced via `#`, so the form can add its repo-relative path to the Context. */
  onMentionFile?: (relPath: string) => void
  /** An `@`/`#` chip left the editor (deleted, or replaced by a loaded text): undo the Context
   *  entry it added, so the prompt and the Context cannot diverge (#948). */
  onMentionRemoved?: (path: string) => void
  projects: ProjectSummary[]
  /** The current project's files, repo-relative, for the `#` picker (#504). */
  files?: string[]
  /** The project's commands: each loads as `/<name> `, for the person to add an argument or send. */
  commands: CommandEntry[]
  /** The saved prompts the box offers (#626, #1025, #2394), each loaded verbatim from the `/` menu (#722). */
  prompts?: readonly OfferedPrompt[]
  /** Open the panel that saves what the box holds, from the `/` menu's "Save prompt…" (#722). Omit
   *  where there is no panel, which also drops the item. */
  onSavePrompt?: () => void
  disabled?: boolean
  placeholder?: string
  /** What a screen reader calls the box: the launcher's takes a prompt, a session's a message. */
  label?: string
  /**
   * Text to open with, applied once as soon as the editor exists (#1066/#1139).
   *
   * A prop rather than a mount-time `loadTemplate` call, because `immediatelyRender: false` leaves
   * `editor` null on the first render: the handle's loadTemplate returns false and does nothing,
   * so a caller that had already taken its one-shot draft lost it silently. Seeding through a prop
   * lets the editor apply it when it is ready instead of the caller guessing when that is.
   */
  initialText?: string | undefined
  /** Whether `initialText` takes the caret as it is applied: it does unless told not to. */
  initialFocus?: boolean
  /** A draft `initialText` is loaded over: one undo brings it back. */
  replacedText?: string | undefined
  /** Take the caret as soon as the editor exists. */
  autoFocus?: boolean
}

/** Insert a token chip at the suggestion range, followed by a space. */
function insertToken(editor: Editor, range: Range, spec: TokenSpec): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{ type: 'token', attrs: { kind: spec.kind, label: spec.label, text: spec.text } }, { type: 'text', text: ' ' }])
    .run()
}

/**
 * Replace the editor content with a text. Takes the live editor instance (not a captured one),
 * so it works from the `/` menu — whose closures are built once on first render, when the
 * useEditor result is still null.
 */
function applyTemplate(editor: Editor, text: string, focus = true): void {
  editor.commands.setContent(text)
  if (focus) editor.commands.focus('end')
  // Parsing the text as markdown drops a trailing space; a command loads as `/<name> ` so the
  // cursor waits after the space, where the `/` menu no longer matches and stays closed.
  if (/\s$/.test(text)) editor.commands.insertContent({ type: 'text', text: ' ' })
}

/** The `/` menu's item that opens the panel saving what the box holds. */
const SAVE_PROMPT = 'save-prompt'

/** A saved prompt's item in the `/` menu: the module that offers it, and its id there. */
function promptItemId(prompt: OfferedPrompt): string {
  return `prompt:${prompt.package}:${prompt.id}`
}

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor(
  { onChange, onSubmit, onLoaded, onMentionProject, onMentionFile, onMentionRemoved, projects, files = [], commands, prompts = [], onSavePrompt, disabled = false, placeholder = 'Describe what to do…', label = 'Prompt', initialText, initialFocus = true, replacedText, autoFocus = false },
  ref,
) {
  const [isEmpty, setIsEmpty] = useState(true)

  // The box takes the keyboard as it opens (`autoFocus`, the text it opens with) only while nobody
  // took it since the box was drawn. Its editor comes a moment later, and a control that took the
  // keyboard meanwhile keeps it: the question a session's page opens on, which the keys answer.
  const keysAtDraw = useRef<Element | null>(null)
  useLayoutEffect(() => {
    keysAtDraw.current = document.activeElement
  }, [])
  const keysUntaken = (): boolean => document.activeElement === null || document.activeElement === document.body || document.activeElement === keysAtDraw.current

  // Refs so the once-built suggestion closures always see the latest props/editor.
  const projectsRef = useRef(projects)
  const filesRef = useRef(files)
  const commandsRef = useRef(commands)
  const promptsRef = useRef(prompts)
  const onSavePromptRef = useRef(onSavePrompt)
  const onLoadedRef = useRef(onLoaded)
  const onMentionProjectRef = useRef(onMentionProject)
  const onMentionFileRef = useRef(onMentionFile)
  const onMentionRemovedRef = useRef(onMentionRemoved)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    projectsRef.current = projects
    filesRef.current = files
    commandsRef.current = commands
    promptsRef.current = prompts
    onSavePromptRef.current = onSavePrompt
    onLoadedRef.current = onLoaded
    onMentionProjectRef.current = onMentionProject
    onMentionFileRef.current = onMentionFile
    onMentionRemovedRef.current = onMentionRemoved
    onChangeRef.current = onChange
    onSubmitRef.current = onSubmit
  })

  // The `@`/`#` chips currently in the doc, as their serialized texts. Deleting a chip must also
  // undo the Context entry it added (#948): the chip was the only visible sign of it, so a
  // chipless prompt silently carrying it was a lie. Compared on every doc change; additions are
  // the pickers' own callbacks.
  const mentionsRef = useRef<Set<string>>(new Set())
  const syncMentions = (ed: Editor): void => {
    const now = new Set<string>()
    ed.state.doc.descendants(node => {
      if (node.type.name === 'token' && (node.attrs.kind === 'project' || node.attrs.kind === 'file')) now.add(String(node.attrs.text))
      return true
    })
    for (const gone of mentionsRef.current) {
      if (now.has(gone)) continue
      if (gone.startsWith('#')) {
        onMentionRemovedRef.current?.(gone.slice(1))
      } else if (gone.startsWith('@')) {
        // A project chip carries its name; the Context holds its path.
        const project = projectsRef.current.find(p => p.name === gone.slice(1))
        if (project) onMentionRemovedRef.current?.(project.path)
      }
    }
    mentionsRef.current = now
  }

  // Load a template into the live editor and sync the derived state (the empty flag + the
  // markdown out). Takes the editor as an argument so the `/` menu — whose closures are built
  // once, before useEditor resolves — can call it too, not only the imperative handle.
  // Replacing a typed draft loads without a blocking confirm (#948): the replacement is one
  // undo step (history groups the draft separately after its ~500ms window), and the caller
  // gets `replaced` back so its note can say "undo brings it back".
  const loadTemplateInto = (ed: Editor, text: string, focus = true): boolean => {
    const replaced = !ed.isEmpty
    applyTemplate(ed, text, focus)
    // setContent emits no update, so the chips are reconciled here too.
    syncMentions(ed)
    setIsEmpty(ed.isEmpty)
    onChangeRef.current(ed.storage.markdown.getMarkdown())
    return replaced
  }

  // What a `/` menu item loads, and what the form's note calls it: a command as `/<name> `, for the
  // person to add an argument or send; a saved prompt, the person's own (#626) or the project's
  // (#1025), verbatim.
  const loadedBy = (id: string): { label: string; text: string } | undefined => {
    const command = commandsRef.current.find(c => `command:${c.name}` === id)
    if (command) return { label: `/${command.name}`, text: `/${command.name} ` }
    const prompt = promptsRef.current.find(p => promptItemId(p) === id)
    return prompt && { label: prompt.label, text: prompt.text }
  }

  const editor = useEditor({
    immediatelyRender: false,
    onCreate: ({ editor: created }) => {
      if (autoFocus && keysUntaken()) created.commands.focus('end')
    },
    extensions: [
      // The words and the line breaks go out as typed, never escaped (as-typed.ts).
      StarterKit.configure({ text: false, hardBreak: false }),
      TypedText,
      TypedBreak,
      // breaks:true keeps a single newline as a hard break, so a saved prompt's line-per-line
      // block survives the markdown round-trip instead of collapsing into one paragraph.
      Markdown.configure({ html: false, linkify: false, breaks: true, transformPastedText: true }),
      Token,
      // `/` — the project's commands, then the saved prompts.
      makeTrigger({
        char: '/',
        key: 'slash',
        items: query => {
          const q = query.toLowerCase()
          // A command typed in full: nothing is left to pick, so the menu closes.
          if (commandsRef.current.some(c => c.name === q)) return []
          const commandItems: SuggestionItem[] = commandsRef.current
            .filter(c => c.name.includes(q))
            .map(c => ({ id: `command:${c.name}`, label: `/${c.name}`, group: 'Commands', ...(c.description ? { title: c.description } : {}) }))
          // The saved prompts (#626, #1025) load verbatim, each hinted with whose it is.
          const promptItems: SuggestionItem[] = promptsRef.current
            .filter(p => p.label.toLowerCase().includes(q))
            .map(p => ({ id: promptItemId(p), label: p.label, hint: p.group, group: 'Saved prompts' }))
          // "Save prompt…" to capture the current prompt (#722), only where the panel that saves it exists.
          const saveItem: SuggestionItem[] =
            onSavePromptRef.current && 'save prompt'.includes(q)
              ? [{ id: SAVE_PROMPT, label: 'Save prompt…', hint: 'save the current prompt', group: 'Saved prompts' }]
              : []
          return [...commandItems, ...promptItems, ...saveItem]
        },
        onSelect: (item, { editor: ed, range }) => {
          if (item.id === SAVE_PROMPT) {
            // Drop the `/query` trigger so the panel captures the real prompt, not the slash.
            ed.chain().focus().deleteRange(range).run()
            onSavePromptRef.current?.()
            return
          }
          const loaded = loadedBy(item.id)
          if (!loaded) return
          // Drop the `/query` trigger first so it does not count as a replaced draft.
          ed.chain().focus().deleteRange(range).run()
          const replaced = loadTemplateInto(ed, loaded.text)
          onLoadedRef.current?.(loaded.label, replaced)
        },
      }),
      // `@` — references: the registered projects, by name.
      makeTrigger({
        char: '@',
        key: 'at',
        emptyNote: 'No projects to reference yet.',
        items: query =>
          projectsRef.current
            .filter(p => p.name.toLowerCase().includes(query))
            .slice(0, 8)
            .map(p => ({ id: `project:${p.id}`, label: `@${p.name}`, hint: 'project', group: 'Projects' })),
        onSelect: (item, { editor: ed, range }) => {
          const project = projectsRef.current.find(p => `project:${p.id}` === item.id)
          if (project) {
            insertToken(ed, range, { kind: 'project', label: `@${project.name}`, text: `@${project.name}` })
            onMentionProjectRef.current?.(project.path)
          }
        },
      }),
      // `#` — files: the finer-grained sibling of `@` (#504). Type to filter the project's
      // files (git ls-files); picking one writes its path into the prompt and adds it to the Context.
      makeTrigger({
        char: '#',
        key: 'hash',
        emptyNote: 'No files indexed here yet.',
        items: query =>
          filesRef.current
            .filter(f => f.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map(f => ({ id: `file:${f}`, label: `#${f}`, path: f, hint: 'file', group: 'Files' })),
        onSelect: (item, { editor: ed, range }) => {
          const rel = item.id.slice('file:'.length)
          insertToken(ed, range, { kind: 'file', label: `#${rel}`, text: `#${rel}` })
          onMentionFileRef.current?.(rel)
        },
      }),
    ],
    editorProps: {
      // The bare contenteditable needs its textbox semantics spelled out (#948): without them a
      // screen reader gets an unlabeled editable region, and the placeholder span is decorative.
      attributes: {
        class: 'pe-prose focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'aria-placeholder': placeholder,
      },
      handleKeyDown: (view, event) => {
        if (pressed(event, 'sendLater')) {
          event.preventDefault()
          onSubmitRef.current(true)
          return true
        }
        // Enter sends, Shift+Enter breaks the line (#1510) — Claude Code web's bindings. This
        // direct prop outranks the plugins' handlers, so it must step aside where Enter already
        // means something: picking from an open suggestion menu (aria-expanded mirrors its
        // visibility), typing a newline in a code block, or confirming an IME composition.
        if (pressed(event, 'send')) {
          if (view.dom.getAttribute('aria-expanded') === 'true') return false
          if (view.state.selection.$from.parent.type.name === 'codeBlock') return false
          event.preventDefault()
          onSubmitRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      syncMentions(ed)
      setIsEmpty(ed.isEmpty)
      onChangeRef.current(ed.storage.markdown.getMarkdown())
    },
  })

  useImperativeHandle(ref, () => ({
    clear: () => {
      const draft = editor?.getJSON() ?? {}
      editor?.commands.clearContent()
      if (editor) syncMentions(editor)
      setIsEmpty(true)
      onChangeRef.current('')
      return draft
    },
    restore: draft => {
      if (!editor) return
      // Over the empty paragraph of an empty box, else after the draft's last line, the caret left where it is.
      const end = editor.state.doc.content.size
      editor.commands.insertContentAt(editor.isEmpty ? { from: 0, to: end } : end, draft.content ?? [], { updateSelection: false })
    },
    focus: () => editor?.commands.focus('end'),
    loadTemplate: (text: string, focus?: boolean) => (editor ? loadTemplateInto(editor, text, focus) : false),
    type: trigger => {
      if (!editor) return
      const before = editor.state.selection.$from.nodeBefore?.text ?? ''
      // As text, not markdown: a `#` parsed would make the line a heading.
      editor.chain().focus().insertContent({ type: 'text', text: before !== '' && !/\s$/.test(before) ? ` ${trigger}` : trigger }).run()
    },
    append: (text: string) => {
      if (!editor) return
      if (editor.isEmpty) return void loadTemplateInto(editor, text, false)
      // Parsed as blocks, as a loaded text is: the insert command's own inline parse leaves `<` as `&lt;` in plain words.
      const blocks = createDocument(editor.storage.markdown.parser.parse(text), editor.schema).content
      editor.commands.insertContentAt(editor.state.doc.content.size, blocks, { updateSelection: false })
    },
  }))

  // Switched off while a start is asked for, and on again after. That is no edit, so no change is
  // told: a form that drops its error at the next edit would drop the refusal the moment it landed.
  useEffect(() => {
    editor?.setEditable(!disabled, false)
  }, [editor, disabled])

  // Seed {@link PromptEditorProps.initialText} the moment the editor exists, and only ever once:
  // it is an opening draft, not a controlled value, so re-applying it would overwrite whatever the
  // user has typed since. The ref (not state) because seeding must not itself cause a render.
  const seeded = useRef(false)
  useEffect(() => {
    if (!editor || seeded.current || !initialText) return
    seeded.current = true
    // The draft beneath is no step of its own, so the undo of the load ends on it, not on an empty box.
    if (replacedText) editor.chain().setMeta('addToHistory', false).setContent(replacedText).run()
    loadTemplateInto(editor, initialText, initialFocus && keysUntaken())
  }, [editor, initialText])

  // The placeholder is absolutely positioned, so it must share the editor's padding (`px-2 py-2`)
  // to sit exactly where the first typed character will (#721). The composer's box is one line tall
  // when empty, as tall as the submit beside it. One line too: on a phone a long one is cut short,
  // where a second line would hang out of the box.
  return (
    <div className="relative">
      {/* The scroll rides a ScrollArea (#1046) so a long prompt shows our thin overlay bar, not the
          OS one. The resting height is deliberately short (#756): the editor grows with its content
          up to max-h, so the tall empty box no longer reserves room for text nobody has typed.
          The border lives on the surrounding composer box (#721) so the editor and its controls
          read as one surface. */}
      <ScrollArea
        // The height cap goes on the viewport (the scroller), not the Root — a Root max-h cannot be
        // resolved by the viewport's height, so the editor would grow instead of scrolling.
        viewportClassName="max-h-64 min-h-9"
      >
        <EditorContent editor={editor} className="w-full bg-transparent not-pointer-coarse:text-sm pointer-coarse:text-base px-2 py-2" />
      </ScrollArea>
      {isEmpty && (
        <span className="pointer-events-none absolute truncate not-pointer-coarse:text-sm text-faint-foreground pointer-coarse:text-base inset-x-2 top-2">
          {placeholder}
        </span>
      )}
    </div>
  )
})
