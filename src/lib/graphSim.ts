import { GraphEdge, GraphNode } from '../types/vault';

export interface SimForces {
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
  collideRadius: number;
}

/**
 * Tuned for wide radial expansion and gentle, low-jitter settling:
 * - High repulsion (1750) + wide linkDistance (235) spreads clusters generously
 * - Low centerStrength (0.032) lets outer nodes breathe outward
 * - High damping (VELOCITY_DECAY = 0.34) eliminates rapid oscillation/shaking
 */
export const DEFAULT_GRAPH_FORCES: SimForces = {
  centerStrength: 0.032,
  repelStrength: 1750,
  linkStrength: 0.55,
  linkDistance: 235,
  collideRadius: 68,
};

/** Backward compatibility alias */
export const DEFAULT_OBSIDIAN_FORCES = DEFAULT_GRAPH_FORCES;

export interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  radius: number;
  phaseOffset: number;
}

export interface SimLink {
  source: SimNode;
  target: SimNode;
  label?: string | null;
  weight: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 0.045;
const VELOCITY_DECAY = 0.34;

export class ColonyGraphSimulator {
  public nodes: SimNode[] = [];
  public links: SimLink[] = [];
  public alpha = 0.28;
  public alphaTarget = 0.0;
  public forces: SimForces = { ...DEFAULT_GRAPH_FORCES };

  constructor(nodes: GraphNode[], edges: GraphEdge[], forces?: Partial<SimForces>) {
    if (forces) {
      this.forces = { ...this.forces, ...forces };
    }
    this.setData(nodes, edges);
  }

  public setData(rawNodes: GraphNode[], rawEdges: GraphEdge[]) {
    const existing = new Map(this.nodes.map((n) => [n.id, n]));
    const hadExisting = existing.size > 0;

    this.nodes = rawNodes.map((n, idx) => {
      const prev = existing.get(n.id);
      const degree = n.in_degree + n.out_degree;
      const radius = Math.min(10.5, Math.max(3.8, 3.8 + Math.pow(degree, 0.62) * 1.45));
      if (prev) {
        return {
          ...n,
          x: prev.x,
          y: prev.y,
          vx: prev.vx * 0.2,
          vy: prev.vy * 0.2,
          fx: prev.fx,
          fy: prev.fy,
          radius,
          phaseOffset: prev.phaseOffset,
        };
      }
      // Wide initial Golden Angle Spiral so nodes start well-separated
      const r = 98 * Math.sqrt(idx + 1);
      const theta = idx * GOLDEN_ANGLE;
      return {
        ...n,
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        radius,
        phaseOffset: idx * 1.37,
      };
    });

    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    const degreeCount = new Map<string, number>();
    for (const e of rawEdges) {
      degreeCount.set(e.source, (degreeCount.get(e.source) || 0) + 1);
      degreeCount.set(e.target, (degreeCount.get(e.target) || 0) + 1);
    }

    this.links = [];
    for (const e of rawEdges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (s && t && s !== t) {
        const sDeg = degreeCount.get(s.id) || 1;
        const tDeg = degreeCount.get(t.id) || 1;
        const weight = 1 / Math.min(sDeg, tDeg);
        this.links.push({
          source: s,
          target: t,
          label: e.label,
          weight,
        });
      }
    }

    if (!hadExisting) {
      // Pre-settle 42 silent ticks so when the canvas opens, nodes are already expanded outward
      // in their natural equilibrium posture and centered at (0, 0)!
      this.alpha = 0.65;
      for (let i = 0; i < 42; i++) {
        this.tick();
      }
      this.recenterCentroid(1.0);
      this.alpha = 0.14;
    } else {
      this.alpha = 0.14;
    }
  }

  /**
   * Shifts all free nodes so the graph's center of mass stays anchored at (0, 0)
   * without altering the relative spacing or posture between nodes.
   */
  public recenterCentroid(strength = 1.0) {
    if (this.nodes.length === 0) return;
    let sumX = 0;
    let sumY = 0;
    for (const n of this.nodes) {
      sumX += n.x;
      sumY += n.y;
    }
    const cx = (sumX / this.nodes.length) * strength;
    const cy = (sumY / this.nodes.length) * strength;
    for (const n of this.nodes) {
      if (n.fx === null) n.x -= cx;
      if (n.fy === null) n.y -= cy;
    }
  }

  public reheat(alpha = 0.16) {
    this.alpha = Math.max(this.alpha, Math.min(0.28, alpha));
  }

  public tick(): boolean {
    if (this.alpha < ALPHA_MIN && this.alphaTarget === 0) {
      return false;
    }

    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const a = this.alpha;
    const { centerStrength, repelStrength, linkStrength, linkDistance, collideRadius } =
      this.forces;

    // 1. Gentle Center Gravity
    for (const node of this.nodes) {
      node.vx += (0 - node.x) * centerStrength * a;
      node.vy += (0 - node.y) * centerStrength * a;
    }

    // 2. Wide Radial Repulsion
    const nLen = this.nodes.length;
    const charge = -Math.max(1, repelStrength);
    for (let i = 0; i < nLen; i++) {
      const n1 = this.nodes[i];
      for (let j = i + 1; j < nLen; j++) {
        const n2 = this.nodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        if (dx === 0 && dy === 0) {
          dx = (i - j) * 0.5;
          dy = 0.5;
        }
        let distSq = dx * dx + dy * dy;
        const minSq = 2500; // 50^2 soft floor to prevent sudden spikes
        if (distSq < minSq) {
          distSq = minSq;
        }
        const factor = (charge * a) / distSq;
        const fx = dx * factor;
        const fy = dy * factor;
        n1.vx -= fx;
        n1.vy -= fy;
        n2.vx += fx;
        n2.vy += fy;
      }
    }

    // 3. Soft Spring Hypha Force
    for (const link of this.links) {
      const { source, target, weight } = link;
      let dx = target.x + target.vx - source.x - source.vx;
      let dy = target.y + target.vy - source.y - source.vy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta =
        ((dist - linkDistance) / dist) * a * linkStrength * Math.min(0.85, weight * 1.2);
      dx *= delta;
      dy *= delta;

      const sDeg = source.in_degree + source.out_degree || 1;
      const tDeg = target.in_degree + target.out_degree || 1;
      const bias = sDeg / (sDeg + tDeg);

      target.vx -= dx * bias;
      target.vy -= dy * bias;
      source.vx += dx * (1 - bias);
      source.vy += dy * (1 - bias);
    }

    // 4. Smooth Collision Padding
    if (collideRadius > 0) {
      for (let i = 0; i < nLen; i++) {
        const n1 = this.nodes[i];
        for (let j = i + 1; j < nLen; j++) {
          const n2 = this.nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = Math.max(collideRadius, n1.radius + n2.radius + 28);
          if (dist < minDist) {
            const overlap = ((minDist - dist) / dist) * 0.14;
            const ox = dx * overlap;
            const oy = dy * overlap;
            n1.vx -= ox;
            n1.vy -= oy;
            n2.vx += ox;
            n2.vy += oy;
          }
        }
      }
    }

    // 5. High-Damping Integration (eliminates harsh oscillation)
    for (const node of this.nodes) {
      if (node.fx !== null) {
        node.x += (node.fx - node.x) * 0.45;
        node.vx = 0;
      } else {
        node.vx *= VELOCITY_DECAY;
        // Clamp max step per frame for silky motion
        const maxStep = 6.5;
        const speed = Math.hypot(node.vx, node.vy);
        if (speed > maxStep) {
          node.vx = (node.vx / speed) * maxStep;
          node.vy = (node.vy / speed) * maxStep;
        }
        node.x += node.vx;
      }

      if (node.fy !== null) {
        node.y += (node.fy - node.y) * 0.45;
        node.vy = 0;
      } else {
        node.vy *= VELOCITY_DECAY;
        node.y += node.vy;
      }
    }

    // Keep the constellation centered around (0, 0) when no node is being dragged
    const anyPinned = this.nodes.some((n) => n.fx !== null || n.fy !== null);
    if (!anyPinned) {
      this.recenterCentroid(0.18);
    }

    return true;
  }
}

/** Backward compatibility alias */
export const ObsidianGraphSimulator = ColonyGraphSimulator;

export function filterLocalSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerId: string,
  maxDepth: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const visited = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source) && !visited.has(edge.target)) {
        visited.add(edge.target);
        nextFrontier.add(edge.target);
      }
      if (frontier.has(edge.target) && !visited.has(edge.source)) {
        visited.add(edge.source);
        nextFrontier.add(edge.source);
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return {
    nodes: nodes.filter((n) => visited.has(n.id)),
    edges: edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
  };
}
