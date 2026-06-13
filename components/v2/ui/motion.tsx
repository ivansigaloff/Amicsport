import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { MOTION } from '../theme';

const NATIVE = MOTION.useNative;

/**
 * Mount-entrance animation: fade + rise. Pass an `index` to cascade list items
 * (staggered reveal — the core of the "not static" feel). Returns an animated
 * style to spread onto an Animated.View.
 */
export function useEntrance(opts: { index?: number; delay?: number; distance?: number; disabled?: boolean } = {}) {
  const { index = 0, delay = 0, distance = 14, disabled = false } = opts;
  const progress = useRef(new Animated.Value(disabled ? 1 : 0)).current;

  useEffect(() => {
    if (disabled) return;
    const totalDelay = delay + index * MOTION.stagger;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.slow,
      delay: totalDelay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, index, delay, disabled]);

  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  };
}

/** Wraps children in an Animated.View that reveals on mount. */
export function AnimatedEntrance({
  index = 0,
  delay = 0,
  distance,
  disabled,
  style,
  children,
}: {
  index?: number;
  delay?: number;
  distance?: number;
  disabled?: boolean;
  style?: any;
  children: React.ReactNode;
}) {
  const entrance = useEntrance({ index, delay, distance, disabled });
  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}

/**
 * Press + hover micro-interactions. Scale-down on press (spring), and on web a
 * subtle lift on hover. Returns an animated transform style + the handlers to
 * attach to a Pressable.
 */
export function usePressable(opts: { scaleTo?: number; hoverLift?: boolean } = {}) {
  const { scaleTo = MOTION.pressScale, hoverLift = true } = opts;
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const spring = (v: Animated.Value, toValue: number) =>
    Animated.spring(v, { toValue, useNativeDriver: NATIVE, speed: 28, bounciness: 6 }).start();

  const handlers = {
    onPressIn: () => spring(scale, scaleTo),
    onPressOut: () => spring(scale, 1),
    ...(Platform.OS === 'web' && hoverLift
      ? {
          onHoverIn: () => spring(lift, 1),
          onHoverOut: () => spring(lift, 0),
        }
      : {}),
  };

  const animatedStyle = {
    transform: [
      { scale },
      {
        translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, MOTION.hoverLift] }),
      },
    ],
  };

  return { animatedStyle, handlers, hovered: lift };
}

/** Continuous shimmer used by skeleton loaders. */
export function useShimmer() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false, // animating opacity-ish via backgroundColor range
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}
