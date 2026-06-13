import { View, ViewStyle, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GRADIENTS, R, S, C } from '../theme';

/**
 * Rounded gradient header surface. Used as the dark/brand "hero" band at the
 * top of screens, giving the layout depth and a focal point.
 */
export default function GradientHero({
  children,
  colors = GRADIENTS.inkBrand,
  style,
  rounded = true,
  topInset = 0,
}: {
  children?: React.ReactNode;
  colors?: readonly string[];
  style?: ViewStyle;
  rounded?: boolean;
  topInset?: number;
}) {
  return (
    <LinearGradient
      colors={colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          paddingTop: topInset + S.lg,
          paddingHorizontal: S.xl,
          paddingBottom: S.xl,
          borderBottomLeftRadius: rounded ? R.xl : 0,
          borderBottomRightRadius: rounded ? R.xl : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* faint decorative orb for depth */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill as any,
          { alignItems: 'flex-end' },
        ]}
      >
        <View
          style={{
            width: 220,
            height: 220,
            borderRadius: 110,
            backgroundColor: 'rgba(45, 212, 191, 0.14)',
            marginTop: -70,
            marginRight: -60,
            ...(Platform.OS === 'web' ? ({ filter: 'blur(8px)' } as any) : {}),
          }}
        />
      </View>
      {children}
    </LinearGradient>
  );
}
