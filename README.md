# Chalkfall

A demolition puzzle on a living chalkboard. Place the charges, set the fuses, hit the plunger and
bring the building down below the line without touching the neighbours.

Chalkfall is a ground-up homage to the classic iOS demolition puzzlers. Everything in it is
original: the levels, the drawings, the sound and music, and Dusty the foreman. It runs in any
modern browser on phones, tablets and desktops, installs as an app (PWA) and works offline.

## Playing

- **Drag** a charge from the tray onto a frame (or tap a charge in the tray, then tap frames).
  Charges snap to half-foot marks, so the same layout always plays out the same way.
- **Tap** a placed charge to set its fuse (now to 2 s), aim a kicker, or remove it. Drag it back to
  the tray to take it off.
- **BOOM** (or Enter) sets everything off. Charges fire the instant their fuse runs out.
- **Pinch / wheel** to zoom, drag the background to pan. Undo with the arrow, Ctrl-Z or Backspace;
  R restarts, Esc pauses.

### Stars

Every level shows its three goals before you detonate:

| Star | Goal |
|------|------|
| ★ | Clear it: all rubble below the red line, and nothing crashes into a neighbour (rubble gently sliding up to one is fine) |
| ★ | Clear it using no more than the par number of charges |
| ★ | The level's bonus: get under the gold line, keep the rubble inside the posts, no fuses, or one kind of charge only |

The stars are independent and are kept across attempts, so you can go for them one at a time. Every
level has been solved by a headless solver (see below) with a margin to spare, so all three stars
are always reachable. The `?` button shows a layout that clears the level.

### Charges

| Charge | What it does |
|--------|--------------|
| **Charge** | Cuts timber, concrete and glass, blows the cut ends out and shoves everything nearby |
| **Blaster** | No cut, a much bigger shove: knocks stacks over |
| **Cutter** | Small and precise: the only thing that slices bolted steel, and it pops the cut post out |
| **Kicker** | A directed shove: tap it to aim, send the mess where you want it |
| **Imploder** | Pulls everything in range toward itself for a moment, so the building folds in on itself |

Materials: timber and concrete snap when they hit hard, glass shatters near any blast, steel only
gives way to cutters, and reinforced (double-lined) frames can't be cut at all.

### Worlds

1. **First Day**: timber and concrete basics
2. **Downtown**: neighbours, tight lots and kickers
3. **Steelworks**: bolted steel, cutters and fuse timing
4. **Skyline**: glass towers and the imploder

Each world has eight sites and unlocks with stars from the ones before it.

## Run it

### Docker

```sh
docker compose up -d --build      # http://localhost:8080
```

or without compose:

```sh
docker build -t chalkfall .
docker run -d -p 8080:80 --name chalkfall chalkfall
```

The image is a small nginx serving the static build (about 300 KB gzipped).

### GitHub Actions

`.github/workflows/docker.yml` runs the type check and the level regression test, then builds a
multi-arch image (amd64 and arm64) and pushes it to the GitHub Container Registry as
`ghcr.io/<owner>/<repo>` on every push to `main` and on `v*` tags. Pull requests are built but not
pushed. It needs no secrets: it uses the built-in `GITHUB_TOKEN`. Packages from a private repository
are private by default; to pull the image elsewhere, `docker login ghcr.io` with a personal access
token that has `read:packages`.

### Development

```sh
npm install
npm run dev          # Vite dev server
npm run build        # type check + production build into dist/
npm test             # every level stands at rest and its stored solution still clears it
npm run check        # per-level stability, start heights, piece counts
```

## How it's built

- **Physics:** [Box2D v3.2](https://github.com/erincatto/box2d) compiled to WebAssembly with a small
  C bridge (`physics/api.c`). The game steps it at a fixed 60 Hz (slightly slowed for weight) and is
  fully deterministic, so replays are re-simulations of your placements. The prebuilt module lives in
  `src/physics/wasm/`; to rebuild it you need Emscripten: `physics/build.sh`.
- **Rendering:** [PixiJS 8](https://pixijs.com) (WebGL). All the chalk art is drawn procedurally
  at load time on a canvas, with no image files (grainy strokes, hatching, three "boiling" variants per piece so the
  drawing wobbles like hand-animated chalk).
- **Audio:** synthesized with WebAudio: impacts per material, glass, welds, the plunger, and a
  small generative jazz loop.
- **UI:** plain DOM over the canvas, written in TypeScript, bundled by Vite.

### Levels and the solver

Levels are written with a small builder DSL in `src/levels/worlds.ts` (columns, beams, braces,
frames, welds, block stacks, neighbours, lot posts). Their pass line, gold line and par come from
`tools/solve.ts`, which plays each level headless hundreds of times: single charges along every
frame, whole floors of columns, beam search over combinations, and random layouts. A layout only
counts if it still works with every charge moved one half-foot mark either way, and the results are stored in
`src/levels/calibration.json`.

```sh
npm run solve -- 2-5 4-8 --write        # re-solve some levels and update the calibration
npx tsx tools/probe.ts 4-5 '{"ground":[["charge",-12,2.5],["charge",12,2.5]]}'
npx tsx tools/film.ts 4-5 solution out.svg   # filmstrip of a collapse
npx tsx tools/robust.ts 4-5 '{"a":[["charge",-12,2.5],["charge",12,2.5]]}'   # same layout, nudged
npx tsx tools/reach.ts 4-5 '{"a":[["charge",-12,2.5]]}'   # how far debris flies (for placing neighbours)
```

Players get one charge of slack on top of the solver's par (`PAR_SLACK` in `src/levels/index.ts`).

## Credits and licences

- Game code, levels and art: original for this project.
- Box2D © Erin Catto, MIT licence (`src/physics/wasm/BOX2D-LICENSE.txt`).
- PixiJS, MIT licence.
- Fonts: Architects Daughter (Kimberly Geswein) and Cabin Sketch (Pablo Impallari), SIL Open Font
  Licence (`public/fonts/`).
