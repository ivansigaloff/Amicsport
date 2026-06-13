import { View, Text, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, FONTS, R } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'ink' | 'lime';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: C.brandWash, fg: C.brandDeep },
  success: { bg: C.successWash, fg: '#047857' },
  warning: { bg: C.warningWash, fg: '#B45309' },
  danger: { bg: C.dangerWash, fg: '#B91C1C' },
  info: { bg: C.infoWash, fg: '#1D4ED8' },
  neutral: { bg: C.surfaceAlt, fg: C.textMuted },
  ink: { bg: C.ink800, fg: '#FFFFFF' },
  lime: { bg: '#ECFCCB', fg: '#3F6212' },
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
          paddingHorizontal: sm ? 8 : 10,
          paddingVertical: sm ? 3 : 5,
          borderRadius: R.pill,
        },
        style,
      ]}
    >
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor || t.fg }} />}
      {icon && <Ionicons name={icon} size={sm ? 11 : 13} color={t.fg} />}
      <Text style={{ color: t.fg, fontFamily: FONTS.bold, fontSize: sm ? 10 : 11, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {label}
      </Text>
    </View>
  );
}
