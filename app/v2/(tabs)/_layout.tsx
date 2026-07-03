import { Tabs } from 'expo-router';
import { View, Pressable, Text, Animated, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { C, FONTS, S, webOnly } from '../../../components/v2/ui';

type IconPair = [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']];

const TAB_META: Record<string, { icon: IconPair; key: string }> = {
  index: { icon: ['football', 'football-outline'], key: 'tabs.matches' },
  explore: { icon: ['person', 'person-outline'], key: 'tabs.profile' },
  menu: { icon: ['grid', 'grid-outline'], key: 'tabs.more' },
};

function TabButton({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: IconPair; onPress: () => void }) {
  const a = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [focused, a]);

  const color = focused ? C.text : C.textFaint;
  return (
    <Pressable
      onPress={onPress}
      style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 4 }, webOnly({ cursor: 'pointer' } as any)]}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
    >
      {/* cinta de capitán: indicador amarillo de pestaña activa */}
      <Animated.View style={{ position: 'absolute', top: 0, height: 4, width: 34, backgroundColor: C.accent, opacity: a, transform: [{ scaleX: a }] }} />
      <Ionicons name={focused ? icon[0] : icon[1]} size={22} color={color} />
      <Text style={{ color, fontFamily: focused ? FONTS.bold : FONTS.medium, fontSize: 11, letterSpacing: 0.2 }}>{label}</Text>
    </Pressable>
  );
}

function V2TabBar({ state, navigation }: any) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes
        .filter((r: any) => TAB_META[r.name])
        .map((route: any) => {
          const focused = state.routes[state.index].key === route.key;
          const meta = TAB_META[route.name];
          const onPress = () => {
            if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return <TabButton key={route.key} focused={focused} label={t(meta.key)} icon={meta.icon} onPress={onPress} />;
        })}
    </View>
  );
}

export default function V2TabsLayout() {
  return (
    <Tabs tabBar={(props) => <V2TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="menu" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: C.surface,
    borderTopWidth: 2,
    borderTopColor: C.ink,
  },
});
