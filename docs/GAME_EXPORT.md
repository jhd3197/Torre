# Torre game export, version 1

Select **Export game data** in Games or Play to download a `.torre.json` file.
It is UTF-8 JSON: readable in a text editor and usable by Python, JavaScript,
spreadsheets with a JSON importer, or future analytics tools. The original PGN is
included under `game.pgn`; **Export PGN** remains available for chess software.
Torre's import screen does not yet import this custom format.

The envelope has `format: "torre-game"`, `version: 1`, a UTC `exported_at`, and
three categories. Consumers should check the version before interpreting fields.
All three move lists join on `ply`, a one-based index from the starting position.
`move_number` follows the FEN and can start at a number other than 1.

| Category | Saved information | Questions it can help answer |
| --- | --- | --- |
| `game` | PGN, headers, initial/final FEN, UCI/SAN moves, positions before/after each move, color, phase, check, capture, legal move count | Where did trouble occur? Was the player responding to check? Which positions should become drills? |
| `timing` | Elapsed time, remaining clock, measurement source, partial-observation flag, sample counts and summaries by color/phase/source | Were mistakes played quickly? Where was the thinking time spent? |
| `quality` | Evaluations, loss in centipawns and winning chances, per-move accuracy, judgment, brilliant tag, engine's preferred move | Which decisions cost the most? Which phase needs practice? |

## Timing meanings

Times are integer milliseconds. `elapsed_ms` has one of three sources:

- `pgn_emt`: the PGN explicitly records elapsed move time (`[%emt]`).
- `clock_delta`: inferred from consecutive clocks for the **same player**, plus
  the increment. Only simple controls such as `300` or `300+2` are supported.
  A missing clock breaks the chain; negative deltas remain unknown. The first
  move's time is inferred from the initial clock only for the standard start.
- `ui_active`: observed time from when the human's turn is ready in Play until
  move submission. Hidden tabs, replay, and requests pause the timer. This is
  time with the board visible, not proof that the player was concentrating.
  Bot response latency is not recorded as human thinking time.

Play saves these observations alongside the game in browser storage. Existing
moves cannot acquire timing retroactively. The first observed turn after opening
or resuming Play is partial because its true start is unknown. Interrupted turns
are also partial; they remain in the file but are excluded from timing summaries.
New games/rematches begin with no recorded timings.

`reaction_ms` is reserved and is always `null` in version 1. Exact reaction time
to the position is not measured. `reaction_time_available` is therefore `false`.
Unknown timings are `null`, never invented zeroes. A recorded zero is valid.

The summaries separate White/Black and each timing source. They include sample
counts, mean, median, and maximum elapsed time. `fast_threshold_ms` is 2000:
`fast_blunders` counts analyzed blunders at or below that threshold;
`fast_analyzed_count` is its denominator. With no qualifying analyzed moves the
count of fast blunders is `null`. This is descriptive, not evidence that speed
caused a mistake. Compare multiple games and adequate sample sizes before drawing
conclusions.

## Quality and context meanings

Quality is included only when saved archive analysis has the current scoring
version and a complete evaluation timeline. Export never starts an engine.
Live Play exports currently have unavailable quality; a review shown in the
interface is not necessarily saved archive analysis. Unavailable analysis is
explicit (`available: false`, `analyzed: false`, numeric values `null`), not 100%
accuracy or zero mistakes. Saved evaluations cover both sides.

Evaluations are from White's perspective; positive values favor White. `cp` is
centipawns, while `mate` is a signed engine mate distance. Existing archive
checkmate sentinels (`cp` +/-100000) are retained. Loss and move accuracy use the
mover's perspective and Torre's existing scoring rules. Centipawn loss clamps
ordinary scores to +/-1500 and maps mate scores beyond that range, matching the
archive's ACPL scale. `win_chance_loss` is a drop in percentage points, not an
empirical probability that a particular player will win.

`judgment: null` means no error classification only when `analyzed` is true.
`grade` is the exclusive category used in the app: `brilliant`, `great`, `best`,
`good`, `book`, `inaccuracy`, `mistake`, or `blunder`. The additive `great` and
`book` flags retain detection/provenance; an error takes priority over Book in
`grade`. Brilliant takes priority over Book, followed by Book, Great, Best, Good.
Checkmating moves are Best or Great rather than Book. Great requires a runner-up
evaluation; missing alternative evidence never produces a Great label. These
fields are null when quality is unavailable. See RELEASE_NOTES.md for the rules.
When a preferred move is unavailable, `best_uci` and `played_best` are both null.
Quality summaries report analyzed sample counts; their mean centipawn loss is
not game accuracy.

Phase uses the existing archive heuristic: moves 1–10 opening, 11–30 middlegame,
31 onward endgame. The file records this method explicitly; it does not infer a
material-based endgame. Legal move count is a factual position feature, not a
measure of difficulty. `capture` includes en passant.

## Endpoints

- `GET api/games/{id}/export`: download an archived report, with an attachment
  filename ending in `.torre.json`.
- `POST api/export`: export the live line using `initialFen`, UCI `moves`, allowed
  PGN `headers`, `playerColor`, and optional `timings`. Responds with `filename`
  and `report`. Requires the same JSON and `X-Chess-Studio: 1` headers as other
  local write requests. This request generates a report without modifying the archive.

Live timing entries include `ply`, `uci`, `elapsed_ms`, `source: "ui_active"`,
and a boolean `partial`. Duplicate/out-of-range plies, mismatched moves, negative
or non-finite times are rejected.
