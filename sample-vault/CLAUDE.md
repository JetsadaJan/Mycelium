# Mycelium & Obsidian Vault — AI Agent Protocol (Antigravity / Claude Code)

When creating or updating `.md` files in this Wiki Vault, ALWAYS follow these rules so both **Mycelium** and **Obsidian** render epistemic AI status accurately:

1. **YAML Frontmatter**:
   ```yaml
   ---
   title: Page Title
   aliases: [Alternative Name, ชื่อเรียกอื่น]
   tags: [topic, category]
   ai_status: unverified
   ai_source: agent
   sources: [https://en.wikipedia.org/wiki/...]
   ---
   ```
2. **Block-Level AI Content**: Wrap AI-researched paragraphs in an Obsidian Callout:
   ```markdown
   > [!ai] AI Research (Unverified)
   > Detailed synthesis with [[WikiLinks]] to related concepts.
   ```
3. **Inline AI Claims / Facts**: Wrap specific AI-generated numbers or claims with:
   `==[AI] specific claim or statistic==`
4. **Wiki Linking**: Use standard Obsidian `[[Page Title]]` or `[[Page Title|Display Text]]`.
