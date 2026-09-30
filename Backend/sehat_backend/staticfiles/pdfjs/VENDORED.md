# pdf.js viewer (vendored)

- Source: pdf.js **v6.3.289**, `pdfjs-6.3.289-legacy-dist.zip` (official release; same version as `pdfjs-dist@6.3.289`).
  Legacy build for older Android WebViews. License: Apache-2.0 (`LICENSE`).
- Opened as `web/viewer.html?file=<signed library URL>#page=N` by the app's in-app reader.

Local changes (keep when upgrading):
1. Removed: sample PDF, debugger, `pdf.sandbox.mjs` (scripting disabled), `*.map` files and their
   `sourceMappingURL` comments (required by the manifest static storage), all locales except `en-US` and `ur`
   (`web/locale/locale.json` lists only those two).
2. `web/viewer.html`: the two `support.mozilla.org` help links point to `#`; loads
   `sehat-viewer-config.js` (no scripting/editing/preferences, external links disabled) and `sehat-viewer.css`
   (hides print, download and open-file buttons).
3. Run `python manage.py collectstatic` after changing anything here.
