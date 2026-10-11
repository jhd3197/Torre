<p align="center">
  <img src="https://raw.githubusercontent.com/jhd3197/Torre/main/.github/logo.png" alt="Torre" width="128" height="128">
</p>

<h1 align="center">Torre</h1>

<p align="center"><a href="https://torre.sh"><b>torre.sh</b></a>: learn chess step by step, play, replay and explore.</p>

Torre is a local Python web app for playing Stockfish, replaying games,
exploring positions, and reviewing your chess history. Its interface is a React
app (in `web/`), served ready-built by the Python server.

## Install

```bash
pip install torre              # or: pip install "torre[coach]" for the AI coach
torre serve --open-browser
```

Torre needs [Stockfish](https://stockfishchess.org/download/) for play and analysis: put it on
your PATH or set `STOCKFISH_PATH`. Your games and progress live in `~/.torre` (set `TORRE_HOME` to
move them). `torre doctor` checks everything.

## Run from source

Start it from this folder after setup:

Double-click **start-studio.cmd** to start the server and open your browser, or run:

```powershell
.\dev.ps1 serve        # builds the interface if it changed, then starts the studio
```

Open **http://127.0.0.1:1886** (the year of the first World Championship). If the port is occupied, pass `--port 1887`.

- **Home:** the default landing screen shows archive statistics, a chart of the
  latest 20 analyzed games, a position to revisit, and five recent games. Continue
  restores your saved Stockfish game only when selected. Review and Explore open
  actual archived games and positions. Statistics label their sample sizes;
  missing analysis has an empty state or a retry action. The featured position is
  the most recent blunder among the archive's twelve largest recorded mistakes.
- **Every screen has its own address**, so reloading, bookmarking and the browser's
  Back button all work:

  | Address | Screen |
  | --- | --- |
  | `/` | Home |
  | `/play`, `/play/bots` | your game against Stockfish; choosing a bot |
  | `/games/<id>/<move>` | a saved game, at a move (`/games` opens the latest) |
  | `/explore?moves=e2e4,e7e5` | a free board; the whole line is in the address |
  | `/train` | drills from your mistakes |
  | `/puzzles/<theme>/<id>` | rated puzzles by theme (`mixed`, `missed`); `/puzzles` is the overview |
  | `/coach` | saved practice plan, task progress, and daily XP |
  | `/coach/progress/<section>` | overview, openings, learn, blunders |
  | `/coach/learn` | links to the app's learning centers |
  | `/insights/<section>` | legacy direct access to the same stats |

- **Puzzles:** about 4,500 puzzles from the Lichess puzzle database (CC0) in 20
  themes: checkmates (mate in 1–3, back-rank, smothered), tactics (forks, pins,
  skewers, discovered attacks, deflection, sacrifices and more) and endgames. Your
  opponent's move sets each puzzle up, then you find the line. A wrong move, a hint
  or showing the solution counts as a miss; only the first try at a puzzle moves
  your puzzle rating, and new puzzles are picked near it. Every attempt is kept
  with the wrong moves you tried, per-theme first-try rates show your weakest
  themes, and missed puzzles wait in a retry list until you solve them cleanly.
  Progress is saved in `data/puzzles.json`. To rebuild the packs from a newer
  database: `pip install zstandard`, then `python -m torre.tools.import_puzzles` (downloads
  ~300 MB once into `data/`).
- **Game library:** search and filter your saved games, click a game to replay it,
  step through its moves, or use autoplay. Moves in analyzed games are marked
  with eight ratings: `!!` Brilliant, `!` Great, Best, Good, Book,
  `?!` Inaccuracy, `?` Mistake and `??` Blunder. Arena, saved and interactive reviews,
  exports and Insights use the same classification. Each move counts once in
  **Your moves**; older analyses show their update coverage until reanalysis finishes.
  Excellent is included in Good in this eight-rating release. Moving a piece in a
  replay opens Explore with that move played.
  Reviews recognize openings and variations from the actual board positions using
  a bundled [Lichess opening index](https://github.com/lichess-org/chess-openings)
  (CC0), including transpositions. The opening name, played move order and a jump
  to its position work offline without an AI model. The optional AI review also
  receives that opening context and general family ideas to discuss the player's
  choices before the turning points. Unrecognized positions are left unnamed;
  recognition alone never labels a move good, bad or a theoretical novelty.
  Rebuild the pinned index with `.venv/Scripts/python -m torre.tools.build_opening_book`.
  **Export PGN** downloads the game annotated in the format Lichess and chess.com
  import: a `[%eval]` comment on every move, `?!` / `?` / `??` / `!!` marks, and the
  engine's move as a variation for each mistake. Clock comments are kept.
  **Export game data** downloads a versioned `.torre.json` file with three
  categories: game context, timing, and decision quality. It includes per-move
  positions, available clock/elapsed times, saved evaluations, and summaries by
  player and phase. Play also offers this export and records active human
  thinking time from now on. Missing data stays unknown; interrupted observations
  are marked partial. See [the format reference](docs/GAME_EXPORT.md) for timing
  definitions, analytics fields, and current limits.
- **Analyze all:** Home, Insights and Train show how many archived games are not
  analyzed yet (or use older scoring) and run `torre/analysis/analyze.py` on them in the
  background, with progress and a Stop button. Insights refresh when it finishes.
- **Train:** every mistake and blunder from your analyzed games becomes a drill:
  the position before your move, to answer with a better one. The engine's move or
  any move it judges no worse than an inaccuracy counts as solved. Reviews are
  scheduled with FSRS (the open algorithm Anki uses): missed positions return within
  minutes, solved ones after growing intervals. Ten new positions are added a day.
  Progress is saved in `drills.json` beside your analysis.
- **Play:** the bot lobby matches the supplied “Torre New Game” design,
  with searchable cards, category/rating filters, and a game setup panel. Choose
  Stockfish, White/Black/Random, and a skill level, then start an
  untimed game. Click or drag pieces; legal moves, check, promotion, and game endings
  are handled by `python-chess`. **Back to game** preserves your current session.
  The reference's personal, seasonal, and character bots (and other engines) are
  labelled design previews. Training, clocks, opening setup, and ladder results
  are not connected; the interface does not simulate those features or records.
- **Explore this position:** open a separate copy of your current board and try
  moves for both sides. Your live game pauses and its saved moves stay intact.
  **Back to game** (or **Back to replay**) restores the source board; **Reset line**
  restarts just the exploration.
- **Plan on the board:** right-drag to draw legal move arrows, with L-shaped
  knight paths. Each arrow describes this position independently, including
  possible moves for either side; it does not simulate a sequence. Illegal paths,
  blocked moves, and moves exposing the mover's king are rejected. **Freeform**
  allows dashed notes from empty squares; it never permits illegal piece moves.
  Right-click for circles, repeat a drawing to remove it, or use **Clear** / **Esc**.
  **Draw arrows** supports two taps on mobile. Drawings rotate with the board.
- **Square control:** Explore can tint squares by White's attacks (green),
  Black's attacks (coral), or both (striped gold). Uncolored squares are unattacked.
  Hover or focus a square for its attackers. This includes pinned attackers and
  defended friendly pieces: control is not a guarantee that a move is safe.
- **Automatic analysis:** in Games and Explore, Stockfish analyzes every position
  as you step through it: the evaluation bar, its top three lines and an arrow for
  its best move update on their own. **Analysis on/off** and **Show/Hide best move**
  are remembered. Pending analysis is striped, never shown as an even position.
  Positive scores favor White. Play has no engine help.
- **Castle:** move the king two squares, drop the king onto its rook, or drop
  the rook onto its king. Only legal castles are accepted; available partner
  squares are highlighted when selected.
- **Import PGN:** paste game notation, including games with a custom starting FEN.
- Use **left/right arrows** to navigate, **F** to flip the board, and **FEN** to
  copy the current position.
- **Insights:** Overview includes progress, results, phase analysis, and
  opponent/color breakdowns; Openings, Learn, and Blunders retain the existing
  analysis. Replay and Explore links open games and positions on Studio's board.

`torre/server/studio.py` is a loopback-only Python HTTP server using the existing virtual
environment and Stockfish installation. It serves the built interface from
`studio/ui/`, which `dev.ps1` builds from `web/` (it is not committed). Games and
analysis stay local. Google Fonts are optional; local fallback fonts work offline.
Your latest game against Stockfish is saved in this browser automatically; select
**Play → Back to game** to resume it after returning. **Start game** replaces this saved session.
Imported PGNs and exploration branches are temporary. None of these modify the archive.
The app automatically treats claimable repetition and fifty-move draws as drawn.

### Command line (`torre`)

Use `.\torre.cmd` from PowerShell after setup. The launcher selects this project's
virtual environment automatically. With that environment activated, you can also
run `python -m torre` from the project folder on Windows, macOS, or Linux.

```powershell
.\torre.cmd doctor
.\torre.cmd import "games.pgn" --username YourPlayerName
.\torre.cmd analyze --limit 20
.\torre.cmd report
.\torre.cmd coach
.\torre.cmd serve --open-browser
```

| Command | What it does |
| --- | --- |
| `import FILE [--username NAME] [--dry-run]` | Import PGN games, skipping duplicates. Repeat `--username` for multiple names; omit it to use accounts and aliases saved in the app. An explicit name overrides saved names for this import. |
| `analyze [--limit N] [--depth 12] [--threads 8] [--no-mine]` | Analyze pending games using the existing Stockfish pipeline, then mine personal puzzles. A limit of 0 means all pending games. Completed analyses are reused on the next run. |
| `report [--output FILE]` | Write the existing mistakes report to `report.md` in the selected data folder, or to the specified file. |
| `coach [--ask] [--lang en\|es] [--model MODEL] [--force]` | Print the local coaching brief as JSON. `--ask` uses the configured AI model and shared advice cache; `--model` and `--force` require `--ask`. |
| `serve [--port 1886] [--open-browser] [--proxied] [--allow-host NAME]` | Start the same local web server. It answers only IP addresses and local names (`localhost`, `.local`, `.lan`); `--allow-host` adds a domain, such as a proxy's. Build the interface first with `.\dev.ps1 build` or `npm --prefix web run build`. |
| `narrate [--lang en\|es] [--gender female\|male] [--force] [--list]` | Record the coach's voice packs into `dist/voice` with a local Kokoro server (`KOKORO_URL`), loudness-normalized with ffmpeg. Needs a source checkout; `.\dev.ps1 narrate` records both voices. |
| `doctor [--json]` | Check Python, dependencies, Stockfish discovery, data paths, and the built interface. Engine discovery checks the binary's path, without launching it. Missing optional features are warnings. |

Every command accepts `--data-dir PATH` before or after its name. The default is
`CHESS_STUDIO_DATA` when set, otherwise this project's `data/`, matching the
standalone web app. Input files, report output paths, and explicit relative data
paths resolve from your terminal's current directory. Stockfish uses the app's
existing discovery, including `STOCKFISH_PATH`. Coaching uses the same
`settings.json`, `CHESS_COACH_MODEL`, and local-model fallback as the app.

```powershell
.\torre.cmd import "games.pgn" --username YourPlayerName --dry-run
.\torre.cmd analyze --data-dir "D:\Chess Archive" --depth 14 --no-mine
.\torre.cmd coach --ask --lang es
.\torre.cmd analyze --help
```

Exit codes are **0** for success (including an empty archive or nothing pending),
**1** for an operation failure or failed required doctor check, **2** for invalid
command syntax, and **130** for Ctrl+C. Partial imports keep valid games and
return 1 with failures on stderr. `--dry-run` writes nothing. The original Python
scripts and `dev.ps1` remain available for existing workflows.

### Development (`dev.ps1`)

The interface is React + TypeScript, built with Vite, in `web/`. Everything runs
through `dev.ps1`; nothing needs building or restarting by hand:

| Command | What it does |
| --- | --- |
| `.\dev.ps1` | studio API on :1886 + the UI with live reload on **http://127.0.0.1:5173**; the API restarts when a `.py` file changes |
| `.\dev.ps1 serve [-Open]` | rebuild the UI only if `web/` changed, then run the studio on :1886 |
| `.\dev.ps1 validate` | watch Python and `web/`; type-check, test and build on every save (`validate once` runs them once) |
| `.\dev.ps1 test` / `test-web` | Python tests / UI tests (Vitest) |
| `.\dev.ps1 check` | everything: Python tests, type-check, UI tests, build |
| `.\dev.ps1 setup` | `.venv`, Python and Node dependencies, first build |
| `.\dev.ps1 analyze <args>` | `python -m torre.analysis.analyze`, e.g. `.\dev.ps1 analyze --limit 20` |
| `.\dev.ps1 release` | `check`, then package the Vela app |

Options: `-Port 1886`, `-UiPort 5173`.

## Run it in Vela

Torre also ships as a [Vela](https://github.com/jhd3197/vela) app, the
first in the **games** category. Build the package:

```powershell
.\dev.ps1 release
```

This writes `dist/chess-<version>.zip` and its `.sha256`. Import the ZIP from
Vela's Library. The package bundles `python-chess` (GPL-3.0, license included),
so Vela needs only Python on the server computer, not pip. Vela serves the app at
`/apps/chess/` and strips that prefix before forwarding. Every page the studio
serves carries a relative `<base href>` pointing at the app root, so clean addresses
such as `/apps/chess/games/12/30` work there with no configuration. `release` runs
every check and builds the interface before packaging.

- **Data:** in Vela, games and analysis are read from `~/.vela-games/chess`
  (`games.jsonl`, `analysis.jsonl`). Standalone runs keep using `data/`. Use
  `--data-dir` or `CHESS_STUDIO_DATA` to point either one elsewhere.
- **Stockfish:** it isn't bundled by default because it is ~110 MB. The app
  checks `STOCKFISH_PATH`, then a packaged `engine/` folder, then
  `stockfish_dist/`, then `stockfish` on PATH. To bundle it, run
  `python -m torre.tools.release_vela --stockfish PATH-TO-BINARY`.
- **Manifest:** `vela-app/app.json` and `vela-app/icon.svg`. Bump `version`
  there for each release.

Downloads your chess.com games (including **bot games**, which the official API
doesn't expose), analyzes every one of your moves with Stockfish, and reports
what's actually costing you games.

## Setup

You need Python 3.11 or newer, Node.js 20 or newer, and Stockfish for engine play
and analysis. Clone the repository and open a terminal in it.

**Windows** (PowerShell):

```powershell
winget install --id Stockfish.Stockfish   # or download it from stockfishchess.org
.\dev.ps1 setup
.\dev.ps1 serve -Open                     # or double-click start-studio.cmd
```

**macOS / Linux**, with [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)
so `dev.ps1` works the same:

```sh
brew install stockfish        # or: sudo apt install stockfish
pwsh ./dev.ps1 setup
pwsh ./dev.ps1 serve -Open
```

`setup` creates `.venv`, installs the Python and Node dependencies, downloads the
app's images from the art release, builds the interface and downloads the legends'
games the historical bots play from. Then open **http://127.0.0.1:1886/**.

Without PowerShell, the same steps by hand:

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm --prefix web ci && npm --prefix web run build
# the images: unzip art-built.zip from the art release into web/public/
.venv/bin/python -m torre.games.download_masters
.venv/bin/python -m torre.server.studio --open-browser
```

The app finds Stockfish through `STOCKFISH_PATH`, then `stockfish_dist/stockfish/`,
then `stockfish` on your PATH; `.	orre.cmd doctor` (or `python -m torre doctor`)
shows what it found. Replay, PGN import, lessons and board exploration work without
it; engine play and analysis need it.

A fresh clone has an empty game library. Import a PGN in **Games**, or follow the
export workflow below to add your own history. The AI coach is optional: it uses a
local [Ollama](https://ollama.com) model, or a hosted model you pick on the coach
card (such as `openai/gpt-4o-mini`) with your own API key.

The optional literature downloader uses `requirements-books.txt`; install it with
`pip install -r requirements-books.txt` inside your environment before running
`torre/tools/download_books.py`.

## What is kept local

`.gitignore` excludes personal game data and reports, browser profiles and cookies,
downloaded books, Stockfish binaries, virtual environments, environment secrets,
and local investigation scripts. These files remain on your computer. The
repository contains the application, scripts, and tests.

Bot cards marked as previews contain illustrative data, not trained models.

GitHub hosts the source code. Running the app requires the Python server;
GitHub Pages alone cannot run its chess and Stockfish APIs.

## Layout

| folder | what is in it |
|---|---|
| `torre/` | the Python app, one package (see below); `torre/content/` holds its data: lessons, puzzle packs, catalogs and the Spanish text |
| `web/` | the React interface (pages in `web/src/pages`, the board in `web/src/components`), built into `torre/ui/` |
| `tests/` | the Python tests: `.\dev.ps1 test`, or `.\dev.ps1 test tests.test_coach` for one file |
| `vela-app/` | the Vela app manifest and icon |
| `docs/` | reference: the game export format |

Inside `torre/`:

| folder | what it does |
|---|---|
| `server/` | the studio's HTTP server (`python -m torre.server.studio`), its routes and API modules, the data folder, background jobs |
| `analysis/` | Stockfish and other engines, per-move analysis and grades, motifs, stats, Insights, reports, PGN and game exports |
| `coaching/` | the coach: its plan, the skills it tracks, the lessons it writes, and the AI it writes with (`coach_ai.py`) |
| `learning/` | lessons, puzzles, drills, openings, endgames, the story, awards and voice packs |
| `games/` | imports from chess.com and Lichess, the legends' games, the engine arena |
| `content/` | the data the app ships with |
| `tools/` | maintainer tools, `python -m torre.tools.<name>`: puzzle import, the opening book, translations, voice packs, the Vela release |
| `cli.py` | the command line: `python -m torre` or `.\torre.cmd` (serve, import, analyze, report, coach, doctor) |

The images are not in git: `.\dev.ps1 art fetch` downloads them from the art release.

## Full run

1. **Import your games:** on the Import page, give your chess.com or Lichess username (public games),
   or drop PGN files. From the command line:
   ```powershell
   .\torre.cmd import my-games.pgn --username YourPlayerName
   .\torre.cmd analyze --depth 12   # ~1-2 min per 20 games
   .\torre.cmd report
   ```

2. Read `data/report.md`.

## What the report tells you

- **ACPL** (average centipawn loss per move): lower is better; ~50 is solid at club level
- **Blunders / mistakes / inaccuracies** per game, judged as Lichess does by the drop in winning chances (a drop of ≥0.3 / ≥0.2 / ≥0.1 on its −1…1 scale), plus **Best** (engine move) and **Brilliant** (a sound sacrifice, see `torre/analysis/scoring.py`)
- **Accuracy** per game with Lichess's formula (`accuracy`; chess.com's own figure stays in `user_accuracy`)
- Which **game phase** leaks points (opening / middlegame / endgame)
- Per-**opponent** and per-**color** breakdowns, monthly **trend**
- Your 15 **biggest blunders** with replay links

## Notes

- Everything is resume-safe: re-running skips games already downloaded/analyzed.
- Be polite: the scripts use ~0.35s delays between requests.

## Curated chess reading library

[`content/chess-library.json`](content/chess-library.json) is a starter catalog of
25 books, grouped by topic and suggested reading level. Each entry includes a
recommendation, a reading exercise, the inspected edition and notation, scan
notes, an Archive link, and the local PDF path. `start_here.pdf_page` is a
one-based PDF page number, not the printed page number.

The suggested first path is Capablanca's *Chess Fundamentals*, Emanuel Lasker's
*Common Sense in Chess*, Edward Lasker's *Chess Strategy*, Sergeant's *Morphy's
Games of Chess*, and Znosko-Borovsky's *The Middle Game in Chess*. Separate paths
cover planning, endgames, and learning through complete games. Topic mappings
are editorial recommendations for future coach integration, not an active app
feature.

All 25 local PDFs were opened and sampled. Ten Archive item pages showed PDF
downloads; the other fifteen online checks were inconclusive. The catalog
distinguishes this from local availability. It is not a complete Archive index,
and sampled inspection does not establish that every page of a scan is present.
Downloaded files remain in the ignored `books/` folder.

## License

Torre is free software under the [GNU General Public License v3.0](LICENSE), the
license of Stockfish and `python-chess`, which it builds on. The puzzles and the
opening index come from the Lichess databases (CC0).
