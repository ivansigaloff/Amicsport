import { Platform } from 'react-native';

/**
 * V2 design system — "monochrome executive".
 *
 * Sober, professional, restrained: graphite/near-black ink + white + cool greys,
 * SQUARE corners (0 radius), no chromatic brand color. Color appears ONLY in
 * functional states (availability, payment status, errors). Lives entirely under
 * components/v2 so the legacy theme (constants/theme.ts) is untouched.
 *
 * NOTE: the `brand*`/`accent*` token names are kept for API stability (many
 * components reference them) but now resolve to monochrome ink/grey values.
 */

export const C = {
  // ---- Primary = ink (near-black). No chromatic brand. -----------------
  brand: '#18181B',       // primary action / active
  brandStrong: '#09090B',
  brandDeep: '#18181B',   // accent text/icons on light surfaces
  brandSoft: '#52525B',
  brandTint: '#E4E4E7',
  brandWash: '#F4F4F5',   // subtle neutral chip / active background

  // ---- Accent (was lime) → ink. -----------------------------------------
  accent: '#18181B',
  accentStrong: '#000000',

  // ---- Ink scale: dark surfaces / hero / nav ----------------------------
  ink: '#09090B',
  ink800: '#18181B',
  ink700: '#27272A',
  ink600: '#3F3F46',

  // ---- Neutrals (zinc) --------------------------------------------------
  bg: '#F4F4F5',
  bgAlt: '#E4E4E7',
  surface: '#FFFFFF',
  surfaceAlt: '#F4F4F5',
  border: '#E4E4E7',
  borderStrong: '#D4D4D8',

  // ---- Text -------------------------------------------------------------
  text: '#18181B',
  textMuted: '#52525B',
  textFaint: '#A1A1AA',
  onBrand: '#FFFFFF',
  onInk: '#FFFFFF',

  // ---- Semantic (functional states only) --------------------------------
  success: '#15803D',
  successWash: '#DCFCE7',
  warning: '#B45309',
  warningWash: '#FEF3C7',
  danger: '#DC2626',
  dangerWash: '#FEE2E2',
  info: '#1D4ED8',
  infoWash: '#DBEAFE',

  // ---- Availability (match capacity) -----------------------------------
  availFree: '#16A34A',
  availLow: '#D97706',
  availFull: '#DC2626',

  overlay: 'rgba(9, 9, 11, 0.55)',
  scrim: 'rgba(9, 9, 11, 0.80)',
} as const;

export const GRADIENTS = {
  // near-solid black with a hint of depth (primary buttons / accents)
  brand: ['#27272A', '#09090B'] as const,
  brandSoft: ['#3F3F46', '#18181B'] as const,
  // dark hero / nav surfaces (monochrome charcoal → black)
  ink: ['#27272A', '#09090B'] as const,
  inkBrand: ['#1F1F23', '#09090B'] as const,
  lime: ['#52525B', '#3F3F46'] as const, // repurposed grey
  danger: ['#EF4444', '#DC2626'] as const,
};

export const FONTS = {
  black: 'Montserrat_800ExtraBold',
  extraBold: 'Montserrat_800ExtraBold',
  bold: 'Montserrat_700Bold',
  semibold: 'Montserrat_600SemiBold',
  medium: 'Montserrat_500Medium',
  regular: 'Montserrat_400Regular',
} as const;

/** 4-pt spacing scale. */
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48,
} as const;

/** Square corners. Kept named for API stability; values are 0 (executive look),
 *  except `pill` which is a tiny 2px so width===height elements aren't perfect
 *  circles but stay crisp. */
export const R = {
  sm: 0, md: 0, lg: 0, xl: 0, pill: 0,
} as const;

/** Cross-platform elevation — subtle, neutral, professional (no colored glow). */
const shadow = (y: number, blur: number, opacity: number, elevation: number, color = '#18181B') => ({
  shadowColor: color, shadowOffset: { width: 0, height: y }, shadowOpacity: opacity, shadowRadius: blur, elevation,
});

export const SHADOW = {
  none: {},
  sm: shadow(1, 3, 0.05, 1),
  md: shadow(4, 12, 0.08, 4),
  lg: shadow(10, 24, 0.12, 10),
  brand: shadow(4, 12, 0.1, 4),   // neutral now (no glow)
  ink: shadow(10, 24, 0.16, 10),
} as const;

export const MOTION = {
  fast: 160, base: 240, slow: 380, stagger: 50,
  pressScale: 0.98, hoverLift: -2,
  useNative: Platform.OS !== 'web',
} as const;

export const webOnly = <T extends object>(style: T): T | {} =>
  Platform.OS === 'web' ? style : {};

export type Variant = 'brand' | 'ink' | 'lime' | 'ghost' | 'danger' | 'outline';
