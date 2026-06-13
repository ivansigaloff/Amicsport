import { Platform } from 'react-native';

/**
 * V2 design system — "sport-tech".
 *
 * Fresh, modern, dynamic look that REPLACES the v1 orange/slate flat theme.
 * Brand = vivid emerald→teal (the pitch / energy), deep ink for contrast
 * surfaces, electric lime as the energy accent. Built to feel alive: layered
 * depth, gradients, generous type. Lives entirely under components/v2 so the
 * legacy theme (constants/theme.ts) is untouched.
 */

export const C = {
  // ---- Brand: emerald → teal -------------------------------------------
  brand: '#10B981', // primary
  brandStrong: '#059669',
  brandDeep: '#047857',
  brandSoft: '#34D399',
  brandTint: '#D1FAE5',
  brandWash: '#ECFDF5', // faintest brand-tinted background

  // ---- Energy accent: electric lime ------------------------------------
  accent: '#A3E635',
  accentStrong: '#84CC16',

  // ---- Ink: deep contrast surfaces / hero / nav ------------------------
  ink: '#0B1220',
  ink800: '#0F172A',
  ink700: '#1E293B',
  ink600: '#334155',

  // ---- Neutrals (slate) -------------------------------------------------
  bg: '#F4F7FB', // app background — cool, airy
  bgAlt: '#EAF0F7',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  border: '#E6EDF5',
  borderStrong: '#D5DEEA',

  // ---- Text -------------------------------------------------------------
  text: '#0B1220',
  textMuted: '#5A6B85',
  textFaint: '#93A2B8',
  onBrand: '#FFFFFF',
  onInk: '#FFFFFF',

  // ---- Semantic ---------------------------------------------------------
  success: '#10B981',
  successWash: '#DCFCE7',
  warning: '#F59E0B',
  warningWash: '#FEF3C7',
  danger: '#EF4444',
  dangerWash: '#FEE2E2',
  info: '#3B82F6',
  infoWash: '#DBEAFE',

  // ---- Availability (match capacity) -----------------------------------
  availFree: '#10B981',
  availLow: '#F59E0B',
  availFull: '#EF4444',

  overlay: 'rgba(11, 18, 32, 0.55)',
  scrim: 'rgba(11, 18, 32, 0.78)',
} as const;

export const GRADIENTS = {
  // primary CTA / hero brand wash (teal → emerald)
  brand: ['#2DD4BF', '#10B981', '#059669'] as const,
  brandSoft: ['#5EEAD4', '#34D399'] as const,
  // dark hero / nav surfaces (subtle, not flat black)
  ink: ['#0F172A', '#0B1220'] as const,
  inkBrand: ['#0F172A', '#0B3D33'] as const, // ink with an emerald undertone
  lime: ['#BEF264', '#84CC16'] as const,
  danger: ['#F87171', '#EF4444'] as const,
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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const R = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/**
 * Cross-platform elevation. On web we lean on rich, layered box-shadows
 * (react-native-web maps shadow* → boxShadow); on native, elevation +
 * shadow props. Soft, colored shadows read more "modern" than hard black.
 */
const shadow = (
  y: number,
  blur: number,
  opacity: number,
  elevation: number,
  color = '#1E293B',
) => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: blur,
  elevation,
});

export const SHADOW = {
  none: {},
  sm: shadow(2, 8, 0.06, 2),
  md: shadow(8, 20, 0.1, 6),
  lg: shadow(16, 36, 0.14, 12),
  // brand-tinted glow for primary CTAs / active elements
  brand: shadow(10, 24, 0.34, 10, '#059669'),
  ink: shadow(14, 30, 0.28, 12, '#0B1220'),
} as const;

/** Motion design tokens. */
export const MOTION = {
  fast: 160,
  base: 240,
  slow: 380,
  // entrance stagger step between list items
  stagger: 55,
  // press feedback
  pressScale: 0.97,
  hoverLift: -4,
  // whether the JS-driven Animated should claim the native driver
  useNative: Platform.OS !== 'web',
} as const;

/** Web-only style helper: returns the object on web, {} elsewhere. */
export const webOnly = <T extends object>(style: T): T | {} =>
  Platform.OS === 'web' ? style : {};

export type Variant = 'brand' | 'ink' | 'lime' | 'ghost' | 'danger' | 'outline';
