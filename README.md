# Radical Materials

A looping photo strip and a writing section, built to plain static files for GitHub Pages.

    npm install
    just serve        # build, open the browser, serve dist/
    just test         # node --test
    just check        # tsc + prettier
    just format

Everything is TypeScript run directly by Node 22. The build strips types for the browser with Node's own
stripper, so there is no bundler.

**Photos** go in `photos/`, any flat set of JPEG, PNG, WebP, AVIF or GIF files. `photos/SOURCES.md` credits the
current placeholders.

**Writing** go in `writing/` as Markdown. Give a title and date either as front matter or as a heading with a
dated line under it:

    ---
    title: ABC
    date: 2026-09-15
    ---

    # ABC

    September 2026

Headings make a contents list, `[^1]` makes footnotes. 

**Deploy** by pushing to `main`

**Fonts.** Both pages use Overpass Mono.

**Analytics** need a Fathom site ID in place of `FATHOM_SITE_ID` in `index.html` and `writing.html`.
