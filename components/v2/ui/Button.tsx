import { View, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, FONTS, R, S, SHADOW, GRADIENTS, Variant } from '../theme';
import PressableScale from './PressableScale';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Props = {
  title?: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: ViewStyle | ViewStyle[];
};

const GRAD: Partial<Record<Variant, readonly string[]>> = {
  brand: GRADIENTS.brand,
  ink: GRADIENTS.ink,
  lime: GRADIENTS.lime,
  danger: GRADIENTS.danger,
};

const FG: Record<Variant, string> = {
  brand: C.onBrand,
  ink: C.onInk,
  lime: C.ink,
  danger: '#FFFFFF',
  ghost: C.brandStrong,
  outline: C.text,
};

const SIZES = {
  sm: { h: 40, px: S.lg, font: 13, icon: 16, gap: 6 },
  md: { h: 52, px: S.xl, font: 15, icon: 18, gap: 8 },
  lg: { h: 58, px: S.xxl, font: 16, icon: 20, gap: 10 },
};

export default function Button({
  title,
  onPress,
  variant = 'brand',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  full,
  style,
}: Props) {
  const sz = SIZES[size];
  const fg = FG[variant];
  const grad = GRAD[variant];
  const isDisabled = disabled || loading;

  const outer: ViewStyle = {
    borderRadius: R.md,
    opacity: isDisabled ? 0.55 : 1,
    ...(full ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' }),
    ...(variant === 'brand' ? SHADOW.brand : variant === 'ghost' || variant === 'outline' ? {} : SHADOW.sm),
  };

  const fill: ViewStyle = {
    height: sz.h,
    paddingHorizontal: sz.px,
    borderRadius: R.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sz.gap,
    ...(variant === 'ghost' ? { backgroundColor: C.brandWash } : {}),
    ...(variant === 'outline' ? { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.borderStrong } : {}),
  };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={sz.icon} color={fg} />}
          {title ? <Text style={[styles.label, { color: fg, fontSize: sz.font }]} numberOfLines={1}>{title}</Text> : null}
          {iconRight && <Ionicons name={iconRight} size={sz.icon} color={fg} />}
        </>
      )}
    </>
  );

  return (
    <PressableScale onPress={onPress} disabled={isDisabled} style={[outer, style as any]} scaleTo={0.96}>
      <View style={[fill, { overflow: 'hidden' }]}>
        {grad && (
          <LinearGradient colors={grad as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
        )}
        {content}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: FONTS.bold, letterSpacing: 0.2 },
});
