import { Platform } from 'react-native';

// Paleta «La Convocatoria»: papel tiza, verde botella, césped y tarjeta
// amarilla — misma piel que /v2 (components/v2/theme.ts), con los nombres
// de token históricos de v1 para no tocar cada pantalla.
export const COLORS = {
  // Brand Colors
  PRIMARY: '#FFC91F', // tarjeta amarilla
  PRIMARY_LIGHT: '#FFD54A',
  PRIMARY_DARK: '#EDAF00',

  SECONDARY: '#0D2015', // verde botella (tinta)
  ACCENT: '#FFC91F',

  // Semantic Colors
  SUCCESS: '#17713A', // césped
  DANGER: '#D63415', // tarjeta roja
  DANGER_LIGHT: '#FADFD6',
  WARNING: '#EDAF00',
  WARNING_LIGHT: '#FFEFC2',
  INFO: '#16606B',

  // Backgrounds
  BACKGROUND: '#F1F3EA', // papel tiza
  CARD_BG: '#FAFBF4',
  MODAL_OVERLAY: 'rgba(13, 32, 21, 0.7)',

  // Text
  TEXT_MAIN: '#14251A',
  TEXT_MUTED: '#4A6353',
  TEXT_LIGHT: '#84957F',
  TEXT_WHITE: '#FFFFFF',

  // Borders
  BORDER: '#DDE3CE',
  BORDER_LIGHT: '#EFF2E4',
};

// Fondo de pantalla: transparente en web para dejar ver la capa fija del
// campo (franjas + tiza, z-index -1); papel tiza opaco en nativo.
export const SCREEN_BG = Platform.OS === 'web' ? 'transparent' : COLORS.BACKGROUND;

// Light/dark palette consumed by the Expo template helpers (useThemeColor,
// ThemedText/ThemedView, Collapsible). Separate from the flat brand COLORS above.
const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';
export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const SHADOWS = {
  // sombras duras de tinta (sin difuminado), firma del estilo Convocatoria
  SMALL: {
    shadowColor: '#0D2015',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  MEDIUM: {
    shadowColor: '#0D2015',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  LARGE: {
    shadowColor: '#0D2015',
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 5,
  },
};

// esquinas cuadradas
export const SIZES = {
  RADIUS_SMALL: 0,
  RADIUS_MEDIUM: 0,
  RADIUS_LARGE: 0,
  PADDING: 20,
};

export const FONTS = {
  BOLD: 'Archivo_700Bold',
  EXTRA_BOLD: 'Archivo_800ExtraBold',
  SEMI_BOLD: 'Archivo_600SemiBold',
  MEDIUM: 'Archivo_500Medium',
  REGULAR: 'Archivo_400Regular',
};
