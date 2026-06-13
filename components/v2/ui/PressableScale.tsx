import { Animated, Pressable, PressableProps, ViewStyle, Platform } from 'react-native';
import { usePressable } from './motion';
import { webOnly } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
  hoverLift?: boolean;
  children?: React.ReactNode;
};

/**
 * Pressable with built-in scale-on-press + (web) hover-lift micro-interactions.
 * The whole interactive surface is a single animated element so layout styles
 * (flex, padding, width) can be passed straight through.
 */
export default function PressableScale({ style, scaleTo, hoverLift, disabled, children, ...rest }: Props) {
  const { animatedStyle, handlers } = usePressable({ scaleTo, hoverLift });
  return (
    <AnimatedPressable
      {...rest}
      {...(disabled ? {} : handlers)}
      disabled={disabled}
      style={[
        webOnly({ cursor: disabled ? 'default' : 'pointer', transitionProperty: 'box-shadow', transitionDuration: '200ms' } as any),
        style as any,
        animatedStyle,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
