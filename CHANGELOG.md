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

