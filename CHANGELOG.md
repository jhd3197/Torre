# Changelog

Notable changes to Torre. Changes stay under Unreleased until a merge to `main` releases them:
the release workflow then stamps them with the version and date, and publishes that section as
the GitHub release's notes.

## Unreleased

### Added

- **AI players get engine-free tactical help by default.** Arena starts at Help level 1,
  with warnings about hanging pieces and replies that allow a fork or winning capture.
  Prompts include a board diagram, material balance, repetition notes and the player's
  previous reason and plan. Thinking defaults to High; streamed calls keep active long
  replies from spending the whole timeout waiting for a single response.
- **Settings › AI is now one place for every AI model Torre can use.** It shows what is ready:
  your Claude Code and Codex logins, Ollama and LM Studio on this computer, and every cloud
  service with a key, with prices and a Test button. Pick one default model, and optionally a
  different one for the coach's advice or for explanations and reviews. You can paste and check
  a key right on its service's card, and see what models have cost.
- **Use your Claude Code or Codex subscription as Torre's AI.** If either is installed and
  signed in, its models work with no API key and no extra bill.
- **Game reviews have three new grades: excellent, miss and forced.** Excellent is a move almost
  as good as the engine's. Miss means you let a chance go: a mate you had, or a slip by your
  opponent you did not punish. Misses go into your drills, puzzles and blind spots like
  mistakes. Forced is the only legal move, and it is never judged. Your games are graded again
  the next time they are analysed.
- **See how strongly each side played a game, in rating points.** An analysed game's review
  shows "Played like ~1650" under each side's accuracy, the after-game card against a bot says
  it for you and the bot, and the spoken recap says it too. It is an estimate from that one
  game, rounded to 50; when the game shows your rating it starts from there. Games shorter than
  15 moves that ended without a mate show "–".
- **Every reviewed game gets a report card by phase.** The opening, middlegame and endgame each
  get a grade for you and your opponent, with the accuracy and slips when you hover it. Tap a
  phase to jump to its first move. A phase with fewer than 3 moves shows "–".
- **The review tells the story of the game and why your good moves were good.** One line sums
  up the game (decided by one blunder, back and forth, in control, a close finish), and the
  coach says it in the recap. The summary shows where the game left the opening book and who
  left it, also marked on the evaluation graph. Great, brilliant, miss, forced and excellent
  moves now say why: "Only good move: the next best loses 25%", "You had mate in 3", "Almost as
  good as Nf3".

### Changed

- **A move that leaves a won game still won is no longer a blunder.** If you were at 90% or more
  before and after the move (or 10% or less, in a lost game), it counts as an inaccuracy at
  most. Letting a long mate go while staying far ahead used to show as a blunder.
- **Opening, middlegame and endgame now mean the same thing everywhere.** Insights and the game
  export split a game by the pieces left on the board, as the phase card does, instead of by
  move number. Your Insights by phase change once your games are analysed again.
- **API keys are shared with your other Prompture apps.** Keys now live in Prompture's private
  key file on this computer, so a key saved in Torre works in any app built on Prompture, and
  keys already set in your environment show up on their own. Keys you saved before move there
  the first time Torre starts. The coach's model becomes Torre's default model.

## 0.5.6 - 2026-10-13

### Added

- **AI models have their own ladder in the Arena.** Every model you pit against another, or
  against an engine, gets a rating with its 95% range, its record and what a game costs it. The
  same model at another help level or thinking setting is rated as a separate player. Play a
  model against Stockfish held to a rating to put it on the same scale as the engines.
- **Pick from the latest AI models of each provider.** The Arena's player picker now lists the
  newest Claude, GPT, Gemini, DeepSeek and Groq models, with their price, plus the models your
  Ollama runs. It says which providers still need a key, and only offers the thinking settings
  a model supports. You can still type any other model.

### Fixed

- **Matches between AI models count in the ladder.** They used to be filed as Stockfish against
  itself and left out.

## 0.5.5 - 2026-10-13

### Added

- **A star beside the Torre logo takes you to Torre on GitHub.** Starring it is free and helps
  more players find Torre. After a few days of play, a small card in the sidebar asks once;
  "Not now" puts it away for two weeks.

## 0.5.4 - 2026-10-13

### Added

- **Run Torre on Windows without installing it.** Each release now has a portable zip: unzip it
  anywhere, even on a USB stick, and run `Torre.exe`. It keeps your games and settings in the
  `home` folder beside it, so they travel with the folder. Releases also add an MSI for managed
  Windows computers and an `.rpm` for Fedora and openSUSE.

### Fixed

- **An AI match stops instead of playing a random move for a model that gave no answer.** When
  every try was cut off or unreadable, the arena used to move for it at random, which could
  decide the game. The match now stops so you can continue it, and models get twice the room
  to think before they answer.

## 0.5.3 - 2026-10-13

Maintenance release: no changes you will notice.

## 0.5.2 - 2026-10-13

### Added

- **Install Torre on macOS and Linux too, with one download.** Each release now has a
  Windows installer, macOS disk images for Apple silicon and Intel, and a Linux AppImage and
  `.deb`. They include their own Python and Stockfish, so there is nothing else to set up, and
  Torre opens in its own window and works offline. Your games stay in `~/.torre`, the same
  folder a `pip install` uses. The installers are not signed yet; the release notes show the
  one-time step Windows and macOS ask for.
- **`torre serve --until-stdin-closes`** stops the studio when its standard input closes. The
  desktop app uses it so the server and its engines never outlive the window.

### Changed

- **Release notes come from this changelog.** Each GitHub release shows its section here,
  followed by the downloads for each system and their checksums.

