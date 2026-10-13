# Changelog

Notable changes to Torre. Changes stay under Unreleased until a merge to `main` releases them:
the release workflow then stamps them with the version and date, and publishes that section as
the GitHub release's notes.

## Unreleased

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

