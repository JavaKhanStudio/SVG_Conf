# CLAUDE.md — SVG Workshop variable format

This project is a tool for live-previewing SVGs with editable variables. When asked to add, modify, or remove tweakable values in an SVG, follow the conventions below.

## The core idea

Tweakable values live as **CSS custom properties** in a `:root { }` rule inside a `<style>` element that is a **direct child of the root `<svg>`**. The style block should be the **first child element** of the SVG so it's the first thing a human reader sees when opening the file.

The SVG is used through the variables via `var(--name)` in attributes. The file stays 100% valid — you can open it in any browser, in Inkscape, or paste it into a component, and it renders with the default values.

## Minimal template

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    :root {
      --bg-color: #1a1a2e;
      --shape-color: #4a90e2;
      --shape-size: 50;
    }
  </style>
  <rect width="100%" height="100%" fill="var(--bg-color)" />
  <circle cx="100" cy="100" r="var(--shape-size)" fill="var(--shape-color)" />
</svg>
```

That's it. Drop this in the workshop tool and you get three live controls automatically.

## Type inference (no hint needed)

The tool guesses the control type from the value:

| Value looks like | You get |
|---|---|
| `#1a1a2e`, `rgb(...)`, `hsl(...)`, named color (`red`, `coral`...) | color picker |
| `20`, `1.5`, `45deg`, `100%`, `12px` | number slider |
| `true` / `false` | checkbox |
| anything else | text input |

For most variables you don't need to do anything beyond declaring them. Pick a sensible default value and the right control just appears.

## Hint comments (when you need more control)

Add a trailing comment on the same line in the form `/* @ws <type> [key=value]... */` to upgrade the control. Comments are ignored by the browser, so the SVG stays valid.

```css
:root {
  --pupil-size: 20;          /* @ws number min=5 max=50 step=1 */
  --style-mode: soft;        /* @ws select options=soft,sharp,neon */
  --seed: 12345;             /* @ws seed */
  --light-x: 100;            /* @ws point2d=light */
  --light-y: 50;             /* @ws point2d=light */
  --internal-helper: 0.7;    /* @ws ignore */
}
```

### Hint reference

| Hint | What it does |
|---|---|
| `@ws number min=<n> max=<n> step=<n>` | Number slider with explicit range and step. Use whenever a number variable has a meaningful range — sliders without it use a generic auto-range. |
| `@ws select options=a,b,c` | Dropdown with the listed options. The default value should be one of them. |
| `@ws seed` | Number input with a 🎲 randomize button. Use for any value the SVG treats as a random seed. |
| `@ws point2d=<n>` | **Pairs two variables** sharing the same group name `<n>` into a single draggable dot in the preview. Use for light positions, distortion centers, focal points — anything that is conceptually a 2D coordinate. The variables themselves stay as two normal CSS numbers. |
| `@ws color` | Force color picker (in case inference picked the wrong type). |
| `@ws text` | Force text input. |
| `@ws ignore` | Skip this variable — don't generate a control. Use for internal helpers that shouldn't be user-facing. |

## Worked examples

### Example 1: Eye with adjustable iris and pupil

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    :root {
      --sclera: #ffffff;
      --iris-color: #4a90e2;
      --pupil-color: #000000;
      --pupil-size: 15;          /* @ws number min=5 max=40 step=1 */
      --iris-size: 50;           /* @ws number min=20 max=80 step=1 */
    }
  </style>
  <circle cx="100" cy="100" r="80" fill="var(--sclera)" />
  <circle cx="100" cy="100" r="var(--iris-size)" fill="var(--iris-color)" />
  <circle cx="100" cy="100" r="var(--pupil-size)" fill="var(--pupil-color)" />
</svg>
```

### Example 2: Lit scene with draggable light source

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
  <style>
    :root {
      --bg: #0a0a1a;
      --light-color: #ffeb99;
      --light-x: 150;            /* @ws point2d=light */
      --light-y: 80;             /* @ws point2d=light */
      --light-radius: 60;        /* @ws number min=10 max=200 step=5 */
    }
  </style>
  <rect width="100%" height="100%" fill="var(--bg)" />
  <circle cx="var(--light-x)" cy="var(--light-y)" r="var(--light-radius)"
          fill="var(--light-color)" opacity="0.6" />
</svg>
```

In the workshop, the light position becomes a single draggable dot you can move around the preview.

### Example 3: Stylized brick with mode selector and seed

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>
    :root {
      --brick-color: #c44;
      --mortar: #222;
      --pattern: running;        /* @ws select options=running,stack,herringbone */
      --noise-seed: 42;          /* @ws seed */
    }
  </style>
  <!-- shapes that reference var(--brick-color), var(--mortar), etc. -->
</svg>
```

## Common mistakes to avoid

- **Don't use `{{varName}}` placeholder syntax.** The tool uses real CSS variables. Always `var(--name)`.
- **Don't put the `<style>` block deep inside a group.** It must be a direct child of the root `<svg>` element, ideally the first child.
- **Don't forget the `:root` selector.** Declarations have to live inside a `:root { }` rule. Variables declared at the top level of the stylesheet without a selector won't be parsed.
- **Don't mutate the `<style>` block when "updating" a value.** The tool overrides values at runtime via inline styles on the SVG root. Source defaults stay as the *defaults*, not the current state.
- **Don't strip comments when reformatting.** The `/* @ws ... */` hint comments are load-bearing — they upgrade controls. Preserve them on the same line as their declaration.
- **Don't put the hint comment on a separate line from the declaration.** Hints must be on the same line as the `--var: value;` they annotate, after the semicolon.
- **Use kebab-case for variable names.** `--light-x`, not `--lightX`. CSS convention, plays nicely with everything.

## When adding a new variable

1. Pick a clear kebab-case name: `--<thing>-<aspect>` (e.g. `--shadow-blur`, `--iris-color`)
2. Pick a sensible default value
3. Add it to the `:root { }` block
4. Reference it in the SVG body via `var(--name)`
5. If it's a number with a meaningful range, add `/* @ws number min=... max=... step=... */`
6. If it's part of a 2D coordinate, add `/* @ws point2d=<groupname> */` to both the x and y variables
7. If it's a discrete choice, use `/* @ws select options=... */`

That's the whole format.
