import { Tabs } from 'expo-router';
import { View, Pressable, Animated, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { C, FONTS, R, S, SHADOW, webOnly } from '../../../components/v2/ui';

type IconPair = [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']];

const TAB_META: Record<string, { icon: IconPair; key: string }> = {
  index: { icon: ['football', 'football-outline'], key: 'tabs.matches' },
  explore: { icon: ['person', 'person-outline'], key: 'tabs.profile' },
  menu: { icon: ['grid', 'grid-outline'], key: 'tabs.more' },
};

function TabButton({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: IconPair; onPress: () => void }) {
  const a = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(a, { toValue: focused ? 1 : 0, useNativeDriver: false, speed: 16, bounciness: 10 }).start();
  }, [focused, a]);

  const bg = a.interpolate({ inputRange: [0, 1], outputRange: ['rgba(16,185,129,0)', C.brandWash] });
  const Animated_Text = Animated.Text;

  return (
    <Pressable
      onPress={onPress}
      style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }, webOnly({ cursor: 'pointer' } as any)]}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 14,
          paddingVertical: 9,
          borderRadius: R.pill,
          backgroundColor: bg as any,
        }}
      >
        <Animated.View style={{ transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}>
          <Ionicons name={focused ? icon[0] : icon[1]} size={23} color={focused ? C.brandDeep : C.textFaint} />
        </Animated.View>
        {focused && (
          <Animated_Text numberOfLines={1} style={{ opacity: a, color: C.brandDeep, fontFamily: FONTS.bold, fontSize: 12.5, letterSpacing: 0.2 }}>
            {label}
          </Animated_Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function V2TabBar({ state, navigation }: any) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={styles.bar}>
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
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: S.lg,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: R.pill,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
    width: '100%',
    maxWidth: 460,
    ...SHADOW.lg,
  },
});
