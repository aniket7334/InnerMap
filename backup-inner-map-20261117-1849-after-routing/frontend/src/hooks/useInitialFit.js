// Frame the map on the page's content once it has loaded (only the first time),
// instead of opening on a whole-world view.
import { useEffect, useRef } from 'react';

export function useInitialFit(bounds, setFitTo) {
  const done = useRef(false);
  const key = bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : '';
  useEffect(() => {
    if (done.current || !bounds) return;
    done.current = true;
    setFitTo({ ...bounds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Union of { south, west, north, east } objects (nulls ignored). */
export function unionBounds(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => ({
    south: Math.min(a.south, b.south),
    west: Math.min(a.west, b.west),
    north: Math.max(a.north, b.north),
    east: Math.max(a.east, b.east),
  }));
}
