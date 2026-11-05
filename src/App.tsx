import React, { useEffect, useMemo, useState } from 'react';
import { VaultSnapshot } from './types/vault';
import { ColonyRecord, vaultClient } from './lib/vaultClient';
import { normalizeId } from './lib/vaultEngine';
import { WikiArticleView } from './components/WikiArticleView';
import { ConnectionsInspector } from './components/ConnectionsInspector';
import {
  NodeMapCanvas,
  computeColonyOrderedClusters,
  loadColonyColorSettings,
  resolveColonyNodeColor,
} from './components/NodeMapCanvas';
import { AiResearchModal } from './components/AiResearchModal';
import {
  CORE_THEME_PRESETS,
  CURATED_MUTED_SWATCHES,
  StudioThemePreset,
  ThemeColorTokens,
  applyThemePaletteToDocument,
  getDefaultCorePreset,
  isColorDark,
  loadStudioThemeState,
  saveStudioThemeState,
} from './lib/themePresets';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  FolderOpen,
  HardDrive,
  Lock,
  Network,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

/**
 * Dynamic Multi-Tone Vector Mushroom & Mycelium Network Emblem
 * - Dome Mushroom Pileus (Cap) + Gill Striations + Tapered Stipe
 * - Branching Root Mycelium Hyphae + Glowing Spore Nodes
 * - Dynamically recolors via `capColor` and `hyphaeColor` from Studio Theme Settings
 */
export const MyceliumLogoMark: React.FC<{
  size?: number;
  capColor?: string;
  hyphaeColor?: string;
}> = ({ size = 21, capColor = 'var(--wiki-link)', hyphaeColor = 'var(--verified-emerald)' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Mycelium Fungi & Hyphae Vector Logo"
  >
    {/* Mushroom Cap (Pileus) Soft Fill & Botanical Outline */}
    <path
      d="M4.5 12.2C4.5 6.8 8.65 3.1 14 3.1C19.35 3.1 23.5 6.8 23.5 12.2C23.5 13.35 22.6 14.1 21.4 14.1H6.6C5.4 14.1 4.5 13.35 4.5 12.2Z"
      fill={capColor}
      fillOpacity="0.26"
      stroke={capColor}
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Cap Spots & Gill Contour */}
    <circle cx="10.2" cy="7.6" r="1.1" fill={capColor} fillOpacity="0.78" />
    <circle cx="15.4" cy="6.5" r="0.95" fill={capColor} fillOpacity="0.65" />
    <circle cx="18.2" cy="9.1" r="0.85" fill={capColor} fillOpacity="0.65" />
    <path
      d="M8.2 11.7C11.1 10.7 16.9 10.7 19.8 11.7"
      stroke={capColor}
      strokeWidth="1.25"
      strokeLinecap="round"
      opacity="0.78"
    />
    {/* Mushroom Stipe (Stem) */}
    <path
      d="M12.6 14.1L12.1 18.6M15.4 14.1L15.9 18.6"
      stroke={capColor}
      strokeWidth="1.65"
      strokeLinecap="round"
    />
    {/* Underground Mycelium Hyphae Filaments */}
    <path
      d="M14 17.6V23.4M12.4 18.4L6.4 22.8M15.6 18.4L21.6 22.8M10.2 20.1L9.2 24.4M17.8 20.1L18.8 24.4"
      stroke={hyphaeColor}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Spore & Hypha Node Terminals */}
    <circle cx="5.6" cy="23.3" r="1.55" fill={hyphaeColor} />
    <circle cx="22.4" cy="23.3" r="1.55" fill={hyphaeColor} />
    <circle cx="14" cy="24.6" r="1.65" fill={capColor} />
    <circle cx="9.0" cy="25.0" r="1.2" fill={hyphaeColor} />
    <circle cx="19.0" cy="25.0" r="1.2" fill={hyphaeColor} />
  </svg>
);

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [colonies, setColonies] = useState<ColonyRecord[]>(vaultClient.getColonies());
  const [activeColony, setActiveColony] = useState<ColonyRecord>(vaultClient.getActiveColony());

  const [activeNoteId, setActiveNoteId] = useState<string>('mycelium-network');
  const [viewStage, setViewStage] = useState<'wiki' | 'graph'>('wiki');
  const [articleMode, setArticleMode] = useState<'read' | 'write'>('read');
  const [graphScope, setGraphScope] = useState<'global' | 'local'>('global');
  const [themeState, setThemeState] = useState(() => loadStudioThemeState());
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    isColorDark(loadStudioThemeState().activeColors.bgCanvas) ? 'dark' : 'light'
  );
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sidebarFilter, setSidebarFilter] = useState<'all' | 'ai' | 'verified'>('all');
  const [activeClusters, setActiveClusters] = useState<string[]>([]);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState<boolean>(true);
  const [colorSettingsTick, setColorSettingsTick] = useState<number>(0);
  const [writeDirtyState, setWriteDirtyState] = useState<{
    isDirty: boolean;
    saveChanges: () => void;
    discardChanges: () => void;
  }>({
    isDirty: false,
    saveChanges: () => {},
    discardChanges: () => {},
  });
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<(() => void) | null>(null);
  const [aiModalTopic, setAiModalTopic] = useState<string | null>(null);

  // Modals: Colony Manager & New Node Composer
  const [showColonyModal, setShowColonyModal] = useState<boolean>(false);
  const [newColonyName, setNewColonyName] = useState<string>('');
  const [newColonyPath, setNewColonyPath] = useState<string>('');
  const [manageColoniesUnlock, setManageColoniesUnlock] = useState<boolean>(false);
  const [colonyPendingRemoval, setColonyPendingRemoval] = useState<ColonyRecord | null>(null);
  const [colonyRemovalTypedName, setColonyRemovalTypedName] = useState<string>('');
  const [confirmResetSample, setConfirmResetSample] = useState<boolean>(false);
  const [inAppFolderBrowserOpen, setInAppFolderBrowserOpen] = useState<boolean>(false);
  const [browserDirData, setBrowserDirData] = useState<{
    current_path: string;
    parent_path: string | null;
    md_count: number;
    directories: Array<{ name: string; path: string; md_count: number }>;
  } | null>(null);
  const [inAppNotice, setInAppNotice] = useState<string | null>(null);

  const [showNewNodeModal, setShowNewNodeModal] = useState<boolean>(false);
  const [newNodeTitle, setNewNodeTitle] = useState<string>('');
  const [newNodeClusters, setNewNodeClusters] = useState<string>('colony, wiki');
  const [newNodeAliases, setNewNodeAliases] = useState<string>('');
  const [newNodeMode, setNewNodeMode] = useState<'manual' | 'ai'>('manual');

  const syncColonyState = (snap: VaultSnapshot) => {
    setSnapshot(snap);
    setColonies(vaultClient.getColonies());
    setActiveColony(vaultClient.getActiveColony());
  };

  const browseDiskDirectory = async (targetPath = '') => {
    try {
      const res = await fetch(`/api/fs/dirs?path=${encodeURIComponent(targetPath)}`);
      if (res.ok) {
        const data = await res.json();
        setBrowserDirData(data);
        setInAppFolderBrowserOpen(true);
      } else {
        setInAppNotice('Unable to read directory. Please check the path.');
      }
    } catch {
      setInAppNotice('Rust Core server is offline. Start Rust Core to browse local folders.');
    }
  };

  useEffect(() => {
    // Route any accidental browser window.alert into the in-app modal
    const origAlert = window.alert;
    window.alert = (msg?: unknown) => {
      setInAppNotice(String(msg ?? ''));
    };
    return () => {
      window.alert = origAlert;
    };
  }, []);

  useEffect(() => {
    const resolvedMode = applyThemePaletteToDocument(themeState.activeColors);
    setTheme(resolvedMode);
    saveStudioThemeState(themeState);
  }, [themeState]);

  const selectThemePreset = (preset: StudioThemePreset) => {
    setThemeState((prev) => ({
      ...prev,
      activePresetId: preset.id,
      activeColors: { ...preset.colors },
    }));
  };

  const updateThemeColor = (key: keyof ThemeColorTokens, value: string) => {
    setThemeState((prev) => {
      const nextColors: ThemeColorTokens = {
        ...prev.activeColors,
        [key]: value,
      };
      // If user changes accent or verified and logo colors were still matching the old ones, keep logo harmonious
      if (key === 'accent' && prev.activeColors.logoCap === prev.activeColors.accent) {
        nextColors.logoCap = value;
      }
      if (key === 'verified' && prev.activeColors.logoHyphae === prev.activeColors.verified) {
        nextColors.logoHyphae = value;
      }
      return {
        ...prev,
        activeColors: nextColors,
      };
    });
  };

  const handleSaveUserPreset = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newPresetName.trim();
    if (!label) return;
    const id = `user-${Date.now()}`;
    const dark = isColorDark(themeState.activeColors.bgCanvas);
    const created: StudioThemePreset = {
      id,
      name: label,
      subtitle: `Custom ${dark ? 'Dark' : 'Light'} Studio Preset`,
      family: 'custom',
      isCore: false,
      isDark: dark,
      colors: { ...themeState.activeColors },
    };
    setThemeState((prev) => ({
      activePresetId: id,
      activeColors: { ...prev.activeColors },
      userPresets: [...prev.userPresets, created],
    }));
    setNewPresetName('');
  };

  const handleDeleteUserPreset = (presetId: string) => {
    setThemeState((prev) => {
      const remaining = prev.userPresets.filter((p) => p.id !== presetId);
      const nextPreset =
        prev.activePresetId === presetId ? getDefaultCorePreset() : null;
      return {
        activePresetId: nextPreset ? nextPreset.id : prev.activePresetId,
        activeColors: nextPreset ? { ...nextPreset.colors } : prev.activeColors,
        userPresets: remaining,
      };
    });
  };

  useEffect(() => {
    vaultClient.fetchVault().then((snap) => {
      syncColonyState(snap);
      if (snap.notes.length > 0 && !snap.notes.some((n) => n.id === activeNoteId)) {
        setActiveNoteId(snap.notes[0].id);
      }
    });
  }, []);

  const activeNote = useMemo(() => {
    if (!snapshot || snapshot.notes.length === 0) return null;
    return snapshot.notes.find((n) => n.id === activeNoteId) || snapshot.notes[0];
  }, [snapshot, activeNoteId]);

  const availableClusters = useMemo(() => {
    if (!snapshot) return [];
    const counts = new Map<string, number>();
    for (const n of snapshot.notes) {
      for (const t of n.tags) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [snapshot]);

  useEffect(() => {
    const onColorsUpdated = () => setColorSettingsTick((t) => t + 1);
    window.addEventListener('mycelium-colony-colors-updated', onColorsUpdated);
    return () => window.removeEventListener('mycelium-colony-colors-updated', onColorsUpdated);
  }, []);

  const guardUnsavedChanges = (action: () => void) => {
    if (viewStage === 'wiki' && articleMode === 'write' && writeDirtyState.isDirty) {
      setPendingUnsavedAction(() => action);
      return;
    }
    action();
  };

  const toggleCluster = (tag: string) => {
    setActiveClusters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const colonyColorConfig = useMemo(() => {
    if (!snapshot) return null;
    const settings = loadColonyColorSettings(snapshot.vault_path);
    const orderedClusters = computeColonyOrderedClusters(
      snapshot.graph_nodes,
      settings.clusterColors
    );
    const clusterColorMap = new Map<string, string>();
    for (const c of orderedClusters) {
      clusterColorMap.set(c.tag, c.color);
    }
    return { settings, orderedClusters, clusterColorMap };
  }, [snapshot, colorSettingsTick]);

  const filteredNotes = useMemo(() => {
    if (!snapshot) return [];
    const q = searchQuery.trim().toLowerCase();
    return snapshot.notes.filter((n) => {
      if (sidebarFilter === 'ai' && n.epistemic_status === 'verified') return false;
      if (sidebarFilter === 'verified' && n.epistemic_status !== 'verified') return false;
      if (activeClusters.length > 0 && !n.tags.some((t) => activeClusters.includes(t))) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.aliases.some((a) => a.toLowerCase().includes(q)) ||
        n.tags.some((t) => t.toLowerCase().includes(q)) ||
        n.body.toLowerCase().includes(q)
      );
    });
  }, [snapshot, searchQuery, sidebarFilter, activeClusters]);

  const colonyStats = useMemo(() => {
    if (!snapshot) return { total: 0, verified: 0, aiSegments: 0 };
    const total = snapshot.notes.length;
    const verified = snapshot.notes.filter((n) => n.epistemic_status === 'verified').length;
    const aiSegments = snapshot.notes.reduce((sum, n) => sum + n.ai_segments.length, 0);
    return { total, verified, aiSegments };
  }, [snapshot]);

  const handleNavigateOrCreate = async (targetTitleOrId: string, createIfMissing = false) => {
    if (!snapshot) return;
    const targetSlug = normalizeId(targetTitleOrId);
    const stemSlug = normalizeId(targetTitleOrId.split('/').pop() || targetTitleOrId);
    const existing = snapshot.notes.find(
      (n) =>
        n.id === targetSlug ||
        n.id === stemSlug ||
        normalizeId(n.title) === targetSlug ||
        normalizeId(n.title) === stemSlug ||
        normalizeId(n.rel_path) === targetSlug ||
        n.aliases.some((a) => normalizeId(a) === targetSlug || normalizeId(a) === stemSlug)
    );
    if (existing) {
      guardUnsavedChanges(() => {
        setActiveNoteId(existing.id);
        setViewStage('wiki');
      });
      return;
    }

    if (createIfMissing) {
      const rawTarget = targetTitleOrId.trim().replace(/\.md$/i, '');
      const hasExplicitFolder = rawTarget.includes('/');
      const cleanTitle = (hasExplicitFolder ? rawTarget.split('/').pop()! : rawTarget).trim();
      const folderPrefix = hasExplicitFolder
        ? `${rawTarget.split('/').slice(0, -1).join('/')}/`
        : activeNote?.folder
        ? `${activeNote.folder}/`
        : '';
      const newRelPath = `${folderPrefix}${cleanTitle}.md`;
      const initialMd = `---
title: ${cleanTitle}
tags: [${activeClusters[0] || 'colony'}]
ai_status: verified
verified_at: ${new Date().toISOString().slice(0, 10)}
---

# ${cleanTitle}

Write verified notes for **${cleanTitle}** or use the **AI Synthesis Co-Pilot** on the right to expand this Node connected via Hypha to [[${
        activeNote?.title || 'Mycelium Network'
      }]].
`;
      const updated = await vaultClient.saveNote(newRelPath, initialMd);
      syncColonyState(updated);
      setActiveNoteId(normalizeId(cleanTitle));
      setViewStage('wiki');
      setArticleMode('write');
    }
  };

  const handleCreateBackgroundNote = async (targetTitle: string, linkTermFirst?: string) => {
    if (!snapshot || !activeNote) return;
    const rawTarget = targetTitle.trim().replace(/\.md$/i, '');
    const hasExplicitFolder = rawTarget.includes('/');
    const baseName = hasExplicitFolder ? rawTarget.split('/').pop()! : rawTarget;
    const cleanTitle = baseName.replace(/[/\\?%*:|"<>]/g, '-').trim();
    if (!cleanTitle) return;

    if (linkTermFirst) {
      await vaultClient.linkTerm(activeNote.id, linkTermFirst, cleanTitle);
    }

    const exists = snapshot.notes.some(
      (n) =>
        n.id === normalizeId(cleanTitle) ||
        normalizeId(n.title) === normalizeId(cleanTitle) ||
        normalizeId(n.rel_path) === normalizeId(rawTarget)
    );
    if (!exists) {
      const folderPrefix = hasExplicitFolder
        ? `${rawTarget
            .split('/')
            .slice(0, -1)
            .map((p) => p.replace(/[/\\?%*:|"<>]/g, '-').trim())
            .filter(Boolean)
            .join('/')}/`
        : activeNote.folder
        ? `${activeNote.folder}/`
        : '';
      const newRelPath = `${folderPrefix}${cleanTitle}.md`;
      const initialMd = `---
title: ${cleanTitle}
tags: [${activeClusters[0] || activeNote.tags[0] || 'colony'}]
ai_status: verified
verified_at: ${new Date().toISOString().slice(0, 10)}
---

# ${cleanTitle}

Connected via Hypha from [[${activeNote.title}]].
`;
      const updated = await vaultClient.saveNote(newRelPath, initialMd);
      syncColonyState(updated);
    } else {
      const updated = await vaultClient.fetchVault();
      syncColonyState(updated);
    }
  };

  const handleCreateNewNodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newNodeTitle.trim();
    if (!cleanTitle) return;

    const tagsList = newNodeClusters
      .split(',')
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean);
    const aliasList = newNodeAliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (newNodeMode === 'ai' && snapshot) {
      const aiRes = await vaultClient.researchWithAi({
        topic: cleanTitle,
        mode: 'agent_wiki',
        existing_titles: snapshot.notes.map((n) => n.title),
      });
      const updated = await vaultClient.saveNote(`${cleanTitle}.md`, aiRes.markdown_page);
      syncColonyState(updated);
      setActiveNoteId(normalizeId(cleanTitle));
      setViewStage('wiki');
      setArticleMode('read');
    } else {
      const md = `---
title: ${cleanTitle}
${aliasList.length > 0 ? `aliases: [${aliasList.join(', ')}]\n` : ''}tags: [${
        tagsList.length > 0 ? tagsList.join(', ') : 'colony'
      }]
ai_status: verified
verified_at: ${new Date().toISOString().slice(0, 10)}
---

# ${cleanTitle}

Start writing your Node content here, and connect related concepts using [[${
        activeNote?.title || 'Mycelium Network'
      }]].
`;
      const updated = await vaultClient.saveNote(`${cleanTitle}.md`, md);
      syncColonyState(updated);
      setActiveNoteId(normalizeId(cleanTitle));
      setViewStage('wiki');
      setArticleMode('write');
    }

    setNewNodeTitle('');
    setNewNodeAliases('');
    setShowNewNodeModal(false);
  };

  const handleOpenDiskColony = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColonyPath.trim()) return;
    const snap = await vaultClient.openOrCreateDiskColony(newColonyName, newColonyPath);
    syncColonyState(snap);
    if (snap.notes.length > 0) {
      setActiveNoteId(snap.notes[0].id);
    }
    setNewColonyName('');
    setNewColonyPath('');
    setShowColonyModal(false);
  };

  if (!snapshot || !activeNote) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        Initializing Mycelium Colony...
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Application Header */}
      <header className="topbar">
        <div className="brand-cluster">
          <button
            type="button"
            className="btn-subtle"
            onClick={() => setLeftSidebarOpen((v) => !v)}
            title={leftSidebarOpen ? 'Collapse Left Colony Explorer' : 'Expand Left Colony Explorer'}
            style={{ padding: '6px 8px' }}
          >
            {leftSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>

          <div
            className="brand-mark"
            title="Mycelium — Personal Wiki & Epistemic Graph Studio (Click to open Studio Settings)"
            onClick={() => setShowSettingsModal(true)}
            style={{
              cursor: 'pointer',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
            }}
          >
            <MyceliumLogoMark
              size={22}
              capColor={themeState.activeColors.logoCap}
              hyphaeColor={themeState.activeColors.logoHyphae}
            />
          </div>
          <span className="brand-title">Mycelium</span>

          {/* Colony Switcher Pill (Remembers Where Colonies Are) */}
          <button
            type="button"
            className="btn-subtle"
            onClick={() => setShowColonyModal(true)}
            title={`Active Colony Path: ${activeColony.path}`}
            style={{ padding: '5px 12px' }}
          >
            <FolderOpen size={13} color="var(--verified-emerald)" />
            <span>{activeColony.name}</span>
            <span
              style={{
                fontSize: 10.5,
                color: 'var(--text-muted)',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              ({colonies.length})
            </span>
            <ChevronDown size={13} />
          </button>

          <span
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            {colonyStats.verified}/{colonyStats.total} Verified • {colonyStats.aiSegments} AI
            Pending
          </span>
        </div>

        {/* Center Segmented Workspace Switcher: Read Node vs. Write Node vs. Colony Map */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`segmented-pill ${
              viewStage === 'wiki' && articleMode === 'read' ? 'active' : ''
            }`}
            onClick={() =>
              guardUnsavedChanges(() => {
                setViewStage('wiki');
                setArticleMode('read');
              })
            }
          >
            <BookOpen size={14} /> Read Node
          </button>
          <button
            type="button"
            className={`segmented-pill ${
              viewStage === 'wiki' && articleMode === 'write' ? 'active' : ''
            }`}
            onClick={() => {
              setViewStage('wiki');
              setArticleMode('write');
            }}
          >
            <PenTool size={14} /> Write Node
            {viewStage === 'wiki' && articleMode === 'write' && writeDirtyState.isDirty && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--ai-amber)',
                  display: 'inline-block',
                }}
                title="Unsaved changes"
              />
            )}
          </button>
          <button
            type="button"
            className={`segmented-pill ${viewStage === 'graph' ? 'active' : ''}`}
            onClick={() =>
              guardUnsavedChanges(() => {
                setViewStage('graph');
              })
            }
          >
            <Network size={14} /> Colony Map
          </button>
        </div>

        {/* Right Action Cluster (Consolidated into Studio Settings) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => guardUnsavedChanges(() => setShowNewNodeModal(true))}
          >
            <Plus size={14} /> New Node (.md)
          </button>

          <button
            type="button"
            className="btn-subtle"
            onClick={() => setShowSettingsModal(true)}
            title="Open Studio Settings (Themes, Custom Colors, Vector Logo, AI Co-Pilot & Colony Tools)"
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600 }}
          >
            <Settings size={14} color="var(--wiki-link)" /> Settings
          </button>

          {viewStage === 'wiki' && (
            <button
              type="button"
              className="btn-subtle"
              onClick={() => setRightSidebarOpen((v) => !v)}
              title={rightSidebarOpen ? 'Collapse Right Hyphae Inspector' : 'Expand Right Hyphae Inspector'}
              style={{ padding: '6px 8px' }}
            >
              {rightSidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          )}
        </div>
      </header>

      {/* Main 3-Pane Horizontal Studio Layout (Supports Collapsible Left & Right Sidebars) */}
      <div className="workspace-grid">
        {/* Left Sidebar: Colony Explorer, Multi-Cluster Filter Pills & Node List */}
        {leftSidebarOpen && (
          <aside className="sidebar-left">
            <div className="search-box">
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              className="search-input"
              placeholder="Search Nodes, aliases, #clusters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '4px 14px 10px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {(['all', 'ai', 'verified'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSidebarFilter(f)}
                className="btn-subtle"
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  padding: '4px 6px',
                  fontSize: 11,
                  borderColor: sidebarFilter === f ? 'var(--wiki-link)' : undefined,
                }}
              >
                {f === 'all' ? 'All Nodes' : f === 'ai' ? 'AI Drafts' : 'Verified'}
              </button>
            ))}
          </div>

          {/* Multi-Cluster Tag Filter Pills (#cluster-tag) */}
          <div className="sidebar-section-header" style={{ paddingBottom: 4 }}>
            <span>
              Clusters ({activeClusters.length > 0 ? `${activeClusters.length} selected` : 'Multi-select'})
            </span>
            {activeClusters.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveClusters([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--wiki-link)',
                  fontSize: 10.5,
                  cursor: 'pointer',
                }}
              >
                Clear ({activeClusters.length})
              </button>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 5,
              padding: '4px 14px 12px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveClusters([])}
              className="btn-subtle"
              style={{
                padding: '3px 9px',
                fontSize: 11,
                borderColor: activeClusters.length === 0 ? 'var(--wiki-link)' : undefined,
              }}
            >
              All
            </button>
            {availableClusters.map(({ tag, count }) => {
              const isSelected = activeClusters.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleCluster(tag)}
                  className="btn-subtle"
                  style={{
                    padding: '3px 9px',
                    fontSize: 11,
                    borderColor: isSelected ? 'var(--wiki-link)' : undefined,
                    background: isSelected ? 'var(--wiki-link-bg)' : undefined,
                    fontWeight: isSelected ? 700 : 500,
                  }}
                  title="Click to toggle cluster (multi-cluster filter)"
                >
                  <Tag size={9} /> #{tag} ({count})
                </button>
              );
            })}
          </div>

          <div className="sidebar-section-header">
            <span>Colony Nodes ({filteredNotes.length})</span>
            <button
              type="button"
              className="btn-subtle"
              style={{ padding: '3px 9px', fontSize: 11 }}
              onClick={() => guardUnsavedChanges(() => setShowNewNodeModal(true))}
            >
              <Plus size={11} /> New Node
            </button>
          </div>

          <div className="note-list">
            {filteredNotes.map((note) => {
              const nodeColor =
                colonyColorConfig
                  ? resolveColonyNodeColor(
                      {
                        id: note.id,
                        epistemic_status: note.epistemic_status,
                        tags: note.tags,
                      },
                      colonyColorConfig.settings,
                      colonyColorConfig.clusterColorMap,
                      activeClusters,
                      note.id === activeNote.id
                    )
                  : undefined;
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`note-item ${note.id === activeNote.id ? 'active' : ''}`}
                  onClick={() =>
                    guardUnsavedChanges(() => {
                      setActiveNoteId(note.id);
                      setViewStage('wiki');
                    })
                  }
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: note.id === activeNote.id ? 600 : 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {note.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: '"JetBrains Mono", monospace',
                      }}
                    >
                      {note.outgoing_links.length} out •{' '}
                      {(snapshot.backlinks[note.id] || []).length} in hyphae
                      {note.ai_segments.length > 0 ? ` • ${note.ai_segments.length} AI` : ''}
                    </div>
                  </div>
                  <span
                    className={`status-dot ${note.epistemic_status}`}
                    style={
                      nodeColor
                        ? {
                            background: nodeColor,
                            boxShadow: `0 0 0 3px ${nodeColor}28`,
                          }
                        : undefined
                    }
                    title={`Node Color (${
                      colonyColorConfig?.settings.mode === 'cluster'
                        ? `#${note.tags[0] || 'cluster'}`
                        : note.epistemic_status
                    })`}
                  />
                </button>
              );
            })}
          </div>
          </aside>
        )}

        {/* Center Stage: Node Reader/Writer OR Full Colony Node Map */}
        <main className="main-stage">
          {/* Left Edge Dock Toggle Button */}
          <button
            type="button"
            onClick={() => setLeftSidebarOpen((v) => !v)}
            title={leftSidebarOpen ? 'Collapse Left Sidebar' : 'Expand Left Sidebar'}
            style={{
              position: 'fixed',
              left: leftSidebarOpen ? 274 : 8,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 35,
              width: 26,
              height: 48,
              borderRadius: 999,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-soft)',
              transition: 'left 0.18s ease',
            }}
          >
            {leftSidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
          </button>

          {/* Right Edge Dock Toggle Button (in Read/Write Stage) */}
          {viewStage === 'wiki' && (
            <button
              type="button"
              onClick={() => setRightSidebarOpen((v) => !v)}
              title={rightSidebarOpen ? 'Collapse Right Sidebar' : 'Expand Right Sidebar'}
              style={{
                position: 'fixed',
                right: rightSidebarOpen ? 336 : 8,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 35,
                width: 26,
                height: 48,
                borderRadius: 999,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-soft)',
                transition: 'right 0.18s ease',
              }}
            >
              {rightSidebarOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
            </button>
          )}
          {viewStage === 'graph' ? (
            <NodeMapCanvas
              nodes={snapshot.graph_nodes}
              edges={snapshot.graph_edges}
              allNotes={snapshot.notes}
              activeNoteId={activeNote.id}
              activeCluster={activeClusters[0] || null}
              activeClusters={activeClusters}
              colonyKey={snapshot.vault_path}
              theme={theme}
              mode={graphScope}
              onModeChange={setGraphScope}
              onFocusNode={(nodeId, _title, isStub) => {
                if (!isStub && snapshot.notes.some((n) => n.id === nodeId)) {
                  setActiveNoteId(nodeId);
                }
              }}
              onSelectNode={(nodeId, title, isStub) => {
                if (isStub) {
                  setAiModalTopic(title);
                } else {
                  setActiveNoteId(nodeId);
                  setArticleMode('read');
                  setViewStage('wiki');
                }
              }}
            />
          ) : (
            <WikiArticleView
              note={activeNote}
              allNotes={snapshot.notes}
              mode={articleMode}
              onModeChange={(nextMode) =>
                guardUnsavedChanges(() => {
                  setArticleMode(nextMode);
                })
              }
              onDirtyChange={(isDirty, saveChanges, discardChanges) =>
                setWriteDirtyState({ isDirty, saveChanges, discardChanges })
              }
              onNavigateToNote={handleNavigateOrCreate}
              onVerifySegment={async (segmentId) => {
                const updated = await vaultClient.verifySegment(activeNote.id, segmentId);
                syncColonyState(updated);
              }}
              onVerifyEntireNote={async () => {
                const updated = await vaultClient.verifyEntireNote(activeNote.id);
                syncColonyState(updated);
              }}
              onLinkTerm={async (term, targetTitle) => {
                const updated = await vaultClient.linkTerm(activeNote.id, term, targetTitle);
                syncColonyState(updated);
              }}
              onCreateBackgroundNote={handleCreateBackgroundNote}
              onSaveRawMarkdown={async (rawMarkdown) => {
                const updated = await vaultClient.saveNote(activeNote.rel_path, rawMarkdown);
                syncColonyState(updated);
              }}
              onRenameAndRefactorNote={async (newTitle, newRawMarkdown) => {
                const safeFileName = newTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
                const folderPrefix = activeNote.folder ? `${activeNote.folder}/` : '';
                const newRelPath = `${folderPrefix}${safeFileName}.md`;
                const updated = await vaultClient.renameNoteAndRefactor(
                  activeNote.rel_path,
                  activeNote.title,
                  newRelPath,
                  newTitle,
                  newRawMarkdown
                );
                syncColonyState(updated);
                const matched = updated.notes.find(
                  (n) => n.rel_path === newRelPath || n.title.toLowerCase() === newTitle.toLowerCase()
                );
                if (matched) {
                  setActiveNoteId(matched.id);
                }
              }}
              onDuplicateNote={async () => {
                const copyTitle = `${activeNote.title} (Copy)`;
                const safeFileName = copyTitle.replace(/[/\\?%*:|"<>]/g, '-').trim();
                const folderPrefix = activeNote.folder ? `${activeNote.folder}/` : '';
                const copyMarkdown = activeNote.raw_markdown
                  .replace(/^title:\s*.+$/m, `title: ${copyTitle}`)
                  .replace(/^#\s+.+$/m, `# ${copyTitle}`);
                const updated = await vaultClient.saveNote(`${folderPrefix}${safeFileName}.md`, copyMarkdown);
                syncColonyState(updated);
                const matched = updated.notes.find(
                  (n) => n.title.toLowerCase() === copyTitle.toLowerCase()
                );
                if (matched) {
                  setActiveNoteId(matched.id);
                }
              }}
              onDeleteNote={async () => {
                const updated = await vaultClient.deleteNote(activeNote.rel_path);
                syncColonyState(updated);
              }}
              onRunAiResearch={(req) => vaultClient.researchWithAi(req)}
              onSelectCluster={(clusterTag) => toggleCluster(clusterTag)}
            />
          )}
        </main>

        {/* Right Sidebar: Incoming Hyphae, Outgoing Hyphae, Latent Hyphae & Local Cluster Map */}
        {viewStage === 'wiki' && rightSidebarOpen && (
          <ConnectionsInspector
            activeNote={activeNote}
            allNotes={snapshot.notes}
            backlinks={snapshot.backlinks[activeNote.id] || []}
            unlinkedMentions={snapshot.unlinked_mentions[activeNote.id] || []}
            graphNodes={snapshot.graph_nodes}
            graphEdges={snapshot.graph_edges}
            verificationLog={snapshot.verification_log}
            colonyKey={snapshot.vault_path}
            theme={theme}
            onSelectNote={handleNavigateOrCreate}
            onLinkUnlinkedMention={async (sourceNoteId, term, targetTitle) => {
              const updated = await vaultClient.linkTerm(sourceNoteId, term, targetTitle);
              syncColonyState(updated);
            }}
            onOpenFullGraph={() => guardUnsavedChanges(() => setViewStage('graph'))}
            onOpenAiResearch={(topic) => setAiModalTopic(topic)}
          />
        )}
      </div>

      {/* ==================== MODAL 1: COLONY REGISTRY & SWITCHER ==================== */}
      {showColonyModal && (
        <div
          onClick={() => setShowColonyModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 90,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 620,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 22,
              padding: 26,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FolderOpen size={19} color="var(--verified-emerald)" />
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>
                    Colony Manager & Saved Locations
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Switch between remembered Colonies or open any Obsidian Compat folder
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setShowColonyModal(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Saved Colonies ({colonies.length})
              </span>
              {colonies.length > 1 && (
                <button
                  type="button"
                  className="btn-subtle"
                  style={{
                    fontSize: 11,
                    padding: '3px 9px',
                    borderColor: manageColoniesUnlock ? 'var(--ai-amber)' : undefined,
                    color: manageColoniesUnlock ? 'var(--ai-amber)' : 'var(--text-muted)',
                  }}
                  onClick={() => {
                    setManageColoniesUnlock((v) => !v);
                    setColonyPendingRemoval(null);
                    setColonyRemovalTypedName('');
                  }}
                >
                  {manageColoniesUnlock ? 'Done Managing' : 'Manage / Remove...'}
                </button>
              )}
            </div>

            {/* Saved Colonies List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {colonies.map((col) => {
                const isCurrent = col.id === activeColony.id;
                return (
                  <div
                    key={col.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 14,
                      background: isCurrent ? 'var(--verified-emerald-bg)' : 'var(--bg-panel)',
                      border: `1px solid ${
                        isCurrent ? 'var(--verified-emerald-border)' : 'var(--border-subtle)'
                      }`,
                    }}
                  >
                    <div
                      onClick={async () => {
                        if (manageColoniesUnlock) return;
                        const snap = await vaultClient.switchColony(col.id);
                        syncColonyState(snap);
                        if (snap.notes.length > 0) setActiveNoteId(snap.notes[0].id);
                        setShowColonyModal(false);
                      }}
                      style={{ cursor: manageColoniesUnlock ? 'default' : 'pointer', flex: 1 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{col.name}</span>
                        {isCurrent && (
                          <span
                            style={{
                              fontSize: 10.5,
                              padding: '1px 8px',
                              borderRadius: 999,
                              background: 'var(--verified-emerald)',
                              color: '#fff',
                              fontWeight: 600,
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 11.5,
                          color: 'var(--text-secondary)',
                          marginTop: 2,
                        }}
                      >
                        {col.path}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {col.nodeCount} Nodes • Last opened {col.lastOpenedAt}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!isCurrent && !manageColoniesUnlock && (
                        <button
                          type="button"
                          className="btn-subtle"
                          onClick={async () => {
                            const snap = await vaultClient.switchColony(col.id);
                            syncColonyState(snap);
                            if (snap.notes.length > 0) setActiveNoteId(snap.notes[0].id);
                            setShowColonyModal(false);
                          }}
                        >
                          <Check size={12} /> Open
                        </button>
                      )}
                      {manageColoniesUnlock && colonies.length > 1 && col.id !== 'sample-colony' && (
                        <button
                          type="button"
                          className="btn-subtle"
                          style={{ color: 'var(--ai-amber)', borderColor: 'rgba(245, 158, 11, 0.35)' }}
                          onClick={() => {
                            setColonyPendingRemoval(col);
                            setColonyRemovalTypedName('');
                          }}
                          title="Open safety confirmation to forget this Colony"
                        >
                          <Trash2 size={12} /> Forget...
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Multi-Step Safety Confirmation Box before Forgetting a Colony */}
            {colonyPendingRemoval && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: 'var(--ai-amber-bg)',
                  border: '1.5px solid var(--ai-amber)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ai-amber-strong)' }}>
                  Confirm Removing Colony "{colonyPendingRemoval.name}" from Saved History
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  To prevent accidental removal, type <strong>{colonyPendingRemoval.name}</strong>{' '}
                  below to unlock the final remove button:
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={colonyRemovalTypedName}
                    onChange={(e) => setColonyRemovalTypedName(e.target.value)}
                    placeholder={`Type "${colonyPendingRemoval.name}" to confirm`}
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 9,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      fontSize: 12.5,
                    }}
                  />
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() => {
                      setColonyPendingRemoval(null);
                      setColonyRemovalTypedName('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      colonyRemovalTypedName.trim().toLowerCase() !==
                      colonyPendingRemoval.name.trim().toLowerCase()
                    }
                    onClick={() => {
                      vaultClient.removeColonyRecord(colonyPendingRemoval.id);
                      setColonies(vaultClient.getColonies());
                      setActiveColony(vaultClient.getActiveColony());
                      setColonyPendingRemoval(null);
                      setColonyRemovalTypedName('');
                      setManageColoniesUnlock(false);
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 9,
                      border: 'none',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor:
                        colonyRemovalTypedName.trim().toLowerCase() ===
                        colonyPendingRemoval.name.trim().toLowerCase()
                          ? 'pointer'
                          : 'not-allowed',
                      opacity:
                        colonyRemovalTypedName.trim().toLowerCase() ===
                        colonyPendingRemoval.name.trim().toLowerCase()
                          ? 1
                          : 0.4,
                      background: '#EF4444',
                      color: '#fff',
                    }}
                  >
                    Confirm Forget Colony
                  </button>
                </div>
              </div>
            )}

            {/* Add Local Disk Path or Browse Folder In-App */}
            <form
              onSubmit={handleOpenDiskColony}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                paddingTop: 14,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <HardDrive size={14} /> Add or Open Colony by Local Disk Path
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr auto', gap: 8 }}>
                <input
                  type="text"
                  value={newColonyName}
                  onChange={(e) => setNewColonyName(e.target.value)}
                  placeholder="Colony Label (e.g. Research Lab)"
                  style={{
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    fontSize: 12.5,
                  }}
                />
                <input
                  type="text"
                  value={newColonyPath}
                  onChange={(e) => setNewColonyPath(e.target.value)}
                  placeholder="/Users/jayjetsada/Documents/MyObsidianVault"
                  style={{
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    fontSize: 12.5,
                    fontFamily: '"JetBrains Mono", monospace',
                  }}
                />
                <button type="submit" className="btn-primary">
                  Mount Path
                </button>
              </div>
            </form>

            {/* In-App Local Folder Browser (Eliminates Browser "localhost:5173 says" Upload Popup!) */}
            {inAppFolderBrowserOpen && browserDirData && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 11.5, fontFamily: '"JetBrains Mono", monospace', color: 'var(--wiki-link)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📁 {browserDirData.current_path} ({browserDirData.md_count} .md files here)
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {browserDirData.parent_path && (
                      <button
                        type="button"
                        className="btn-subtle"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={() => browseDiskDirectory(browserDirData.parent_path!)}
                      >
                        ↑ Up Folder
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ padding: '3px 10px', fontSize: 11 }}
                      onClick={async () => {
                        const folderName =
                          browserDirData.current_path.split('/').filter(Boolean).pop() ||
                          'Local Colony';
                        const snap = await vaultClient.openOrCreateDiskColony(
                          newColonyName.trim() || folderName,
                          browserDirData.current_path
                        );
                        syncColonyState(snap);
                        if (snap.notes.length > 0) setActiveNoteId(snap.notes[0].id);
                        setInAppFolderBrowserOpen(false);
                        setShowColonyModal(false);
                      }}
                    >
                      Open This Folder as Colony
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
                    gap: 6,
                    maxHeight: 150,
                    overflowY: 'auto',
                  }}
                >
                  {browserDirData.directories.map((d) => (
                    <button
                      key={d.path}
                      type="button"
                      onClick={() => browseDiskDirectory(d.path)}
                      className="btn-subtle"
                      style={{
                        justifyContent: 'space-between',
                        padding: '6px 9px',
                        fontSize: 11.5,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📁 {d.name}
                      </span>
                      {d.md_count > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--verified-emerald)', fontWeight: 700 }}>
                          {d.md_count} .md
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* In-App Confirmation before Resetting Core Sample Colony */}
            {confirmResetSample && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--ai-amber-bg)',
                  border: '1px solid var(--ai-amber)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <span>Restore the Core Sample Colony to its initial showcase Nodes?</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn-subtle"
                    onClick={() => setConfirmResetSample(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-amber"
                    onClick={async () => {
                      const snap = await vaultClient.resetToSampleVault();
                      syncColonyState(snap);
                      setConfirmResetSample(false);
                      setShowColonyModal(false);
                    }}
                  >
                    Confirm Reset
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => {
                  if (inAppFolderBrowserOpen) {
                    setInAppFolderBrowserOpen(false);
                  } else {
                    browseDiskDirectory('');
                  }
                }}
              >
                <FolderOpen size={13} />{' '}
                {inAppFolderBrowserOpen ? 'Hide Folder Browser' : 'Browse Local Folders (In-App)...'}
              </button>

              <button
                type="button"
                className="btn-subtle"
                onClick={() => setConfirmResetSample((v) => !v)}
              >
                <RotateCcw size={12} /> Reset Core Sample Colony...
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 2: NEW NODE (.MD) COMPOSER ==================== */}
      {showNewNodeModal && (
        <div
          onClick={() => setShowNewNodeModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 90,
            padding: 20,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateNewNodeSubmit}
            style={{
              width: '100%',
              maxWidth: 520,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 22,
              padding: 26,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Plus size={18} color="var(--verified-emerald)" />
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Create New Colony Node (.md)</h2>
              </div>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setShowNewNodeModal(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Node Title (Filename: <code>{newNodeTitle.trim() || 'Untitled'}.md</code>)
              </label>
              <input
                type="text"
                autoFocus
                required
                value={newNodeTitle}
                onChange={(e) => setNewNodeTitle(e.target.value)}
                placeholder="e.g. Spore Dispersal, Bioluminescence, Distributed Consensus..."
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-panel)',
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Cluster Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={newNodeClusters}
                  onChange={(e) => setNewNodeClusters(e.target.value)}
                  placeholder="biology, fungi, network"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    fontSize: 12.5,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Aliases (optional)
                </label>
                <input
                  type="text"
                  value={newNodeAliases}
                  onChange={(e) => setNewNodeAliases(e.target.value)}
                  placeholder="Alternative names..."
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-panel)',
                    fontSize: 12.5,
                  }}
                />
              </div>
            </div>

            {/* Existing Colony Cluster Tag Suggestions (Prevents Typos!) */}
            {availableClusters.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Tag size={11} color="var(--wiki-link)" /> Existing Colony Clusters (click to
                  add/remove — prevents typos):
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {availableClusters.map(({ tag, count }) => {
                    const currentTags = newNodeClusters
                      .split(',')
                      .map((t) => t.trim().replace(/^#/, ''))
                      .filter(Boolean);
                    const lastPartial = (newNodeClusters.split(',').pop() || '')
                      .trim()
                      .replace(/^#/, '')
                      .toLowerCase();
                    const isSelected = currentTags.includes(tag);
                    const isMatchingPrefix =
                      lastPartial.length > 0 &&
                      !isSelected &&
                      tag.toLowerCase().includes(lastPartial);

                    return (
                      <button
                        key={tag}
                        type="button"
                        className="btn-subtle"
                        onClick={() => {
                          if (isSelected) {
                            setNewNodeClusters(
                              currentTags.filter((t) => t !== tag).join(', ')
                            );
                          } else {
                            const parts = newNodeClusters
                              .split(',')
                              .map((s) => s.trim().replace(/^#/, ''))
                              .filter(Boolean);
                            if (
                              parts.length > 0 &&
                              tag.toLowerCase().startsWith(parts[parts.length - 1].toLowerCase()) &&
                              !availableClusters.some((c) => c.tag === parts[parts.length - 1])
                            ) {
                              parts[parts.length - 1] = tag;
                              setNewNodeClusters(Array.from(new Set(parts)).join(', '));
                            } else {
                              setNewNodeClusters([...currentTags, tag].join(', '));
                            }
                          }
                        }}
                        style={{
                          padding: '3px 9px',
                          fontSize: 11,
                          borderRadius: 999,
                          background: isSelected
                            ? 'var(--verified-emerald-bg)'
                            : isMatchingPrefix
                            ? 'var(--ai-amber-bg)'
                            : 'var(--bg-elevated)',
                          borderColor: isSelected
                            ? 'var(--verified-emerald)'
                            : isMatchingPrefix
                            ? 'var(--ai-amber)'
                            : 'var(--border-subtle)',
                          color: isSelected
                            ? 'var(--verified-emerald)'
                            : isMatchingPrefix
                            ? 'var(--ai-amber)'
                            : 'var(--text-secondary)',
                          fontWeight: isSelected || isMatchingPrefix ? 700 : 500,
                        }}
                      >
                        {isSelected ? '✓' : '+'} #{tag}{' '}
                        <span style={{ opacity: 0.65, fontSize: 10 }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setNewNodeMode('manual')}
                style={{
                  padding: '10px 12px',
                  justifyContent: 'center',
                  borderColor: newNodeMode === 'manual' ? 'var(--verified-emerald)' : undefined,
                }}
              >
                <PenTool size={14} color="var(--verified-emerald)" /> Write Node Manually
              </button>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setNewNodeMode('ai')}
                style={{
                  padding: '10px 12px',
                  justifyContent: 'center',
                  borderColor: newNodeMode === 'ai' ? 'var(--ai-amber)' : undefined,
                }}
              >
                <Sparkles size={14} color="var(--ai-amber)" /> Auto-Synthesize via AI
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setShowNewNodeModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                {newNodeMode === 'manual'
                  ? 'Create & Open in Write Studio'
                  : 'Synthesize & Save Node'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL 3: STUDIO SETTINGS (THEMES, CUSTOM COLORS, VECTOR LOGO & AI) ==================== */}
      {showSettingsModal && (
        <div
          onClick={() => setShowSettingsModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 95,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 740,
              maxHeight: '88vh',
              overflowY: 'auto',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 22,
              padding: 26,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            {/* Header + Dynamic Vector Mushroom Logo Preview */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    background: 'var(--bg-panel)',
                    border: '1.5px solid var(--border-strong)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <MyceliumLogoMark
                    size={34}
                    capColor={themeState.activeColors.logoCap}
                    hyphaeColor={themeState.activeColors.logoHyphae}
                  />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>
                    Mycelium Studio Settings & Theme Lab
                  </h2>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Earth & Ocean low-saturation palettes, custom color harmony, dynamic vector fungi logo & AI tools
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setShowSettingsModal(false)}
              >
                <X size={14} />
              </button>
            </div>

            {/* Quick Studio Tools (Moved from Topbar into Settings) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                padding: '12px 16px',
                borderRadius: 16,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Studio Co-Pilot & Colony Management</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Synthesize or verify nodes with AI, or switch between local Markdown Colonies
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setAiModalTopic('');
                  }}
                  style={{ padding: '7px 13px', fontSize: 12, fontWeight: 600 }}
                >
                  <Sparkles size={13} color="var(--ai-amber)" /> Open AI Synthesis Co-Pilot
                </button>
                <button
                  type="button"
                  className="btn-subtle"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowColonyModal(true);
                  }}
                  style={{ padding: '7px 13px', fontSize: 12, fontWeight: 600 }}
                >
                  <FolderOpen size={13} color="var(--verified-emerald)" /> Manage Colonies ({colonies.length})
                </button>
              </div>
            </div>

            {/* 4 Locked Core Presets: Earth Dark / Earth Light / Ocean Dark / Ocean Light */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Palette size={13} color="var(--wiki-link)" /> Core Theme Presets (4 Locked Studio Signatures)
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Low-saturation, eye-friendly contrast
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
                  gap: 10,
                }}
              >
                {CORE_THEME_PRESETS.map((preset) => {
                  const isSelected = themeState.activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => selectThemePreset(preset)}
                      style={{
                        textAlign: 'left',
                        padding: '12px 13px',
                        borderRadius: 15,
                        background: preset.colors.bgElevated,
                        color: preset.colors.textPrimary,
                        border: isSelected
                          ? `2px solid ${preset.colors.accent}`
                          : `1px solid ${preset.colors.textSecondary}33`,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        transition: 'transform 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <MyceliumLogoMark
                            size={18}
                            capColor={preset.colors.logoCap}
                            hyphaeColor={preset.colors.logoHyphae}
                          />
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{preset.name}</span>
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: `${preset.colors.textPrimary}14`,
                            color: preset.colors.textSecondary,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                          title="Built-in Core Preset (Cannot be deleted)"
                        >
                          <Lock size={9} /> Core
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: preset.colors.textSecondary, lineHeight: 1.35 }}>
                        {preset.subtitle}
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                        {[
                          preset.colors.bgCanvas,
                          preset.colors.bgElevated,
                          preset.colors.textPrimary,
                          preset.colors.accent,
                          preset.colors.verified,
                        ].map((hex, i) => (
                          <span
                            key={i}
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 999,
                              background: hex,
                              border: `1px solid ${preset.colors.textSecondary}44`,
                            }}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* User Custom Presets (Add New & Delete User Presets Only) */}
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 16,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  User Custom Presets ({themeState.userPresets.length})
                </span>
                <form onSubmit={handleSaveUserPreset} style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="Preset name (e.g. Forest Truffle)..."
                    style={{
                      padding: '5px 11px',
                      borderRadius: 999,
                      border: '1px solid var(--border-strong)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      width: 210,
                    }}
                  />
                  <button type="submit" className="btn-primary" style={{ padding: '5px 12px', fontSize: 12 }}>
                    <Plus size={12} /> Save Current as Preset
                  </button>
                </form>
              </div>

              {themeState.userPresets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Customize any colors below and save your own preset here. (The 4 Core presets above are permanently protected.)
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {themeState.userPresets.map((up) => {
                    const isSelected = themeState.activePresetId === up.id;
                    return (
                      <div
                        key={up.id}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 11px',
                          borderRadius: 999,
                          background: up.colors.bgElevated,
                          color: up.colors.textPrimary,
                          border: isSelected
                            ? `2px solid ${up.colors.accent}`
                            : `1px solid var(--border-strong)`,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => selectThemePreset(up)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          <MyceliumLogoMark
                            size={15}
                            capColor={up.colors.logoCap}
                            hyphaeColor={up.colors.logoHyphae}
                          />
                          <span>{up.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUserPreset(up.id)}
                          title={`Delete user preset "${up.name}"`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--ai-amber)',
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            padding: 2,
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Harmonious Color & Vector Logo Customizer ("แต่งยังไงก็สวย") */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '16px',
                borderRadius: 16,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    Custom Color & Vector Logo Harmony Studio
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Pick from muted designer swatches or fine-tune any token — surfaces & borders auto-harmonize
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => {
                    const currentCore =
                      CORE_THEME_PRESETS.find((p) => p.id === themeState.activePresetId) ||
                      getDefaultCorePreset();
                    selectThemePreset(currentCore);
                  }}
                >
                  <RotateCcw size={11} /> Reset to Preset Default
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 12,
                }}
              >
                {(
                  [
                    {
                      key: 'bgCanvas' as const,
                      label: 'Canvas Background',
                      swatches:
                        theme === 'dark'
                          ? CURATED_MUTED_SWATCHES.bgCanvasDark
                          : CURATED_MUTED_SWATCHES.bgCanvasLight,
                    },
                    {
                      key: 'bgElevated' as const,
                      label: 'Paper Card Surface',
                      swatches:
                        theme === 'dark'
                          ? CURATED_MUTED_SWATCHES.bgElevatedDark
                          : CURATED_MUTED_SWATCHES.bgElevatedLight,
                    },
                    {
                      key: 'textPrimary' as const,
                      label: 'Primary Typography',
                      swatches:
                        theme === 'dark'
                          ? CURATED_MUTED_SWATCHES.textDark
                          : CURATED_MUTED_SWATCHES.textLight,
                    },
                    {
                      key: 'accent' as const,
                      label: 'Accent & [[Hypha]] Links',
                      swatches: CURATED_MUTED_SWATCHES.accent,
                    },
                    {
                      key: 'logoCap' as const,
                      label: 'Logo: Mushroom Cap Vector',
                      swatches: CURATED_MUTED_SWATCHES.accent,
                    },
                    {
                      key: 'logoHyphae' as const,
                      label: 'Logo: Mycelium Hyphae Vector',
                      swatches: ['#5A9E7C', '#509C87', '#6A9E7F', '#C48B5A', '#6497BF', '#8E82B8'],
                    },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.key}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <span>{themeState.activeColors[item.key].toUpperCase()}</span>
                        <input
                          type="color"
                          value={themeState.activeColors[item.key]}
                          onChange={(e) => updateThemeColor(item.key, e.target.value)}
                          style={{
                            width: 22,
                            height: 22,
                            border: 'none',
                            borderRadius: 6,
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {item.swatches.map((sw) => (
                        <button
                          key={sw}
                          type="button"
                          onClick={() => updateThemeColor(item.key, sw)}
                          title={`Apply curated swatch ${sw}`}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 999,
                            background: sw,
                            border:
                              themeState.activeColors[item.key].toLowerCase() === sw.toLowerCase()
                                ? '2px solid var(--text-primary)'
                                : '1px solid var(--border-strong)',
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Provider AI Research & Agent Prompt Modal */}
      {aiModalTopic !== null && (
        <AiResearchModal
          initialTopic={aiModalTopic}
          existingTitles={snapshot.notes.map((n) => n.title)}
          onClose={() => setAiModalTopic(null)}
          onRunResearch={(req) => vaultClient.researchWithAi(req)}
          onCreateOrUpdatePage={async (title, rawMarkdown) => {
            const relPath = `${title.trim()}.md`;
            const updated = await vaultClient.saveNote(relPath, rawMarkdown);
            syncColonyState(updated);
            setActiveNoteId(normalizeId(title));
            setViewStage('wiki');
          }}
          onAppendBlockToCurrent={async (markdownBlock) => {
            const appended = `${activeNote.raw_markdown.trimEnd()}\n\n${markdownBlock}\n`;
            const updated = await vaultClient.saveNote(activeNote.rel_path, appended);
            syncColonyState(updated);
          }}
        />
      )}

      {/* In-App Unsaved Write Changes Confirmation Modal */}
      {pendingUnsavedAction && (
        <div
          onClick={() => setPendingUnsavedAction(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.62)',
            backdropFilter: 'blur(7px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 130,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              background: 'var(--bg-elevated)',
              border: '1.5px solid var(--ai-amber)',
              borderRadius: 20,
              padding: 22,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={20} color="var(--ai-amber)" />
              <div style={{ fontWeight: 700, fontSize: 16 }}>Unsaved Changes in "{activeNote.title}"</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              You have unsaved edits in Write Node mode. Would you like to save your changes to{' '}
              <code>{activeNote.rel_path}</code> before leaving, or discard them?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setPendingUnsavedAction(null)}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="btn-subtle"
                style={{ color: 'var(--ai-amber)', borderColor: 'var(--ai-amber)' }}
                onClick={() => {
                  const next = pendingUnsavedAction;
                  writeDirtyState.discardChanges();
                  setPendingUnsavedAction(null);
                  next();
                }}
              >
                Discard Changes
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const next = pendingUnsavedAction;
                  writeDirtyState.saveChanges();
                  setPendingUnsavedAction(null);
                  next();
                }}
              >
                <Check size={14} /> Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App System Dialog (Replaces any browser alert/dialog) */}
      {inAppNotice && (
        <div
          onClick={() => setInAppNotice(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 120,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 18,
              padding: 20,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>Mycelium Studio Notice</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {inAppNotice}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setInAppNotice(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
