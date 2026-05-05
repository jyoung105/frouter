# free-router Site Design

This site uses the shared Tony "Urban Loft" editorial system used by the
`side-scraper`, `free-router`, and `future-slide` project sites.

## Structure

All three sites keep the same hand-maintained source shape:

```text
site/
  DESIGN.md
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  public/
  src/
    content.ts
    i18n.ts
    main.ts
    style.css
    theme.ts
    utils.ts
    vite-env.d.ts
```

Product-specific generated files are allowed. This site adds
`index.template.html`, `.generated/`, `models/`, and `scripts/` for static
model-page generation.

## Visual System

- Single editorial column: `--page-max: 42rem`, centered with
  `clamp(1rem, 4vw, 1.5rem)` side padding.
- Floating right-aligned header with author link, GitHub icon, language
  toggle, and theme toggle.
- Neutral ramp plus terracotta only: `#fafafa`, `#000000`, `#a35e47`,
  `#c97d63`, `#f5e8e2`, `#7a4534`.
- Anton uppercase wordmark, Source Serif 4 section labels, Barlow body
  copy, JetBrains Mono terminal blocks.
- No marketing hero and no decorative card grid. The model explorer is the
  product-specific exception: it may use a bordered table surface because
  filtering and comparison require dense structured data.

## Interaction

- Theme state is stored in `fr-theme`; language state is stored in
  `fr-locale`.
- Language switching updates all `[data-i18n]` text and any
  `[data-lang-en]` / `[data-lang-ko]` alternates.
- Hovering a `.featured-link` dims sibling `.home-dimmable-item` rows to
  `0.38` opacity in light mode and `0.3` in dark mode.
- Copy buttons use `data-copy` or `data-cmd` and show the shared copied
  icon state.

## Project Notes

The page must preserve the current flow:

1. Hero
2. Providers
3. Why free-router
4. Install
5. Usage
6. Models explorer
7. Footer

The implementation is intentionally pure Vite + TypeScript. Keep generated
model pages in `models/`; do not replace the generator with a client-only
rendering framework.
