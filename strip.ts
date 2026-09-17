export interface Series {
  table: number[];
  terms: { k: number; a: number }[];
}

export type Theme = 'dark' | 'light';

// A sine clipped at ±1: gain 1 is a pure sine, more gain flattens the top so the strip rests longer on a photo
export function clipped(gain: number, size = 2048, harmonics = 15): Series {
  const table = Array.from({ length: size }, (_, i) =>
    Math.max(-1, Math.min(1, gain * Math.sin((2 * Math.PI * i) / size + Math.PI / 2))),
  );
  return { table, terms: transform(table, harmonics) };
}

// Discrete Fourier transform onto the odd sines, which are all a half-wave symmetric signal has
export function transform(table: number[], harmonics: number): { k: number; a: number }[] {
  return Array.from({ length: (harmonics + 1) / 2 }, (_, i) => {
    const k = 2 * i + 1;
    const a = table.reduce((sum, v, j) => sum + v * Math.sin(k * ((2 * Math.PI * j) / table.length + Math.PI / 2)), 0);
    return { k, a: (2 * a) / table.length };
  });
}

export const partial = ({ terms }: Series, phi: number): number =>
  terms.reduce((sum, { k, a }) => sum + a * Math.sin(k * (phi + Math.PI / 2)), 0);

export const sample = ({ table }: Series, phi: number): number =>
  table[Math.floor(((((phi / (2 * Math.PI)) % 1) + 1) % 1) * table.length)];

// Phase runs uniformly in time; the wave's value is the position between two photos
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

// Photos nearest the starting one load first, the one ahead just before the one behind, wrapping round the loop
export function loadOrder(count: number, start: number): number[] {
  const rank = (i: number) => Math.min((i - start + count) % count, ((start - i + count) % count) + 0.5);
  return Array.from({ length: count }, (_, i) => i).sort((a, b) => rank(a) - rank(b));
}
