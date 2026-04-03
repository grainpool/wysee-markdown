# Wysee Markdown

WYSIWYG Markdown editor with print, rendered diff, intelligent change control, and advanced authoring features — for VS Code and VSCodium.

📖 **[Full documentation →](https://docs.grainpoolholdings.com/open-source-projects/wysee.html)**

## Features

### Visual editing

- **WYSIWYG canvas** — Markdown files open in a rendered canvas. Double-click any block to edit its raw Markdown in an inline panel with live side-by-side preview.
- **Block insertion** — `(+)` buttons between blocks for inserting new content with live preview.
- **Formatting shortcuts** — Ctrl+B (bold), Ctrl+I (italic), Ctrl+K (link) in the edit panel.
- **Find** — Ctrl+F with match highlighting, case sensitivity, and prev/next navigation.
- **Image paste** — Ctrl+V with a clipboard image saves a PNG and inserts the reference.
- **Context menu** — Right-click to insert headings (H1–H6), links, images, tables (up to 16×32), code fences, mermaid fences, task lists, footnotes, and horizontal rules.

### Rendered diff and change control

- **Side-by-side rendered diff** — Visual diff with color-coded block backgrounds, inline word-level highlights, diagonal-stripe placeholders, and synchronized scroll.
- **Diff gutter indicators** — Blue/green/red gutter marks in the regular editor. Click to jump to the diff view.
- **Hunk navigation** — ▲/▼ buttons with counter, Alt+Shift+Up/Down shortcuts, focus pulse animation.
- **Approval matrix export** — Export a ZIP bundle with a styled XLSX workbook and self-contained review HTML. Each hunk becomes one row with rendered before/after card images, approval dropdown, and review link.
- **Commit-based comparison** — Compare any two revisions via QuickPick with recent commit history, or paste hashes manually. Working tree diff is the one-click default.
- **Ad hoc diff support** — Side-by-side diffs opened via `code --diff` or `codium --diff` gain full Wysee rendering, hunk navigation, and export support.
- **AI-assisted summaries** — Optional AI-generated change summaries grounded in document context and Git revision metadata. Configure via the built-in settings panel or `.wysee/ai-config.yaml`. Supports any OpenAI-compatible endpoint including local models (Ollama, LM Studio). Per-model request scheduling, cancellation support, four built-in prompt templates, and field-level config validation. AI failure never blocks export.

### Rendering

- **Syntax highlighting** — Language-specific code coloring with customizable syntax styles and per-language overrides.
- **Mermaid diagrams** — Fenced `mermaid` blocks render as interactive diagrams in the canvas, print, and export.
- **KaTeX math** — Inline `$...$` and block `$$...$$` math expressions.
- **Footnotes** — `[^N]` references as superscripts with a footnote section. Editable from the referencing block.
- **Strikethrough** — `~~text~~` with line-through rendering.

### Print and export

- **Print / PDF** — Browser-based print with configurable page size, margins, page numbers, mirror margins, and code wrapping.
- **PDF via headless Chrome** — `Save PDF…` uses a local Chromium installation for direct export.
- **Export options** — Persistent bottom-bar "Export options…" popup with Print, Save PDF, Export Approval Matrix, and Configure AI.

### Theming

- **Document styles** — Match Editor Theme, Light, Dark, or custom JSON styles with element-level CSS.
- **Syntax styles** — Match Editor Theme, Light, Dark, or custom token-level CSS with per-language overrides.
- **Print profiles** — Page layout, margins, page numbers, mirror margins, and linked document styles.
- **Style panel** — Side panel with live preview for all three style types.

### Utilities

- **Spellcheck** — Red wavy underlines on misspelled words. Right-click to add to dictionary or ignore.
- **Word count and statistics** — Word count in the bottom bar. "More Stats" modal with reading time, character counts, code lines, and dangling reference detection.
- **Scroll sync** — Bidirectional block-anchor scroll synchronization between canvas and source editor.

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=grainpool.wysee-md) or [Open VSX](https://open-vsx.org/extension/grainpool/wysee-md) for VSCodium.

Or install from VSIX:

```
code --install-extension wysee-md-0.11.0.vsix
```

## Quick start

Open any `.md` file — it opens in the Wysee canvas by default.

- **Double-click** a block to edit its raw Markdown
- **Click (+)** between blocks to insert new content
- **Right-click** for the Insert MD Block menu
- Click **Export options…** in the bottom bar for print, PDF, or approval matrix export
- Toggle **Sync scroll** to link canvas and source scrolling

To open in the standard text editor, use `Open With...` → Text Editor.

## AI-assisted summaries

Open the configuration panel via the command palette: **Wysee: AI Config: Settings**, or via the "Configure AI…" entry in the export menu.

The panel provides a form-first interface for model configuration, prompting, context settings, and output options. A collapsible raw YAML editor at the bottom is bidirectionally synced with the form and validates every field as you type. Changes are saved to `.wysee/ai-config.yaml` in your workspace root.

Example configuration:

```yaml
models:
  - name: Qwen3-Coder 30B
    provider: ollama
    model: qwen3-coder:30b
    endpoint: http://localhost:11434/v1
    auth: none
    chatPath: chat
    requestScheduling:
      mode: sequential
    options:
      temperature: 0.3
      maxTokens: 2000

  - name: GPT-4o Mini
    provider: openai
    model: gpt-4o-mini
    endpoint: https://api.openai.com/v1
    auth: bearer
    apiKey: ${{ secrets.OPENAI_API_KEY }}
    requestScheduling:
      mode: parallel
      maxConcurrent: 6

activeModel: "Qwen3-Coder 30B"

context:
  sectionContext:
    mode: fullMarkdown
  hunkCommitProvenance: true
  hunkCommitLimit: 10

prompting:
  template: default-review-summary
```

Store secrets via the command palette: **Wysee: AI Config: Set Secret…**

When exporting an approval matrix, a QuickPick lets you select a model or continue without AI. Summaries populate column C of the workbook. Cancel during generation to choose **Discard** or **Export with existing summaries**. AI failure never blocks the export.

Preview what the model receives: **Wysee: AI Config: Preview Prompt**


## Supported Markdown

CommonMark/GFM basics, headings, paragraphs, lists (nested, ordered, task), blockquotes, tables, links, images with `{width, align}` attribute syntax, fenced code blocks with syntax highlighting, mermaid fences, strikethrough, footnotes, and print directives (`<!-- wysee:page-break -->`).

## Requirements

- VS Code 1.90+ or VSCodium equivalent
- Desktop only (not supported in VS Code for the Web, Codespaces, or remote hosts)

## License

[Apache License 2.0](LICENSE.txt)

Copyright 2025-2026 Grainpool Holdings LLC

---

📖 **[Full documentation](https://docs.grainpoolholdings.com/open-source-projects/wysee.html)** · Developed by [Grainpool Holdings LLC](https://github.com/grainpool)
