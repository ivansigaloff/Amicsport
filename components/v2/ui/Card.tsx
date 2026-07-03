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

/** Cartulina con borde de tinta 2px y sombra dura. La selección se marca en
 *  amarilla (tu tarjeta). */
const toneStyles: Record<NonNullable<Props['tone']>, ViewStyle> = {
  surface: { backgroundColor: C.surface, borderColor: C.ink, borderWidth: 2 },
  soft: { backgroundColor: C.surfaceAlt, borderColor: C.ink, borderWidth: 2 },
  ink: { backgroundColor: C.ink800, borderColor: C.ink, borderWidth: 2 },
  brand: { backgroundColor: C.brand, borderColor: C.ink, borderWidth: 2 },
};

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
    ...(selected ? { borderColor: C.accentStrong, shadowColor: C.accentStrong } : {}),
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
