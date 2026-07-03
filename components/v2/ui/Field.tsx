import { useRef, useState } from 'react';
import { View, Text, TextInput, TextInputProps, Animated, Pressable, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, FONTS, R, S } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = TextInputProps & {
  label?: string;
  icon?: IconName;
  secureToggle?: boolean;
  rightElement?: React.ReactNode;
  containerStyle?: ViewStyle;
};

/** Themed text input with icon, optional label, animated focus glow and a
 *  built-in password show/hide toggle. */
export default function Field({ label, icon, secureToggle, rightElement, containerStyle, secureTextEntry, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const glow = useRef(new Animated.Value(0)).current;

  const animate = (to: number) => Animated.timing(glow, { toValue: to, duration: 160, useNativeDriver: false }).start();

  const borderColor = glow.interpolate({ inputRange: [0, 1], outputRange: [C.border, C.brand] });
  const isSecure = secureToggle ? hidden : secureTextEntry;

  return (
    <View style={containerStyle}>
      {label ? <Text style={{ color: C.textMuted, fontFamily: FONTS.monoMedium, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 7, marginLeft: 2 }}>{label}</Text> : null}
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: C.surface,
          borderRadius: R.md,
          borderWidth: 2,
          borderColor,
          paddingHorizontal: S.lg,
          ...(focused ? { shadowColor: C.ink, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 2, height: 2 }, elevation: 2 } : {}),
        }}
      >
        {icon && <Ionicons name={icon} size={19} color={focused ? C.brand : C.textFaint} style={{ marginRight: 10 }} />}
        <TextInput
          {...rest}
          secureTextEntry={isSecure}
          onFocus={(e) => { setFocused(true); animate(1); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); animate(0); rest.onBlur?.(e); }}
          placeholderTextColor={C.textFaint}
          style={[{ flex: 1, height: 54, color: C.text, fontSize: 15.5, fontFamily: FONTS.medium, outlineStyle: 'none' } as any, style]}
        />
        {secureToggle ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} style={{ padding: 6 }}>
            <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={19} color={C.textFaint} />
          </Pressable>
        ) : rightElement}
      </Animated.View>
    </View>
  );
}
