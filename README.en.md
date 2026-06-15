# PRecap

[Français](README.md) · **English**

PRecap gives you, **with a single command**, a recap of your GitHub activity for a given day - merged / opened / fixup / touched PRs - as a web page. Everything is **local**, **AI-free** and **server-free**: it reads your PRs via the `gh` CLI and generates a self-contained HTML file you open in your browser.

![stack](https://img.shields.io/badge/stack-Vite%20%2B%20TypeScript%20%2B%20Tailwind%20v4-blue)

> [!IMPORTANT]
> **PRecap accesses GitHub read-only, through your `gh` - nothing else.** It only **reads** PRs/commits; it **never** writes, merges, pushes or deletes anything. No token is stored in the project: it's your `gh` (already signed in on your machine) that carries the authentication.

## Install (once)

```bash
git clone <repo> && cd precap
nvm use          # Node ≥ 20 (cf. .nvmrc → 24; the machine default is often too old)
npm install
```

**Requirement**: the [`gh`](https://cli.github.com/) CLI installed and signed in.

```bash
gh auth login    # once; then check with `gh auth status`
```

## Usage

The command is **`npm run report -- --repos <your repos>`**: it classifies your activity for the day for those repos and opens the report in the browser. You **always** pass your repos - the simplest is to bake them into a shell function (below).

> 💡 **Recommended: a shell function** (in `~/.zshrc` / `~/.bashrc`) that bakes in your repos and leaves you in your current directory:
> ```bash
> precap() { ( cd ~/path/to/precap && npm run report -- --repos acme/web,acme/api "$@" ); }
> ```
> Then just **`precap`** (or `precap 2026-06-10`, `precap --force`). The `( … )` subshell runs the `cd` without changing your current directory, and `"$@"` forwards your arguments (which a plain `alias` can't do). To change repos: edit the function.

### Examples

```bash
# The recap of the last business day (Friday if it's Monday, else the day before)
precap

# A specific day
precap 2026-06-10

# Recompute a day already generated (e.g. after a late rebase/merge)
precap --force

# Write the report somewhere other than dist/report.html
precap -o /tmp/recap.html

# Without the function: pass --repos every time
npm run report -- --repos acme/web 2026-06-10
```

### Good to know

- **The report is frozen**: a day already generated is not recomputed (unless `--force`). No need to re-generate a day you've already done.
- **If something's off** (misspelled repo, no access, or `gh` not signed in): a clear message in the terminal, the offending repo is skipped, the others still go through.
- **In the page**: you can **filter the display by repo** (the chips at the top) and **switch the language FR/EN**. Nothing else - it's a report, not an interactive dashboard.
- **The file is self-contained**: `dist/report.html` embeds everything (HTML + CSS + data). You can reopen it offline (`file://`) or send it as-is.
- **Everyone sees their PRs**: the report uses your `gh` auth, so nobody shares a server or data.
- Extra options: `--no-build` (skip the rebuild), `--no-open` (or `PRECAP_NO_OPEN=1`, don't open the browser).

---

## Going further

### GitHub authentication (`gh`)

- A signed-in `gh` is enough: **no `.env`, no token in the project**. The script shells out to `gh`, which carries the auth itself.
- Check it: `gh auth status` - shows the account, the scopes and **where** the token is stored.
- **Recommended token**: a read-only fine-grained PAT (GitHub → *Settings → Developer settings → Fine-grained tokens*, permission **`Pull requests: Read-only`**, + `Contents: Read-only` for private repos), limited to the relevant repos. No write permission is needed.
- **Machine without `gh auth login`** (another box, CI…): export `GH_TOKEN=<PAT>` - `gh` natively honors this variable.
- **Node ≥ 20** (cf. `.nvmrc` → 24). A guard (`scripts/check-node.mjs`) cleanly blocks commands if Node is too old - remember `nvm use`.

### Which repos? (stateless)

- PRecap is **stateless**: repos come **only** from `--repos`. No config file, no remembered list - what you pass is what you get.
- To change your list: **edit your `precap` function** (that's the only place it lives).
- The report shows only the repos you passed; the chips only toggle on-screen visibility.
- `data.js` (local, gitignored) caches days already classified - just an optimization, independent of the repo list.

### Language (FR / EN)

Bilingual report. By default the **browser** language; the **FR / EN** selector (top right) forces the choice, remembered (`localStorage`) **only if it differs** from the browser. Labels are translated **at display time** (`src/i18n.ts`), so switching language requires **no regeneration**.

### How it works (under the hood)

```
                         npm run report
                               │
            ┌──────────────────┼───────────────────┐
            ▼                  ▼                    ▼
   ┌─────────────────┐   ┌───────────┐    ┌──────────────────┐
   │ scripts/lib.ts  │   │ vite build│    │  api.github.com  │
   │ (classification)│   │  (dist/)  │    │   via gh CLI     │
   └────────┬────────┘   └─────┬─────┘    └──────────────────┘
            │ writes data.js   │ bundle + CSS         ▲
            └──────────┬───────┘                      │ reads PRs/commits
                       ▼                              │
            dist/report.html  ◀──── inline (bundle + CSS + data) ──┘
            (a single file, openable via file://)
```

`npm run report` builds the bundle (`vite build`, ≈ 100 ms), classifies the day via `gh`, writes the data into `data.js`, then inlines everything into a self-contained `dist/report.html`. The render is **static**: once generated, the HTML no longer queries anything.

> To iterate on the UI: `npm run dev` serves the bundle against the existing `data.js` (no `gh`, no regeneration).

### Where does the «Jira» info come from?

**From no Jira call.** The ticket shown under a PR is inferred from its GitHub metadata. Detection is **generic** (key `PROJ-123`, any project/host):

- **first Jira link in the body** - `[label](https://<host>/browse/KEY)`, any host - = the displayed subject (key + label);
- otherwise, fallback to a **ticket key in the branch name** (`feature/PROJ-123-…`);
- no ticket found → **nothing displayed**.

It's a heuristic on the PR-writing convention - if the body lies, the recap lies.

### Classification rules (per Paris day, priority order)

| Bucket | Rule |
|---|---|
| **Merged** | `mergedAt` falls on this day (displays the target branch `baseRefName`; badge `modified + merged` / `rebased + merged` if the branch also received content that day, otherwise a plain merge) |
| **Opened** | `createdAt` falls on this day, not merged the same day (**your PRs only**) |
| **Fixup** | pre-existing PR, **real git activity** that day: commit committed that day (`push`), or `head_ref_force_pushed` without new content (`rebase`) |
| **Touched, not pushed** | **your PRs** updated that day **without any push** (label, review, comment…) |

A PR appears in only one bucket.

> **Other people's PRs.** On PRs **opened by someone else**, only **your** actions show up - a **merge** you clicked, or **commits / force-pushes** you made that day - with a "**PR opened by @author**" banner. No "Opened" or "Touched, not pushed" bucket for other people's PRs.

### Data retention

- **90-day sliding window** (`KEEP_DAYS`, `scripts/lib.ts`): on every generation, days older than `today − 90 days` are purged from `data.js`, for all repos.
- `data.js` is **local and gitignored**: never committed, specific to each machine. The volume stays bounded (a few tens to hundreds of KB). No maintenance to do.

### Known limitations

- **Other people's PRs**: only your content actions (merge / push / rebase) show up - not their openings, nor PRs merely touched (review/comment) by you.
- The "other people's PRs" query is **time-bounded** → a PR merged by you then re-modified much later can slip through.
- Search bounded to **200 PRs per query**: for a very old date on a very active repo, some PRs may be missing.
- "Touched, not pushed" is only reliable for **recent days** (`updatedAt` only keeps the last activity).
- Jira subjects rely on the **body convention** described above - repos without this convention = empty or approximate subjects.
