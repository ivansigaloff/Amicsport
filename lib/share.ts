import { Share, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Returns the base URL for generating match links.
 * On web: auto-detects from the current page origin + first path segment.
 * On native: falls back to a hardcoded default.
 */
export const getBaseUrl = (): string => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    
    // Detectar si estamos en un subdirectorio:
    // Dividimos la ruta y tomamos el primer segmento significativo.
    // Ignoramos segmentos que coincidan con nombres de rutas internas comunes como login, match, etc.
    const segments = pathname.split('/').filter(s => s.length > 0);
    const internalRoutes = ['login', 'match', '(tabs)', 'dev', 'reset-password', 'legal', 'payment', 'admin', 'modal', 'privacy', 'terms'];
    
    if (segments.length > 0 && !internalRoutes.includes(segments[0])) {
      // El primer segmento parece ser una carpeta física (ej: /test o /Kickerzbcn)
      return `${origin}/${segments[0]}`;
    }
    
    // Desarrollo local o despliegue en raíz
    return origin;
  }
  
  // En nativo: construir desde el APP_BASE_URL configurado en el entorno
  return `https://multigraf.info${process.env.EXPO_PUBLIC_BASE_URL || ''}`;
};

/**
 * Generates the direct web URL for a match.
 */
export const getMatchUrl = (matchId: string | number): string => {
  return `${getBaseUrl()}/match/${matchId}`;
};

/**
 * Generates a shareable text block for a single match.
 */
export const getMatchShareText = (match: any): string => {
  const url = getMatchUrl(match.id);
  return `⚽ ${match.title}\n📍 ${match.venue}\n📅 ${match.date} • ${match.time}\n💰 €${Number(match.price).toFixed(2)}\n👥 ${match.computed_joined ?? match.joined_players ?? '?'}/${match.max_players} jugadores\n🔗 ${url}`;
};

/**
 * Generates a shareable text block for multiple matches.
 */
export const getMultiMatchShareText = (matches: any[]): string => {
  const header = `⚽ ${matches.length} Partido${matches.length !== 1 ? 's' : ''} Disponible${matches.length !== 1 ? 's' : ''}\n${'─'.repeat(20)}\n\n`;
  const body = matches.map((m, i) => {
    return `${i + 1}. ${m.title}\n📍 ${m.venue}\n📅 ${m.date} • ${m.time}\n💰 €${Number(m.price).toFixed(2)}\n🔗 ${getMatchUrl(m.id)}`;
  }).join('\n\n');
  return header + body;
};

/**
 * Shares a single match using the native share dialog.
 */
export const shareMatch = async (match: any): Promise<void> => {
  const message = getMatchShareText(match);
  try {
    await Share.share({
      message,
      title: `⚽ ${match.title}`,
    });
  } catch (e) {
    // User cancelled or error
  }
};

/**
 * Shares multiple matches using the native share dialog.
 */
export const shareMultipleMatches = async (matches: any[]): Promise<void> => {
  const message = getMultiMatchShareText(matches);
  try {
    await Share.share({
      message,
      title: `⚽ ${matches.length} Partidos`,
    });
  } catch (e) {
    // User cancelled or error
  }
};

/**
 * Copies the match URL to the clipboard.
 * Returns true if successful.
 */
export const copyMatchUrl = async (match: any): Promise<boolean> => {
  const url = getMatchUrl(match.id);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(url);
    } else {
      await Clipboard.setStringAsync(url);
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Copies multiple match URLs to the clipboard.
 * Returns true if successful.
 */
export const copyMultipleMatchUrls = async (matches: any[]): Promise<boolean> => {
  const text = getMultiMatchShareText(matches);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(text);
    } else {
      await Clipboard.setStringAsync(text);
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Validates a password against several security requirements:
 * - Minimum 8 characters.
 * - At least one uppercase letter.
 * - At least one lowercase letter.
 * - At least one number.
 * - At least one special character (!@#$%^&* etc.).
 */
export const validatePassword = (password: string): { isValid: boolean; message: string } => {
  if (password.length < 8) {
    return { isValid: false, message: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: 'La contraseña debe tener al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: 'La contraseña debe tener al menos una letra minúscula.' };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: 'La contraseña debe tener al menos un número.' };
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { isValid: false, message: 'La contraseña debe tener al menos un símbolo (ej: !@#$%^&*).' };
  }
  return { isValid: true, message: '' };
};
