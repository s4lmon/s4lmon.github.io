import { imageSize } from 'image-size';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, parse } from 'node:path';
import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';
import { gfmHeadingId, getHeadingList } from 'marked-gfm-heading-id';

const ROOT = import.meta.dirname;
const IMAGE_KINDS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const SCRIPTS = ['gallery.ts', 'strip.ts'];
const PAGE = readFileSync(join(ROOT, 'writing.html'), 'utf8');

export interface Post {
  slug: string;
  title: string;
  date: Date;
  toc: string;
  body: string;
}

export const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const dateLabel = (date: Date): string => date.toLocaleDateString('en', { month: 'long', year: 'numeric' });

export function parseFrontMatter(text: string): [Record<string, string>, string] {
  const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1;
  if (end < 0) return [{}, text];
  const meta: Record<string, string> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0)
      meta[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim()
        .replace(/^"|"$/g, '');
  }
  return [meta, text.slice(end + 4)];
}

// Date-only strings are local midnight, so months never drift
export function parseDate(value: string | undefined, fallback: Date): Date {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? `${value}T00:00` : (value ?? ''));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

const toc = (headings: { level: number; id: string; text: string }[]): string => {
  const items = headings.filter((h) => h.level <= 3);
  if (!items.length) return '';
  const list = items.map((h) => `<li class="l${h.level}"><a href="#${h.id}">${h.text}</a></li>`).join('');
  return `<div class="toc"><ul>${list}</ul></div>`;
};

// A leading "# Title" line, with a short dated line under it, stands in for front matter
export function parseHeading(text: string): { title?: string; date?: string; body: string } {
  const lines = text.trimStart().split('\n');
  if (!lines[0]?.startsWith('# ')) return { body: text };
  const title = lines[0].slice(2).trim();
  const rest = lines.slice(1);
  while (rest[0]?.trim() === '') rest.shift();
  const probe = rest[0]?.trim() ?? '';
  const NONE = new Date(0);
  const dated = probe.length < 40 && /\d/.test(probe) && parseDate(probe, NONE) !== NONE;
  return { title, date: dated ? probe : undefined, body: (dated ? rest.slice(1) : rest).join('\n') };
}

export function readPost(path: string): Post {
  const [meta, text] = parseFrontMatter(readFileSync(path, 'utf8'));
  const heading = parseHeading(text);
  const html = new Marked().use(gfmHeadingId(), markedFootnote()).parse(heading.body) as string;
  const slug = parse(path).name;
  return {
    slug,
    title: meta.title || heading.title || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    date: parseDate(meta.date ?? heading.date, statSync(path).mtime),
    toc: toc(getHeadingList()),
    body: html,
  };
}

export const render = (vars: Record<string, string>): string =>
  PAGE.replace(/\$\{?(\w+)\}?/g, (_, key: string) => vars[key] ?? '');

export const listPhotos = (folder: string): string[] =>
  readdirSync(folder)
    .filter((name) => IMAGE_KINDS.has(extname(name).toLowerCase()))
    .sort();

// Aspect ratios ship with the list so the strip lays out before any photo arrives
export const photoMeta = (folder: string): { name: string; aspect: number }[] =>
  listPhotos(folder).map((name) => {
    try {
      const { width, height, orientation = 1 } = imageSize(readFileSync(join(folder, name)));
      return { name, aspect: orientation >= 5 ? height / width : width / height };
    } catch {
      return { name, aspect: 1 };
    }
  });

// Browsers get plain JavaScript with .js imports
export const compile = (source: string): string =>
  stripTypeScriptTypes(source).replace(/(from\s+['"]\.[^'"]+)\.ts(['"])/g, '$1.js$2');

export function build(root = ROOT, dist = join(root, 'dist')): string {
  rmSync(dist, { recursive: true, force: true });
  cpSync(join(root, 'photos'), join(dist, 'photos'), { recursive: true });
  for (const file of ['index.html', 'hummingbird.png', 'favicon.svg']) cpSync(join(root, file), join(dist, file));
  if (existsSync(join(root, 'fonts'))) cpSync(join(root, 'fonts'), join(dist, 'fonts'), { recursive: true });
  for (const script of SCRIPTS) {
    writeFileSync(join(dist, script.replace(/\.ts$/, '.js')), compile(readFileSync(join(root, script), 'utf8')));
  }
  writeFileSync(join(dist, 'photos.json'), JSON.stringify(photoMeta(join(root, 'photos'))));

  const posts = readdirSync(join(root, 'writing'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => readPost(join(root, 'writing', name)))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const post of posts) {
    mkdirSync(join(dist, 'writing', post.slug), { recursive: true });
    const page = render({
      root: '../../',
      title: escape(post.title),
      date: dateLabel(post.date),
      toc: post.toc,
      body: post.body,
    });
    writeFileSync(join(dist, 'writing', post.slug, 'index.html'), page);
  }
  // Root-relative links survive a missing trailing slash
  const items = posts.map(
    (p) => `<li><a href="../writing/${p.slug}/">${escape(p.title)}</a><span>${dateLabel(p.date)}</span></li>`,
  );
  mkdirSync(join(dist, 'writing'), { recursive: true });
  writeFileSync(
    join(dist, 'writing', 'index.html'),
    render({ root: '../', title: 'Writing', body: `<ul class="posts">${items.join('')}</ul>` }),
  );
  return dist;
}

if (process.argv[1] === import.meta.filename) {
  const dist = build();
  const posts = readdirSync(join(dist, 'writing')).length - 1;
  console.log(`built dist: ${listPhotos(join(dist, 'photos')).length} photos, ${posts} posts`);
}
