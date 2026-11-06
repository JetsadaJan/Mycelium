use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResearchRequest {
    pub topic: String,
    pub mode: String, // "api" | "ollama" | "agent_research" | "agent_wiki"
    pub api_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub existing_titles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResearchResponse {
    pub title: String,
    pub markdown_page: String,
    pub markdown_block: String,
    pub sources: Vec<String>,
    pub provider_used: String,
    pub agent_prompt: String,
}

pub fn build_agent_prompt(topic: &str, existing_titles: &[String]) -> String {
    let related = existing_titles
        .iter()
        .take(15)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Research \"{topic}\" and create or update `{topic}.md` in the Colony following `AGENTS.md`:\n\
1. Add YAML Frontmatter (`title: {topic}`, `ai_status: unverified`, `ai_source: agent`, `sources: [...]`).\n\
2. Wrap AI-synthesized paragraphs in a Callout `> [!ai] AI Research (Unverified)`.\n\
3. Wrap specific statistics or factual claims in `==[AI] ...==`.\n\
4. Link related concepts using `[[Hyphae Links]]` to existing Colony Nodes such as: {related}."
    )
}

pub fn research_topic(req: &AiResearchRequest) -> Result<AiResearchResponse, String> {
    let agent_prompt = build_agent_prompt(&req.topic, &req.existing_titles);

    let (wiki_extract, wiki_url) = fetch_wikipedia_summary(&req.topic).unwrap_or_else(|| {
        (
            format!(
                "{} is a key concept within the personal knowledge graph awaiting primary source verification and expansion.",
                req.topic
            ),
            format!(
                "https://en.wikipedia.org/wiki/{}",
                req.topic.replace(' ', "_")
            ),
        )
    });

    if req.mode == "ollama" {
        let ollama_url = req
            .api_url
            .clone()
            .unwrap_or_else(|| "http://localhost:11434/api/generate".to_string());
        let model = req.model.clone().unwrap_or_else(|| "llama3.2".to_string());
        if let Ok(generated) = call_ollama(
            &ollama_url,
            &model,
            &req.topic,
            &wiki_extract,
            &req.existing_titles,
        ) {
            return Ok(format_ai_response(
                &req.topic,
                &generated,
                vec![wiki_url],
                &format!("ollama ({})", model),
                agent_prompt,
                &req.existing_titles,
            ));
        }
    }

    if req.mode == "api" {
        if let Some(ref key) = req.api_key {
            if !key.trim().is_empty() {
                let api_url = req.api_url.clone().unwrap_or_else(|| {
                    "https://api.openai.com/v1/chat/completions".to_string()
                });
                let model = req
                    .model
                    .clone()
                    .unwrap_or_else(|| "gpt-4o-mini".to_string());
                if let Ok(generated) = call_openai_compatible(
                    &api_url,
                    key,
                    &model,
                    &req.topic,
                    &wiki_extract,
                    &req.existing_titles,
                ) {
                    return Ok(format_ai_response(
                        &req.topic,
                        &generated,
                        vec![wiki_url],
                        &format!("cloud-api ({})", model),
                        agent_prompt,
                        &req.existing_titles,
                    ));
                }
            }
        }
    }

    let linked_extract = auto_inject_hypha_links(&wiki_extract, &req.topic, &req.existing_titles);
    Ok(format_ai_response(
        &req.topic,
        &linked_extract,
        vec![wiki_url],
        "mycelium-grounded-research",
        agent_prompt,
        &req.existing_titles,
    ))
}

fn fetch_wikipedia_summary(topic: &str) -> Option<(String, String)> {
    let encoded = topic.trim().replace(' ', "_");
    let url = format!(
        "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
        encoded
    );

    let resp = ureq::get(&url)
        .set("User-Agent", "Mycelium/0.1 (Local Knowledge Colony)")
        .call()
        .ok()?;
    let json: serde_json::Value = resp.into_json().ok()?;
    let extract = json.get("extract")?.as_str()?.trim().to_string();
    if extract.is_empty() {
        return None;
    }
    let page_url = json
        .get("content_urls")
        .and_then(|c| c.get("desktop"))
        .and_then(|d| d.get("page"))
        .and_then(|p| p.as_str())
        .unwrap_or(&url)
        .to_string();

    Some((extract, page_url))
}

fn call_ollama(
    url: &str,
    model: &str,
    topic: &str,
    context: &str,
    existing_titles: &[String],
) -> Result<String, String> {
    let links_hint = existing_titles
        .iter()
        .take(12)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let prompt = format!(
        "Write a concise summary about '{}' in English. \
Use [[Links]] when referencing related topics ({}). \
Wrap specific factual claims or statistics in ==[AI] claim==. \
Reference context: {}",
        topic, links_hint, context
    );
    let resp = ureq::post(url)
        .send_json(serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false
        }))
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    json.get("response")
        .and_then(|r| r.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "Empty Ollama response".to_string())
}

fn call_openai_compatible(
    url: &str,
    api_key: &str,
    model: &str,
    topic: &str,
    context: &str,
    existing_titles: &[String],
) -> Result<String, String> {
    let links_hint = existing_titles
        .iter()
        .take(12)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let prompt = format!(
        "Write a concise synthesis about '{}' in English. \
Use [[Links]] for related terms ({}). \
Wrap key claims in ==[AI] ...==. Grounding context: {}",
        topic, links_hint, context
    );
    let resp = ureq::post(url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .send_json(serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": "You are an epistemic knowledge researcher producing standard Markdown in English." },
                { "role": "user", "content": prompt }
            ]
        }))
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    json.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|first| first.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "Empty API response".to_string())
}

fn auto_inject_hypha_links(text: &str, current_topic: &str, existing_titles: &[String]) -> String {
    let mut out = text.to_string();
    for title in existing_titles {
        if title.eq_ignore_ascii_case(current_topic) || title.chars().count() < 3 {
            continue;
        }
        let bracketed = format!("[[{}]]", title);
        if !out.contains(&bracketed) && out.contains(title) {
            out = out.replacen(title, &bracketed, 1);
        }
    }
    out
}

fn format_ai_response(
    topic: &str,
    synthesized_body: &str,
    sources: Vec<String>,
    provider: &str,
    agent_prompt: String,
    existing_titles: &[String],
) -> AiResearchResponse {
    let quoted_lines: Vec<String> = synthesized_body
        .lines()
        .map(|l| format!("> {}", l))
        .collect();
    let callout_block = format!(
        "> [!ai] Generated by AI ({provider}) — Pending Human Verification\n{}",
        quoted_lines.join("\n")
    );

    let related_links: Vec<String> = existing_titles
        .iter()
        .filter(|t| !t.eq_ignore_ascii_case(topic))
        .take(3)
        .map(|t| format!("[[{}]]", t))
        .collect();

    let related_line = if related_links.is_empty() {
        String::new()
    } else {
        format!("\n\nRelated Nodes: {}", related_links.join(" • "))
    };

    let sources_yaml = sources
        .iter()
        .map(|s| format!("  - \"{}\"", s))
        .collect::<Vec<_>>()
        .join("\n");

    let markdown_page = format!(
        "---\ntitle: {topic}\ntags: [colony, ai-draft]\nai_status: unverified\nai_source: {provider}\nsources:\n{sources_yaml}\n---\n\n# {topic}\n\n{callout_block}\n\n## Key Claims Pending Review\n\n- ==[AI:{provider}] Initial synthesis for {topic} was automatically compiled and requires human verification before promotion=={related_line}\n"
    );

    AiResearchResponse {
        title: topic.to_string(),
        markdown_page,
        markdown_block: format!(
            "{}\n\n- ==[AI:{}] Additional synthesized notes on {} pending verification==",
            callout_block, provider, topic
        ),
        sources,
        provider_used: provider.to_string(),
        agent_prompt,
    }
}
