# Mycelium

**A local Knowledge Colony & Epistemic AI Studio built on open Markdown, where you always know which parts of your knowledge a human verified and which parts an AI wrote.**

> **License**: Mycelium is **free for personal, educational, and solo non-commercial use and modification**. Commercial use, multi-person business deployment, or SaaS hosting requires a prior commercial license from **Jetsada Janpaijet**, or is automatically subject to a **25% gross revenue (\$2,500 USD/month minimum) royalty**. See [`LICENSE`](./LICENSE) and [`COMMERCIAL_LICENSE.md`](./COMMERCIAL_LICENSE.md).

---

## What is Mycelium?

Mycelium is a desktop app (macOS first) for authoring and exploring an epistemic knowledge graph made of plain Markdown files. Your notes live in an ordinary folder on your disk. There is no database, no cloud account, and no lock-in: you can open the same folder in Mycelium, VS Code, or standard Markdown tools, or let a coding agent edit it, and every tool sees the exact same files.

On top of traditional note editors it adds two primary superpowers:

1. **Epistemic AI tracking.** AI-written text is marked directly inside your Markdown, highlighted in amber, and stays "unverified" until you review it and click **Verify**. At any moment you can see how much of your knowledge base is human-verified.
2. **A living graph.** A force-directed map of all your notes and the links between them, with directional links (incoming vs. outgoing), clusters, and a focus mode that makes the node you are looking at readable.

The name comes from fungi: a mycelium is an underground network of thread-like *hyphae* that connects many mushrooms. Your notes are the mushrooms; your links are the threads.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Colony** | A folder of `.md` files. This is your whole local knowledge base. |
| **Node** | One note (`.md` file) inside the Colony. |
| **Hypha** (plural **Hyphae**) | A `[[link]]` from one Node to another. *Incoming* hyphae are backlinks, *outgoing* hyphae are links you wrote, *latent* hyphae are places where a Node's title is mentioned in text but not yet linked. |
| **Cluster** | A group of Nodes that share a `#tag`. |

## Features

### Open Markdown Interoperability (Lossless)
- Reads and writes standard Markdown: YAML frontmatter, `[[Hyphae Links]]`, `[[Page|Alias]]`, `[[Page#Heading]]`, `[[Page#^block-id]]`, `![[Embeds]]`, `![[Page#Heading]]` transclusion, `#tags` (including nested `#a/b`), callouts such as `> [!note]`, `==highlights==`, footnotes, math, task lists, and `%%comments%%` (hidden in Read mode, preserved on disk).
- **Saving never destroys your data.** Custom frontmatter keys (`cssclasses`, `created`, `publish`, ...) are kept as-is, and a note that had no `# H1` title or no frontmatter is not forced to get one.
- Subfolders are respected: renaming or duplicating a note keeps it in its folder, and both `[[Note]]` and `[[Folder/Note]]` resolve to the same Node.
- Reads attachment configuration and ensures background interoperability CSS so external Markdown viewers render AI blocks in the same amber style.

### Read, write, and undo
- **Read Node** mode renders the note; **Write Node** mode edits it with structured fields (title, aliases, tags, sources) plus the Markdown body.
- Edits in Write mode are **not saved until you click Save**. If you navigate away with unsaved changes, Mycelium asks what to do.
- **Undo / Redo** (`Cmd/Ctrl + Z`) works in both modes, including link changes, AI flags, and task checkbox toggles.
- Wrap a term in bold safely: `**[[Hypha]]**` renders as a bold link and stays valid across standard Markdown tools.

### Hyphae (links)
- Existing Node titles and aliases are underlined in your prose. One click converts them into a `[[link]]`.
- Linking to a Node that does not exist asks you what to do: create a new `.md` file, or leave an empty **red link** that shows a small "Node is unavailable" hint instead of a noisy popup.
- The right-hand inspector lists incoming, outgoing, and latent Hyphae for the current Node.

### Epistemic AI provenance
AI content is marked at three levels, all stored as plain Markdown that standard tools can parse:

| Level | Markdown | Meaning |
| --- | --- | --- |
| Page | `ai_status: unverified` in frontmatter | The whole note is AI-drafted |
| Block | `> [!ai] AI research (unverified)` | A paragraph or section written by AI |
| Inline | `==[AI] a specific claim==` | A single sentence, number, or claim |

- Select any text and choose **Mark as AI** to flag it; the app avoids breaking links, headings, code, and frontmatter while doing so.
- Click **Verify** on a block or claim to strip the AI marker and promote it to verified text, or **Unmark AI** to remove a flag by mistake. Every verification is recorded in `.mycelium/index.json`.
- AI content can come from a cloud LLM, a local model (Ollama), or an external coding agent following the generated `AGENTS.md` / `CLAUDE.md` protocol.

### Agent Skill Protocol (`mycelium` skill)
Mycelium includes an AI agent skill located at [`.agents/skills/mycelium/SKILL.md`](./.agents/skills/mycelium/SKILL.md) (and installable globally in `~/.gemini/config/skills/mycelium/` or `~/.claude/skills/`).

When AI agents (Claude Code, Antigravity, or custom agent scripts) interact with your Colony, this skill enforces four principles:
1. **Pre-flight discovery**: The agent scans existing `.md` files and aliases first so it reuses canonical titles instead of duplicating notes.
2. **Lossless frontmatter preservation**: All existing custom YAML keys (`cssclasses`, `created`, `publish`, etc.) and folder locations are preserved.
3. **Epistemic quarantine**: Newly synthesized sections are enclosed in `> [!ai]` callouts or `==[AI:agent] ...==` inline spans with `ai_status: partial` or `unverified`, allowing you to inspect and approve claims in the Mycelium UI.
4. **Graph hyphae formation**: High-value concepts are linked with `[[Hyphae Links]]`, and missing topics become dashed stub nodes ready for 1-click authoring.

### Colony Map
- A force-directed graph with organic physical simulation, with global and local (1-3 hop) views.
- Amber rings mark Nodes that still contain unverified AI content.
- Hyphae are drawn as curved lines so incoming and outgoing links never overlap. Choose how they are colored: by source/target Node, by direction (in/out two-tone), or monochrome.
- Click a Node to center it and read it in a focus card; double-click to open it. Select several Clusters at once to filter the map.

### Themes and settings
- A **Settings** panel holds AI configuration, colors, and Colony options.
- Four built-in, low-saturation themes: **Earth Dark / Earth Light** (warm) and **Ocean Dark / Ocean Light** (cool). **Ocean Dark** is the default. They cannot be deleted.
- Customize text, background, and accent colors and save your own presets. The Mycelium logo recolors with your theme.
- Collapsible left (Colony explorer) and right (Hyphae inspector) sidebars.

## Install (macOS)

1. Download `Mycelium_0.0.3_aarch64.dmg` from the [Releases](https://github.com/JetsadaJan/Mycelium/releases) page (Apple Silicon Macs).
2. Open the DMG and drag **Mycelium** into **Applications**.
3. The app is **not code-signed or notarized** yet, so macOS may block the first launch. Right-click the app and choose **Open**, or run:
   ```bash
   xattr -cr /Applications/Mycelium.app
   ```
4. On first launch Mycelium creates a Colony at `~/Documents/Mycelium Colony` pre-filled with a small sample vault. You can open any existing Markdown folder or vault from the Colony switcher at the top of the window.

## How it works

```
React 19 + TypeScript (Vite)          <- UI: reader, writer, graph, inspector
        |  HTTP, 127.0.0.1:4174
Rust core (tiny_http server)          <- vault scan, parser, links, AI verification
        |
Your Colony folder of .md files       <- the single source of truth
```

- **Frontend** (`src/`): the reader/writer, Colony Map canvas, theme system, and a TypeScript copy of the Markdown engine (`src/lib/vaultEngine.ts`) with unit tests.
- **Rust core** (`src-tauri/src/`): `parser.rs` (Markdown, frontmatter, links, AI segments), `vault.rs` (indexing, backlinks, unlinked mentions, interop integration), `ai.rs` (AI research), `server.rs` (local API).
- **Desktop shell**: [Tauri v2](https://tauri.app) wraps the UI in a native window and starts the Rust server in-process. Nothing leaves your machine except calls to an AI provider you configure.

## Develop

Requirements: Node 20+, Rust (stable), and the Tauri prerequisites for your OS.

```bash
npm install

# Run the unit tests
npm test               # frontend (Vitest)
npm run rust:test      # Rust core

# Browser development (two terminals)
npm run rust:server    # Rust API on http://127.0.0.1:4174 (headless)
npm run dev            # UI on http://localhost:5173

# Native app
npm run tauri dev
npm run tauri build -- --bundles dmg
```

## Project layout

See [`PROJECT_MAP.md`](./PROJECT_MAP.md) for a file-by-file map. `sample-vault/` is a ready-to-use Colony you can open in Mycelium or any Markdown reader.

## License

Copyright (c) 2026 **Jetsada Janpaijet**. All rights reserved.

- **Personal / academic / solo non-commercial use**: free to use, fork, and modify under [Part I of `LICENSE`](./LICENSE).
- **Commercial use**: requires a prior license from **Jetsada Janpaijet** ([`COMMERCIAL_LICENSE.md`](./COMMERCIAL_LICENSE.md)). Unlicensed commercial use triggers the **25% gross revenue (or \$2,500 USD/month minimum)** royalty under [Part II of `LICENSE`](./LICENSE).


## Trademark Notice

*Obsidian® is a registered trademark of Dynalist Inc. Mycelium is an independent project and is not affiliated with, endorsed by, or sponsored by Dynalist Inc.*
