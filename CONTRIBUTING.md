# Contributing

Thanks for helping with Torre. Lessons, translations, bots, bug fixes and ideas are all welcome.

## The branches

- **dev** is where work happens. Open pull requests against `dev`. Every push to `dev` publishes
  a pre-release to PyPI (`pip install --pre torre`).
- **main** only takes merges from `dev`. Each merge publishes the next release to PyPI and GitHub.

## Getting started

```powershell
git clone https://github.com/jhd3197/Torre
cd Torre
.\dev.ps1 setup        # .venv, Python and Node dependencies, first build
.\dev.ps1 art fetch    # the images (they are not in git)
.\dev.ps1              # the studio with live reload on http://127.0.0.1:5173
```

On macOS or Linux use PowerShell 7 (`pwsh ./dev.ps1 ...`), or the plain commands:
`pip install -r requirements.txt`, `npm --prefix web ci`, `python -m torre.server.studio`.

## Before you open a pull request

```powershell
.\dev.ps1 check        # Python tests, type-check, lint, UI tests, build
```

- Add a line to [CHANGELOG.md](CHANGELOG.md) under `## Unreleased` when players will notice the
  change. It becomes the release notes.
- Write the interface text in English in `web/src/i18n/locales/en/`; Spanish lives next to it in
  `es/`. Keep copy plain and short.
- Styles are SCSS with tokens (`web/src/styles/_tokens.scss`): no raw colours or sizes.
- Lessons are JSON in `torre/content/lessons/`; `python -m torre.tools.verify_lessons` checks
  their chess with Stockfish.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
