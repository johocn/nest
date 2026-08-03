export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function inRange(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): boolean {
  return distance(x1, y1, x2, y2) <= radius;
}
