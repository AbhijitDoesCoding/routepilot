# Open-Source Contributions

**GitHub username:** [AbhijitDoesCoding](https://github.com/AbhijitDoesCoding)  
**Context:** External open-source pull requests submitted during the 2026 hackathon window. These are contributor work in upstream projects, not code that is part of the RoutePilot repository itself.

This index records each pull request's status accurately as of October 23, 2026. A closed pull request is not necessarily a merged pull request.

## Summary

| Project | Pull request | Status | Area |
|---|---|---|---|
| MapLibre Martin | [#3409 — Add CQL2 filtering for DuckDB sources](https://github.com/maplibre/martin/pull/3409) | **Merged** (September 30, 2026) | Geospatial tile serving and DuckDB filters |
| Valhalla | [#6361 — Fix `valhalla_add_elevation` tile validation](https://github.com/valhalla/valhalla/pull/6361) | **Merged** (October 3, 2026) | Routing-engine utility validation |
| Valhalla | [#6390 — Fix adjacent pedestrian area routing](https://github.com/valhalla/valhalla/pull/6390) | **Closed, not merged** (October 7, 2026) | Pedestrian-area routing graph connectivity |
| Nominatim | [#4207 — Add place category when linking places](https://github.com/osm-search/Nominatim/pull/4207) | **Closed, not merged** (October 13, 2026) | Place indexing and linked-category consistency |
| QubesOS core-admin | [#910 — Use `QubesVMInUseError` for GuiVM dependencies](https://github.com/QubesOS/qubes-core-admin/pull/910) | **Merged** (October 17, 2026) | VM dependency shutdown handling |
| QubesOS core-admin-client | [#513 — Fix `--wait` docs and add NetVM chain regression test](https://github.com/QubesOS/qubes-core-admin-client/pull/513) | **Open** (as of October 23, 2026) | Documentation and dependency-chain testing |

## Contribution details

### MapLibre Martin — PR #3409

**Status:** Merged September 30, 2026.  
**Repository:** [maplibre/martin](https://github.com/maplibre/martin)

Adds CQL2 filtering for DuckDB GeoParquet sources and DuckDB database table/view sources. The change applies translated filters to tile queries, supports filtered bounds, adds tests, and documents the `filter` option.

### Valhalla — PR #6361

**Status:** Merged October 3, 2026.  
**Repository:** [valhalla/valhalla](https://github.com/valhalla/valhalla)

Fixes tile argument validation in `valhalla_add_elevation`: the implementation validates the actual `tiles` argument, reports invalid entries, and permits execution to continue when at least one supplied tile is valid.

### Valhalla — PR #6390

**Status:** Closed, not merged October 7, 2026.  
**Repository:** [valhalla/valhalla](https://github.com/valhalla/valhalla)

Proposes allowing adjacent pedestrian areas to connect when their shared perimeter nodes are not part of a linear pedestrian way. Includes a regression test checking that routing uses the area traversals instead of a longer bypass. The PR's description notes that the targeted tests could not be run in that local Windows environment.

### Nominatim — PR #4207

**Status:** Closed, not merged October 13, 2026.  
**Repository:** [osm-search/Nominatim](https://github.com/osm-search/Nominatim)

Implements inheritance of `osm.place.*` categories from a linked place while preserving the boundary's own category, and removes inherited categories when the linked place is deleted. Adds regression coverage and documents local database-level indexing verification. The PR also records a remaining edge case and the test limitations in its description.

### QubesOS core-admin — PR #910

**Status:** Merged October 17, 2026.  
**Repository:** [QubesOS/qubes-core-admin](https://github.com/QubesOS/qubes-core-admin)

Raises `QubesVMInUseError` when a GuiVM cannot be shut down because running VMs depend on it, preserves the `force=True` behavior, and adds regression tests.

### QubesOS core-admin-client — PR #513

**Status:** Open as of October 23, 2026.  
**Repository:** [QubesOS/qubes-core-admin-client](https://github.com/QubesOS/qubes-core-admin-client)

Corrects `qvm-shutdown --wait` documentation about dependency ordering and adds a unit/regression test for a three-level NetVM dependency chain. Its description clarifies the scope of the scripted test and the behavior it does not independently verify.

## Devpost entry guidance

If the Open Source mini-challenge form accepts only one contribution URL, use a contribution that best matches its eligibility criteria and enter that URL in the primary field. The merged [Valhalla #6361](https://github.com/valhalla/valhalla/pull/6361) is a strong primary option, but check the exact challenge prompt before choosing. Include the other links in the description or project story if additional text is allowed.

Do not describe the Nominatim #4207 or Valhalla #6390 pull requests as merged. Statuses can change; recheck the upstream PR pages before submitting.
