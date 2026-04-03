# Changelog

## [0.11.0] — 2026-04-03

Initial release.

### Editing
- WYSIWYG Markdown canvas with inline block editing and live preview
- Block insertion via (+) buttons with raw/preview split panel
- Formatting shortcuts (Ctrl+B, Ctrl+I, Ctrl+K), find (Ctrl+F), image paste
- Context menu with headings, tables (up to 16×32), code fences, mermaid, footnotes
- Bidirectional scroll sync between canvas and source editor
- Word count, reading time, dangling reference detection

### Rendering
- Syntax highlighting with customizable styles and per-language overrides
- Mermaid diagrams, KaTeX math, footnotes, strikethrough
- Spellcheck with user/workspace dictionaries

### Diff and change control
- Side-by-side rendered diff with hunk highlighting, placeholders, and scroll sync
- Diff gutter indicators and hunk navigation
- Approval matrix export (XLSX + review HTML bundle) with rendered before/after cards, 28-column hidden metadata sheet
- Commit-based comparison via QuickPick with recent commit history
- AI-assisted change summaries grounded in document context (heading ancestry, framing context) and Git revision metadata (commit messages, tags, per-hunk provenance)
- Four built-in prompt templates with structured four-field JSON response contract
- Per-model request scheduling (sequential or parallel with bounded concurrency)
- Cancellation during AI generation with Discard / Export with existing summaries dialog
- Form-first AI configuration panel with collapsible model cards, bidirectional YAML sync, and field-level validation
- Prompt preview command

### Print and export
- Browser-based print with configurable page layout, page numbers, and mirror margins
- PDF export via headless Chrome
- Persistent "Export options…" bottom-bar menu

### Theming
- Document styles, syntax styles, and print profiles with JSON editing and live preview
- Three built-in themes (Match Editor Theme, Light, Dark)
