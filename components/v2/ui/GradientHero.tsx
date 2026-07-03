import { Animated, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRADIENTS, S } from '../theme';

/**
 * Pizarra del vestuario: banda superior en verde botella profundo con
 * geometría de tiza (círculo central y línea discontinua) de fondo.
 * Esquinas cuadradas.
 *
 * `parallax`: pásale el Animated.Value del scroll vertical y la geometría de
 * tiza se desplaza a ~1/3 de la velocidad del contenido (profundidad sutil).
 */
export default function GradientHero({
  children,
  colors = GRADIENTS.inkBrand,
  style,
  topInset = 0,
  chalk = true,
  parallax,
}: {
  children?: React.ReactNode;
  colors?: readonly string[];
  style?: ViewStyle;
  topInset?: number;
  chalk?: boolean;
  parallax?: Animated.Value;
}) {
  const chalkShift = parallax
    ? parallax.interpolate({ inputRange: [0, 600], outputRange: [0, 210], extrapolateLeft: 'clamp' })
    : 0;
  return (
    <LinearGradient
      colors={colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ paddingTop: topInset + S.lg, paddingHorizontal: S.xl, paddingBottom: S.xl, overflow: 'hidden' }, style]}
    >
      {chalk && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.4,
            transform: [{ translateY: chalkShift }],
          }}
        >
          {/* círculo central grande saliendo por la derecha */}
          <View
            style={{
              position: 'absolute', right: -110, top: -110,
              width: 320, height: 320, borderRadius: 160,
              borderWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
          {/* punto de penalti */}
          <View style={{ position: 'absolute', right: 44, top: 44, width: 6, height: 6, borderRadius: 3, backgroundColor: C.chalkSoft }} />
          {/* cuarto de córner inferior izquierdo */}
          <View
            style={{
              position: 'absolute', left: -70, bottom: -70,
              width: 140, height: 140, borderRadius: 70,
              borderWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
          {/* área de penalti asomando por abajo */}
          <View
            style={{
              position: 'absolute', left: '30%', bottom: -34,
              width: 170, height: 90,
              borderWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
          {/* línea de banda inferior */}
          <View
            style={{
              position: 'absolute', left: -10, right: '58%', bottom: 12,
              borderTopWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
        </Animated.View>
      )}
      {children}
    </LinearGradient>
  );
}
