use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyKeyPayload {
    pub provider: String, // "openai" | "gemini" | "openrouter" | "custom" | "ollama"
    pub api_key: String,
    pub api_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyKeyResponse {
    pub ok: bool,
    pub provider: String,
    pub message: String,
}

pub fn verify_api_key(payload: &VerifyKeyPayload) -> Result<VerifyKeyResponse, String> {
    let key = payload.api_key.trim();
    if payload.provider != "ollama" && key.is_empty() {
        return Ok(VerifyKeyResponse {
            ok: false,
            provider: payload.provider.clone(),
            message: "API Key cannot be blank. Please enter a valid key.".to_string(),
        });
    }

    if payload.provider == "ollama" {
        let url = payload
            .api_url
            .clone()
            .unwrap_or_else(|| "http://localhost:11434/api/tags".to_string());
        match ureq::get(&url).timeout(std::time::Duration::from_secs(6)).call() {
            Ok(resp) if resp.status() == 200 => Ok(VerifyKeyResponse {
                ok: true,
                provider: "ollama".to_string(),
                message: "Connected to local Ollama instance successfully!".to_string(),
            }),
            Ok(resp) => Ok(VerifyKeyResponse {
                ok: false,
                provider: "ollama".to_string(),
                message: format!("Ollama returned unexpected HTTP status {}", resp.status()),
            }),
            Err(e) => Ok(VerifyKeyResponse {
                ok: false,
                provider: "ollama".to_string(),
                message: format!("Could not connect to Ollama: {}. Make sure 'ollama serve' is running.", e),
            }),
        }
    } else if payload.provider == "gemini" {
        // Direct test against Gemini models list or generateContent endpoint
        let model = payload.model.clone().unwrap_or_else(|| "gemini-2.5-flash".to_string());
        let test_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, key
        );
        let body = serde_json::json!({
            "contents": [{
                "parts": [{ "text": "ping" }]
            }]
        });
        match ureq::post(&test_url)
            .timeout(std::time::Duration::from_secs(10))
            .send_json(body)
        {
            Ok(resp) if resp.status() == 200 => Ok(VerifyKeyResponse {
                ok: true,
                provider: "gemini".to_string(),
                message: format!("Gemini API Key verified and active for {}!", model),
            }),
            Ok(resp) => Ok(VerifyKeyResponse {
                ok: false,
                provider: "gemini".to_string(),
                message: format!("Gemini returned HTTP {}. Please verify the key and model permissions.", resp.status()),
            }),
            Err(ureq::Error::Status(code, resp)) => {
                let err_text = resp.into_string().unwrap_or_default();
                let detail = if code == 400 || code == 403 {
                    "Invalid API key or unauthorized model access."
                } else if code == 429 {
                    "Quota limit exceeded (Rate limit / 429)."
                } else {
                    "API key verification failed."
                };
                Ok(VerifyKeyResponse {
                    ok: false,
                    provider: "gemini".to_string(),
                    message: format!("Gemini error (HTTP {}): {} {}", code, detail, err_text),
                })
            }
            Err(e) => Ok(VerifyKeyResponse {
                ok: false,
                provider: "gemini".to_string(),
                message: format!("Network/connection error contacting Gemini: {}", e),
            }),
        }
    } else {
        // OpenAI / OpenRouter / Custom OpenAI-compatible endpoint
        let endpoint = payload.api_url.clone().unwrap_or_else(|| {
            if payload.provider == "openrouter" {
                "https://openrouter.ai/api/v1/chat/completions".to_string()
            } else {
                "https://api.openai.com/v1/chat/completions".to_string()
            }
        });
        let model = payload.model.clone().unwrap_or_else(|| {
            if payload.provider == "openrouter" {
                "google/gemini-2.5-flash".to_string()
            } else {
                "gpt-4o-mini".to_string()
            }
        });

        let body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "user", "content": "ping" }
            ],
            "max_tokens": 5
        });

        match ureq::post(&endpoint)
            .set("Authorization", &format!("Bearer {}", key))
            .timeout(std::time::Duration::from_secs(10))
            .send_json(body)
        {
            Ok(resp) if resp.status() == 200 => Ok(VerifyKeyResponse {
                ok: true,
                provider: payload.provider.clone(),
                message: format!("API Key verified successfully with {} ({})!", endpoint, model),
            }),
            Ok(resp) => Ok(VerifyKeyResponse {
                ok: false,
                provider: payload.provider.clone(),
                message: format!("Endpoint returned unexpected status HTTP {}", resp.status()),
            }),
            Err(ureq::Error::Status(code, resp)) => {
                let err_text = resp.into_string().unwrap_or_default();
                let hint = if code == 401 {
                    "Invalid API Key. Authentication failed (401 Unauthorized)."
                } else if code == 403 {
                    "Permission denied or model access restricted (403 Forbidden)."
                } else if code == 429 {
                    "Quota exceeded or rate-limited (429 Too Many Requests)."
                } else {
                    "Key rejected by server."
                };
                Ok(VerifyKeyResponse {
                    ok: false,
                    provider: payload.provider.clone(),
                    message: format!("HTTP {}: {} {}", code, hint, err_text),
                })
            }
            Err(e) => Ok(VerifyKeyResponse {
                ok: false,
                provider: payload.provider.clone(),
                message: format!("Connection error: {}", e),
            }),
        }
    }
}

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
            let trimmed_key = key.trim();
            if !trimmed_key.is_empty() {
                let api_url = req.api_url.clone().unwrap_or_else(|| {
                    "https://api.openai.com/v1/chat/completions".to_string()
                });
                let model = req
                    .model
                    .clone()
                    .unwrap_or_else(|| "gpt-4o-mini".to_string());

                let result = if api_url.contains("googleapis.com") {
                    call_gemini_direct(trimmed_key, &model, &req.topic, &wiki_extract, &req.existing_titles)
                } else {
                    call_openai_compatible(
                        &api_url,
                        trimmed_key,
                        &model,
                        &req.topic,
                        &wiki_extract,
                        &req.existing_titles,
                    )
                };

                match result {
                    Ok(generated) => {
                        return Ok(format_ai_response(
                            &req.topic,
                            &generated,
                            vec![wiki_url],
                            &format!("cloud-api ({})", model),
                            agent_prompt,
                            &req.existing_titles,
                        ));
                    }
                    Err(e) => {
                        return Err(format!("AI Synthesis Error with key: {}", e));
                    }
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

fn call_gemini_direct(
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
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );
    let body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }]
    });
    let resp = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(30))
        .send_json(body)
        .map_err(|e| format!("Gemini error: {}", e))?;
    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    json.get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|first| first.get("content"))
        .and_then(|cnt| cnt.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p0| p0.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "Gemini returned empty candidate response".to_string())
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
