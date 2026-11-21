import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'

// The box's words go out as they were typed. tiptap-markdown escapes the text it writes, so a typed
// `~/a`, `GIT_AUTHOR_*` or `<div>` came out as `\~/a`, `GIT\_AUTHOR\_\*` or `&lt;div&gt;`, and it
// ends a Shift+Enter line with a backslash: those went to the agent and showed in the chat. What
// the box marks as markdown (a list, a heading, bold) is written as markdown still; the words in it
// are the person's own.

interface Writer {
  text: (text: string, escape?: boolean) => void
  write: (text?: string) => void
}

interface Inline {
  type: unknown
  text: string
}

/** The words, unescaped. */
export const TypedText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: Writer, node: Inline) {
          state.text(node.text, false)
        },
        parse: {},
      },
    }
  },
})

/** A line broken with Shift+Enter, as a newline (the box reads one back as a break: `breaks: true`). A break with no words after it is dropped. */
export const TypedBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: Writer, node: Inline, parent: { childCount: number; child: (at: number) => Inline }, index: number) {
          for (let at = index + 1; at < parent.childCount; at++) {
            if (parent.child(at).type !== node.type) return void state.write('\n')
          }
        },
        parse: {},
      },
    }
  },
})
