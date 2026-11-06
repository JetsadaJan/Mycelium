import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColonyGraphSimulator,
  DEFAULT_GRAPH_FORCES,
  SimForces,
  SimNode,
  filterLocalSubgraph,
} from '../lib/graphSim';
import { EpistemicStatus, GraphEdge, GraphNode, NoteDocument } from '../types/vault';
import { stripMarkdownToPlainText } from '../lib/vaultEngine';
import { BookOpen, Compass, Eye, Maximize2, Palette, RotateCcw, Sliders, Sparkles } from 'lucide-react';

export type NodeColorMode = 'verification' | 'cluster';
export type HyphaColorMode = 'source-target' | 'in-out' | 'monochrome';

export interface ColonyDisplaySettings {
  baseNodeSize: number; // 0.6 .. 1.8 (default 1.0)
  hubSizeBoost: number; // 0.0 .. 2.0 (default 1.0 - nodes with more Hyphae are larger)
  labelFontSize: number; // 9 .. 16 px (default 12 - constant on screen when zooming)
  hyphaThickness: number; // 0.5 .. 2.0 (default 1.0)
  hyphaCurvature: number; // 0.0 .. 1.6 (default 1.0)
  hyphaColorMode: HyphaColorMode; // 'source-target' | 'in-out' | 'monochrome'
  outgoingHyphaColor: string; // Outgoing start color when hyphaColorMode === 'in-out'
  incomingHyphaColor: string; // Incoming end color when hyphaColorMode === 'in-out'
  showSignalPulses: boolean;
  labelMode: 'all' | 'smart' | 'hover';
}

export interface ColonyColorSettings {
  mode: NodeColorMode;
  verificationColors: {
    verified: string;
    partial: string;
    unverified: string;
    stub: string;
    active: string;
  };
  clusterColors: Record<string, string>;
  display: ColonyDisplaySettings;
  forces: SimForces;
}

export const DEFAULT_VERIFICATION_COLORS = {
  verified: '#10B981',
  partial: '#D97706',
  unverified: '#F59E0B',
  stub: '#F47265',
  active: '#E29D52',
};

export const DEFAULT_DISPLAY_SETTINGS: ColonyDisplaySettings = {
  baseNodeSize: 0.7,
  hubSizeBoost: 1.0,
  labelFontSize: 12,
  hyphaThickness: 1.1,
  hyphaCurvature: 1.0,
  hyphaColorMode: 'in-out',
  outgoingHyphaColor: '#F59E0B',
  incomingHyphaColor: '#10B981',
  showSignalPulses: true,
  labelMode: 'all',
};

export const AUTO_CLUSTER_PALETTE = [
  '#10B981', // Emerald
  '#E29D52', // Warm Ochre
  '#38BDF8', // Sky
  '#A855F7', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#84CC16', // Lime
  '#F97316', // Terracotta Orange
  '#06B6D4', // Cyan
  '#EAB308', // Gold
  '#F43F5E', // Rose
];

export function getStorageKeyForColony(colonyKey: string): string {
  return `mycelium_colony_colors_v2_${colonyKey || 'default'}`;
}

export function loadColonyColorSettings(colonyKey: string): ColonyColorSettings {
  try {
    const raw = localStorage.getItem(getStorageKeyForColony(colonyKey));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: parsed.mode === 'cluster' ? 'cluster' : 'verification',
        verificationColors: {
          ...DEFAULT_VERIFICATION_COLORS,
          ...(parsed.verificationColors || {}),
        },
        clusterColors: parsed.clusterColors || {},
        display: {
          ...DEFAULT_DISPLAY_SETTINGS,
          ...(parsed.display || {}),
          // If previous storage still had legacy default 1.0, adapt to new calibrated default 0.7
          baseNodeSize:
            parsed.display?.baseNodeSize !== undefined && parsed.display?.baseNodeSize !== 1.0
              ? parsed.display.baseNodeSize
              : DEFAULT_DISPLAY_SETTINGS.baseNodeSize,
        },
        forces: {
          ...DEFAULT_GRAPH_FORCES,
          ...(parsed.forces || {}),
        },
      };
    }
  } catch {
    // Fallback to defaults
  }
  return {
    mode: 'verification',
    verificationColors: { ...DEFAULT_VERIFICATION_COLORS },
    clusterColors: {},
    display: { ...DEFAULT_DISPLAY_SETTINGS },
    forces: { ...DEFAULT_GRAPH_FORCES },
  };
}

export function computeColonyOrderedClusters(
  nodes: Array<{ is_stub?: boolean; tags: string[] }>,
  customClusterColors: Record<string, string>
) {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.is_stub) continue;
    for (const t of n.tags) {
      if (t === 'stub') continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count], idx) => {
      const autoColor = AUTO_CLUSTER_PALETTE[idx % AUTO_CLUSTER_PALETTE.length];
      const resolvedColor = customClusterColors[tag] || autoColor;
      return { tag, count, autoColor, color: resolvedColor };
    });
}

export function resolveColonyNodeColor(
  node: {
    id: string;
    tags: string[];
    epistemic_status: EpistemicStatus;
    is_stub?: boolean;
  },
  colorSettings: ColonyColorSettings,
  clusterColorMap: Map<string, string>,
  activeClusters: string[] = [],
  isActive = false
): string {
  const vColors = colorSettings.verificationColors;
  if (node.is_stub) {
    return vColors.stub;
  }
  if (colorSettings.mode === 'cluster') {
    const preferredTag =
      activeClusters.find((ac) => node.tags.includes(ac)) ||
      node.tags.find((t) => t !== 'stub');
    return (preferredTag ? clusterColorMap.get(preferredTag) : undefined) || '#A89882';
  }
  if (node.epistemic_status === 'unverified') {
    return vColors.unverified;
  }
  if (node.epistemic_status === 'partial') {
    return vColors.partial;
  }
  return isActive ? vColors.active : vColors.verified;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return `rgba(226, 157, 82, ${alpha})`;
}

interface NodeMapCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  allNotes?: NoteDocument[];
  activeNoteId: string;
  activeCluster?: string | null;
  activeClusters?: string[];
  colonyKey?: string;
  theme: 'dark' | 'light';
  mode: 'global' | 'local';
  onModeChange: (mode: 'global' | 'local') => void;
  onFocusNode?: (nodeId: string, title: string, isStub: boolean) => void;
  onSelectNode: (nodeId: string, title: string, isStub: boolean) => void;
  compact?: boolean;
}

export const NodeMapCanvas: React.FC<NodeMapCanvasProps> = ({
  nodes,
  edges,
  allNotes = [],
  activeNoteId,
  activeCluster = null,
  activeClusters = [],
  colonyKey = 'default-colony',
  theme,
  mode,
  onModeChange,
  onFocusNode,
  onSelectNode,
  compact = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<ColonyGraphSimulator | null>(null);

  const [localDepth, setLocalDepth] = useState<number>(1);
  const [showControls, setShowControls] = useState<boolean>(false);
  const [controlTab, setControlTab] = useState<'appearance' | 'colors' | 'physics'>('appearance');
  const [focusedNodeId, setFocusedNodeId] = useState<string>(activeNoteId);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState<number>(compact ? 72 : 92);
  const [colorSettings, setColorSettings] = useState<ColonyColorSettings>(() =>
    loadColonyColorSettings(colonyKey)
  );
  const forces = colorSettings.forces;
  const display = colorSettings.display;

  const selectedClusters = useMemo(() => {
    if (activeClusters && activeClusters.length > 0) return activeClusters;
    if (activeCluster) return [activeCluster];
    return [];
  }, [activeClusters, activeCluster]);

  useEffect(() => {
    setFocusedNodeId(activeNoteId);
  }, [activeNoteId]);

  const effectiveActiveNodeId = focusedNodeId || activeNoteId;

  // Reload color settings when switching Colonies & sync between full map and sidebar mini-map
  useEffect(() => {
    setColorSettings(loadColonyColorSettings(colonyKey));
    const handleSync = (e: Event) => {
      const custom = e as CustomEvent<{ colonyKey: string }>;
      if (!custom.detail || custom.detail.colonyKey === colonyKey) {
        setColorSettings(loadColonyColorSettings(colonyKey));
      }
    };
    window.addEventListener('mycelium-colony-colors-updated', handleSync);
    return () => window.removeEventListener('mycelium-colony-colors-updated', handleSync);
  }, [colonyKey]);

  const updateColorSettings = (updater: (prev: ColonyColorSettings) => ColonyColorSettings) => {
    setColorSettings((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(getStorageKeyForColony(colonyKey), JSON.stringify(next));
        window.dispatchEvent(
          new CustomEvent('mycelium-colony-colors-updated', { detail: { colonyKey } })
        );
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  // Card snapping & dragging positions (persisted per colony or default corners)
  type CardCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  const [readerCorner, setReaderCorner] = useState<CardCorner>('bottom-left');
  const [controlsCorner, setControlsCorner] = useState<CardCorner>('bottom-right');
  const [draggingCard, setDraggingCard] = useState<'reader' | 'controls' | null>(null);
  const [cardDragPos, setCardDragPos] = useState<{ x: number; y: number } | null>(null);
  const cardDragStartRef = useRef<{ startX: number; startY: number; initLeft: number; initTop: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const getCornerStyle = (corner: CardCorner, isControls: boolean) => {
    const margin = 18;
    switch (corner) {
      case 'bottom-left':
        return { bottom: margin, left: margin };
      case 'bottom-right':
        return { bottom: margin, right: margin };
      case 'top-left':
        return { top: 58, left: margin }; // below top-left pill bar
      case 'top-right':
        return { top: 58, right: margin };
    }
  };

  const handleCardDragStart = (e: React.MouseEvent, type: 'reader' | 'controls') => {
    // Only drag from non-interactive header regions
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a, textarea')) return;

    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const parentRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    cardDragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initLeft: rect.left - parentRect.left,
      initTop: rect.top - parentRect.top,
    };
    setCardDragPos({
      x: rect.left - parentRect.left,
      y: rect.top - parentRect.top,
    });
    setDraggingCard(type);
  };

  useEffect(() => {
    if (!draggingCard) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!cardDragStartRef.current || !containerRef.current) return;
      const dx = e.clientX - cardDragStartRef.current.startX;
      const dy = e.clientY - cardDragStartRef.current.startY;
      const parentRect = containerRef.current.getBoundingClientRect();
      const maxX = parentRect.width - 200;
      const maxY = parentRect.height - 100;
      const nextX = Math.max(10, Math.min(maxX, cardDragStartRef.current.initLeft + dx));
      const nextY = Math.max(10, Math.min(maxY, cardDragStartRef.current.initTop + dy));
      setCardDragPos({ x: nextX, y: nextY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!cardDragStartRef.current || !containerRef.current) {
        setDraggingCard(null);
        setCardDragPos(null);
        return;
      }
      const parentRect = containerRef.current.getBoundingClientRect();
      const curX = cardDragPos ? cardDragPos.x : cardDragStartRef.current.initLeft;
      const curY = cardDragPos ? cardDragPos.y : cardDragStartRef.current.initTop;

      const isLeft = curX < parentRect.width / 2;
      const isTop = curY < parentRect.height / 2;
      const targetCorner: CardCorner = isTop
        ? (isLeft ? 'top-left' : 'top-right')
        : (isLeft ? 'bottom-left' : 'bottom-right');

      if (draggingCard === 'reader') {
        // Prevent overlapping with controls card: if same corner, flip controls or swap
        if (targetCorner === controlsCorner) {
          setControlsCorner(readerCorner);
        }
        setReaderCorner(targetCorner);
      } else {
        if (targetCorner === readerCorner) {
          setReaderCorner(controlsCorner);
        }
        setControlsCorner(targetCorner);
      }

      setDraggingCard(null);
      setCardDragPos(null);
      cardDragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingCard, cardDragPos, readerCorner, controlsCorner]);

  // Ordered clusters across the Colony + sequential auto-generated colors (with user overrides)
  const orderedClusters = useMemo(
    () => computeColonyOrderedClusters(nodes, colorSettings.clusterColors),
    [nodes, colorSettings.clusterColors]
  );

  const clusterColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of orderedClusters) {
      map.set(c.tag, c.color);
    }
    return map;
  }, [orderedClusters]);

  const cameraRef = useRef({ x: 0, y: 0, scale: compact ? 0.72 : 0.92 });
  const cameraTargetNodeIdRef = useRef<string | null>(null);
  const cameraTrackFramesRef = useRef<number>(0);
  const lastClickRef = useRef<{
    node: SimNode;
    time: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pulsePhaseRef = useRef(0);
  const hoverScaleRef = useRef<Record<string, number>>({});
  const mouseOffsetRef = useRef<Record<string, { dx: number; dy: number }>>({});
  const mouseWorldRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const dragRef = useRef<{
    type: 'node' | 'pan' | null;
    node: SimNode | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ type: null, node: null, startX: 0, startY: 0, moved: false });

  const localCenterNodeId = mode === 'local' ? effectiveActiveNodeId : null;

  const filteredGraph = useMemo(() => {
    const base =
      mode === 'local' && localCenterNodeId
        ? filterLocalSubgraph(nodes, edges, localCenterNodeId, localDepth)
        : { nodes, edges };

    if (selectedClusters.length === 0) return base;
    const allowed = new Set(
      base.nodes
        .filter((n) => n.tags.some((t) => selectedClusters.includes(t)))
        .map((n) => n.id)
    );
    return {
      nodes: base.nodes.filter((n) => allowed.has(n.id)),
      edges: base.edges.filter((e) => allowed.has(e.source) && allowed.has(e.target)),
    };
  }, [nodes, edges, mode, localCenterNodeId, localDepth, selectedClusters]);

  useEffect(() => {
    if (!simRef.current) {
      simRef.current = new ColonyGraphSimulator(
        filteredGraph.nodes,
        filteredGraph.edges,
        forces
      );
      simRef.current.recenterCentroid(1.0);
      cameraRef.current.x = 0;
      cameraRef.current.y = 0;
    } else {
      const nodeCountChanged = simRef.current.nodes.length !== filteredGraph.nodes.length;
      simRef.current.forces = { ...forces };
      simRef.current.setData(filteredGraph.nodes, filteredGraph.edges);
      if (nodeCountChanged && !cameraTargetNodeIdRef.current) {
        simRef.current.recenterCentroid(1.0);
        cameraRef.current.x = 0;
        cameraRef.current.y = 0;
      }
    }
  }, [filteredGraph, forces]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const drawRoundedPill = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const render = () => {
      pulsePhaseRef.current = (pulsePhaseRef.current + 0.012) % 1;
      const sim = simRef.current;
      if (sim) {
        sim.tick();
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(rect.width * dpr) ||
        canvas.height !== Math.floor(rect.height * dpr)
      ) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const isDark = theme === 'dark';

      // Smooth, Moderate Camera Centering when single-clicking a Node
      const camScale = cameraRef.current.scale;
      if (
        sim &&
        cameraTargetNodeIdRef.current &&
        cameraTrackFramesRef.current > 0 &&
        dragRef.current.type === null
      ) {
        const targetNode = sim.nodes.find((n) => n.id === cameraTargetNodeIdRef.current);
        if (targetNode) {
          const targetCamX = -targetNode.x * camScale;
          const targetCamY = -targetNode.y * camScale;
          cameraRef.current.x += (targetCamX - cameraRef.current.x) * 0.11;
          cameraRef.current.y += (targetCamY - cameraRef.current.y) * 0.11;
          cameraTrackFramesRef.current -= 1;
          if (
            Math.hypot(targetCamX - cameraRef.current.x, targetCamY - cameraRef.current.y) < 0.8 &&
            cameraTrackFramesRef.current < 18
          ) {
            cameraTrackFramesRef.current = 0;
          }
        } else {
          cameraTrackFramesRef.current = 0;
        }
      }

      // Dynamic Theme / Custom Preset Canvas Background
      const rootStyle = getComputedStyle(document.documentElement);
      const cssBgCanvas = rootStyle.getPropertyValue('--bg-canvas').trim() || (isDark ? '#15120F' : '#F4EFE6');
      const cssBgElevated = rootStyle.getPropertyValue('--bg-elevated').trim() || (isDark ? '#26201B' : '#FAF7F2');
      const cssBgPanel = rootStyle.getPropertyValue('--bg-panel').trim() || (isDark ? '#1D1814' : '#EAE2D6');
      const cssTextPrimary = rootStyle.getPropertyValue('--text-primary').trim() || (isDark ? '#EDE5DC' : '#282019');

      ctx.fillStyle = cssBgCanvas;
      ctx.fillRect(0, 0, width, height);

      // Subtle Organic Spore Dot Grid
      const gridStep = 34;
      ctx.fillStyle = hexToRgba(cssTextPrimary, isDark ? 0.065 : 0.085);
      for (let gx = (cameraRef.current.x % gridStep) + gridStep; gx < width; gx += gridStep) {
        for (let gy = (cameraRef.current.y % gridStep) + gridStep; gy < height; gy += gridStep) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const invCam = 1 / camScale;
      const zoomNodeFactor = 1 / Math.pow(camScale, 0.76);

      ctx.translate(width / 2 + cameraRef.current.x, height / 2 + cameraRef.current.y);
      ctx.scale(camScale, camScale);

      if (sim) {
        const focusId = draggingNodeId || hoveredNodeId;
        const inspectNodeId = focusId || effectiveActiveNodeId;
        const neighborIds = new Set<string>();
        if (focusId) {
          neighborIds.add(focusId);
          for (const link of sim.links) {
            if (link.source.id === focusId) neighborIds.add(link.target.id);
            if (link.target.id === focusId) neighborIds.add(link.source.id);
          }
        }

        // Pre-index directed pairs so bidirectional Hyphae (A->B and B->A) never overlap!
        const directedPairSet = new Set<string>();
        for (const l of sim.links) {
          directedPairSet.add(`${l.source.id}-->${l.target.id}`);
        }

        // 1. Draw Non-Overlapping Organic Curved Hyphae with 3 Color Modes
        const thickMult = display.hyphaThickness * invCam;
        const curveMult = display.hyphaCurvature;
        const outColor = display.outgoingHyphaColor || '#F59E0B';
        const inColor = display.incomingHyphaColor || '#10B981';

        for (let idx = 0; idx < sim.links.length; idx++) {
          const link = sim.links[idx];
          const isHighlighted =
            focusId && (link.source.id === focusId || link.target.id === focusId);
          const isConnectedToActive =
            link.source.id === effectiveActiveNodeId || link.target.id === effectiveActiveNodeId;
          const isDimmed = focusId && !isHighlighted;

          const isOutgoingFromInspect = link.source.id === inspectNodeId;
          const isIncomingToInspect = link.target.id === inspectNodeId;

          const sx = link.source.x;
          const sy = link.source.y;
          const tx = link.target.x;
          const ty = link.target.y;
          const dx = tx - sx;
          const dy = ty - sy;
          const dist = Math.hypot(dx, dy) || 1;

          // Always bow along the right-hand normal of the directed vector (sx,sy -> tx,ty).
          // Because (tx,ty -> sx,sy) has the exact opposite direction vector, its right-hand
          // normal points to the opposite side in world space — guaranteeing Incoming and Outgoing
          // Hyphae between two Nodes never overlap!
          const hasReverse = directedPairSet.has(`${link.target.id}-->${link.source.id}`);
          const baseBow = hasReverse
            ? Math.max(18, Math.min(34, dist * 0.14))
            : Math.min(22, dist * 0.085);
          const curveOffset = baseBow * Math.max(hasReverse ? 0.45 : 0, curveMult);
          const cx = (sx + tx) / 2 - (dy / dist) * curveOffset;
          const cy = (sy + ty) / 2 + (dx / dist) * curveOffset;

          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(cx, cy, tx, ty);

          const baseAlpha = isDimmed
            ? 0.1
            : isHighlighted
            ? 0.95
            : isConnectedToActive
            ? 0.78
            : 0.38;

          if (display.hyphaColorMode === 'monochrome') {
            ctx.strokeStyle = isDark
              ? `rgba(246, 240, 230, ${baseAlpha})`
              : `rgba(68, 46, 26, ${baseAlpha})`;
          } else if (display.hyphaColorMode === 'source-target') {
            const srcColor = resolveColonyNodeColor(
              link.source,
              colorSettings,
              clusterColorMap,
              selectedClusters,
              link.source.id === effectiveActiveNodeId
            );
            const tgtColor = resolveColonyNodeColor(
              link.target,
              colorSettings,
              clusterColorMap,
              selectedClusters,
              link.target.id === effectiveActiveNodeId
            );
            const grad = ctx.createLinearGradient(sx, sy, tx, ty);
            grad.addColorStop(0, hexToRgba(srcColor, baseAlpha));
            grad.addColorStop(1, hexToRgba(tgtColor, baseAlpha));
            ctx.strokeStyle = grad;
          } else {
            // 'in-out': 2-color gradient along every Hypha (Outgoing origin -> Incoming destination)
            const grad = ctx.createLinearGradient(sx, sy, tx, ty);
            grad.addColorStop(0, hexToRgba(outColor, baseAlpha));
            grad.addColorStop(1, hexToRgba(inColor, baseAlpha));
            ctx.strokeStyle = grad;
          }

          ctx.lineWidth =
            (isHighlighted ? 2.35 : isConnectedToActive ? 1.85 : isDimmed ? 0.95 : 1.35) *
            thickMult;
          ctx.stroke();

          // Subtle directional arrowhead at t = 0.72 so Incoming vs Outgoing direction is unmistakable
          if (!isDimmed && (isHighlighted || isConnectedToActive || camScale >= 0.85)) {
            const tArrow = 0.72;
            const ax =
              (1 - tArrow) * (1 - tArrow) * sx +
              2 * (1 - tArrow) * tArrow * cx +
              tArrow * tArrow * tx;
            const ay =
              (1 - tArrow) * (1 - tArrow) * sy +
              2 * (1 - tArrow) * tArrow * cy +
              tArrow * tArrow * ty;
            // Tangent vector of quadratic bezier at tArrow
            const tanX = 2 * (1 - tArrow) * (cx - sx) + 2 * tArrow * (tx - cx);
            const tanY = 2 * (1 - tArrow) * (cy - sy) + 2 * tArrow * (ty - cy);
            const tanLen = Math.hypot(tanX, tanY) || 1;
            const ux = tanX / tanLen;
            const uy = tanY / tanLen;
            const arrowSize = (isHighlighted || isConnectedToActive ? 5.2 : 3.8) * zoomNodeFactor;

            ctx.beginPath();
            ctx.moveTo(ax + ux * arrowSize, ay + uy * arrowSize);
            ctx.lineTo(
              ax - ux * arrowSize * 0.8 - uy * arrowSize * 0.65,
              ay - uy * arrowSize * 0.8 + ux * arrowSize * 0.65
            );
            ctx.lineTo(
              ax - ux * arrowSize * 0.8 + uy * arrowSize * 0.65,
              ay - uy * arrowSize * 0.8 - ux * arrowSize * 0.65
            );
            ctx.closePath();

            if (display.hyphaColorMode === 'monochrome') {
              ctx.fillStyle = isDark
                ? `rgba(246, 240, 230, ${Math.min(1, baseAlpha + 0.15)})`
                : `rgba(68, 46, 26, ${Math.min(1, baseAlpha + 0.15)})`;
            } else if (display.hyphaColorMode === 'source-target') {
              const tgtColor = resolveColonyNodeColor(
                link.target,
                colorSettings,
                clusterColorMap,
                selectedClusters,
                link.target.id === effectiveActiveNodeId
              );
              ctx.fillStyle = hexToRgba(tgtColor, Math.min(1, baseAlpha + 0.15));
            } else {
              const arrowHex = isOutgoingFromInspect
                ? outColor
                : isIncomingToInspect
                ? inColor
                : inColor;
              ctx.fillStyle = hexToRgba(arrowHex, Math.min(1, baseAlpha + 0.18));
            }
            ctx.fill();
          }

          // Animated Bio-Signal Pulse along active/highlighted Hyphae
          if (display.showSignalPulses && (isHighlighted || isConnectedToActive)) {
            const t = (pulsePhaseRef.current + idx * 0.19) % 1;
            const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * tx;
            const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ty;

            ctx.beginPath();
            ctx.arc(px, py, (isHighlighted ? 3.1 : 2.35) * zoomNodeFactor, 0, Math.PI * 2);
            if (display.hyphaColorMode === 'monochrome') {
              ctx.fillStyle = isDark ? '#F6F0E6' : '#241911';
            } else if (display.hyphaColorMode === 'source-target') {
              ctx.fillStyle = resolveColonyNodeColor(
                link.target,
                colorSettings,
                clusterColorMap,
                selectedClusters,
                false
              );
            } else {
              ctx.fillStyle = isOutgoingFromInspect ? outColor : inColor;
            }
            ctx.fill();
          }
        }

        // 2. Draw Tactile Colony Nodes with Subtle Magnetic Attraction, Gentle Hover & Controlled Click Scale
        const PROXIMITY_RADIUS = 135 * invCam;
        for (const node of sim.nodes) {
          const isActive = node.id === effectiveActiveNodeId;
          const isHovered = node.id === hoveredNodeId || node.id === draggingNodeId;
          const isDimmed = focusId && !neighborIds.has(node.id);
          const hasUnverifiedAi =
            node.epistemic_status === 'unverified' || node.epistemic_status === 'partial';

          // Nodes with more Hyphae (degree) are proportionally larger
          const degree = node.in_degree + node.out_degree;
          const dynamicBaseRadius =
            Math.min(
              15,
              Math.max(3.5, 3.7 + Math.pow(degree, 0.65) * 1.55 * display.hubSizeBoost)
            ) * display.baseNodeSize;

          // Compute mouse proximity & gentle magnetic attraction toward cursor (capped so it never slips away!)
          let proximityFactor = 0;
          let targetMagDx = 0;
          let targetMagDy = 0;
          if (mouseWorldRef.current.active && dragRef.current.type === null) {
            const toMouseX = mouseWorldRef.current.x - node.x;
            const toMouseY = mouseWorldRef.current.y - node.y;
            const distToMouse = Math.hypot(toMouseX, toMouseY);
            if (distToMouse < PROXIMITY_RADIUS && distToMouse > 0.001) {
              proximityFactor = Math.pow(1 - distToMouse / PROXIMITY_RADIUS, 1.7);
              // Gentle magnetic pull toward cursor: peaks at ~3.2px in screen space, zero when directly under cursor
              const pullStrength = Math.min(distToMouse * 0.14, 3.2 * invCam) * proximityFactor;
              targetMagDx = (toMouseX / distToMouse) * pullStrength;
              targetMagDy = (toMouseY / distToMouse) * pullStrength;
            }
          }

          const prevOff = mouseOffsetRef.current[node.id] || { dx: 0, dy: 0 };
          const curOffDx = prevOff.dx + (targetMagDx - prevOff.dx) * 0.16;
          const curOffDy = prevOff.dy + (targetMagDy - prevOff.dy) * 0.16;
          mouseOffsetRef.current[node.id] = { dx: curOffDx, dy: curOffDy };

          const drawX = node.x + curOffDx;
          const drawY = node.y + curOffDy;

          // Subtle scale on mouse pass/hover (1.0 -> 1.14 proximity, 1.24 hover)
          // More noticeable when clicked/focused (1.42x), but never jarring
          const proximityScale = 1.0 + proximityFactor * 0.14;
          const targetScale = isActive
            ? isHovered
              ? 1.48
              : 1.4
            : isHovered
            ? 1.24
            : proximityScale;
          const prevScale = hoverScaleRef.current[node.id] ?? 1.0;
          const currentScale = prevScale + (targetScale - prevScale) * 0.16;
          hoverScaleRef.current[node.id] = currentScale;

          const r = dynamicBaseRadius * currentScale * zoomNodeFactor;
          const magnifyProgress = Math.min(1, Math.max(0, (currentScale - 1.0) / 0.48));

          // Resolve Node Color based on per-Colony color mode ('verification' vs 'cluster')
          const vColors = colorSettings.verificationColors;
          const resolvedNodeColor = resolveColonyNodeColor(
            node,
            colorSettings,
            clusterColorMap,
            selectedClusters,
            isActive
          );

          ctx.save();
          if (isDimmed) {
            ctx.globalAlpha = 0.22;
          }

          // Soft Radial Glow Halo
          if (isHovered || isActive || hasUnverifiedAi || magnifyProgress > 0.2 || degree >= 5) {
            const glowRadius = r * (isHovered || isActive ? 2.45 : 1.85 + magnifyProgress * 0.4);
            const grad = ctx.createRadialGradient(
              drawX,
              drawY,
              r * 0.35,
              drawX,
              drawY,
              glowRadius
            );
            const glowColor = hexToRgba(
              isActive || isHovered ? vColors.active : resolvedNodeColor,
              isHovered || isActive ? 0.34 : 0.2
            );
            grad.addColorStop(0, glowColor);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.beginPath();
            ctx.arc(drawX, drawY, glowRadius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
          }

          // Outer Epistemic Amber Ring for AI-pending Nodes
          if (hasUnverifiedAi) {
            ctx.beginPath();
            ctx.arc(
              drawX,
              drawY,
              r + (3.2 + magnifyProgress * 1.6) * zoomNodeFactor,
              0,
              Math.PI * 2
            );
            ctx.strokeStyle = vColors.unverified;
            ctx.lineWidth =
              ((node.epistemic_status === 'unverified' ? 1.8 : 1.4) + magnifyProgress * 0.5) *
              invCam;
            if (node.epistemic_status === 'partial') {
              ctx.setLineDash([4 * invCam, 2.5 * invCam]);
            }
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Active / Hovered Selection Ring
          if (isActive || isHovered) {
            ctx.beginPath();
            ctx.arc(
              drawX,
              drawY,
              r + (hasUnverifiedAi ? 6.5 : 3.6) * zoomNodeFactor,
              0,
              Math.PI * 2
            );
            ctx.strokeStyle = vColors.active;
            ctx.lineWidth = (isActive ? 2.2 : 1.8) * invCam;
            ctx.stroke();
          }

          // Core Node Sphere
          ctx.beginPath();
          ctx.arc(drawX, drawY, r, 0, Math.PI * 2);

          if (node.is_stub) {
            ctx.fillStyle = hexToRgba(vColors.stub, isDark ? 0.22 : 0.16);
            ctx.fill();
            ctx.setLineDash([3 * invCam, 3 * invCam]);
            ctx.strokeStyle = vColors.stub;
            ctx.lineWidth = 1.5 * invCam;
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            ctx.fillStyle = resolvedNodeColor;
            ctx.fill();
          }

          // Specular Inner Highlight Dot for Tactile Depth
          if (!node.is_stub) {
            ctx.beginPath();
            ctx.arc(drawX - r * 0.28, drawY - r * 0.28, r * 0.26, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fill();
          }

          // Dynamic Label Visibility ('all' | 'smart' | 'hover')
          const showLabel =
            display.labelMode === 'all' ||
            isHovered ||
            isActive ||
            magnifyProgress > 0.22 ||
            (display.labelMode === 'smart' && (degree >= 3 || camScale >= 1.15));

          if (showLabel) {
            // Dynamic Typography: slightly larger base + degree boost + subtle hover + extra clarity for Focused Node!
            const degreeFontBoost = Math.min(2.0, degree * 0.2);
            const screenFontSize =
              display.labelFontSize +
              degreeFontBoost +
              magnifyProgress * 1.4 +
              (isActive ? 2.0 : 0);
            const worldFontSize = screenFontSize * invCam;
            ctx.font = `${isHovered || isActive || magnifyProgress > 0.4 ? 700 : 600} ${worldFontSize.toFixed(2)}px "Plus Jakarta Sans", "Noto Sans Thai", sans-serif`;
            const labelText =
              node.ai_segment_count > 0 &&
              !compact &&
              (isHovered || isActive || magnifyProgress > 0.35)
                ? `${node.title} · ${node.ai_segment_count} AI`
                : node.title;
            const textWidth = ctx.measureText(labelText).width;
            const pillPadX = (6.5 + (isActive ? 3 : 0) + magnifyProgress * 1.5) * invCam;
            const pillH = (screenFontSize + 6 + (isActive ? 2 : 0) + magnifyProgress * 1.5) * invCam;
            const pillW = textWidth + pillPadX * 2;
            const pillX = drawX - pillW / 2;
            const pillY = drawY + r + (hasUnverifiedAi ? 6.5 : 4.5) * zoomNodeFactor;

            drawRoundedPill(pillX, pillY, pillW, pillH, pillH / 2);
            ctx.fillStyle = hexToRgba(isActive ? cssBgElevated : cssBgPanel, isActive ? 0.96 : 0.9);
            ctx.fill();
            ctx.strokeStyle =
              isHovered || isActive
                ? vColors.active
                : hasUnverifiedAi
                ? hexToRgba(vColors.unverified, 0.38)
                : hexToRgba(cssTextPrimary, isDark ? 0.14 : 0.16);
            ctx.lineWidth = (isActive || isHovered ? 1.5 : 1) * invCam;
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = cssTextPrimary;
            ctx.fillText(labelText, drawX, pillY + pillH / 2 + 0.5 * invCam);
          }

          ctx.restore();
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [
    theme,
    effectiveActiveNodeId,
    hoveredNodeId,
    draggingNodeId,
    compact,
    colorSettings,
    clusterColorMap,
    selectedClusters,
  ]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2 - cameraRef.current.x;
    const cy = clientY - rect.top - rect.height / 2 - cameraRef.current.y;
    return {
      x: cx / cameraRef.current.scale,
      y: cy / cameraRef.current.scale,
    };
  };

  const findNodeAt = (wx: number, wy: number): SimNode | null => {
    const sim = simRef.current;
    if (!sim) return null;
    const camScale = cameraRef.current.scale;
    const invCam = 1 / camScale;
    const zoomNodeFactor = 1 / Math.pow(camScale, 0.76);
    for (let i = sim.nodes.length - 1; i >= 0; i--) {
      const n = sim.nodes[i];
      const dx = wx - n.x;
      const dy = wy - n.y;
      const degree = n.in_degree + n.out_degree;
      const dynamicBaseRadius =
        Math.min(
          15,
          Math.max(3.5, 3.7 + Math.pow(degree, 0.65) * 1.55 * display.hubSizeBoost)
        ) * display.baseNodeSize;
      const scaledR = dynamicBaseRadius * (hoverScaleRef.current[n.id] ?? 1.0) * zoomNodeFactor;
      const hitRadius = Math.max(15 * invCam, scaledR + 9 * invCam);
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n;
      }
    }
    return null;
  };

  const focusAndCenterNode = (target: SimNode) => {
    setFocusedNodeId(target.id);
    cameraTargetNodeIdRef.current = target.id;
    cameraTrackFramesRef.current = 32;
    simRef.current?.reheat(0.045);
    onFocusNode?.(target.id, target.title, target.is_stub);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    let hit = findNodeAt(x, y);
    // If user is double-clicking the exact screen spot within 380ms and the first click
    // already started gliding the node toward center, preserve the target node!
    if (
      !hit &&
      lastClickRef.current &&
      performance.now() - lastClickRef.current.time < 380 &&
      Math.hypot(
        e.clientX - lastClickRef.current.clientX,
        e.clientY - lastClickRef.current.clientY
      ) < 28
    ) {
      hit = lastClickRef.current.node;
    }

    if (hit) {
      dragRef.current = {
        type: 'node',
        node: hit,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      setDraggingNodeId(hit.id);
      hit.fx = hit.x;
      hit.fy = hit.y;
    } else {
      cameraTargetNodeIdRef.current = null;
      cameraTrackFramesRef.current = 0;
      dragRef.current = {
        type: 'pan',
        node: null,
        startX: e.clientX - cameraRef.current.x,
        startY: e.clientY - cameraRef.current.y,
        moved: false,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    mouseWorldRef.current = { x, y, active: true };
    if (dragRef.current.type === 'node' && dragRef.current.node) {
      const distMoved = Math.hypot(
        e.clientX - dragRef.current.startX,
        e.clientY - dragRef.current.startY
      );
      if (distMoved > 4) {
        dragRef.current.moved = true;
        cameraTargetNodeIdRef.current = null;
        cameraTrackFramesRef.current = 0;
        dragRef.current.node.fx = x;
        dragRef.current.node.fy = y;
        simRef.current?.reheat(0.065);
      }
      return;
    }
    if (dragRef.current.type === 'pan') {
      cameraRef.current.x = e.clientX - dragRef.current.startX;
      cameraRef.current.y = e.clientY - dragRef.current.startY;
      return;
    }
    const hit = findNodeAt(x, y);
    setHoveredNodeId(hit ? hit.id : null);
  };

  const handleMouseLeave = () => {
    mouseWorldRef.current.active = false;
    setHoveredNodeId(null);
    handleMouseUp();
  };

  const handleMouseUp = () => {
    setDraggingNodeId(null);
    if (dragRef.current.type === 'node' && dragRef.current.node) {
      const clickedNode = dragRef.current.node;
      const wasClick = !dragRef.current.moved;
      const clickStartX = dragRef.current.startX;
      const clickStartY = dragRef.current.startY;
      clickedNode.fx = null;
      clickedNode.fy = null;
      dragRef.current = { type: null, node: null, startX: 0, startY: 0, moved: false };
      if (wasClick) {
        if (compact) {
          // In the tiny sidebar mini-map, single click navigates directly
          onSelectNode(clickedNode.id, clickedNode.title, clickedNode.is_stub);
          return;
        }
        const now = performance.now();
        const prev = lastClickRef.current;
        if (prev && prev.node.id === clickedNode.id && now - prev.time < 380) {
          // Double-click detected -> enter Read Node mode!
          lastClickRef.current = null;
          onSelectNode(clickedNode.id, clickedNode.title, clickedNode.is_stub);
        } else {
          // Single-click -> smoothly center Colony Map on this Node & focus it!
          lastClickRef.current = {
            node: clickedNode,
            time: now,
            clientX: clickStartX,
            clientY: clickStartY,
          };
          focusAndCenterNode(clickedNode);
        }
      }
      return;
    }
    dragRef.current = { type: null, node: null, startX: 0, startY: 0, moved: false };
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const hit =
      findNodeAt(x, y) ||
      (lastClickRef.current &&
      performance.now() - lastClickRef.current.time < 450 &&
      Math.hypot(
        e.clientX - lastClickRef.current.clientX,
        e.clientY - lastClickRef.current.clientY
      ) < 32
        ? lastClickRef.current.node
        : null);
    if (hit) {
      lastClickRef.current = null;
      onSelectNode(hit.id, hit.title, hit.is_stub);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    cameraTargetNodeIdRef.current = null;
    cameraTrackFramesRef.current = 0;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;

    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const prevScale = cameraRef.current.scale;
    const nextScale = Math.min(2.8, Math.max(0.35, prevScale * factor));
    const ratio = nextScale / prevScale;

    cameraRef.current.x = mouseX - (mouseX - cameraRef.current.x) * ratio;
    cameraRef.current.y = mouseY - (mouseY - cameraRef.current.y) * ratio;
    cameraRef.current.scale = nextScale;
    setZoomPercent(Math.round(nextScale * 100));
  };

  const resetCamera = () => {
    cameraTargetNodeIdRef.current = null;
    cameraTrackFramesRef.current = 0;
    const defaultScale = compact ? 0.68 : 0.88;
    cameraRef.current = { x: 0, y: 0, scale: defaultScale };
    setZoomPercent(Math.round(defaultScale * 100));
    simRef.current?.recenterCentroid(1.0);
    simRef.current?.reheat(0.2);
  };

  // Focused or Hovered Node for the Colony Map Reader Card
  const activeInspectNodeObj = useMemo(() => {
    const targetId = hoveredNodeId || effectiveActiveNodeId;
    if (!targetId) return null;
    return filteredGraph.nodes.find((n) => n.id === targetId) || nodes.find((n) => n.id === targetId) || null;
  }, [hoveredNodeId, effectiveActiveNodeId, filteredGraph.nodes, nodes]);

  const activeInspectNoteDoc = useMemo(() => {
    if (!activeInspectNodeObj) return null;
    return allNotes.find((n) => n.id === activeInspectNodeObj.id) || null;
  }, [activeInspectNodeObj, allNotes]);

  const activeInspectExcerpt = useMemo(() => {
    if (!activeInspectNoteDoc) return '';
    const cleaned = stripMarkdownToPlainText(
      activeInspectNoteDoc.body.replace(/^#\s+.+$/m, '')
    );
    return cleaned.length > 260 ? `${cleaned.slice(0, 260).trim()}…` : cleaned;
  }, [activeInspectNoteDoc]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: draggingNodeId ? 'grabbing' : hoveredNodeId ? 'pointer' : 'grab',
        }}
      />

      {/* Floating Island Top Bar */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          right: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'none',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(14px)',
            padding: '5px 8px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-soft)',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => onModeChange('global')}
            className="btn-subtle"
            style={{
              padding: '4px 10px',
              fontSize: 11.5,
              borderColor: mode === 'global' ? 'var(--hypha-link)' : 'transparent',
            }}
          >
            <Compass size={13} /> Colony Map
          </button>
          <button
            type="button"
            onClick={() => onModeChange('local')}
            className="btn-subtle"
            style={{
              padding: '4px 10px',
              fontSize: 11.5,
              borderColor: mode === 'local' ? 'var(--hypha-link)' : 'transparent',
            }}
          >
            <Maximize2 size={13} /> Local Cluster ({localDepth} hop)
          </button>
          {mode === 'local' && (
            <input
              type="range"
              min={1}
              max={3}
              value={localDepth}
              onChange={(e) => setLocalDepth(Number(e.target.value))}
              style={{ width: 54 }}
              title="Local Cluster Depth (1-3 hops)"
            />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(14px)',
            padding: '5px 10px',
            borderRadius: 999,
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-soft)',
            fontSize: 11,
            pointerEvents: 'auto',
            flexWrap: 'wrap',
          }}
        >
          {/* Quick 1-click Node Color Representation Switcher */}
          {!compact && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: 2,
                borderRadius: 999,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
              }}
              title="Choose what Node colors represent in this Colony"
            >
              <button
                type="button"
                onClick={() => updateColorSettings((prev) => ({ ...prev, mode: 'verification' }))}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '2px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background:
                    colorSettings.mode === 'verification' ? 'var(--hypha-link)' : 'transparent',
                  color: colorSettings.mode === 'verification' ? '#fff' : 'var(--text-secondary)',
                }}
              >
                Verify Status
              </button>
              <button
                type="button"
                onClick={() => updateColorSettings((prev) => ({ ...prev, mode: 'cluster' }))}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '2px 8px',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background:
                    colorSettings.mode === 'cluster' ? 'var(--hypha-link)' : 'transparent',
                  color: colorSettings.mode === 'cluster' ? '#fff' : 'var(--text-secondary)',
                }}
              >
                By Cluster
              </button>
            </div>
          )}

          {/* Dynamic Legend Pills matching current Color Mode */}
          {colorSettings.mode === 'verification' ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: colorSettings.verificationColors.verified,
                    display: 'inline-block',
                  }}
                />
                Verified
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: colorSettings.verificationColors.partial,
                    display: 'inline-block',
                  }}
                />
                Partial
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: colorSettings.verificationColors.unverified,
                    display: 'inline-block',
                  }}
                />
                AI Pending
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: `1.5px dashed ${colorSettings.verificationColors.stub}`,
                    display: 'inline-block',
                  }}
                />
                Stub
              </span>
            </>
          ) : (
            orderedClusters.slice(0, compact ? 3 : 5).map((c) => (
              <span
                key={c.tag}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: c.color,
                    display: 'inline-block',
                  }}
                />
                #{c.tag}
              </span>
            ))
          )}

          <button
            type="button"
            onClick={resetCamera}
            className="btn-subtle"
            style={{
              padding: '3px 8px',
              fontSize: 10.5,
              fontFamily: '"JetBrains Mono", monospace',
            }}
            title="Click to recenter Colony Map at (0, 0)"
          >
            <RotateCcw size={11} /> {zoomPercent}%
          </button>
          {!compact && (
            <button
              type="button"
              onClick={() => setShowControls((v) => !v)}
              className="btn-subtle"
              style={{
                padding: '3px 10px',
                fontSize: 11,
                borderColor: showControls ? 'var(--hypha-link)' : undefined,
                background: showControls ? 'var(--bg-elevated)' : undefined,
              }}
            >
              <Sliders size={12} /> Studio Controls
            </button>
          )}
        </div>
      </div>

      {/* Focused / Hovered Node Reader Card — Readable Node Preview right on Colony Map */}
      {activeInspectNodeObj && !compact && (
        <div
          onMouseDown={(e) => handleCardDragStart(e, 'reader')}
          style={{
            position: 'absolute',
            ...(draggingCard === 'reader' && cardDragPos
              ? { left: cardDragPos.x, top: cardDragPos.y }
              : getCornerStyle(readerCorner, false)),
            width: 356,
            maxWidth: 'calc(100vw - 380px)',
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(18px)',
            border: '1px solid var(--border-strong)',
            borderRadius: 18,
            padding: '13px 16px',
            boxShadow: draggingCard === 'reader' ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            cursor: draggingCard === 'reader' ? 'grabbing' : 'grab',
            transition: draggingCard === 'reader' ? 'none' : 'all 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)',
            zIndex: draggingCard === 'reader' ? 40 : 32,
            userSelect: draggingCard ? 'none' : 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: hoveredNodeId ? 'var(--hypha-link)' : 'var(--verified-emerald)',
                fontFamily: '"JetBrains Mono", monospace',
              }}
            >
              {hoveredNodeId && hoveredNodeId !== effectiveActiveNodeId
                ? '● Hovered Node (Click to Center)'
                : '◉ Focused Center Node'}
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontFamily: '"JetBrains Mono", monospace',
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--bg-elevated)',
                color: 'var(--hypha-link)',
                fontWeight: 600,
              }}
            >
              {activeInspectNodeObj.in_degree + activeInspectNodeObj.out_degree} Hyphae
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}
            >
              {activeInspectNodeObj.title}
            </span>
          </div>

          {/* Incoming vs Outgoing Hyphae Legend for Focused Node */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    display.hyphaColorMode === 'in-out'
                      ? display.incomingHyphaColor
                      : 'var(--verified-emerald)',
                }}
              />
              In: <strong>{activeInspectNodeObj.in_degree}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    display.hyphaColorMode === 'in-out'
                      ? display.outgoingHyphaColor
                      : 'var(--hypha-link)',
                }}
              />
              Out: <strong>{activeInspectNodeObj.out_degree}</strong>
            </span>
            <span>·</span>
            <span style={{ textTransform: 'capitalize' }}>
              {activeInspectNodeObj.is_stub
                ? 'Missing Stub'
                : activeInspectNodeObj.epistemic_status}
            </span>
            {activeInspectNodeObj.tags
              .filter((t) => t !== 'stub')
              .slice(0, 4)
              .map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10.5,
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  #{t}
                </span>
              ))}
          </div>

          {/* Readable Node Article Excerpt directly on the Colony Map */}
          {activeInspectExcerpt ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.58,
                color: 'var(--text-primary)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '9px 11px',
                maxHeight: 96,
                overflowY: 'auto',
              }}
            >
              {activeInspectExcerpt}
            </div>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                fontStyle: 'italic',
              }}
            >
              Uncreated Stub Node — double-click or press button below to synthesize.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              paddingTop: 2,
            }}
          >
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
              1-Click = Center · Double-Click = Read
            </span>
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '4px 12px', fontSize: 11.5 }}
              onClick={() =>
                onSelectNode(
                  activeInspectNodeObj.id,
                  activeInspectNodeObj.title,
                  activeInspectNodeObj.is_stub
                )
              }
            >
              <BookOpen size={12} />{' '}
              {activeInspectNodeObj.is_stub ? 'Create Stub Node' : 'Read Node'}
            </button>
          </div>
        </div>
      )}

      {/* Rounded Floating Dynamic Studio Controls Drawer (Saved per Colony) */}
      {showControls && !compact && (
        <div
          onMouseDown={(e) => handleCardDragStart(e, 'controls')}
          style={{
            position: 'absolute',
            ...(draggingCard === 'controls' && cardDragPos
              ? { left: cardDragPos.x, top: cardDragPos.y }
              : getCornerStyle(controlsCorner, true)),
            width: 332,
            maxHeight: 'calc(100% - 92px)',
            overflowY: 'auto',
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(18px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 18,
            padding: 15,
            boxShadow: draggingCard === 'controls' ? 'var(--shadow-elevated)' : 'var(--shadow-card)',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            cursor: draggingCard === 'controls' ? 'grabbing' : 'grab',
            transition: draggingCard === 'controls' ? 'none' : 'all 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)',
            zIndex: draggingCard === 'controls' ? 40 : 32,
            userSelect: draggingCard ? 'none' : 'auto',
          }}
        >
          {/* 3-Tab Switcher: Appearance | Colors | Physics */}
          <div
            style={{
              display: 'flex',
              gap: 3,
              background: 'var(--bg-elevated)',
              padding: 3,
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setControlTab('appearance')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 7,
                padding: '5px 6px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: controlTab === 'appearance' ? 'var(--bg-panel)' : 'transparent',
                color:
                  controlTab === 'appearance' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Eye size={11} /> Appearance
            </button>
            <button
              type="button"
              onClick={() => setControlTab('colors')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 7,
                padding: '5px 6px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: controlTab === 'colors' ? 'var(--bg-panel)' : 'transparent',
                color: controlTab === 'colors' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Palette size={11} /> Colors
            </button>
            <button
              type="button"
              onClick={() => setControlTab('physics')}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 7,
                padding: '5px 6px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                background: controlTab === 'physics' ? 'var(--bg-panel)' : 'transparent',
                color: controlTab === 'physics' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <Sliders size={11} /> Physics
            </button>
          </div>

          {controlTab === 'appearance' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Fonts scale dynamically by hub degree & stay constant when zooming.
              </div>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Base Node Size ({(display.baseNodeSize / 0.7).toFixed(2)}x)</span>
                <input
                  type="range"
                  min={40}
                  max={140}
                  value={Math.round(display.baseNodeSize * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, baseNodeSize: val },
                    }));
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Hub Hypha Size Boost ({display.hubSizeBoost.toFixed(1)}x)</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={Math.round(display.hubSizeBoost * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, hubSizeBoost: val },
                    }));
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Constant Label Size ({display.labelFontSize}px)</span>
                <input
                  type="range"
                  min={9}
                  max={16}
                  value={display.labelFontSize}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, labelFontSize: val },
                    }));
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Hypha Thickness ({display.hyphaThickness.toFixed(1)}x)</span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  value={Math.round(display.hyphaThickness * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, hyphaThickness: val },
                    }));
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Hypha Curvature ({display.hyphaCurvature.toFixed(1)})</span>
                <input
                  type="range"
                  min={0}
                  max={160}
                  value={Math.round(display.hyphaCurvature * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, hyphaCurvature: val },
                    }));
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Label Visibility</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'smart', label: 'Hubs + Zoom' },
                      { id: 'hover', label: 'Hover' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="btn-subtle"
                      style={{
                        padding: '2px 7px',
                        fontSize: 10.5,
                        borderColor: display.labelMode === m.id ? 'var(--hypha-link)' : undefined,
                      }}
                      onClick={() =>
                        updateColorSettings((prev) => ({
                          ...prev,
                          display: { ...prev.display, labelMode: m.id },
                        }))
                      }
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <label
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Sparkles size={12} color="var(--hypha-link)" /> Bio-Signal Pulses on Hyphae
                </span>
                <input
                  type="checkbox"
                  checked={display.showSignalPulses}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateColorSettings((prev) => ({
                      ...prev,
                      display: { ...prev.display, showSignalPulses: checked },
                    }));
                  }}
                />
              </label>

              <button
                type="button"
                className="btn-subtle"
                style={{ justifyContent: 'center', fontSize: 11, marginTop: 2 }}
                onClick={() =>
                  updateColorSettings((prev) => ({
                    ...prev,
                    display: { ...DEFAULT_DISPLAY_SETTINGS },
                  }))
                }
              >
                Reset Appearance Defaults
              </button>
            </div>
          ) : controlTab === 'colors' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Saved automatically for this Colony (applies to Map & Sidebar)
              </div>

              {/* 1. Hypha Filament Color Mode Selector (3 modes requested) */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 12,
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Hypha Filament Color Mode
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(
                    [
                      {
                        id: 'source-target',
                        label: '1. Source → Target Node Color (Gradient)',
                      },
                      {
                        id: 'in-out',
                        label: '2. Outgoing → Incoming Gradient (2-Color)',
                      },
                      {
                        id: 'monochrome',
                        label: '3. Monochrome White / Neutral',
                      },
                    ] as const
                  ).map((hm) => (
                    <button
                      key={hm.id}
                      type="button"
                      onClick={() =>
                        updateColorSettings((prev) => ({
                          ...prev,
                          display: { ...prev.display, hyphaColorMode: hm.id },
                        }))
                      }
                      className="btn-subtle"
                      style={{
                        justifyContent: 'flex-start',
                        padding: '4px 8px',
                        fontSize: 11,
                        borderColor:
                          display.hyphaColorMode === hm.id ? 'var(--hypha-link)' : undefined,
                        background:
                          display.hyphaColorMode === hm.id
                            ? 'var(--hypha-link-bg)'
                            : 'var(--bg-elevated)',
                      }}
                    >
                      {hm.label}
                    </button>
                  ))}
                </div>

                {display.hyphaColorMode === 'in-out' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    <label
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '3px 7px',
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 10.5,
                        cursor: 'pointer',
                      }}
                    >
                      <span>Outgoing</span>
                      <input
                        type="color"
                        value={display.outgoingHyphaColor || '#F59E0B'}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateColorSettings((prev) => ({
                            ...prev,
                            display: { ...prev.display, outgoingHyphaColor: val },
                          }));
                        }}
                        style={{
                          width: 18,
                          height: 18,
                          border: 'none',
                          padding: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      />
                    </label>
                    <label
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '3px 7px',
                        borderRadius: 8,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 10.5,
                        cursor: 'pointer',
                      }}
                    >
                      <span>Incoming</span>
                      <input
                        type="color"
                        value={display.incomingHyphaColor || '#10B981'}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateColorSettings((prev) => ({
                            ...prev,
                            display: { ...prev.display, incomingHyphaColor: val },
                          }));
                        }}
                        style={{
                          width: 18,
                          height: 18,
                          border: 'none',
                          padding: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* 2. Node Color Representation Selector */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                Node Color Representation
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  onClick={() =>
                    updateColorSettings((prev) => ({ ...prev, mode: 'verification' }))
                  }
                  className="btn-subtle"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    padding: '5px 6px',
                    fontSize: 11,
                    borderColor:
                      colorSettings.mode === 'verification' ? 'var(--hypha-link)' : undefined,
                  }}
                >
                  Verification Status
                </button>
                <button
                  type="button"
                  onClick={() => updateColorSettings((prev) => ({ ...prev, mode: 'cluster' }))}
                  className="btn-subtle"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    padding: '5px 6px',
                    fontSize: 11,
                    borderColor: colorSettings.mode === 'cluster' ? 'var(--hypha-link)' : undefined,
                  }}
                >
                  By Cluster (#tag)
                </button>
              </div>

              {colorSettings.mode === 'verification' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(
                    [
                      { key: 'verified', label: 'Verified Node' },
                      { key: 'partial', label: 'Partially Verified' },
                      { key: 'unverified', label: 'AI Pending Review' },
                      { key: 'stub', label: 'Missing Stub Node' },
                      { key: 'active', label: 'Selected / Active Highlight' },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 8px',
                        borderRadius: 8,
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 11.5 }}>{item.label}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {colorSettings.verificationColors[item.key]}
                        </code>
                        <input
                          type="color"
                          value={colorSettings.verificationColors[item.key]}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateColorSettings((prev) => ({
                              ...prev,
                              verificationColors: {
                                ...prev.verificationColors,
                                [item.key]: val,
                              },
                            }));
                          }}
                          style={{
                            width: 22,
                            height: 22,
                            border: 'none',
                            padding: 0,
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        />
                      </span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="btn-subtle"
                    style={{ justifyContent: 'center', fontSize: 11, marginTop: 2 }}
                    onClick={() =>
                      updateColorSettings((prev) => ({
                        ...prev,
                        verificationColors: { ...DEFAULT_VERIFICATION_COLORS },
                      }))
                    }
                  >
                    Reset Default Verification Colors
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>Auto-generated by sequence (click to customize)</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      maxHeight: 165,
                      overflowY: 'auto',
                      paddingRight: 2,
                    }}
                  >
                    {orderedClusters.map((c) => (
                      <label
                        key={c.tag}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          borderRadius: 8,
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 11.5, fontWeight: 500 }}>
                          #{c.tag}{' '}
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            ({c.count})
                          </span>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {c.color}
                          </code>
                          <input
                            type="color"
                            value={c.color}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateColorSettings((prev) => ({
                                ...prev,
                                clusterColors: {
                                  ...prev.clusterColors,
                                  [c.tag]: val,
                                },
                              }));
                            }}
                            style={{
                              width: 22,
                              height: 22,
                              border: 'none',
                              padding: 0,
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-subtle"
                    style={{ justifyContent: 'center', fontSize: 11, marginTop: 2 }}
                    onClick={() =>
                      updateColorSettings((prev) => ({
                        ...prev,
                        clusterColors: {},
                      }))
                    }
                  >
                    Reset to Auto-Generated Cluster Colors
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontWeight: 600 }}>Colony Physics</div>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Node Repulsion ({forces.repelStrength})</span>
                <input
                  type="range"
                  min={400}
                  max={3200}
                  step={50}
                  value={forces.repelStrength}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateColorSettings((prev) => ({
                      ...prev,
                      forces: { ...prev.forces, repelStrength: val },
                    }));
                    simRef.current?.reheat(0.24);
                  }}
                  style={{ width: 115 }}
                />
              </label>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Hypha Length ({forces.linkDistance})</span>
                <input
                  type="range"
                  min={90}
                  max={380}
                  step={5}
                  value={forces.linkDistance}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateColorSettings((prev) => ({
                      ...prev,
                      forces: { ...prev.forces, linkDistance: val },
                    }));
                    simRef.current?.reheat(0.24);
                  }}
                  style={{ width: 115 }}
                />
              </label>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Center Gravity ({Math.round(forces.centerStrength * 1000)})</span>
                <input
                  type="range"
                  min={5}
                  max={90}
                  value={Math.round(forces.centerStrength * 1000)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 1000;
                    updateColorSettings((prev) => ({
                      ...prev,
                      forces: { ...prev.forces, centerStrength: val },
                    }));
                    simRef.current?.reheat(0.24);
                  }}
                  style={{ width: 115 }}
                />
              </label>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Collision Spacing ({forces.collideRadius})</span>
                <input
                  type="range"
                  min={24}
                  max={120}
                  value={forces.collideRadius}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateColorSettings((prev) => ({
                      ...prev,
                      forces: { ...prev.forces, collideRadius: val },
                    }));
                    simRef.current?.reheat(0.24);
                  }}
                  style={{ width: 115 }}
                />
              </label>

              <button
                type="button"
                className="btn-subtle"
                style={{ justifyContent: 'center', fontSize: 11, marginTop: 2 }}
                onClick={() => {
                  updateColorSettings((prev) => ({
                    ...prev,
                    forces: { ...DEFAULT_GRAPH_FORCES },
                  }));
                  resetCamera();
                }}
              >
                <RotateCcw size={11} /> Reset Default Posture & Center
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
