import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  build,
  compile,
  listPhotos,
  photoMeta,
  parseDate,
  parseFrontMatter,
  parseHeading,
  readPost,
} from '../build.ts';

const ROOT = join(import.meta.dirname, '..');
const FALLBACK = new Date(2000, 0, 1);
const scratch = () => mkdtempSync(join(tmpdir(), 'materials-'));
const write = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

test('front matter is parsed and stripped', () => {
  const [meta, body] = parseFrontMatter('---\nTitle: "Hello"\ndate: 2026-09-15\n---\n\n# Heading\n');
  assert.deepEqual(meta, { title: 'Hello', date: '2026-09-15' });
  assert.equal(body.trim(), '# Heading');
});

test('text without front matter is untouched', () => {
  assert.deepEqual(parseFrontMatter('# Heading\n'), [{}, '# Heading\n']);
});

test('dates parse from ISO or month-year and fall back otherwise', () => {
  assert.deepEqual(parseDate('2026-09-15', FALLBACK), new Date(2026, 8, 15));
  assert.equal(parseDate('September 2026', FALLBACK).getMonth(), 8);
  assert.equal(parseDate('someday', FALLBACK), FALLBACK);
  assert.equal(parseDate(undefined, FALLBACK), FALLBACK);
});

test('a post derives its title from the filename and renders a contents list and footnotes', () => {
  const path = join(scratch(), 'pacing-the-frontier.md');
  writeFileSync(path, 'Intro.[^1]\n\n## Why\n\nBecause.\n\n### How\n\nSo.\n\n[^1]: A note.\n');
  const post = readPost(path);
  assert.equal(post.title, 'Pacing the frontier');
  assert.equal(post.slug, 'pacing-the-frontier');
  assert.match(post.toc, /class="toc"/);
  assert.match(post.toc, /href="#why"/);
  assert.match(post.toc, /class="l3"><a href="#how"/);
  assert.match(post.body, /class="footnotes"/);
  assert.match(post.body, /A note\./);
});

test('a leading title line and the date under it stand in for front matter', () => {
  const lifted = parseHeading('# Pacing the Frontier\n\nSeptember 2026\n\nIntro.\n');
  assert.equal(lifted.title, 'Pacing the Frontier');
  assert.equal(lifted.date, 'September 2026');
  assert.equal(lifted.body.trim(), 'Intro.');
  const undated = parseHeading('# Title\n\nJust a first paragraph.\n');
  assert.equal(undated.date, undefined);
  assert.equal(undated.body.trim(), 'Just a first paragraph.');
  assert.deepEqual(parseHeading('No heading here.\n'), { body: 'No heading here.\n' });
});

test('a post file with a title line renders without repeating it', () => {
  const path = join(scratch(), 'note.md');
  writeFileSync(path, '# A Note\n\n2026-09-15\n\nBody.\n');
  const post = readPost(path);
  assert.equal(post.title, 'A Note');
  assert.equal(post.date.getMonth(), 8);
  assert.doesNotMatch(post.body, /<h1|2026/);
  assert.match(post.body, /<p>Body\.<\/p>/);
});

test('a post without headings has no contents list', () => {
  const path = join(scratch(), 'note.md');
  writeFileSync(path, 'Just a paragraph.\n');
  assert.equal(readPost(path).toc, '');
});

test('photo listing keeps only images, sorted', () => {
  const dir = scratch();
  for (const name of ['b.JPG', 'a.png', 'notes.md', 'c.tiff']) writeFileSync(join(dir, name), '');
  assert.deepEqual(listPhotos(dir), ['a.png', 'b.JPG']);
});

const site = () => {
  const root = scratch();
  write(join(root, 'index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
  writeFileSync(join(root, 'hummingbird.png'), 'png');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  for (const script of ['gallery.ts', 'strip.ts']) write(join(root, script), readFileSync(join(ROOT, script), 'utf8'));
  write(join(root, 'photos', 'grain.jpg'), 'jpg');
  write(join(root, 'photos', 'SOURCES.md'), 'credits');
  write(join(root, 'writing', 'older.md'), '---\ntitle: Older & Wiser\ndate: 2025-01-01\n---\nOld.\n');
  write(join(root, 'writing', 'newer.md'), '---\ntitle: Newer\ndate: 2026-09-15\n---\nNew.\n');
  return build(root);
};

test('build copies the gallery and writes the photo manifest', () => {
  const dist = site();
  assert.ok(existsSync(join(dist, 'index.html')));
  assert.equal(readFileSync(join(dist, 'photos', 'grain.jpg'), 'utf8'), 'jpg');
  assert.deepEqual(JSON.parse(readFileSync(join(dist, 'photos.json'), 'utf8')), [{ name: 'grain.jpg', aspect: 1 }]);
});

test('build compiles the scripts to plain JavaScript with .js imports', () => {
  const dist = site();
  const gallery = readFileSync(join(dist, 'gallery.js'), 'utf8');
  assert.match(gallery, /from '\.\/strip\.js'/);
  assert.doesNotMatch(gallery, /interface |: number/);
  assert.ok(existsSync(join(dist, 'strip.js')));
  assert.equal(
    compile('const n: number = 1;\nexport { n };\n').replace(/\s+/g, ' ').trim(),
    'const n = 1; export { n };',
  );
});

test('build lists posts newest first with escaped titles and relative links', () => {
  const index = readFileSync(join(site(), 'writing', 'index.html'), 'utf8');
  assert.ok(index.indexOf('href="../writing/newer/"') < index.indexOf('href="../writing/older/"'));
  assert.match(index, /Older &amp; Wiser/);
  assert.match(index, /January 2025/);
  assert.match(index, /href="\.\.\/"/);
});

test('build renders post pages rooted two levels up', () => {
  const page = readFileSync(join(site(), 'writing', 'newer', 'index.html'), 'utf8');
  assert.match(page, /<title>Newer · Radical AI<\/title>/);
  assert.match(page, /<p>New\.<\/p>/);
  assert.match(page, /September 2026/);
  assert.match(page, /href="\.\.\/\.\.\/"/);
  assert.match(page, /href="\.\.\/\.\.\/writing\/"/);
});

test('build replaces previous output', () => {
  const dist = site();
  const stale = join(dist, 'writing', 'gone', 'index.html');
  write(stale, 'stale');
  build(join(dist, '..'));
  assert.ok(!existsSync(stale));
});

test('photoMeta reads real dimensions and squares off anything unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meta-'));
  const png2x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAACsXFQNAAAADElEQVQIW2P4//8/AwAI/AL+XJ/QAAAAAABJRU5ErkJggg==';
  writeFileSync(join(dir, 'wide.png'), Buffer.from(png2x1, 'base64'));
  writeFileSync(join(dir, 'broken.jpg'), '');
  assert.deepEqual(photoMeta(dir), [
    { name: 'broken.jpg', aspect: 1 },
    { name: 'wide.png', aspect: 2 },
  ]);
});
