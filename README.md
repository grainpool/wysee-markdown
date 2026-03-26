# Wysee MD

A WYSIWYG-style Markdown editor for VS Code and VSCodium. Edit Markdown visually with a rendered canvas, live preview, and full source synchronization.

## Features

**Visual Markdown editing** — Markdown files open in a rendered canvas by default. Double-click any block to edit its raw Markdown in an inline panel with a live side-by-side preview. All edits write back to the source document.

**Inline block insertion** — `(+)` buttons between blocks let you insert new content directly where you want it. Type raw Markdown on the left, see it rendered on the right, confirm to insert.

**Bidirectional scroll sync** — Toggle "Sync scroll" to keep the WYSIWYG canvas and source editor aligned. Click a block in the canvas to jump to and highlight its source text.

**Syntax highlighting** — Fenced code blocks render with language-specific coloring. Choose from built-in syntax styles (Match Editor Theme, Light, Dark), create custom syntax themes with per-language overrides, or disable highlighting per language. Managed from the Style panel.

**Mermaid diagrams** — Fenced `mermaid` code blocks render as interactive diagrams in the canvas, print output, and HTML export.

**Math rendering** — Inline `$...$` and block `$$...$$` math expressions rendered via KaTeX.

**Footnotes** — `[^1]` references render as superscripts with a footnote section at the document end. Edit footnote text directly from the referencing block's edit panel.

**Strikethrough** — `~~text~~` renders with line-through decoration.

**Spellcheck** — Integrated spellcheck in both the canvas and source editor. Misspelled words show a red wavy underline. Right-click to add to dictionary, ignore, or replace.

**Theming** — Switch between document styles (Match Editor Theme, Light, Dark, or custom), syntax highlighting styles, and print profiles from a side panel with inline JSON editing and live preview. Document styles can link to syntax styles and print profiles can link to document styles.

**Print & PDF** — Browser-based print flow with configurable page size, margins, page numbers, mirror margins, and code wrapping. Print profiles can link to specific document styles.

**Context menu** — Right-click to insert headings, links, images, quotes, footnotes, code fences, mermaid fences, task lists, horizontal rules, and tables. Works in the canvas, source editor, and inside the edit panel's raw text area.

**Copy control** — Configure whether copying from the canvas produces plain text (default) or source Markdown. Boundary `(+)` elements are never included in clipboard content.

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=grainpool.wysee-md) or [Open VSX](https://open-vsx.org/extension/grainpool/wysee-md) for VSCodium.

Or install from VSIX:

```
code --install-extension wysee-md-0.9.0.vsix
```

## Usage

Open any `.md` file — it opens in the Wysee MD canvas by default.

- **Double-click** a block to edit its raw Markdown with live preview
- **Click** `(+)` between blocks to insert new content
- **Right-click** for the Insert MD Block context menu
- Use the title bar buttons for **Print**, **Save PDF**, **Style**, and **Source**
- Toggle **Sync scroll** in the top bar to link canvas and source scrolling

To open in the standard text editor instead, use `Open With...` and select Text Editor. Use the `Restore Built-in Default` command to revert file associations.

## Settings

| Setting | Default | Description |
|---|---|---|
| `wyseeMd.preview.editable` | `true` | Enable block editing in the canvas |
| `wyseeMd.preview.syncScroll` | `true` | Bidirectional scroll synchronization |
| `wyseeMd.preview.syntaxHighlight` | `true` | Enable syntax highlighting in code blocks |
| `wyseeMd.preview.copyMode` | `plainText` | Copy mode: `plainText` or `sourceMarkdown` |
| `wyseeMd.preview.insertRelativeToBlock` | `after` | Insert position: `before` or `after` |
| `wyseeMd.preview.commitOnBlur` | `false` | Auto-save edits when focus leaves the panel |
| `wyseeMd.style.active` | `__match-editor` | Active document style |
| `wyseeMd.syntaxStyle.active` | `__match-editor-syntax` | Active syntax highlighting style |
| `wyseeMd.printProfile.active` | `__default-pdf` | Active print profile |
| `wyseeMd.spell.language` | `en-US` | Spellcheck language |
| `wyseeMd.print.browserFamily` | `system` | Browser for print handoff |
| `wyseeMd.trace.level` | `info` | Log verbosity |

See the full settings list in VS Code's Settings UI under "Wysee MD".

## Document Styles

Document styles control how Markdown elements appear in the canvas and print:

```json
{
  "id": "my-style",
  "name": "My Style",
  "syntaxStyle": "my-syntax",
  "baseStyles": "font-family: Georgia, serif; line-height: 1.6; color: #333; background: #fff;",
  "elementStyles": {
    "h1": "font-size: 2em; font-weight: 700; border-bottom: 2px solid #333;",
    "blockquote": "border-left: 3px solid #0366d6; padding-left: 1em; color: #555;",
    "a": "color: #0366d6;"
  }
}
```

## Syntax Styles

Syntax styles control code block coloring with per-language overrides:

```json
{
  "id": "my-syntax",
  "name": "My Syntax Theme",
  "syntaxStyles": {
    "default": {
      "keyword": "color: #c678dd;",
      "string": "color: #98c379;",
      "comment": "color: #5c6370; font-style: italic;",
      "function": "color: #61aeee;"
    },
    "python": {
      "keyword": "color: #ff79c6;",
      "string": "color: #f1fa8c;"
    },
    "yaml": { "highlight": false }
  }
}
```

## Print Profiles

Print profiles control page layout for print and PDF output:

```json
{
  "id": "my-print",
  "name": "My Print Style",
  "printStyle": "__light",
  "format": "Letter",
  "marginTop": "0.75in",
  "marginRight": "0.75in",
  "marginBottom": "0.75in",
  "marginLeft": "0.75in",
  "pageNumbers": {
    "enabled": true,
    "position": "center",
    "style": "decimal",
    "startAt": 1,
    "suppressFirstPage": true
  }
}
```

## Supported Markdown

CommonMark/GFM basics, headings, paragraphs, lists (including nested and ordered), task lists, blockquotes, tables, links, images with `{width, align}` attribute syntax, fenced code blocks with syntax highlighting, mermaid fences, strikethrough, footnotes, and print directives (`<!-- wysee:page-break -->`).

## Requirements

- VS Code 1.90+ or VSCodium equivalent
- Desktop only (not supported in VS Code for the Web, Codespaces, or remote hosts)

## License

See [LICENSE.txt](LICENSE.txt).

---

Developed by [Grainpool Holdings LLC](https://github.com/grainpool).
