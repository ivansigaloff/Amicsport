import { View, Text } from 'react-native';
import { C, FONTS, S } from '../theme';

/** Small uppercase section label with an optional right-aligned action. */
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
      <Text style={{ color: C.textFaint, fontFamily: FONTS.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {children}
      </Text>
      {right}
    </View>
  );
}
