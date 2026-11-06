import React, { useState, useEffect } from 'react';
import { AiResearchRequest, AiResearchResponse } from '../types/vault';
import { getSavedAiConfig } from '../lib/vaultClient';
import { Bot, Check, Copy, Cpu, Globe, Key, Settings, Sparkles, X, AlertTriangle } from 'lucide-react';

interface AiResearchModalProps {
  initialTopic: string;
  existingTitles: string[];
  onClose: () => void;
  onOpenSettings?: () => void;
  onRunResearch: (req: AiResearchRequest) => Promise<AiResearchResponse>;
  onCreateOrUpdatePage: (title: string, rawMarkdown: string) => void;
  onAppendBlockToCurrent: (markdownBlock: string) => void;
}

export const AiResearchModal: React.FC<AiResearchModalProps> = ({
  initialTopic,
  existingTitles,
  onClose,
  onOpenSettings,
  onRunResearch,
  onCreateOrUpdatePage,
  onAppendBlockToCurrent,
}) => {
  const savedCfg = getSavedAiConfig();
  const [topic, setTopic] = useState(initialTopic);
  const [mode, setMode] = useState<'agent_research' | 'agent_wiki' | 'api' | 'ollama'>('agent_research');
  const [apiUrl, setApiUrl] = useState(savedCfg.apiUrl || 'https://generativelanguage.googleapis.com');
  const [apiKey, setApiKey] = useState(savedCfg.apiKey || '');
  const [model, setModel] = useState(savedCfg.model || 'gemini-2.5-flash');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiResearchResponse | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  useEffect(() => {
    // When switching to 'api' mode, default to the saved studio configuration
    if (mode === 'api') {
      const cfg = getSavedAiConfig();
      if (cfg.apiKey) setApiKey(cfg.apiKey);
      if (cfg.apiUrl) setApiUrl(cfg.apiUrl);
      if (cfg.model) setModel(cfg.model);
    }
  }, [mode]);

  const handleSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    setResearchError(null);
    try {
      const res = await onRunResearch({
        topic: topic.trim(),
        mode,
        api_url: apiUrl,
        api_key: apiKey,
        model,
        existing_titles: existingTitles,
      });
      setResult(res);
    } catch (err: any) {
      setResearchError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const copyAgentPrompt = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.agent_prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.62)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          padding: 24,
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={18} color="var(--ai-amber)" />
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>
              Epistemic AI Node Synthesizer
            </h2>
          </div>
          <button type="button" className="btn-subtle" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          All AI-generated knowledge is automatically marked in{' '}
          <strong style={{ color: 'var(--ai-amber)' }}>Amber Unverified Status</strong> (
          <code>ai_status: unverified</code>, <code>&gt; [!ai]</code>, and{' '}
          <code>==[AI] ...==</code>) until you inspect primary sources and click{' '}
          <strong>Verify</strong>.
        </p>

        {/* 3 Ingestion Modes Selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            type="button"
            className="btn-subtle"
            onClick={() => setMode('agent_research')}
            style={{
              padding: '10px 12px',
              justifyContent: 'flex-start',
              borderColor: mode === 'agent_research' || mode === 'agent_wiki' ? 'var(--ai-amber)' : undefined,
            }}
          >
            <Bot size={15} color="var(--ai-amber)" />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Grounded Research + Agent</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                Wikipedia + Antigravity / Claude
              </div>
            </div>
          </button>

          <button
            type="button"
            className="btn-subtle"
            onClick={() => {
              setMode('api');
              setApiUrl('https://api.openai.com/v1/chat/completions');
              setModel('gpt-4o-mini');
            }}
            style={{
              padding: '10px 12px',
              justifyContent: 'flex-start',
              borderColor: mode === 'api' ? 'var(--ai-amber)' : undefined,
            }}
          >
            <Globe size={15} color="var(--hypha-link)" />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Cloud LLM API</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                OpenAI / Gemini / Claude
              </div>
            </div>
          </button>

          <button
            type="button"
            className="btn-subtle"
            onClick={() => {
              setMode('ollama');
              setApiUrl('http://localhost:11434/api/generate');
              setModel('llama3.2');
            }}
            style={{
              padding: '10px 12px',
              justifyContent: 'flex-start',
              borderColor: mode === 'ollama' ? 'var(--ai-amber)' : undefined,
            }}
          >
            <Cpu size={15} color="var(--verified-emerald)" />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Local LLM (Ollama)</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                100% Local on Mac
              </div>
            </div>
          </button>
        </div>

        <form onSubmit={handleSynthesize} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter concept or Node title (e.g. Spore, Slime Mold, Rhizosphere)..."
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-panel)',
                fontSize: 13.5,
              }}
            />
            <button type="submit" className="btn-amber" disabled={loading}>
              <Sparkles size={14} /> {loading ? 'Researching...' : 'Synthesize Draft'}
            </button>
          </div>

          {mode !== 'agent_research' && mode !== 'agent_wiki' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="Endpoint URL"
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                  fontSize: 12,
                }}
              />
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model name (e.g. llama3.2, gpt-4o-mini)"
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-panel)',
                  fontSize: 12,
                }}
              />
              {mode === 'api' && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API Key (Leave empty to use central Studio Settings key or grounded synthesis)"
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-panel)',
                      fontSize: 12,
                    }}
                  />
                  {savedCfg.apiKey && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Key size={12} color="var(--ai-amber)" />
                      <span>Loaded from Studio Settings ({savedCfg.provider.toUpperCase()} • {savedCfg.apiKey.slice(0, 6)}...{savedCfg.apiKey.slice(-4)})</span>
                      {onOpenSettings && (
                        <button
                          type="button"
                          onClick={onOpenSettings}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--hypha-link)',
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: 0,
                            textDecoration: 'underline',
                          }}
                        >
                          Configure in Settings
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {researchError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 12px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#f87171',
                fontSize: 12,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{researchError}</div>
              {onOpenSettings && (
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={onOpenSettings}
                  style={{ fontSize: 11, padding: '3px 8px', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                >
                  <Settings size={12} /> Recheck Key
                </button>
              )}
            </div>
          )}
        </form>

        {result && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              borderTop: '1px solid var(--border-subtle)',
              paddingTop: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--ai-amber-strong)',
              }}
            >
              <span>
                Generated Node Markdown (Marked Unverified via <code>{result.provider_used}</code>)
              </span>
              <button type="button" className="btn-subtle" onClick={copyAgentPrompt}>
                {copiedPrompt ? <Check size={12} /> : <Copy size={12} />}
                {copiedPrompt ? 'Copied Agent Prompt' : 'Copy Prompt for Antigravity / Claude Code'}
              </button>
            </div>

            <pre
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--ai-amber-border)',
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {result.markdown_page}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => {
                  onAppendBlockToCurrent(result.markdown_block);
                  onClose();
                }}
              >
                Append AI Block to Current Node
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onCreateOrUpdatePage(result.title, result.markdown_page);
                  onClose();
                }}
              >
                Save Node `{result.title}.md` (Unverified AI)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
