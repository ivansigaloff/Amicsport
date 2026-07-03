import { View, Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, FONTS, R } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'ink' | 'lime';

/** Etiquetas tipo tarjeta de árbitro: warning = tarjeta amarilla (tinta sobre
 *  amarillo), danger = tarjeta roja (blanco sobre rojo). Borde fino de tinta,
 *  tipografía mono en mayúsculas. */
const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  brand: { bg: C.brandWash, fg: C.brandDeep, border: C.brandDeep },
  success: { bg: C.brand, fg: '#FFFFFF', border: C.ink },
  warning: { bg: C.accent, fg: C.ink, border: C.ink },
  danger: { bg: C.danger, fg: '#FFFFFF', border: C.ink },
  info: { bg: C.infoWash, fg: C.info, border: C.info },
  neutral: { bg: C.surface, fg: C.textMuted, border: C.textMuted },
  ink: { bg: C.ink800, fg: C.onInk, border: C.ink },
  lime: { bg: C.accent, fg: C.ink, border: C.ink },
};

export default function Badge({
  label,
  tone = 'neutral',
  icon,
  dot,
  dotColor,
  size = 'md',
  style,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  dotColor?: string;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}) {
  const t = TONES[tone];
  const sm = size === 'sm';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: sm ? 4 : 6,
          backgroundColor: t.bg,
          borderWidth: 1.5,
          borderColor: t.border,
          paddingHorizontal: sm ? 7 : 9,
          paddingVertical: sm ? 2.5 : 4,
          borderRadius: R.pill,
        },
        style,
      ]}
    >
      {dot && <View style={{ width: 7, height: 7, backgroundColor: dotColor || t.fg }} />}
      {icon && <Ionicons name={icon} size={sm ? 11 : 13} color={t.fg} />}
      <Text style={{ color: t.fg, fontFamily: FONTS.monoMedium, fontSize: sm ? 9.5 : 10.5, letterSpacing: 0.8, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}
