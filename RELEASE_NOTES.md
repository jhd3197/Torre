# Move ratings and interactive progress — 2026-10-07

Move ratings now agree across game review, Arena and Insights. The set is
Brilliant, Great, Best, Good, Book, Inaccuracy, Mistake and Blunder. Excellent
remains part of Good for this release.

## What changed

- One backend classifier supplies saved analysis, interactive review and Arena.
  Interactive review now receives Brilliant detection rather than assuming false.
- Arena and game summaries show all eight categories. Insights' **Your moves**
  counts each analysed player move exactly once; percentages use that same total.
- Great uses the engine's top two choices. Our conservative rule requires the
  played move to be best, lose at most two win-percentage points, and retain at
  least 70% when the runner-up has at most 55%, or retain at least 45% when the
  runner-up has at most 30%. Positions with one legal move do not earn Great.
  These are evaluation-derived thresholds, not measured human win probabilities.
- Book matches position/move pairs from prefixes of the bundled opening lines,
  including transpositions, within the first 40 plies. A legend's historical
  game move is separate provenance and does not automatically qualify as Book.
- Precedence is Brilliant, error judgment, Book, Great, Best, Good. A mating
  move is not labelled Book. Raw flags remain available alongside the exclusive
  category, so error totals and rating totals do not double-count a move.
- PGN includes Great (`!`) and named non-error comments. Portable JSON reports
  include the exclusive grade plus Great and Book flags without running an engine.
- English and Spanish labels, help text, coach responses and verdicts cover all
  eight grades. The move list keeps ordinary Good moves visually quiet.
- All eight coin assets were recropped from the supplied sheet by their colored
  silhouettes. They use consistent padding, transparent backgrounds, inward edge
  feathering and lossless WebP. Great and Book also use their coins wherever a
  larger grade illustration is requested.

## Progress chart and illustrations

- Form over time responds directly to hover, click and touch dragging. A crosshair,
  markers and readout identify the selected game; its details and Replay link stay
  selected after leaving the chart. The range slider has been removed.
- Keyboard users can focus the chart and use Left/Right, Home and End. Missing
  accuracy or loss values stay missing instead of connecting unrelated points.
- Six supplied illustrations now cover From your games, daily practice, Lessons,
  training cards, Streak, Storm and the Form over time heading. The shared registry
  keeps those uses consistent.
- Each cut follows the actual object silhouette, retains the detached gold rays,
  removes card borders and contact-shadow remnants, and uses transparent lossless
  WebP. All six cuts were checked against a dark background.

Rebuild these illustrations with `python art/build_assets.py progress`, using
`art/source/progress/progress.png`. The local preview is
`art/.cache/review/progress.jpg`.

## Coach hub and consistent layouts

- Coach is now a main navigation destination with Your plan, Progress and
  Learning centers tabs. Existing Insights URLs remain available.
- Advice becomes illustrated activity cards with valid puzzle, lesson, repertoire
  or bot-game links. Goals and progress come from app activity; invented weekly
  schedules are no longer displayed. Baselines persist across visits and languages.
- Task cards explain existing XP rules, and the hub shows today's earned XP.
  Completing a coach task does not issue a second reward for the same activity.
- Reading the Coach page never starts a model call. Update plan is available when
  the brief changes; unchanged requests reuse saved results. Up to 24 results are
  retained by brief, model and language. Older advice stays visible during updates.
- Story, Coach, puzzles, training, Insights and Engine Lab share a content frame
  and page gutters. Play, review, training and lesson boards use common desktop
  proportions and stack with their panels on narrow screens.
- Release packaging follows local runtime imports automatically and includes
  translated content, so newly added modules such as coach task tracking ship.

## Existing games and release preparation

Scoring version is now 3. Existing games are queued for the app's normal
reanalysis process; the app respects the user's automatic-analysis setting.
Insights retains the complete analysed-move total while showing how many moves
have updated ratings. Great and Book counts are explicitly incomplete until
that process finishes. Reanalysis can also change other ratings as engine
evaluations improve; old category counts are not relabelled by guesswork.

Historical Arena records lacking grade data stay readable. Old five-category
Arena records cannot recover omitted Good moves from totals alone; those new
categories are shown as unavailable. Newly played matches record all eight.

Build the interface with `cd web; npm run build`. The existing Vela packaging
process includes the updated scoring module, opening book and built artwork.
This change prepares a local release; it does not publish or deploy one.

## Audit coverage

| Surface | Source of rating/count |
| --- | --- |
| Saved game review and coach verdict | Versioned saved move flags |
| Interactive review and board badges | Backend grade in review response |
| Arena live move list and totals | Shared classifier, per-player counts |
| Arena finished match totals | Sum of exclusive game tallies |
| Insights Your moves | Exclusive categories from each player's analysed moves |
| PGN and portable JSON | Shared classifier with saved evaluations/alternatives |
| Error drills, mistakes and blunder statistics | Existing error judgments, unchanged thresholds |

Asset QA preview: `art/.cache/review/grade-icons-light-dark.png` (local build
artifact). Rebuild the coins with `python art/build_assets.py grade-icons`;
the original sheet belongs at `art/source/review/grade-icons.png`.
