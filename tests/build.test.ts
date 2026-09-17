import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  build,
  compile,
  listPhotos,
  renderPhotos,
  parseDate,
  parseFrontMatter,
  parseHeading,
  readPost,
  siteName,
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

const wide = () =>
  sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } })
    .png()
    .toBuffer();

const site = async () => {
  const root = scratch();
  write(join(root, 'index.html'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
  writeFileSync(join(root, 'hummingbird.png'), 'png');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  write(join(root, 'site.css'), readFileSync(join(ROOT, 'site.css'), 'utf8'));
  for (const script of ['gallery.ts', 'strip.ts']) write(join(root, script), readFileSync(join(ROOT, script), 'utf8'));
  mkdirSync(join(root, 'photos'), { recursive: true });
  writeFileSync(join(root, 'photos', 'grain.jpg'), await wide());
  write(join(root, 'photos', 'SOURCES.md'), 'credits');
  write(join(root, 'writing', 'older.md'), '---\ntitle: Older & Wiser\ndate: 2025-01-01\n---\nOld.\n');
  write(join(root, 'writing', 'newer.md'), '---\ntitle: Newer\ndate: 2026-09-15\n---\nNew.\n');
  return build(root);
};

test('build renders photos to sized copies and writes the manifest', async () => {
  const dist = await site();
  assert.ok(existsSync(join(dist, 'index.html')));
  assert.ok(!existsSync(join(dist, 'photos', 'grain.jpg')), 'originals are never served');
  for (const size of [1600, 3200]) assert.ok(existsSync(join(dist, 'photos', `grain.${size}.webp`)));
  const [meta] = JSON.parse(readFileSync(join(dist, 'photos.json'), 'utf8'));
  assert.equal(meta.name, 'grain.jpg');
  assert.equal(meta.aspect, 2);
  assert.match(meta.blur, /^data:image\/webp;base64,/);
});

test('build compiles the scripts to hashed plain JavaScript the page and imports point at', async () => {
  const dist = await site();
  const files = readdirSync(dist);
  const galleryFile = files.find((f) => /^gallery\.[0-9a-f]{8}\.js$/.test(f));
  const stripFile = files.find((f) => /^strip\.[0-9a-f]{8}\.js$/.test(f));
  assert.ok(galleryFile && stripFile, 'both scripts carry a content hash');
  assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), new RegExp(`src="${galleryFile}"`));
  const gallery = readFileSync(join(dist, galleryFile!), 'utf8');
  assert.ok(gallery.includes(`from './${stripFile}'`), 'gallery imports the hashed strip');
  assert.doesNotMatch(gallery, /interface |: number/);
  assert.ok(!files.includes('gallery.js'), 'no unhashed copy is left to be cached');
  const cssFile = files.find((f) => /^site\.[0-9a-f]{8}\.css$/.test(f));
  assert.ok(cssFile, 'the stylesheet carries a content hash');
  assert.ok(readFileSync(join(dist, 'index.html'), 'utf8').includes(`href="${cssFile}"`));
  assert.ok(readFileSync(join(dist, 'writing', 'newer', 'index.html'), 'utf8').includes(`href="../../${cssFile}"`));
  assert.equal(
    compile('const n: number = 1;\nexport { n };\n').replace(/\s+/g, ' ').trim(),
    'const n = 1; export { n };',
  );
});

test('build lists posts newest first with escaped titles and relative links', async () => {
  const index = readFileSync(join(await site(), 'writing', 'index.html'), 'utf8');
  assert.ok(index.indexOf('href="../writing/newer/"') < index.indexOf('href="../writing/older/"'));
  assert.match(index, /Older &amp; Wiser/);
  assert.match(index, /January 2025/);
  assert.match(index, /href="\.\.\/"/);
});

test('build renders post pages rooted two levels up', async () => {
  const page = readFileSync(join(await site(), 'writing', 'newer', 'index.html'), 'utf8');
  const name = siteName(readFileSync(join(ROOT, 'index.html'), 'utf8'));
  assert.ok(page.includes(`<title>Newer · ${name}</title>`));
  assert.match(page, /<p>New\.<\/p>/);
  assert.match(page, /September 2026/);
  assert.match(page, /href="\.\.\/\.\.\/"/);
  assert.match(page, /href="\.\.\/\.\.\/writing\/"/);
});

test('build replaces previous output', async () => {
  const dist = await site();
  const stale = join(dist, 'writing', 'gone', 'index.html');
  write(stale, 'stale');
  await build(join(dist, '..'));
  assert.ok(!existsSync(stale));
});

test('renderPhotos reads real dimensions and skips anything unreadable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meta-'));
  writeFileSync(join(dir, 'wide.png'), await wide());
  writeFileSync(join(dir, 'broken.jpg'), '');
  const metas = await renderPhotos(dir, join(dir, 'out'), join(dir, 'cache'));
  assert.deepEqual(
    metas.map(({ name, aspect }) => ({ name, aspect })),
    [{ name: 'wide.png', aspect: 2 }],
  );
});
