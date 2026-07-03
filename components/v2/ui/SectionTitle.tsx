import { View, Text } from 'react-native';
import { C, FONTS, S } from '../theme';

/** Rótulo de sección en mono mayúscula — anotación de pizarra. */
export default function SectionTitle({
  children,
  right,
  style,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  style?: any;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: S.md, marginTop: S.sm }, style]}>
      <Text style={{ color: C.textMuted, fontFamily: FONTS.monoMedium, fontSize: 11.5, letterSpacing: 2, textTransform: 'uppercase' }}>
        {children}
      </Text>
      {right}
    </View>
  );
}
