import React, { useState } from 'react';
import { AiResearchRequest, AiResearchResponse } from '../types/vault';
import { Bot, Check, Copy, Cpu, Globe, Sparkles, X } from 'lucide-react';

interface AiResearchModalProps {
  initialTopic: string;
  existingTitles: string[];
  onClose: () => void;
  onRunResearch: (req: AiResearchRequest) => Promise<AiResearchResponse>;
  onCreateOrUpdatePage: (title: string, rawMarkdown: string) => void;
  onAppendBlockToCurrent: (markdownBlock: string) => void;
}

export const AiResearchModal: React.FC<AiResearchModalProps> = ({
  initialTopic,
  existingTitles,
  onClose,
  onRunResearch,
  onCreateOrUpdatePage,
  onAppendBlockToCurrent,
}) => {
  const [topic, setTopic] = useState(initialTopic);
  const [mode, setMode] = useState<'agent_wiki' | 'api' | 'ollama'>('agent_wiki');
  const [apiUrl, setApiUrl] = useState('https://api.openai.com/v1/chat/completions');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiResearchResponse | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const handleSynthesize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
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
            onClick={() => setMode('agent_wiki')}
            style={{
              padding: '10px 12px',
              justifyContent: 'flex-start',
              borderColor: mode === 'agent_wiki' ? 'var(--ai-amber)' : undefined,
            }}
          >
            <Bot size={15} color="var(--ai-amber)" />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Grounded Wiki + Agent</div>
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
            <Globe size={15} color="var(--wiki-link)" />
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
              placeholder="Enter concept or Wiki page title (e.g. Spore, Slime Mold, Rhizosphere)..."
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

          {mode !== 'agent_wiki' && (
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
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API Key (optional — falls back to grounded synthesis if empty)"
                  style={{
                    gridColumn: '1 / -1',
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    fontSize: 12,
                  }}
                />
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
