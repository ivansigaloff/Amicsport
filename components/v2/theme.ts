import { Platform } from 'react-native';

/**
 * V2 design system — «La Convocatoria».
 *
 * Pizarra táctica + polideportivo municipal: papel-tiza con sesgo verde,
 * tinta verde botella, verde césped como color primario y el sistema de
 * estados del propio fútbol — tarjeta AMARILLA (últimas plazas / aviso) y
 * tarjeta ROJA (completo / peligro). Esquinas CUADRADAS, bordes de tinta de
 * 2px y sombras DURAS desplazadas (sin difuminado). Tipos: Anton (dorsales /
 * display), Archivo (interfaz) e IBM Plex Mono (datos, precios, etiquetas).
 * Vive entero bajo components/v2; el tema legacy (constants/theme.ts) no se toca.
 *
 * NOTE: los nombres `brand*`/`accent*`/`ink*` se conservan por estabilidad de
 * API (muchos componentes los referencian) y ahora resuelven a césped/botella/
 * amarilla.
 */

export const C = {
  // ---- Primary = césped. -------------------------------------------------
  brand: '#17713A',       // acción primaria / activo
  brandStrong: '#0F5A2C',
  brandDeep: '#0B4423',   // texto/iconos de acento sobre superficies claras
  brandSoft: '#4E7A5D',
  brandTint: '#CFE3D2',
  brandWash: '#E6EFE3',   // chip suave / fondo activo

  // ---- Accent = tarjeta amarilla (gastar con cuentagotas). ---------------
  accent: '#FFC91F',
  accentStrong: '#EDAF00',

  // ---- Ink scale: tinta verde botella / pizarra / nav --------------------
  ink: '#0D2015',
  ink800: '#14301F',
  ink700: '#1C3D28',
  ink600: '#2A5238',

  // ---- Neutrales (papel-tiza con sesgo verde) ----------------------------
  bg: '#F1F3EA',
  bgAlt: '#E6EADA',
  surface: '#FAFBF4',
  surfaceAlt: '#EFF2E4',
  border: '#DDE3CE',
  borderStrong: '#0D2015', // borde de tinta: el trazo de la Convocatoria

  // ---- Tiza --------------------------------------------------------------
  chalk: '#FFFFFF',
  chalkSoft: 'rgba(244, 250, 240, 0.82)',

  // ---- Texto -------------------------------------------------------------
  text: '#14251A',
  textMuted: '#4A6353',
  textFaint: '#84957F',
  onBrand: '#FFFFFF',
  onInk: '#F2F7EC',

  // ---- Semánticos (estados funcionales) ----------------------------------
  success: '#17713A',
  successWash: '#E1EDDA',
  warning: '#8A6700',      // texto sobre wash amarilla
  warningWash: '#FFEFC2',
  danger: '#D63415',       // tarjeta roja
  dangerWash: '#FADFD6',
  info: '#16606B',
  infoWash: '#DEEDEF',

  // ---- Disponibilidad (cupo del partido) ---------------------------------
  availFree: '#1B8244',
  availLow: '#EDAF00',
  availFull: '#D63415',

  overlay: 'rgba(13, 32, 21, 0.55)',
  scrim: 'rgba(13, 32, 21, 0.82)',
} as const;

export const GRADIENTS = {
  // césped (botones/acentos primarios) — casi plano, con un punto de vida
  brand: ['#1B8244', '#0F5A2C'] as const,
  brandSoft: ['#2E8B52', '#17713A'] as const,
  // pizarra del vestuario: verde botella profundo (heros / nav oscura)
  ink: ['#1B3A26', '#0C1F14'] as const,
  inkBrand: ['#17351F', '#0B1D12'] as const,
  // amarilla (CTA de pago / "última plaza")
  lime: ['#FFD54A', '#F5BC00'] as const,
  danger: ['#E85B3A', '#D63415'] as const,
};

export const FONTS = {
  /** Display «dorsal»: Anton, un solo peso, condensada de cartel. */
  black: 'Anton_400Regular',
  extraBold: 'Archivo_800ExtraBold',
  bold: 'Archivo_700Bold',
  semibold: 'Archivo_600SemiBold',
  medium: 'Archivo_500Medium',
  regular: 'Archivo_400Regular',
  /** Datos, precios, etiquetas, tickers. */
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

/** 4-pt spacing scale. */
export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48,
} as const;

/** Esquinas cuadradas — trazo de rotulador, no de app genérica. */
export const R = {
  sm: 0, md: 0, lg: 0, xl: 0, pill: 0,
} as const;

/** Sombra DURA desplazada (sin blur): en web se traduce a
 *  `box-shadow: Npx Npx 0 tinta`. En Android elevation queda suave — asumible. */
const hard = (offset: number, color = C.ink) => ({
  shadowColor: color,
  shadowOffset: { width: offset, height: offset },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: offset,
});

export const SHADOW = {
  none: {},
  sm: hard(2),
  md: hard(3),
  lg: hard(5),
  brand: hard(3),
  ink: hard(6),
} as const;

export const MOTION = {
  fast: 160, base: 240, slow: 380, stagger: 50,
  pressScale: 0.97, hoverLift: -2,
  useNative: Platform.OS !== 'web',
} as const;

export const webOnly = <T extends object>(style: T): T | {} =>
  Platform.OS === 'web' ? style : {};

export type Variant = 'brand' | 'ink' | 'lime' | 'ghost' | 'danger' | 'outline';
