export interface Series {
  table: number[];
  terms: { k: number; a: number }[];
}

export type Theme = 'dark' | 'light';

// Square wave partial sum, plain 1/k terms, Gibbs ringing included
export function fourier(harmonics: number, size = 2048): Series {
  const terms = Array.from({ length: (harmonics + 1) / 2 }, (_, i) => ({ k: 2 * i + 1, a: 1 / (2 * i + 1) }));
  const table = Array.from({ length: size }, (_, i) =>
    terms.reduce((sum, { k, a }) => sum + a * Math.sin(k * ((2 * Math.PI * i) / size + Math.PI / 2)), 0),
  );
  return { table, terms };
}

export const sample = ({ table }: Series, phi: number): number =>
  table[Math.floor(((((phi / (2 * Math.PI)) % 1) + 1) % 1) * table.length)];

// Phase runs uniformly in time, the wave value is the position between two photos
export function turnsAtPhase(series: Series, phi: number): number {
  const n = Math.floor(phi / Math.PI);
  const sign = ((n % 2) + 2) % 2 ? -1 : 1;
  return n + (1 - (sign * sample(series, phi)) / sample(series, 0)) / 2;
}

export function phaseAtTurns(turns: number): number {
  const n = Math.floor(turns);
  return n * Math.PI + Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (turns - n))));
}

// Turns count photos around the loop, unbounded
export function stripAt(centres: number[], length: number, turns: number): number {
  const n = centres.length;
  const cycle = Math.floor(turns / n);
  const t = turns - cycle * n;
  const i = Math.floor(t);
  const prev = centres[i];
  const next = i + 1 < n ? centres[i + 1] : centres[0] + length;
  return cycle * length + prev + (t - i) * (next - prev);
}

export function turnsAt(centres: number[], length: number, x: number): number {
  const n = centres.length;
  const cycle = Math.floor(x / length);
  const pos = x - cycle * length;
  const i = centres.findLastIndex((c) => c <= pos);
  const prev = i < 0 ? centres[n - 1] - length : centres[i];
  const next = i + 1 < n ? centres[i + 1] : centres[0] + length;
  return cycle * n + i + (pos - prev) / (next - prev);
}

// Short way round the loop
export const offset = (centres: number[], length: number, x: number, i: number): number =>
  ((((centres[i] - x + length / 2) % length) + length) % length) - length / 2;

export const photoIndex = (n: number, turns: number): number => ((Math.round(turns) % n) + n) % n;

// Vim keys: h l step photos, j k change speed
export const keyStep = (key: string): -1 | 0 | 1 => (key === 'l' ? 1 : key === 'h' ? -1 : 0);
export const speedStep = (key: string): -1 | 0 | 1 => (key === 'k' ? 1 : key === 'j' ? -1 : 0);

export const nextTheme = (theme: string | undefined): Theme => (theme === 'dark' ? 'light' : 'dark');

// Nearest photos first, the one ahead before the one behind
export function loadOrder(count: number, start: number): number[] {
  const rank = (i: number) => Math.min((i - start + count) % count, ((start - i + count) % count) + 0.5);
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => rank(a) - rank(b));
}

// Pre-sized copies, by long side in pixels
export const SIZES = [1600, 3200];

export const sizeFor = (px: number): number => SIZES.find((s) => s >= px) ?? SIZES[SIZES.length - 1];

export const variant = (name: string, size: number): string => `${name.replace(/\.[^.]+$/, '')}.${size}.webp`;

// Pages a swipe turns, always the way it went
export function landing(moved: number, carry: number): number {
  const travel = moved + carry;
  if (Math.abs(travel) < 0.06) return 0;
  return Math.sign(travel) * Math.min(3, Math.max(1, Math.round(Math.abs(travel))));
}

// Critically damped, keeps its speed and never overshoots
export function spring(x: number, v: number, target: number, dt: number, omega = 10): [number, number] {
  const next = v + (omega * omega * (target - x) - 2 * omega * v) * dt;
  return [x + next * dt, next];
}
