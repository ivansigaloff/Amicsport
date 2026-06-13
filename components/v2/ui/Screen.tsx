import { View, ScrollView, ViewStyle, RefreshControlProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, S } from '../theme';

type Props = {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  background?: string;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  showsVerticalScrollIndicator?: boolean;
};

/** Standard screen frame: safe area + themed background, optional scroll. */
export default function Screen({
  children,
  scroll,
  padded,
  background = C.bg,
  edges = ['top', 'left', 'right'],
  style,
  contentStyle,
  refreshControl,
  showsVerticalScrollIndicator = false,
}: Props) {
  const pad: ViewStyle = padded ? { paddingHorizontal: S.lg } : {};
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: background }, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingBottom: S.huge }, pad, contentStyle]}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
