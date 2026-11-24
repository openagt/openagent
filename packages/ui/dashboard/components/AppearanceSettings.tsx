import { useId } from 'react'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { ACCENTS, DEFAULT_ACCENT_LABELS, accentOf, CODE_FONTS, DOCUMENT_FONTS, FONTS, PALETTES, PALETTE_LABELS, type Accent, type CodeFont, type DocumentFont, type Font, type Palette } from '../../src/client.js'
import { useDetectedEditors } from '../lib/editors.js'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { Section } from './ui/section.js'
import { Segmented } from './ui/segmented.js'
import { cn } from '../lib/utils.js'
import { SettingsRow, SettingsSection, SettingsSelectRow, ToggleRow } from './SettingsRows.js'

// Settings › Appearance: the theme, as three small pictures of the page; then the colours, the
// primary colour as its swatches, the three fonts, the editor, and the Overview's checklist.

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function AppearanceSettings() {
  const preferences = usePreferences()
  const editors = useDetectedEditors()
  const palette = preferences.palette ?? 'openagent'
  return (
    <div className="space-y-8">
      <Section title="Theme">
        <ThemePick value={themePreference(preferences)} onChange={theme => updatePreferences({ theme })} />
      </Section>
      <Section title="Colours and fonts">
        <SettingsSection>
          <SettingsRow
            label="Colours"
            description="OpenAgent’s own Everforest colours, or neutral greys."
            control={
              <Segmented
                label="Colours"
                value={palette}
                options={PALETTES.map(p => ({ value: p, label: PALETTE_LABELS[p] }))}
                // A primary colour is one of the palette's own: the new palette starts on its default.
                onChange={next => updatePreferences({ palette: next as Palette, accent: '' as Accent })}
                className="max-md:flex"
              />
            }
          />
          <Swatches palette={palette} value={accentOf(palette, preferences.accent) ?? ''} onChange={accent => updatePreferences({ accent })} />
          <SettingsSelectRow
            label="Font"
            description="The font of the page and the chat."
            value={preferences.font ?? 'ibm-plex-sans'}
            options={Object.entries(FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ font: value as Font })}
          />
          <SettingsSelectRow
            label="Code font"
            description="Code blocks, the files an agent read, the Files pane."
            value={preferences.codeFont ?? 'jetbrains-mono'}
            options={Object.entries(CODE_FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ codeFont: value as CodeFont })}
          />
          <SettingsSelectRow
            label="File preview font"
            description="A Markdown file read in the Files pane."
            value={preferences.documentFont ?? 'source-serif-4'}
            options={Object.entries(DOCUMENT_FONTS).map(([value, label]) => ({ value, label }))}
            onChange={value => updatePreferences({ documentFont: value as DocumentFont })}
          />
          <SettingsSelectRow
            label="Editor"
            description="Which editor “Open in editor” launches."
            value={preferences.editor ?? ''}
            options={[{ value: '', label: 'Auto-detect' }, ...editors.map(e => ({ value: e.bin, label: e.label }))]}
            onChange={value => updatePreferences({ editor: value })}
          />
          {/* The Overview's checklist hides with its own ✕, and comes back here. */}
          <ToggleRow
            label="Discover OpenAgent on the Overview"
            description="What a new install can set up, first on the Overview until every step is done."
            checked={!(preferences.onboardingDismissed ?? false)}
            onChange={next => updatePreferences({ onboardingDismissed: !next })}
          />
        </SettingsSection>
      </Section>
    </div>
  )
}

/** The theme, picked from three small pictures of the page in it: System half light and half dark. */
function ThemePick({ value, onChange }: { value: ThemePreference; onChange: (next: ThemePreference) => void }) {
  return (
    <RadioGroupPrimitive aria-label="Theme" value={value} onValueChange={next => onChange(next as ThemePreference)} className="grid grid-cols-3 gap-3">
      {THEMES.map(theme => (
        <Radio.Root key={theme.value} value={theme.value} className="group/theme focus-ring flex cursor-pointer flex-col gap-2 rounded-lg outline-offset-4">
          <span className="flex h-16 overflow-hidden rounded-lg ring-1 ring-hairline transition-shadow group-data-[checked]/theme:ring-2 group-data-[checked]/theme:ring-primary">
            {theme.value === 'system' ? (
              <>
                <Page scheme="light" />
                <Page scheme="dark" />
              </>
            ) : (
              <Page scheme={theme.value} />
            )}
          </span>
          <span className="text-center text-xs text-muted-foreground group-data-[checked]/theme:font-medium group-data-[checked]/theme:text-foreground">{theme.label}</span>
        </Radio.Root>
      ))}
    </RadioGroupPrimitive>
  )
}

/** A page drawn small in one scheme's own colours: its sidebar, and two cards on it. */
function Page({ scheme }: { scheme: 'light' | 'dark' }) {
  return (
    <span data-scheme={scheme} aria-hidden className="flex flex-1 bg-background">
      <span className="w-6 shrink-0 border-r border-hairline bg-sidebar" />
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-3 rounded-sm bg-card ring-1 ring-hairline" />
        <span className="h-3 w-2/3 rounded-sm bg-card ring-1 ring-hairline" />
      </span>
    </span>
  )
}

/** The primary colour as its swatches, each painted in its own colour (tailwind.css), and the picked one's name after them. */
function Swatches({ palette, value, onChange }: { palette: Palette; value: Accent | ''; onChange: (next: Accent) => void }) {
  const named = useId()
  const label = (accent: Accent | ''): string => (accent === '' ? DEFAULT_ACCENT_LABELS[palette] : accent.charAt(0).toUpperCase() + accent.slice(1))
  const accents: (Accent | '')[] = ['', ...ACCENTS[palette]]
  // Neutral's seventeen do not fit beside the words: they stand under them, as on a phone.
  const under = accents.length > 8
  return (
    <SettingsRow
      label="Primary colour"
      description="Buttons, links and what is picked, in the colours’ own hues."
      stacked={under}
      control={
        <div className="flex flex-wrap items-center gap-3">
          <RadioGroupPrimitive aria-label="Primary colour" aria-describedby={named} value={value} onValueChange={next => onChange(next as Accent)} className="flex flex-wrap gap-3">
            {accents.map(accent => (
              <Radio.Root
                key={accent}
                value={accent}
                aria-label={label(accent)}
                data-swatch={accent}
                // A finger's 36 around each on a phone, the 12 between them included.
                className={cn('focus-ring relative size-6 cursor-pointer rounded-full bg-primary ring-1 ring-foreground/10 ring-inset pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5', 'data-[checked]:outline-2 data-[checked]:outline-offset-2 data-[checked]:outline-foreground')}
              />
            ))}
          </RadioGroupPrimitive>
          <span id={named} className="text-sm text-muted-foreground">
            {label(value)}
          </span>
        </div>
      }
    />
  )
}
