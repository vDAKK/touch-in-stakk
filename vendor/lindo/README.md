# vendor/lindo — third-party, GPL-3.0

These files are a copy of [`zenoxs/lindo-game-base`](https://github.com/zenoxs/lindo-game-base)
at commit `0327e6986a1ab78900667c79663d0b2215894058` (branch `popup`):
`manifest.json`, `regex.json`, `index.html`, `fixes.js`, `fixes.css`,
`keymaster2.js`, `icon.png`.

They are **not** part of Touch in STAKK's own MIT-licensed code. They are
licensed under the GNU General Public License v3.0 — see `LICENSE` in this
directory — and belong to their authors.

## Why they are here

They are the last-resort source for the compatibility shell and the patch rules:
the launcher fetches them from the pinned commit, falls back to the last set
that worked (`userData/patchset.json`, `userData/proxy-cache`), and only then to
this copy. Having them in the repository makes the pinned version reviewable in
a diff rather than being whatever a URL returns today.

## Why they are not in the builds

`build.files` in `package.json` deliberately leaves `vendor/` out: shipping
GPL-3.0 files inside the MIT-licensed installers would be redistribution under
a licence this project does not carry. In a packaged app the fallback chain
therefore stops at the disk cache, which covers every launch after the first
successful one.

Bumping the pinned version means changing `LINDO_COMMIT` in
`src/main/patcher.js` and re-downloading these files from the new commit.
