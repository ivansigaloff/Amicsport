import { LocaleConfig } from 'react-native-calendars';

/** Duración estimada de un partido en milisegundos (2 horas). */
export const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Parsea una cadena de fecha en formato español (ej: "Lun 12 Abr")
 * a un objeto Date o una cadena ISO YYYY-MM-DD.
 */
export const parseMatchDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const parts = dateStr.toLowerCase().replace('.', '').replace(',', '').split(' ');
  
  let dayStr, monthStr;
  
  if (parts.length >= 3) {
    dayStr = parts[1];
    monthStr = parts[2];
  } else if (parts.length === 2) {
    dayStr = parts[0];
    monthStr = parts[1];
  } else {
    return null;
  }
  
  const day = parseInt(dayStr, 10);
  const monthIdx = months.findIndex(m => monthStr.includes(m));
  
  if (monthIdx !== -1 && !isNaN(day)) {
    const d = new Date();
    d.setMonth(monthIdx);
    d.setHours(12, 0, 0, 0); // Evitar problemas de zona horaria
    d.setDate(day);
    
    // Si la fecha resultante es muy anterior a hoy (más de 2 meses), asumimos que es del año que viene
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    
    if (d < twoMonthsAgo) {
      d.setFullYear(d.getFullYear() + 1);
    }
    
    return d;
  }
  
  return null;
};

/**
 * Convierte una fecha parseada a formato ISO YYYY-MM-DD
 */
export const toISODate = (date: Date | null): string | null => {
  if (!date) return null;
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

/**
 * Formatea una fecha según el idioma actual del usuario.
 * @param date Objeto Date a formatear.
 * @param lng Código de idioma ('es', 'en', 'ca').
 * @returns Cadena formateada (ej: "Mon, 12 Apr" o "Lun, 12 Abr").
 */
export const formatLocalizedDate = (date: Date | null, lng: string = 'es'): string => {
  if (!date) return '';
  
  const localeMap: Record<string, string> = {
    es: 'es-ES',
    en: 'en-GB',
    ca: 'ca-ES'
  };
  
  const locale = localeMap[lng] || 'es-ES';
  
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
};
