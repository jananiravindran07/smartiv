# Font licensing — Minya

## Minya

Minya is a **commercial font** by Dharmas Studio. It is **not** covered by an
open source licence, and it is **not** redistributable.

Nothing from the font is committed to this repository. The licensed files are
expected in `web/public/fonts/` — see `web/public/fonts/README.md` for the
exact filenames. Only that README is tracked.

### What you must confirm before shipping

Before this build goes to a ward, a TV device, or any app store, confirm the
licence you hold with Dharmas Studio covers each of these, because they are
separate rights and a web font licence does not always include them:

1. **Web embedding.** Use inside a `CSS` `@font-face` rule served by the app.
2. **App packaging.** The font files being redistributed inside the packaged
   application. Tizen, webOS and Android TV builds all copy `web/dist`
   wholesale, so the font ships with the app.
3. **Number of seats or devices.** Per-device licensing is common, and a ward
   deployment plus TV displays may exceed a single-seat web licence.
4. **Modification.** Subsetting. Converting woff2 to woff or ttf is a format
   change, which some licences permit and some treat as a derivative work.
   Do not subset or alter the outlines without checking.

Until those are confirmed, leave `web/public/fonts/` empty. The app is built
to work in that state: the `@font-face` rules in `web/src/fonts.css` simply
do not resolve, and `--font-display` falls through to **Marcellus**, which is
already loaded from Google Fonts. Nothing renders broken and no error is
raised.

### Recording the licence

Keep the purchase receipt and licence text alongside the project but outside
it, and note the licence reference here when it is settled:

```
Minya licence reference: <not yet recorded>
Purchased from:          <not yet recorded>
Covers web embedding:    <unconfirmed>
Covers app packaging:    <unconfirmed>
```

## Fonts already in use

These are loaded from Google Fonts and need no licence action here, but the
ward operator should still confirm Google's terms suit your deployment:

- **Marcellus** — display face, and the current fallback for `--font-display`.
- **Hanken Grotesk** — body copy, menus, buttons and tables.
- **IBM Plex Mono** — every number on a bed card, the countdown and the clock.

All three are served from `fonts.googleapis.com`. If the ward network has no
outbound internet access, self-host them the same way as Minya and update the
`<link>` in `web/index.html`.
