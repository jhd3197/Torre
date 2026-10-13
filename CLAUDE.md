# Torre: working agreement

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, setup and checks, and the README's
"Run from source" section for how the pieces fit.

## Changelog: part of finishing a change

Update `CHANGELOG.md` under `## Unreleased` in the same change whenever it affects players,
installation, compatibility, public documentation or contributor workflows. Each merge to `main`
releases: the release workflow stamps Unreleased with the version and date, and that section
becomes the GitHub release's notes, above the downloads. A missing entry ships a release that
says nothing.

- Use `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`,
  each once within the section.
- Write for the person playing: lead each entry with one bold sentence saying what they can do
  now or what behaves differently, then a sentence or two of detail and any action they must take.
  Plain, short words, like the interface text.
- Group related work into one useful entry. If an unreleased entry already covers the change,
  update it instead of adding another.
- Do not write a transcript of the work, implementation steps, test results or plans. A purely
  internal refactor may skip the changelog; say so in the commit or PR.
- Never write a version number or date into the changelog by hand, and never invent contributors
  or results. A version bump or local build is not a release.

`python -m torre.tools.changelog stamp <version>` and `notes <version>` are what the release
workflow runs (`.github/workflows/release.yml`); `tests/test_changelog.py` covers them.

## Releases and installers

A merge to `main` publishes to PyPI, the Docker image, and the desktop installers for Windows,
macOS (Apple silicon and Intel) and Linux (`.github/workflows/desktop.yml`), then publishes the
GitHub release. The installers bundle a standalone Python and Stockfish
(`desktop/scripts/build_runtime.py`, pinned by checksum); bump those pins there.
