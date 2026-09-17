import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fourier,
  sizeFor,
  spring,
  variant,
  sample,
  keyStep,
  landing,
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
  const sine = fourier(1);
  assert.deepEqual(sine.terms, [{ k: 1, a: 1 }]);
  close(turnsAtPhase(sine, 0), 0, 1e-3);
  close(turnsAtPhase(sine, Math.PI / 2), 0.5, 1e-3);
  close(turnsAtPhase(sine, Math.PI), 1, 1e-3);
  close(turnsAtPhase(sine, 3 * Math.PI), 3, 1e-3);
  close(turnsAtPhase(sine, -Math.PI / 2), -0.5, 1e-3);
});

test('phase and position are inverses for a pure sine', () => {
  const sine = fourier(1);
  for (const turns of [0.1, 0.5, 0.9, 2.25, -0.75]) close(turnsAtPhase(sine, phaseAtTurns(turns)), turns, 1e-3);
  assert.ok(Number.isFinite(phaseAtTurns(1.02)), 'an overshoot past a photo still yields a phase');
});

test('more terms square the wave, with the ringing a real partial sum has', () => {
  const square = fourier(31);
  assert.deepEqual(square.terms.slice(0, 3), [
    { k: 1, a: 1 },
    { k: 3, a: 1 / 3 },
    { k: 5, a: 1 / 5 },
  ]);
  close(sample(square, 0), Math.PI / 4, 0.02);
  assert.ok(Math.max(...square.table) > sample(square, 0) * 1.05, 'overshoots near the jump');
  assert.ok(Math.abs(turnsAtPhase(square, Math.PI / 4)) < 0.1, 'still on the photo a quarter of the way through');
  assert.ok(Math.abs(turnsAtPhase(square, (3 * Math.PI) / 4) - 1) < 0.1, 'already on the next photo');
});

test('photos load outwards from the starting one, next before previous, wrapping round', () => {
  assert.deepEqual(loadOrder(6, 0), [0, 1, 5, 2, 4, 3]);
  assert.deepEqual(loadOrder(5, 3), [3, 4, 2, 0, 1]);
});

test('photos pick the smallest copy that covers how large they are drawn', () => {
  assert.equal(sizeFor(900), 1600);
  assert.equal(sizeFor(1600), 1600);
  assert.equal(sizeFor(1601), 3200);
  assert.equal(sizeFor(9000), 3200);
  assert.equal(variant('IMG_2462.JPG', 1600), 'IMG_2462.1600.webp');
  assert.equal(variant('a.b.png', 3200), 'a.b.3200.webp');
});

test('a nudge stays, a swipe turns a page the way it went, a fling turns up to three', () => {
  assert.equal(landing(0.03, 0), 0);
  assert.equal(landing(0.07, 0), 1);
  assert.equal(landing(-0.3, 0), -1);
  assert.equal(landing(1.4, 0), 1);
  assert.equal(landing(1.6, 0), 2);
  assert.equal(landing(0.2, 0.9), 1);
  assert.equal(landing(0.1, 2.6), 3);
  assert.equal(landing(-4, -2), -3);
});

test('the spring arrives without overshoot and keeps the speed it is given', () => {
  let [x, v] = [0, 0];
  const path: number[] = [];
  for (let t = 0; t < 1; t += 1 / 120) {
    [x, v] = spring(x, v, 1, 1 / 120);
    path.push(x);
  }
  assert.ok(
    path.every((p) => p <= 1 + 1e-9),
    'never past the target',
  );
  close(x, 1, 1e-3);
  const [fast] = spring(0, 5, 1, 1 / 120);
  const [slow] = spring(0, 0, 1, 1 / 120);
  assert.ok(fast > slow + 0.03, 'a fling carries on at its own speed');
});
