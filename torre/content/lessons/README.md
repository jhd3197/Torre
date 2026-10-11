# Lessons

Each `*.json` file here is one lesson in the Lessons page (`/lessons`). The
file name is the lesson's slug and URL (`knight-fork.json` → `/lessons/knight-fork`).
A lesson is data, not code: adding one needs no change to the app.

`lessons.py` checks every file when it loads. A lesson with an unknown step
kind, a missing field or an illegal move is left out of the list and reported
under `problems` in `GET /api/lessons`, and `tests/test_lessons.py` fails on it.

```json
{
  "version": 1,
  "title": "The knight fork",
  "summary": "One line for the lesson card.",
  "category": "tactics",
  "level": "beginner",
  "minutes": 5,
  "requires": ["opening-principles"],
  "orientation": "white",
  "steps": [ ... ]
}
```

- `category`: `basics`, `openings`, `tactics`, `checkmates`, `endgames`, `strategy` or `history`
  (the Lessons page shows them in that order, one unit each)
- `level`: `beginner`, `intermediate` or `advanced`
- `requires`: slugs of lessons to take first (shown as a suggestion, never a lock)
- `unit` (optional): a series inside the category, like `"Paul Morphy"` or `"London System"`.
  The path shows it as a heading; loose lessons come first, then each series.
- `order` (optional, default 0): the lesson's place within its unit. The units of a category
  appear in the order `lessons/units.json` lists them (history is chronological); unlisted
  units come after, by name.
- `practice` (optional): a puzzle theme slug (`puzzles.py` THEMES, like `"fork"`) offered
  as "Practise it on puzzles" when the lesson is finished.
- Videos are not set here: `content/videos.json` lists every channel video with the
  lesson it belongs to. Paste a video's YouTube link into its `youtube` field and that
  lesson's intro gets a **Watch the video** button, and the lesson joins the Videos
  shelf at the top of the library (a full review wins over a Short). It plays from
  `youtube-nocookie.com`.
- `orientation`: which side is at the bottom of the board for `explain` and
  `choose` steps (default `white`); a step can override it. `play` steps always
  show the side to move at the bottom.

Every step has a unique `id` (lowercase, dash-separated), a `kind` and an
optional `title`. Squares in `marks` are `["e4"]` for a circle and
`["e2", "e4"]` for an arrow.

No em dashes ("—") anywhere in lesson wording: use a comma, a colon or a full stop.
`torre/tools/clean_wording.py` rewrites them, and `tests/test_lessons.py` fails if one slips in.

Two optional fields turn the mascot into a teacher on any step:

- `narration`: 1-3 spoken sentences in the coach's voice. Plain English, no
  markdown, no UCI squares; say "knight to f3", not "g1f3". The recorded voice
  comes from the voice packs: `narrate.py` records every line the app speaks with
  a local Kokoro TTS server (one mp3 per sentence, named by a hash of its text),
  and `torre/tools/build_packs.py` zips them for download. Changing a line only means
  re-running `.\dev.ps1 narrate`; nothing is tied to step ids.
- `pose`: one of the mascot poses listed in `POSES` in `lessons.py`
  (`thumbs-up`, `detective`, `thinking`, `trophy`, ...). Pick one that fits
  the moment: `detective` for "find the move", `alarm` for dangers, `trophy`
  or `confetti` for the finish.

## Translations

English is the source. `translate_content.py` writes `lessons/<lang>/<slug>.json`
overlays holding only the text (same step ids, same `[move]` cue count); a lesson
without one, or a field without a translation, stays English. Re-run it after
editing English text; only changed strings are sent to the model.

## Extra voice lines

Quips and reactions the coach says outside a lesson's own text live in
`web/src/i18n/locales/en/voice.json` (for example `capture`, said after a clean
puzzle solve that takes a piece). To add one:

1. Add the English line to `voice.json`.
2. If the Spanish should not be a literal translation (a pun, a song line), put
   your wording in `translations/overrides/es.json`, keyed by the English text.
   Overrides always win over the model.
3. `.\dev.ps1 translate`, `.\dev.ps1 narrate`, `.\dev.ps1 packs publish`: only the
   new lines are translated and recorded, and installed packs show Update.

## Step kinds

### `explain`

A position with text. `demo` is an optional line of UCI moves the reader steps through.

When the step has a demo, write its `narration` with `[move]` cues where each
demo move should play: under autoplay the coach says the words before a cue,
the board plays that move (a capture flashes red) and holds it, then the coach
carries on. Say the move before its cue, so the words lead and the board
follows: `"White brings the queen out to g4. [move] Black's knight comes out
and hits her. [move] Now she has to move again. [move]"`. Moves without a cue
play after the last words; with no cues at all, the whole line is said first and
the demo plays after. Each piece is recorded on its own, so the move lands
between them.

```json
{ "id": "make-luft", "kind": "explain", "fen": "...", "text": "...",
  "marks": [["h7"]], "demo": ["d1d8", "g8h7"] }
```

### `play`

The reader finds the moves. `line` alternates the reader's moves and the
replies, so it starts and ends with the reader's move. The last move may list
alternatives (`"g7g6|d8e7"`), and any move that gives checkmate is accepted.
Any other move Stockfish rates as good as the lesson's is accepted too.
`success` is shown after the line.

Help is a ladder the reader climbs one rung per request, never forced on them:
`nudge` (optional, a general pointer such as "Look for a move that attacks two
things"; the page has a default), then `hint` (the specific clue), then the
piece to move is circled, then the move is drawn. A wrong move shows the reply
that answers it and why it fails, and "Show me on the board" plays it out.
After two misses the page offers the first rung by itself. Hard mode (Settings)
takes the ladder away.

`branches` are other whole lines from the same position, each with its own
`success`. Where the lines part at a reply, the opponent picks one, a line the
reader has not finished yet first, so "Try the other defence" shows the rest.
Use them for the opponent who does not play along: the defence to a trap, the
other way to answer a gambit.

```json
{ "id": "royal-fork", "kind": "play", "fen": "...",
  "prompt": "Use c7 to win a rook.", "nudge": "Look for a move that attacks two things.",
  "hint": "From c7 a knight attacks e8 and a8.",
  "line": ["b5c7", "e8d8", "c7a8"], "success": "Nc7+ forks king and rook.",
  "branches": [{ "line": ["b5c7", "e8e7", "c7a8"], "success": "The king steps up, the rook still falls." }] }
```

A finished lesson's `play` steps come back for spaced review in Train (drills.py),
and a category's placement check (coach_lessons.py `placement-<category>`) uses each
lesson's last `play` step, so make that one the exercise that proves the idea.

### `choose`

A multiple-choice question, with an optional position. Exactly one option is
`"correct": true`; `why` explains each choice once it is picked.

```json
{ "id": "quiz", "kind": "choose", "question": "...",
  "options": [{ "text": "...", "correct": true, "why": "..." }, { "text": "...", "why": "..." }] }
```

### `reel`

A game (or a segment of one) that plays itself like a video: the page shows a
transport bar with play/pause, a seek bar and a speed control, and `notes` as
subtitles that appear when their move is on the board. `fen` is optional and
defaults to the standard start position; `notes` are optional captions keyed
by ply (1 is the first move in `moves`).

```json
{ "id": "the-game", "kind": "reel", "title": "Paris, 1858", "text": "Setting the scene.",
  "moves": ["e2e4", "e7e5", "g1f3", "..."],
  "notes": [{ "ply": 19, "text": "The sacrifice that decides the game." }] }
```

### `guess`

Guess the move: a game (or segment) plays itself and stops before each move in
`guesses`. The reader finds it on the board; after two misses, or on request, an
arrow shows the game move. Takes everything a `reel` takes, plus:

```json
{ "id": "the-game", "kind": "guess", "title": "Paris, 1858", "text": "What to watch for.",
  "moves": ["e2e4", "e7e5", "..."],
  "guesses": [{ "ply": 33, "prompt": "Morphy finds a queen sacrifice. Where?",
                "hint": "The b-file is open.", "why": "16.Qb8+! drags the knight away.",
                "also": [] }] }
```

`ply` is the move to guess (moves 1 to ply-1 are on the board). `also` lists other
moves good enough to count as found; the game move is still the one played on.

## Game stories

`game_story.py` builds a guess lesson from a master game: `download_masters.py`
fetches the games (kept out of git), `game_story.py find` searches them,
`moments` lists the key moves Stockfish finds, and `skeleton` writes the lesson
with TODO text. Write every word yourself: moves are facts, but nobody's notes
or annotations may be copied.

## Mascot poses

`pose` must be one of `POSES` in `lessons.py`. Good defaults: `present` or `wave`
to open, `detective` or `magnify` for "find the move", `point`/`pointer` while
explaining, `alarm`/`nervous` for danger, `facepalm`/`sheepish` for a mistake,
`idea` for the takeaway, `trophy`/`confetti`/`clap` for the finish, `rival` for the
opponent's threat.

## Checking a new lesson

Run `.\dev.ps1 test`. It loads every lesson and fails on any problem. Then check
the chess with Stockfish: `python verify_lessons.py <slug>` fails when a move the
reader must find is clearly worse than the engine's choice, and warns when
another move is just as good (list it in `alternatives` or `also`, or pick a
clearer position) or when a reply is not the real defence.
