import { Node, mergeAttributes } from '@tiptap/core'

// The prompt editor's tokens (#470). A token is an inline chip that reads as a pill in the
// editor but serializes back to plain text: a project (`@my-app`) or a file (`#src/a.ts`).
// Because a chip flattens to its `text` verbatim, the prompt over the wire is what it reads as.

/** What a token is, which drives its chip colour and which menu inserts it. */
export type TokenKind = 'project' | 'file'

/** One insertable token: how it reads (label) and how it serializes (text). */
export interface TokenSpec {
  kind: TokenKind
  /** The chip label shown in the editor. */
  label: string
  /** The exact string written to the prompt on submit. */
  text: string
}

/**
 * The inline token node. It is an atom (edited as one unit, not character-by-character) that
 * carries its display `label` and its serialized `text`. `tiptap-markdown` serializes it by
 * writing `text` raw, with no escaping.
 */
export const Token = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'file' as TokenKind },
      label: { default: '' },
      text: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-token]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-token': node.attrs.kind,
        class: 'pe-token',
      }),
      node.attrs.label || node.attrs.text,
    ]
  },

  // Plain-text extraction (editor.getText) — mirrors the markdown serialization below.
  renderText({ node }) {
    return node.attrs.text
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { text: string } }) {
          state.write(node.attrs.text)
        },
        parse: {},
      },
    }
  },
})
