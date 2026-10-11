# Design notes

How the web app looks and why.
Audit taken 2026-10-05; the changes below were applied on 2026-10-06.

**Direction:** Story set the identity: clay chess pieces on a park island,
chunky pressable controls, chapter colours. The rest of the app now borrows
from it instead of falling back to a generic dashboard kit (cream page,
1px-bordered cards, tiny grey mono labels).

---

## 1. Stylesheet rules (read this before touching styles)

Styles are SCSS in `src/styles/`, one entry (`main.scss`) that `@use`s the
partials in order. Later partials win: `controls` and `motion` load last.

| File | Holds |
| --- | --- |
| `_tokens.scss` | Every colour, font, font size and breakpoint |
| `_mixins.scss` | `down(md)` / `up(md)` width queries, `reduced-motion`, `motion-ok`, `press`, `focus-ring` |
| `_controls.scss` | The house control grammar: `.button`, `.primary`, `.danger`, segmented pills, icon buttons |
| `_motion.scss` | App-wide motion: page transitions, the board's edge bump, toast timing |
| `_<page>.scss` | One partial per page or feature |

Rules, enforced by `src/styles/styles.test.ts` (part of `.\dev.ps1 test-web`):

- **Colours come from `_tokens.scss`.** No raw hex anywhere else. Brand
  colours are named (`$paper`, `$ink`, `$forest`, `$brand-green`…); the rest is
  a scale by hue family and lightness (`$sage-600`, `$moss-700`, `$wheat-200`).
  Pick the nearest step instead of inventing a colour. Board themes keep
  exact colours (`$board-forest-light`…).
- **Font sizes come from the type scale** (`$fs-2xs` 11px … `$fs-display`).
  Nothing below 11px, and that only for coordinates, badges and counts. Product
  body text is `$fs-md` (14px). In a `font:` shorthand write `#{$fs-md}`.
  Fluid `clamp()` / `calc()` sizes are allowed.
- **Widths come from the breakpoints**: `@include down(md) { … }`. Never a raw
  `@media (max-width: 812px)`.
- **Fonts come from `$font-sans` (Nunito) and `$font-mono` (DM Mono).** Mono is
  for chess data only (moves, ratings, clocks, counts), never for labels.
- **The stylesheet must compile** (the test compiles `main.scss`).

Format with `.\dev.ps1 format` (Prettier, `web/.prettierrc.json`).

## 2. What was applied

### Page chrome
- The shared top bar is opt-out per route: routes made with `bare(title)` in
  `src/App.tsx` get no top bar, and the page owns the `<h1>`. Bare routes:
  Home, Story, Bots, Arena, Coach, Puzzles (overview), Profile, Settings.
- Gone: duplicate titles (Engine Lab, Arena), Story's empty strip, the
  explainer lines on Lessons, Import, Engine Lab and Arena, Story's "Your
  learning journey" label, and the XP chip in the top bar. XP shows on Profile,
  Story's sidebar, and as the week strip on Home.
- The "games not analyzed" banner shows on Insights and on an unanalyzed game
  page only (it was also on Home and Train).

### Type and colour
- One type scale (15 steps) replaces ~40 ad-hoc sizes; everything under 11px
  was raised.
- Muted text colours were darkened to reach about 4.5:1 on paper
  (`$muted`, `$sage-500`, `$sage-600`).
- Decorative uppercase mono kickers became sentence-case Nunito labels (24
  rules). Real badges (NNUE, award tiers, the logo) stay uppercase.
- One font system: Bots and Legends no longer load Outfit and IBM Plex Mono.

### Controls (`_controls.scss`)
- Every `.button` shares Story START's grammar: 10px corners, a solid lower
  edge, and a press that sinks onto it (`press` mixin). Primary is green
  with a forest edge, secondary white with a sage edge.
- Segmented controls (`<Segments>`, `src/components/Segments.tsx`) slide one
  pill to the chosen option. The first placement and resizes land without
  animating.

### Home
- The hero is the next Story node on its chapter's colours. A lesson about a
  piece shows that piece on a small 5×5 board with every square it reaches
  (`src/components/PieceStage.tsx`). The chapter's clay scene spills past the
  hero's bottom edge.
- **The memorable moment:** pressing START makes the piece hop to one of its
  squares (an L for the knight) before the lesson opens. Skipped under reduced
  motion and for modified clicks.
- START names the action: "Start the lesson", "Start the gauntlet", "Face the
  boss".
- Practice doors use clay art and no boxes. The streak is seven day cells with
  flames, and today's cell fills with XP.

### Fewer boxes
- Profile: six bordered cards became doors (clay art, name, one line), and the
  level panel lost its box.
- Lessons and Puzzles theme cards: no border or background; hover gives them
  a floor.
- Story sidebar: the stat tiles inside the progress card lost their own boxes.
- Puzzles: the rating card and the mascot-plus-rules block became one headline
  row (gauge, rating, trend, actions). Scoring rules sit behind a "How scoring
  works" disclosure.

### Empty and loading states
- Arena waits on the real starting position, set aside, instead of a dashed
  box.
- Insights shows the calculating mascot while it loads.

### Motion (`_motion.scss`)
- The three base motions: press feedback on every button, the sliding
  segment pill, and page entrances.
- Page changes from the rail, Home doors and Profile doors use View
  Transitions. The page leaves in 160ms and arrives in 280ms; the rail stays
  put.
- The board nudges 12px when ← / → hits either end of a game.
- The toast leaves faster than it arrives.
- Everything has a `prefers-reduced-motion` equivalent.

### Bugs fixed along the way
- `useNarration.ts` read `VOICE_WAIT` before it was declared, which crashed at
  load when the browser had no voices yet.
- Home's mobile streak strip overlapped itself.
- Engine Lab's Play and Install buttons were unreadable because of a
  `.engine-actions` class collision with the board panel. They now use
  `.engine-card-actions`.
- About 110 dead CSS rules from the old dashboard and shell were removed.

### After the independent review (2026-10-06)
A reviewer who saw only screenshots flagged these, now fixed:
- Bots, Engine Lab and Arena had their own side padding, so the content
  started 30px right of the other pages. They now share the app's container,
  and their titles share one heading style (`_controls.scss`).
- Bots' "Surprise me" and "Train a bot" were flat. They press like every
  other button now.
- Mono was carrying words ("steady", "Stockfish playing at 1180", "Today's
  goal", "3 of 12 done", licences, player tags). Those are Nunito now.
- The streak heading was red on Home and orange elsewhere; it's orange
  everywhere.
- Home's doors and the lesson and puzzle cards didn't look clickable. They
  now end in an arrow that steps forward on hover.
- Smaller fixes: Story's all-caps START is now "Start". Phones lost the
  doubled hairline under the top bar. Story got top spacing on phones. The
  Puzzles sparkline no longer overflows on phones. Arena's waiting board is no
  longer washed out. "Keep climbing." was cut.

Not taken, and why:
- One header for every page. Top-bar pages (small title, icon, "?") and hero
  pages (Home, Story, Bots, Engine Lab, Arena) are two deliberate patterns;
  merging them would bring back the empty bars.
- Folding Bots' rating chips into a dropdown, and Arena's repeated "Pick a
  legend" link. Both are product changes, not visual ones; worth doing
  separately.

## 3. Still open

- The streak is still drawn three ways (Home week cells, Story's circles,
  Profile's flame and text). Make one component.
- Bot cards and award cards still sit in bordered boxes. Try letting the
  portraits and renders break the frame, so the art becomes the structure.
- Insights' stat tiles and Engine Lab's cards keep their boxes on purpose.
  They group actions and data, which is what boxes are for.
- Lesson cards could use a shared-element transition (card art grows into the
  lesson header).
- Import's source tabs and date chips predate `<Segments>`; move them over.
- Rail icons are flat glyphs, which is fine for navigation. Content
  everywhere else uses clay art; keep it that way.

## 4. Review loop

- Screenshots at desktop (1440x900) and phone (390x844) sizes, checking for
  console errors, overflow and broken images. Blank the text once: if two
  pages look like the same grey rectangles, the layout is the default
  template.
- Before calling a page done, do a subtraction pass: one main element, then
  delete text block by block, putting back only what hurts comprehension
  when it's gone.
- For a bigger change, get an independent review from a reviewer who has
  seen only the screenshots.
