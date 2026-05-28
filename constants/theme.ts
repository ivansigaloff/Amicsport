import { Platform } from 'react-native';

export const COLORS = {
  // Brand Colors
  PRIMARY: '#FFB81C', // Code10 Orange
  PRIMARY_LIGHT: '#FFD370',
  PRIMARY_DARK: '#E59A00',
  
  SECONDARY: '#0F172A', // Slate 900
  ACCENT: '#FFB81C', 
  
  // Semantic Colors
  SUCCESS: '#10B981', // Emerald 500
  DANGER: '#EF4444', // Red 500
  DANGER_LIGHT: '#FEE2E2', // Red 100
  WARNING: '#FFB81C',
  WARNING_LIGHT: '#FEF3C7', // Amber 100
  INFO: '#3B82F6', // Blue 500
  
  // Backgrounds
  BACKGROUND: '#E2E8F0', // Slate 200
  CARD_BG: '#FFFFFF',
  MODAL_OVERLAY: 'rgba(15, 23, 42, 0.7)',
  
  // Text
  TEXT_MAIN: '#0F172A', // Slate 900
  TEXT_MUTED: '#64748B', // Slate 500
  TEXT_LIGHT: '#94A3B8', // Slate 400
  TEXT_WHITE: '#FFFFFF',
  
  // Borders
  BORDER: '#E2E8F0', // Slate 200
  BORDER_LIGHT: '#F1F5F9', // Slate 100
};

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
  SMALL: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  MEDIUM: {
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  LARGE: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
};

export const SIZES = {
  RADIUS_SMALL: 12,
  RADIUS_MEDIUM: 20,
  RADIUS_LARGE: 32,
  PADDING: 20,
};

export const FONTS = {
  BOLD: 'Montserrat_700Bold',
  EXTRA_BOLD: 'Montserrat_800ExtraBold',
  SEMI_BOLD: 'Montserrat_600SemiBold',
  MEDIUM: 'Montserrat_500Medium',
  REGULAR: 'Montserrat_400Regular',
};
