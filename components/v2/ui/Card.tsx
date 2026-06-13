import { View, StyleProp, ViewStyle } from 'react-native';
import { C, R, S, SHADOW } from '../theme';
import PressableScale from './PressableScale';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  tone?: 'surface' | 'soft' | 'ink' | 'brand';
  elevation?: keyof typeof SHADOW;
  selected?: boolean;
};

const toneStyles: Record<NonNullable<Props['tone']>, ViewStyle> = {
  surface: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1 },
  soft: { backgroundColor: C.surfaceAlt, borderColor: C.border, borderWidth: 1 },
  ink: { backgroundColor: C.ink800, borderColor: C.ink700, borderWidth: 1 },
  brand: { backgroundColor: C.brand, borderColor: C.brandStrong, borderWidth: 1 },
};

/** Surface card. Becomes an animated pressable when `onPress` is given. */
export default function Card({
  children,
  onPress,
  onLongPress,
  style,
  padded = true,
  tone = 'surface',
  elevation = 'md',
  selected,
}: Props) {
  const base: ViewStyle = {
    borderRadius: R.lg,
    ...(padded ? { padding: S.lg } : {}),
    ...toneStyles[tone],
    ...SHADOW[elevation],
    ...(selected ? { borderColor: C.brand, borderWidth: 2 } : {}),
  };

  if (onPress || onLongPress) {
    return (
      <PressableScale onPress={onPress} onLongPress={onLongPress} style={[base, style as any]}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[base, style as any]}>{children}</View>;
}
