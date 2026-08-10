# Vendored VS Code themes

The theme JSON files in this directory are vendored from the
[tm-themes](https://github.com/shikijs/textmate-grammars-themes) package
(v1.12.2), the same normalized collection Shiki bundles. Each file keeps its
upstream license — see `NOTICE` (third-party attributions for the full
tm-themes collection, vendored verbatim; this directory carries a subset of
the files it lists) and `LICENSE` (the tm-themes MIT license for the
collection itself).

They are imported at build time by `../presets.ts` and converted into app
presets by `../vscode-import.ts`.

To add or swap a bundled theme: drop the theme JSON here, register it in
`BUNDLED_THEME_SOURCES` in `../presets.ts`, and confirm its attribution is
covered by `NOTICE`.
