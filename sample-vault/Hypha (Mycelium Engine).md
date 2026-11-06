---
title: Hypha (Mycelium Engine)
aliases: [Hypha, Hyphae, Hyphal Link, Knowledge Link]
tags: [mycelium-system, architecture, core]
ai_status: verified
verified_at: 2026-11-05
scope: "Directional [[Link]] connecting Nodes in the Mycelium app"
disambiguation: "Hypha (Biology)"
sources:
  - "https://en.wikipedia.org/wiki/Hyperlink"
---

# Hypha (Mycelium Engine)

In the **Mycelium** application, a **Hypha** (plural: **Hyphae**) is a directional connection (`[[Target Node]]`) between two [[Node (Mycelium Document)|Nodes]] inside your [[Colony (Mycelium Workspace)|Colony]]. Just as biological [[Hypha (Biology)|fungal hyphae]] transport nutrients and signals between trees, software Hyphae route context and provenance across your knowledge base.

## Three States of Hyphae in Mycelium

1. **Outgoing Hyphae**: Explicit `[[Node Title]]` or `[[Node Title|Display Alias]]` links written inside the current Node pointing outward.
2. **Incoming Hyphae (Backlinks)**: Automatic reverse connections showing every other Node in the Colony that points to the current Node, complete with the surrounding sentence context.
3. **Latent Hyphae (Unlinked Mentions)**: Words in your text that match an existing Node's title or alias without `[[...]]` brackets yet. Mycelium underlines these with a dotted line so you can connect them in a single click.

## Disambiguation for Homonym Terms

When a single word like **Hypha** or **Node** matches multiple distinct concepts (for example, `[[Hypha (Biology)]]` vs. `[[Hypha (Mycelium Engine)]]`), Mycelium displays a **Disambiguation Picker** so you can choose the exact target Node and see which scope is currently open.
