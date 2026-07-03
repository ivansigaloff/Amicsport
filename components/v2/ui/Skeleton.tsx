import { Animated } from 'react-native';
import { R } from '../theme';
import { useShimmer } from './motion';

/** Shimmering placeholder block for loading states. */
export default function Skeleton({
  width = '100%',
  height = 16,
  radius = R.sm,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: any;
}) {
  const v = useShimmer();
  const backgroundColor = v.interpolate({
    inputRange: [0, 1],
    outputRange: ['#E3E8D6', '#F0F3E5'],
  });
  return (
    <Animated.View style={[{ width: width as any, height, borderRadius: radius, backgroundColor }, style]} />
  );
}
