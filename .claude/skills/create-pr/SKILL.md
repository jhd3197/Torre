---
name: create-pr
description: Generate a pull request title and description from the commits on dev that main doesn't have yet. Produces a full-width summary, optional feature highlights, and collapsible technical details, written to .pr/YYYY-MM-DD.md.
---

# Create PR Description

Generate a pull request title and description that's scannable, informative, and has just enough personality to feel human.

In Torre, work happens on `dev` and `main` only takes merges from `dev` (see CONTRIBUTING.md), so a PR is **`dev` into `main`** unless the user names other branches.

## Instructions

### 1. Gather context (do ALL of these)

Run these commands to build a complete picture before writing anything:

```bash
# Make sure main is current, so the range is what the PR will actually contain
git fetch origin

# Commit overview
git log origin/main..dev --oneline --stat

# Full diff stat for file-level scope
git diff origin/main...dev --stat

# Actual code changes — read the diff, don't just skim filenames
git diff origin/main...dev
```

If the full diff is too large, diff individual areas in batches: the Python server (`torre/`), the interface (`web/src/pages`, `web/src/components`), styles (`web/src/styles`), locales (`web/src/i18n/locales`), content (`torre/content`). You must understand **what the code actually does**, not just which files were touched.

### 2. Write the PR file

Write the file to `.pr/YYYY-MM-DD.md` (using today's date). Create the `.pr/` directory if it doesn't exist (it is in `.gitignore`). If a file for today's date already exists, append a counter: `YYYY-MM-DD-2.md`, `YYYY-MM-DD-3.md`, etc.

The structure depends on whether the PR introduces user-facing features or is purely internal (refactors, bug fixes, infra).

#### When the PR has user-facing features:

~~~markdown
# <Title>

<4-6 sentence summary, as one paragraph on one line>

### Highlights

- Highlight 1
- Highlight 2
- ...

<details>
<summary>Technical changes</summary>

- Detail 1
- Detail 2
- ...

</details>
~~~

#### When the PR is purely internal (no user-facing features):

~~~markdown
# <Title>

<4-6 sentence summary, as one paragraph on one line>

<details>
<summary>Technical changes</summary>

- Detail 1
- Detail 2
- ...

</details>
~~~

Omit the Highlights section entirely for internal-only PRs — don't force it.

### Style Rules

#### Full-width text (never hard-wrap)
- **Every paragraph is a single line**, however long. Every bullet is a single line. Do not break prose at 72 or 80 characters the way commit bodies are wrapped; GitHub reflows the text itself, and a hard-wrapped body shows ragged lines in the rendered PR and in the merge commit.
- Blank lines separate paragraphs and sections, nothing else does.
- This applies to the summary, Highlights, Technical changes and the body passed to `gh pr create`. (Commit messages are the opposite: wrapped at 72. Don't mix the two up.)

#### Title
- **Write a normal, human title — NOT a conventional-commit prefix.** Name the PR the way you'd describe it to a teammate. **No `type(scope):`, no `feat:` / `fix:` / `chore:` lead-in, no square-bracket tags** in the title.
  - Good: `Make Torre feel like an app on phones` · `Cache the interface's images, fonts and sounds`
  - Bad: `feat(web): mobile layout` · `fix: cache headers` · `chore(deps): bump`
- Capitalize the first word like a sentence; imperative or plain-descriptive are both fine; no trailing period. Keep it under ~70 chars.
- The `# <Title>` line at the top of the generated file **is** the PR title — when the PR is eventually opened, that same string is the `gh pr create --title` value. Don't write a second, different headline.
- **Where the release weight actually lives (so you can safely keep it out of the title):** merging into `main` runs `.github/workflows/release.yml`, which bumps the version from the **commit messages** (`mathieudutour/github-tag-action`), not this title: a patch by default, `feat:` in a commit makes it a minor, `BREAKING CHANGE` a major. Put any bump intent in your **commits**; leave the PR title human.

#### Summary
- **4-6 sentences, one paragraph, one line.** This is the part people actually read — give it room to breathe.
- **Open with a touch of personality.** One line that makes the reader smile — a wry observation, a lighthearted remark, a playful metaphor. Not forced, just human. Examples of the energy (don't copy these literally, invent your own each time):
  - "This one's mostly about cleaning house."
  - "Turns out the type checker was right to complain."
  - A playful metaphor about what the code was doing wrong
  - A wry observation about the state of things before this PR
- **Match the tone to the change.** The voice should fit what the PR actually is — a bug fix can read dry and a little relieved, a new feature can read genuinely excited, a refactor can read like satisfying cleanup, a security fix should stay sober and matter-of-fact. Don't paste the same energy onto every PR; that's just a different kind of static.
- **Then explain what was going on and what this PR does about it.** Set the scene — what was broken, missing, or annoying? What's the approach? Name the main change areas but describe them in context, not as a dry list. The reader should walk away understanding the *story* of this PR, not just a changelog.
- **Include the "why" and the reasoning.** If there was a design choice, a trade-off, or a particular reason you went one way instead of another, mention it briefly. "We went with X instead of Y because Z" is the kind of thing that saves people from asking in review.
- **Do not repeat what Highlights or Technical changes already cover** verbatim, but it's fine to reference the same areas — the summary gives narrative context, the sections below give specifics.

#### Highlights (only when applicable)
- One bullet per user-facing feature, behavior change, or notable improvement.
- Write from the player's perspective — what they'll notice, not internal implementation.
- Plain language, no code references. "Phones get a tab bar instead of the menu drawer" not "`Layout` renders `TABS` when `usePhone()`".
- Keep the copy plain and short, like Torre's interface text (CONTRIBUTING.md).
- 3-7 bullets is the sweet spot. If you can only think of 1-2, fold them into the summary and skip this section.

#### Technical changes (inside the accordion)
- One bullet per discrete change. Be specific — name files, components, functions, settings, routes.
- Format: `backtick code references` for identifiers, plain text for descriptions.
- Every meaningful change in the diff must have a bullet. If a change touches security (the origin check, the sign-in gateway, path handling), caching, data on disk, error handling, accessibility, or concurrency, it gets its own bullet — do not bury these.
- Bullets should describe the mechanism, not just the intent. "`send_static` answers `If-None-Match` with a 304 against an ETag from size and mtime" is good. "Improve caching" is not.
- Mention new interface strings by namespace when they were added (they need both `en` and `es`).
- Group related changes together (all phone layout, all server, all styles, etc.)

#### Contributors
- If the PR includes commits from multiple authors (not just the repo owner), add a **Contributors** section after the summary and before Highlights.
- Use `git log origin/main..dev --format='%aN <%aE>' | sort -u` to find unique commit authors.
- Exclude bot accounts (e.g., `github-actions[bot]`, `dependabot[bot]`).
- Format: `@username` if their GitHub handle is available (check the ARGUMENTS or commit metadata), otherwise use their name. Add a brief note about what they contributed if it's clear from the commits.
- Keep it short — one line per contributor, no need for a full changelog.

#### General
- **No test plan section.** Do not include "Test plan" or "Testing".
- **No mention of tests.** Do not reference test files, test results, or testing.
- **No emoji.**
- **No "Generated by" footer.**

### 3. Stop after writing the file

This skill's job ends when the `.pr/` file is written. **Do not** run `gh pr create`, `gh pr edit`, `git push`, or any other remote-affecting command to actually open the PR — that's a separate, explicit step the user requests on its own. Print the path of the file you wrote and a one-line note that it's ready to review/copy.

When the user then asks to open it, use the file as is: the `# <Title>` line is `--title`, and everything after it is the body (`gh pr create --base main --head dev --title "<Title>" --body-file <file without the title line>`).
