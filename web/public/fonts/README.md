# Minya font files

Drop the licensed Minya web fonts in this folder. Nothing else needs editing:
`web/src/fonts.css` already declares the four styles and points at these
paths, with Marcellus as the fallback, so the app renders correctly with this
folder containing only this note.

Vite copies everything in `web/public/` verbatim into `web/dist`, so the
files are packaged with the app and resolve with no host name and no CDN.

## Files expected here

```
web/public/fonts/
  Minya-Regular.woff2
  Minya-Regular.woff
  Minya-Regular.ttf
  Minya-Italic.woff2
  Minya-Italic.woff
  Minya-Italic.ttf
  Minya-Outline.woff2
  Minya-Outline.woff
  Minya-Outline.ttf
  Minya-OutlineItalic.woff2
  Minya-OutlineItalic.woff
  Minya-OutlineItalic.ttf
```

The Outline files register under the separate family `Minya Outline`, so they
must not be renamed or folded into `Minya-Regular`.

Only `.woff2` is needed for a modern browser. `.woff` and `.ttf` are listed as
fallbacks in the `@font-face` rules for older smart-TV webviews.

**If a file is missing, its rule is simply skipped** and that style falls
back to Marcellus. There is no broken render and no console error.

## Licensing

Minya is a commercial font. See `FONT-LICENSE.md` at the repository root. The
files are not committed — only this note is.

## Where it is used

Only display text, through `--font-display`: the wordmark, page titles, the
login hero heading and section headers. Body copy, tables, buttons, menus and
all numeric readouts stay on Hanken Grotesk and IBM Plex Mono, which are
already loaded from Google Fonts.

`.display-outline` uses the Outline cut and is only ever applied to text that
is already 60px or larger, because it is too thin to read below that.
