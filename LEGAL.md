# LEGAL — BitJarvis License Topology

This document maps which license governs which part of this distribution.
It is a practical index, not legal advice. In case of conflict, the LICENSE
file of the specific subtree governs that subtree.

Not reviewed by counsel. Get legal review before commercial distribution.

---

## 1. Top-level mapping

| Path | License | License file |
|---|---|---|
| `.`, `core/`, `lib/`, `server/`, `desktop/`, `hub/`, `shared/`, `cli/`, `plugins/`, `skills2set/`, `packages/`, `tools/`, `scripts/`, `tests/`, `vendor/` | **Apache-2.0** | `LICENSE` |
| `im/` | **AGPL-3.0-or-later** | `im/LICENSE` (+ `im/licenses.yaml`) |
| `node_modules/` | various, per package | `<pkg>/LICENSE*` |

This repository contains **no GPL code**. The `mobile/` subtree (OpenMinis,
GPLv3) is being removed and moves to a separate repository — see §5.

---

## 2. Origin (upstream)

BitJarvis is a derivative work of:

```
openhanako  — Apache-2.0, Copyright 2025 liliMozi
https://github.com/liliMozi/openhanako
```

The upstream repository is 6.5k★ / 564 forks / 3,466 commits and is actively
developed; its README states that repository and release URLs are still on the
old `openhanako` URLs during a migration phase, with a later rename.

Because Apache-2.0 is a permissive license, forking and redistributing under
Apache-2.0 is permitted. The obligations below apply to us.

---

## 3. Apache-2.0 obligations and current status

Apache-2.0 Section 4 imposes four redistribution conditions. Status:

| § | Requirement | Status |
|---|---|---|
| 4(a) | Give recipients a copy of this License | ✅ `LICENSE` present |
| 4(b) | Mark modified files with a change notice and date | ⚠️ **Not enforced** — no convention in place yet, see §7 |
| 4(c) | Retain all copyright / patent / trademark / attribution notices from the upstream source | ✅ `LICENSE` now carries both `liliMozi` (upstream) and `mengtian999` (this fork) |
| 4(d) | Carry a readable copy of the attribution notices from the upstream NOTICE file | ✅ `NOTICE` present (we author it; upstream ships none) |

Note on §4(d): upstream openhanako ships **no NOTICE file**, so there are no
upstream notices to preserve verbatim. Our NOTICE credits the upstream
project and author in lieu.

Note on §4(c): the upstream LICENSE contained only `Copyright 2025 liliMozi`.
An earlier revision of this file replaced that line with a single fork-side
copyright notice, removing the upstream attribution, which would violate
§4(c). The upstream line has been restored alongside our own.

---

## 4. `im/` — AGPL-3.0, bundled not linked

`im/` is a fork of FluffyChat, a Matrix protocol client. AGPL-3.0 is **not**
compatible with Apache-2.0 in the sense that its code cannot be brought into
an Apache-2.0 codebase; it also cannot be relicensed.

The project stays compliant by keeping a hard bundle boundary:

- `im/` is compiled to web assets and shipped inside the desktop package as a
  bundled resource (`extraResources` / `im-web`).
- **Nothing in `lib/`, `server/`, `desktop/`, or `hub/` imports or links the
  `im/` source or its compiled output.**
- `im/LICENSE` and `im/licenses.yaml` are retained.

If `im/` is ever imported into the TypeScript source tree, this topology breaks
and the whole distribution would need re-licensing assessment. Do not do that
without counsel review.

---

## 5. Repository split — `mobile/` moves to a separate repository

`mobile/` is being removed from this repository. The resulting structure is
two independently released applications:

| Repository / App | Contents | License profile |
|---|---|---|
| **BitJarvis** (this repo) | `bitjarvis/` desktop + `im/` | Apache-2.0 + AGPL-3.0 (bundled) |
| **OpenMinis mobile** (separate repo) | OpenMinis mobile + `im/` | GPL-3.0 + AGPL-3.0 |

Both applications ship the same `im/` tree (FluffyChat fork, AGPL-3.0). That
is legal — AGPL-3.0 permits forking — and the `im/` subtree in each repo keeps
its own `im/LICENSE` and `im/licenses.yaml`.

### What actually moved

What left this repo (previously 24,662 files):

| Subdir | Contents |
|---|---|
| `mobile/src/` | 22,100 files — 451 `.swift`, 1,147 `.kt`, 22 `.java` (Android + iOS) |
| `mobile/deps/` | 2,518 files — vendored GPL sandbox runtime: iSH (GPLv3), PRoot (GPLv2), talloc, LAME, ffmpeg patches, rclone |
| `mobile/scripts/` | 26 files — `prepare_rootfs.sh`, `prepare_android_sandbox.sh`, `rename_sandbox_paths.py`, … |
| `mobile/docs/` | 6 files — OpenMinis specs (e.g. `debug-server-api.md`) |
| `mobile/LICENSE` | GNU GPL-3.0 (35,149 bytes) |
| `mobile/.gitmodules` | submodule definitions populating `mobile/deps/` |

### Do **not** delete these — they are ours, not OpenMinis'

The name collision is real and easy to over-correct. These are BitJarvis' own
files and must stay:

| Path | What it is |
|---|---|
| `desktop/src/react/mobile/` | `MobileApp.tsx`, `mobile-init.ts`, `mobile-entry.css`, `mobile-platform.ts` — the app's **own browser/PWA UI**, built in React. Unrelated to the Swift/Kotlin mobile app. |
| `server/routes/mobile-workbench.ts` | `/mobile/*` **HTTP routes** (workbench PWA API: `bootstrap`, `workbench/files`, `search`, `content`, `actions`, `upload`). Serves the app's own web UI. |
| `server/http/route-security.ts` | Route policy for the same `/mobile/*` endpoints. |
| `desktop/src/react/__tests__/mobile/` | Tests for the PWA UI above. |

Before removing `mobile/`, confirm nothing in the list above imports from it.
A scan of 1,903 TypeScript/JSON/Markdown files in `lib/`, `core/`, `server/`,
`desktop/`, `hub/`, `shared/`, `cli/`, `packages/`, `tools/`, `scripts/`, and
`plugins/` found **zero imports of `mobile/`**, so removal should be
mechanical. Re-run the check after the split.

The desktop package build (`package.json` → `build.files` and `build.extraResources`)
does not reference `mobile/`, so no build config change is needed. `im/build/web/`
→ `im-web/` is the one `extraResources` entry that must keep working.

---

## 6. Issues that move with `mobile/`

The following concerns are now the responsibility of the separate OpenMinis
mobile repository. They are recorded here for continuity and are not blockers
for this repository.

1. **PRoot is GPL-2.0 vs. `mobile/LICENSE` is GPL-3.0.** `mobile/deps/proot/`
   is GPL-2.0 upstream. Per FSF guidance, GPL-2.0-only and GPL-3.0 are
   **incompatible** and cannot be combined into a single GPLv3 work. Counsel
   must confirm whether the PRoot component is GPL-2.0-or-later (fine) or
   GPL-2.0-only (needs explicit dual-licensing or upstream confirmation).
2. **GPLv3 §6 source completeness.** `mobile/deps/` is populated via
   `mobile/.gitmodules`. The receiving repo must check the submodules out —
   `git submodule update --init --recursive` — before any release, or the
   distribution lacks the exact corresponding source GPLv3 §6 requires.
3. **Provenance / redistribution rights.** The OpenMinis tree is described
   upstream as a *mirror* synchronized from a private development tree. If that
   tree is not licensed to permit downstream redistribution, copying it into
   the new repo may not be permitted, independent of the copy's own license.

None of the above affects this repository: it contains no GPL code.

---

## 7. Recommended conventions going forward

To discharge §4(b) and keep the topology auditable:

1. **Modified-file notices.** When a file inherited from upstream is modified,
   add a short header comment:
   ```ts
   // Modified by BitJarvis (2026-xx-xx): <one-line reason>
   // Upstream: https://github.com/liliMozi/openhanako
   ```
   **Historical files cannot be back-filled.** This repository is a mirror copy
   of openhanako, not a git fork, so there is no shared ancestor to run
   `git diff` against. Without a baseline we cannot determine which files count
   as "modified" under §4(b), so the convention is enforced going forward only:
   files touched from today onward get the notice, pre-existing files are left
   as they are. If a snapshot of the matching upstream version becomes
   available, running the diff first would establish that baseline.

2. **New files.** New original files need no license header — the root
   `LICENSE` covers them by distribution. Adding a per-file header is optional
   and, if used, must be Apache-2.0 only.
3. **Never** add `SPDX-License-Identifier` lines containing `GPL-3.0`,
   `AGPL-3.0`, or any non-Apache identifier to files in the Apache-2.0
   subtrees. If a file is genuinely dual-licensed, record that in this
   document and add a `LICENSE` file in its own subtree instead.
4. **Third-party additions.** Any new dependency with a copyleft license must
   get its own subtree and its own entry in §1. Add it to §4-style notes if it
   is bundled rather than linked, or flag it for counsel review if it is linked.
5. **NOTICE maintenance.** Update `NOTICE` when a new bundled component is
   added or removed.

---

## 8. Third-party components of note

| Path | License | Notes |
|---|---|---|
| `vendor/mingit/` | see `vendor/mingit/LICENSE.txt` | bundled vendored tool |
| `skills2set/skill-creator/` | see `skills2set/skill-creator/LICENSE.txt` | bundled skill |
| `node_modules/` | mixed (MIT / ISC / Apache-2.0 / BSD / others) | per-package LICENSE files retained |
| `build/web/assets/NOTICES` | generated | produced by the build; verify it ships in releases |
| `dist/win-unpacked/LICENSES.chromium.html` | Chromium | bundled by Electron |
| `dist/win-unpacked/LICENSE.electron.txt` | MIT | bundled by Electron |

The Chromium/Electron notice files are already emitted into the packaged build.
Verify the release pipeline preserves them alongside `LICENSE`, `NOTICE`, and
`LEGAL.md` — the packaging script controls this.

---

## 9. Acknowledgements

- **openhanako** (liliMozi) — upstream project this fork derives from.
- **FluffyChat** contributors — `im/`.
- **tw93/kami** — progressive-disclosure structure of the HTML aesthetic
  specification used by the beautify plugin.

The iSH, PRoot, LAME, rclone, and talloc maintainers are acknowledged in the
separate OpenMinis mobile repository, which carries `mobile/deps/`.

---

## 10. Not covered here

This document does not address:

- Trademark usage of third-party names in UI, docs, or marketing copy.
  Apache-2.0 §6 does not grant trademark rights; third-party trademarks are
  likewise not granted by this document.
- Privacy terms, terms of service, or data-processing commitments for any
  backend service that relays model traffic. Those belong in user-facing legal
  documents, not in this repository.
- Patent position beyond what Apache-2.0 §3 already states.

