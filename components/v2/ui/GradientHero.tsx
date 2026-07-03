import { View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRADIENTS, S } from '../theme';

/**
 * Pizarra del vestuario: banda superior en verde botella profundo con
 * geometría de tiza (círculo central y línea discontinua) de fondo.
 * Esquinas cuadradas.
 */
export default function GradientHero({
  children,
  colors = GRADIENTS.inkBrand,
  style,
  topInset = 0,
  chalk = true,
}: {
  children?: React.ReactNode;
  colors?: readonly string[];
  style?: ViewStyle;
  topInset?: number;
  chalk?: boolean;
}) {
  return (
    <LinearGradient
      colors={colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ paddingTop: topInset + S.lg, paddingHorizontal: S.xl, paddingBottom: S.xl, overflow: 'hidden' }, style]}
    >
      {chalk && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.28 }}>
          {/* círculo central saliendo por la derecha */}
          <View
            style={{
              position: 'absolute', right: -80, top: -70,
              width: 220, height: 220, borderRadius: 110,
              borderWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
          {/* punto de penalti */}
          <View style={{ position: 'absolute', right: 26, top: 36, width: 6, height: 6, borderRadius: 3, backgroundColor: C.chalkSoft }} />
          {/* línea de banda inferior */}
          <View
            style={{
              position: 'absolute', left: -10, right: '45%', bottom: 12,
              borderTopWidth: 2, borderStyle: 'dashed', borderColor: C.chalkSoft,
            }}
          />
        </View>
      )}
      {children}
    </LinearGradient>
  );
}
