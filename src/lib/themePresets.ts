export interface ThemeColorTokens {
  bgCanvas: string;
  bgElevated: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  verified: string;
  aiAmber: string;
  logoCap: string;
  logoHyphae: string;
}

export interface StudioThemePreset {
  id: string;
  name: string;
  subtitle: string;
  family: 'earth' | 'ocean' | 'custom';
  isCore: boolean;
  isDark: boolean;
  colors: ThemeColorTokens;
}

/**
 * 4 Non-Deletable Core Presets crafted with low saturation, high readability,
 * and distinct warm (Earth) vs. sleek composed cool (Ocean) character.
 */
export const CORE_THEME_PRESETS: StudioThemePreset[] = [
  {
    id: 'earth-dark',
    name: 'Earth Dark',
    subtitle: 'Warm espresso soil & muted terracotta ochre',
    family: 'earth',
    isCore: true,
    isDark: true,
    colors: {
      bgCanvas: '#161310',
      bgElevated: '#241F1A',
      textPrimary: '#EAE2D8',
      textSecondary: '#B3A494',
      accent: '#C48B5A',
      verified: '#5A9E7C',
      aiAmber: '#CC934C',
      logoCap: '#C48B5A',
      logoHyphae: '#5A9E7C',
    },
  },
  {
    id: 'earth-light',
    name: 'Earth Light',
    subtitle: 'Warm mushroom parchment & soft archival sepia',
    family: 'earth',
    isCore: true,
    isDark: false,
    colors: {
      bgCanvas: '#F2ECE1',
      bgElevated: '#FAF7F1',
      textPrimary: '#2A221B',
      textSecondary: '#665749',
      accent: '#946137',
      verified: '#3B7D5B',
      aiAmber: '#AD6F27',
      logoCap: '#946137',
      logoHyphae: '#3B7D5B',
    },
  },
  {
    id: 'ocean-dark',
    name: 'Ocean Dark',
    subtitle: 'Sleek abyssal fjord slate & composed Nordic blue',
    family: 'ocean',
    isCore: true,
    isDark: true,
    colors: {
      bgCanvas: '#0F1419',
      bgElevated: '#1A222B',
      textPrimary: '#E2E9F0',
      textSecondary: '#97A8B8',
      accent: '#6497BF',
      verified: '#509C87',
      aiAmber: '#C79A56',
      logoCap: '#6497BF',
      logoHyphae: '#509C87',
    },
  },
  {
    id: 'ocean-light',
    name: 'Ocean Light',
    subtitle: 'Composed cool mist & crisp Nordic slate ink',
    family: 'ocean',
    isCore: true,
    isDark: false,
    colors: {
      bgCanvas: '#EDF2F6',
      bgElevated: '#F7FAFC',
      textPrimary: '#1B2530',
      textSecondary: '#546678',
      accent: '#3E6F96',
      verified: '#337B66',
      aiAmber: '#A67229',
      logoCap: '#3E6F96',
      logoHyphae: '#337B66',
    },
  },
];

/**
 * Curated low-saturation designer swatches so any combination the user picks
 * remains harmonious, calm, and legible ("แต่งยังไงก็สวย").
 */
export const CURATED_MUTED_SWATCHES = {
  bgCanvasDark: ['#161310', '#0F1419', '#141614', '#171318', '#181512', '#11161B'],
  bgCanvasLight: ['#F2ECE1', '#EDF2F6', '#EEF1EC', '#F4EFEA', '#F1EFEA', '#EBF0F2'],
  bgElevatedDark: ['#241F1A', '#1A222B', '#1E231F', '#241E26', '#27221D', '#1C252E'],
  bgElevatedLight: ['#FAF7F1', '#F7FAFC', '#F7F9F6', '#FCF9F6', '#FAF9F5', '#F5F9FA'],
  textDark: ['#EAE2D8', '#E2E9F0', '#E4EBE4', '#ECE3EC', '#EFE9E1', '#DDE7F0'],
  textLight: ['#2A221B', '#1B2530', '#1E2821', '#2B1F28', '#26211C', '#19242B'],
  accent: [
    '#C48B5A', // Muted Terracotta Ochre
    '#6497BF', // Composed Fjord Blue
    '#6A9E7F', // Lichen Sage
    '#B57C84', // Dusty Rose-Bark
    '#8E82B8', // Muted Lavender Spore
    '#B89658', // Warm Chanterelle Gold
    '#4F8699', // Deep Pelagic Teal
    '#946137', // Roasted Umber
  ],
};

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b];
    }
  }
  return [22, 19, 16];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function mixHex(hexA: string, hexB: string, weightB = 0.5): string {
  const [r1, g1, b1] = parseHexRgb(hexA);
  const [r2, g2, b2] = parseHexRgb(hexB);
  return rgbToHex(
    r1 + (r2 - r1) * weightB,
    g1 + (g2 - g1) * weightB,
    b1 + (b2 - b1) * weightB
  );
}

export function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isColorDark(hex: string): boolean {
  const [r, g, b] = parseHexRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.52;
}

const STORAGE_KEY_STATE = 'mycelium_studio_theme_state_v1';

export interface PersistedThemeState {
  activePresetId: string;
  activeColors: ThemeColorTokens;
  userPresets: StudioThemePreset[];
}

export const DEFAULT_THEME_PRESET_ID = 'ocean-dark';

export function getDefaultCorePreset(): StudioThemePreset {
  return (
    CORE_THEME_PRESETS.find((p) => p.id === DEFAULT_THEME_PRESET_ID) || CORE_THEME_PRESETS[0]
  );
}

export function loadStudioThemeState(): PersistedThemeState {
  const defaultPreset = getDefaultCorePreset();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedThemeState>;
      const userPresets = Array.isArray(parsed.userPresets)
        ? parsed.userPresets.filter((p) => p && !p.isCore && p.id && p.colors)
        : [];
      const allPresets = [...CORE_THEME_PRESETS, ...userPresets];
      const matched =
        allPresets.find((p) => p.id === parsed.activePresetId) || defaultPreset;
      const activeColors: ThemeColorTokens = {
        ...matched.colors,
        ...(parsed.activeColors || {}),
      };
      return {
        activePresetId: parsed.activePresetId || matched.id,
        activeColors,
        userPresets,
      };
    }
  } catch {
    // Fallback to default Ocean Dark
  }
  return {
    activePresetId: defaultPreset.id,
    activeColors: { ...defaultPreset.colors },
    userPresets: [],
  };
}

export function saveStudioThemeState(state: PersistedThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Applies the active theme tokens and harmoniously derived surface/border/tint tokens
 * to document.documentElement so the entire studio updates instantaneously.
 */
export function applyThemePaletteToDocument(colors: ThemeColorTokens): 'dark' | 'light' {
  const root = document.documentElement;
  const dark = isColorDark(colors.bgCanvas);
  const mode: 'dark' | 'light' = dark ? 'dark' : 'light';
  root.setAttribute('data-theme', mode);

  const bgPanel = mixHex(colors.bgCanvas, colors.bgElevated, 0.52);
  const bgHover = mixHex(colors.bgElevated, colors.textPrimary, dark ? 0.08 : 0.06);
  const textMuted = mixHex(colors.textSecondary, colors.bgCanvas, 0.28);

  root.style.setProperty('--bg-canvas', colors.bgCanvas);
  root.style.setProperty('--bg-panel', bgPanel);
  root.style.setProperty('--bg-elevated', colors.bgElevated);
  root.style.setProperty(
    '--bg-glass',
    hexAlpha(bgPanel, dark ? 0.86 : 0.88)
  );
  root.style.setProperty('--bg-hover', bgHover);

  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', textMuted);

  root.style.setProperty(
    '--border-subtle',
    hexAlpha(colors.textPrimary, dark ? 0.09 : 0.11)
  );
  root.style.setProperty(
    '--border-strong',
    hexAlpha(colors.textPrimary, dark ? 0.17 : 0.19)
  );

  root.style.setProperty('--hypha-link', colors.accent);
  root.style.setProperty('--hypha-link-bg', hexAlpha(colors.accent, dark ? 0.14 : 0.12));
  root.style.setProperty('--wiki-link', colors.accent);
  root.style.setProperty('--wiki-link-bg', hexAlpha(colors.accent, dark ? 0.14 : 0.12));

  root.style.setProperty('--verified-emerald', colors.verified);
  root.style.setProperty(
    '--verified-emerald-bg',
    hexAlpha(colors.verified, dark ? 0.12 : 0.1)
  );
  root.style.setProperty(
    '--verified-emerald-border',
    hexAlpha(colors.verified, dark ? 0.34 : 0.3)
  );

  root.style.setProperty('--ai-amber', colors.aiAmber);
  root.style.setProperty('--ai-amber-strong', colors.aiAmber);
  root.style.setProperty('--ai-amber-bg', hexAlpha(colors.aiAmber, dark ? 0.12 : 0.1));
  root.style.setProperty(
    '--ai-amber-border',
    hexAlpha(colors.aiAmber, dark ? 0.38 : 0.34)
  );

  return mode;
}
