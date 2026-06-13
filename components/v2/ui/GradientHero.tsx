import { ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GRADIENTS, S } from '../theme';

/**
 * Dark gradient header band at the top of screens. Monochrome (charcoal → black),
 * square corners — sober and professional.
 */
export default function GradientHero({
  children,
  colors = GRADIENTS.inkBrand,
  style,
  topInset = 0,
}: {
  children?: React.ReactNode;
  colors?: readonly string[];
  style?: ViewStyle;
  topInset?: number;
}) {
  return (
    <LinearGradient
      colors={colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ paddingTop: topInset + S.lg, paddingHorizontal: S.xl, paddingBottom: S.xl }, style]}
    >
      {children}
    </LinearGradient>
  );
}
