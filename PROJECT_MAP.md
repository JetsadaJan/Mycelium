# Mycelium Project Map
Knowledge Colony, Epistemic AI Verification Studio & Living Knowledge Graph (Tauri v2 + Rust + React/TS).

## Core Structure
- `LICENSE`, `COMMERCIAL_LICENSE.md`, `CONTRIBUTING.md`: Source-Available License (25% Gross Revenue / $2,500/mo commercial fallback + CLA).
- `src-tauri/src/models.rs`: Colony data structures (NoteDocument, HyphaLinkRef, BacklinkRef, UnlinkedMention, AiSegment, EpistemicStatus).
- `src-tauri/src/parser.rs`: Markdown/Frontmatter/HyphaLink/Callout/Highlight parser & AI tag verifier.
- `src-tauri/src/vault.rs`: Colony indexer, entity matcher, 1-click linker, `.mycelium/index.json`, interop CSS snippet, file watcher.
- `src-tauri/src/ai.rs` & `main.rs`: 3-way AI research engine (Cloud LLM API, Local Ollama, Grounded Reference/Agent protocol) & local API server.
- `src/lib/vaultEngine.ts` & `vaultClient.ts`: Dual-mode TypeScript bridge (Rust IPC + local fallback engine) & lossless Markdown serializer.
- `src/lib/themePresets.ts` & `colonyColorSettings.ts`: 4 protected core theme presets (`Earth`/`Ocean` Dark/Light), custom theme harmony & Colony graph color modes.
- `src/lib/graphSim.ts` & `src/components/NodeMapCanvas.tsx`: Colony force-directed graph physics, 2-color curved directional Hyphae & gentle magnetic proximity.
- `src/components/NodeDocumentView.tsx`: Node document reader/editor, inline entity detection, hover preview, 1-click AI verification.
- `src/components/ConnectionsInspector.tsx` & `AiResearchModal.tsx`: Backlinks, Outgoing Hyphae, Latent Mentions & AI Researcher.
- `sample-vault/`: Ready-to-use Mycelium Colony knowledge base with `AGENTS.md` and `CLAUDE.md`.
- `.agents/skills/mycelium/SKILL.md`: Reusable AI skill for authoring, linking (`[[Hyphae]]`), and tagging epistemic AI segments (`> [!ai]`, `==[AI:...]==`) in any Mycelium Colony.
