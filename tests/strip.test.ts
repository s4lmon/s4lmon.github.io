import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipped,
  partial,
  transform,
  keyStep,
  loadOrder,
  nextTheme,
  offset,
  phaseAtTurns,
  photoIndex,
  speedStep,
  stripAt,
  turnsAt,
  turnsAtPhase,
} from '../strip.ts';

// Three photos: centrelines in pixels, loop length
const CENTRES = [100, 300, 600];
const L = 800;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('turn -1 is the last photo sitting left of the first, turn n the first again', () => {
  close(stripAt(CENTRES, L, -1), 600 - 800);
  close(stripAt(CENTRES, L, 3), 100 + 800);
  close(stripAt(CENTRES, L, 1.5), 450);
});

test('pixels and turns are inverses across the seam', () => {
  for (const turns of [-1.3, -1, -0.25, 0, 0.5, 2, 2.9, 3, 4.75])
    close(turnsAt(CENTRES, L, stripAt(CENTRES, L, turns)), turns);
});

test('photos are offset the short way round the loop', () => {
  close(offset(CENTRES, L, 100, 2), -300);
  close(offset(CENTRES, L, 600, 0), 300);
});

test('h from the first photo lands on the last, l from the last on the first', () => {
  assert.equal(keyStep('h'), -1);
  assert.equal(keyStep('l'), 1);
  assert.equal(keyStep('ArrowLeft'), 0);
  assert.equal(photoIndex(3, 0 + keyStep('h')), 2);
  assert.equal(photoIndex(3, 2 + keyStep('l')), 0);
});

test('k speeds up and j slows down', () => {
  assert.equal(speedStep('k'), 1);
  assert.equal(speedStep('j'), -1);
  assert.equal(speedStep('l'), 0);
});

test('t flips the theme both ways', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});

test('with a pure sine the phase drives simple harmonic motion between photos', () => {
  const sine = clipped(1);
  close(sine.terms[0].a, 1, 1e-6);
  for (const { a } of sine.terms.slice(1)) close(a, 0, 1e-6);
  close(turnsAtPhase(sine, 0), 0, 1e-3);
  close(turnsAtPhase(sine, Math.PI / 2), 0.5, 1e-3);
  close(turnsAtPhase(sine, Math.PI), 1, 1e-3);
  close(turnsAtPhase(sine, 3 * Math.PI), 3, 1e-3);
  close(turnsAtPhase(sine, -Math.PI / 2), -0.5, 1e-3);
});

test('phase and position are inverses for a pure sine', () => {
  const sine = clipped(1);
  for (const turns of [0.1, 0.5, 0.9, 2.25, -0.75]) close(turnsAtPhase(sine, phaseAtTurns(turns)), turns, 1e-3);
  assert.ok(Number.isFinite(phaseAtTurns(1.02)), 'an overshoot past a photo still yields a phase');
});

test('clipping gives an exactly flat top, so the strip rests dead centre then moves on', () => {
  const square = clipped(8);
  assert.ok(
    square.table.slice(0, 200).every((v) => v === 1),
    'flat across the plateau',
  );
  assert.equal(turnsAtPhase(square, Math.PI / 4), 0);
  assert.equal(turnsAtPhase(square, (3 * Math.PI) / 4), 1);
  const turns = Array.from({ length: 300 }, (_, i) => turnsAtPhase(square, (i / 299) * Math.PI));
  assert.ok(
    turns.every((t, i) => !i || t >= turns[i - 1]),
    'the strip never backs up',
  );
});

test('the transform recovers a known series and its partial sums converge on the wave', () => {
  const size = 2048;
  const known = Array.from({ length: size }, (_, i) => {
    const phi = (2 * Math.PI * i) / size + Math.PI / 2;
    return Math.sin(phi) + 0.3 * Math.sin(3 * phi) - 0.1 * Math.sin(5 * phi);
  });
  const terms = transform(known, 7);
  close(terms[0].a, 1, 1e-9);
  close(terms[1].a, 0.3, 1e-9);
  close(terms[2].a, -0.1, 1e-9);
  close(terms[3].a, 0, 1e-9);
  const error = (harmonics: number) => {
    const s = clipped(3, size, harmonics);
    return Math.max(...s.table.map((v, i) => Math.abs(v - partial(s, (2 * Math.PI * i) / size))));
  };
  assert.ok(error(31) < error(7) && error(7) < error(1), 'more terms, closer fit');
  assert.ok(error(31) > 0.01, 'a finite sum still rings at the corners');
});

test('photos load outwards from the starting one, next before previous, wrapping round', () => {
  assert.deepEqual(loadOrder(6, 0), [0, 1, 5, 2, 4, 3]);
  assert.deepEqual(loadOrder(5, 3), [3, 4, 2, 0, 1]);
});
