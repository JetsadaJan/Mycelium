---
title: Node (Mycelium Document)
aliases: [Node, Colony Node, Wiki Node]
tags: [mycelium-system, architecture, core]
ai_status: verified
verified_at: 2026-11-05
scope: "An individual .md knowledge page inside a Mycelium Colony"
disambiguation: "Node (Graph & Neural)"
sources:
  - "https://en.wikipedia.org/wiki/Wiki"
---

# Node (Mycelium Document)

In the [[Colony (Mycelium Workspace)|Mycelium application]], a **Node** is a single self-contained Markdown (`.md`) article representing one concept, organism, or system. When multiple Nodes are connected via [[Hypha (Mycelium Engine)|Hyphae]] and tagged into **Clusters**, they form a living knowledge graph.

## Anatomy of a Mycelium Node

- **YAML Frontmatter**: Stores `title`, `aliases`, `#cluster` `tags`, `scope`, `disambiguation`, and `ai_status` (`verified`, `partial`, or `unverified`).
- **Seamless Read & Write Modes**: Switch between **Read Node** (encyclopedia reader with hover previews and 1-click verification) and **Write Node** (an in-place document editor that preserves the exact same visual layout).
- **Disambiguation Awareness**: If two Nodes share a name or alias (such as `[[Node (Mycelium Document)]]` vs. `[[Node (Graph & Neural)]]`), Mycelium displays a disambiguation banner at the top of the page and lets you pick which target to link when clicking the word **Node**.
