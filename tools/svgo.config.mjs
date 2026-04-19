// SVGO config for workshop SVGs.
//
// Workshop SVGs put their CSS variables in a `:root { }` block inside a
// <style> element so the workshop UI + svg_render can find them. SVGO's
// default `preset-default` includes `inlineStyles` + `convertStyleToAttrs`,
// which move the :root vars into a `style` attribute on the root <svg>.
// Our svg_render's var-inliner only looks inside <style> blocks — when the
// vars move, every `var(--xxx)` reference goes unresolved and resvg falls
// back to black on every fill. Disable those two plugins.
//
// `floatPrecision: 1` rounds path coordinates to 1 decimal place, which
// cuts the trace output down by roughly 80–90 % on dense vtracer SVGs
// without any visible quality loss (the trace was emitting 17-digit
// floats per coordinate).
//
// `minifyStyles` rewrites class selectors using `:is` etc., which can
// trip the workshop's regex-based parser. Disabled for safety.
//
// Usage:
//     npm i --no-save svgo@3
//     npx svgo -i gallery/foo.svg -o gallery/foo.svg --config tools/svgo.config.mjs
//     # or run on the whole gallery:
//     for f in gallery/*.svg; do
//         npx svgo -i "$f" -o "$f" --config tools/svgo.config.mjs
//     done

export default {
  multipass: true,
  floatPrecision: 1,
  plugins: [
    { name: 'preset-default', params: { overrides: {
      inlineStyles: false,
      convertStyleToAttrs: false,
      minifyStyles: false,
    }}},
  ],
};
