# LEGAL — BitJarvis License Topology

This document maps which license governs which part of this distribution.
It is a practical index, not legal advice. In case of conflict, the LICENSE
file of the specific subtree governs that subtree.


---

## 1. Top-level mapping

| Path | License | License file |
|---|---|---|
| `.`, `core/`, `lib/`, `server/`, `desktop/`, `hub/`, `shared/`, `cli/`, `plugins/`, `skills2set/`, `packages/`, `tools/`, `scripts/`, `tests/`, `vendor/` | **Apache-2.0** | `LICENSE` |
| `im/` | **AGPL-3.0-or-later** | `im/LICENSE` (+ `im/licenses.yaml`) |
| `node_modules/` | various, per package | `<pkg>/LICENSE*` |


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

