export interface Series {
  table: number[];
  peak: number;
  terms: { k: number; a: number }[];
}

export type Theme = 'dark' | 'light';

// Square-wave partial sum with Fejér weights: the tapered cutoff removes Gibbs overshoot and keeps each
// half period monotone, so the strip never backs up on its way to a photo
export function fourier(harmonics: number, size = 2048): Series {
  const raw = Array.from({ length: (harmonics + 1) / 2 }, (_, i) => {
    const k = 2 * i + 1;
    return { k, a: (1 - k / (harmonics + 1)) / k };
  });
  const wave = (terms: { k: number; a: number }[]) =>
    Array.from({ length: size }, (_, i) =>
      terms.reduce((sum, { k, a }) => sum + a * Math.sin(k * ((2 * Math.PI * i) / size + Math.PI / 2)), 0),
    );
  const scale = 1 / Math.max(...wave(raw).map(Math.abs));
  const terms = raw.map(({ k, a }) => ({ k, a: a * scale }));
  const table = wave(terms);
  return { table, peak: Math.max(...table.map(Math.abs)), terms };
}

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
