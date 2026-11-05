# Mycelium Project Map
Personal Wiki, Epistemic AI Verification Studio & Obsidian-Compatible Knowledge Graph (Tauri v2 + Rust + React/TS).

## Core Structure
- `LICENSE`, `COMMERCIAL_LICENSE.md`, `CONTRIBUTING.md`: Source-Available License (25% Gross Revenue / $2,500/mo commercial fallback + CLA).
- `src-tauri/src/models.rs`: Vault data structures (NoteDocument, WikiLinkRef, BacklinkRef, UnlinkedMention, AiSegment, EpistemicStatus).
- `src-tauri/src/parser.rs`: Obsidian-compatible Markdown/Frontmatter/WikiLink/Callout/Highlight parser & AI tag verifier.
- `src-tauri/src/vault.rs`: Vault indexer, entity matcher, 1-click linker, `.mycelium/index.json`, `.obsidian` CSS snippet, file watcher.
- `src-tauri/src/ai.rs` & `main.rs`: 3-way AI research engine (Cloud LLM API, Local Ollama, Wikipedia/Agent protocol) & local API server.
- `src/lib/vaultEngine.ts` & `vaultClient.ts`: Dual-mode TypeScript bridge (Rust IPC + local fallback engine) & lossless Obsidian serializer.
- `src/lib/themePresets.ts` & `colonyColorSettings.ts`: 4 protected core theme presets (`Earth`/`Ocean` Dark/Light), custom theme harmony & Colony graph color modes.
- `src/lib/graphSim.ts` & `src/components/NodeMapCanvas.tsx`: Obsidian `sim.js` force-directed graph physics, 2-color curved directional Hyphae & gentle magnetic proximity.
- `src/components/WikiArticleView.tsx`: Wiki reader/editor, inline entity detection, hover preview, 1-click AI verification.
- `src/components/ConnectionsInspector.tsx` & `AiResearchModal.tsx`: Backlinks, Outgoing Links, Unlinked Mentions & AI Researcher.
- `sample-vault/`: Ready-to-use Obsidian & Mycelium compatible knowledge base with `AGENTS.md` and `CLAUDE.md`.
