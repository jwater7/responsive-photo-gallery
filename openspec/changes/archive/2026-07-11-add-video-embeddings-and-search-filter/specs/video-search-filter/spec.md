# video-search-filter

## ADDED Requirements

### Requirement: Search API can exclude videos
The `/search` endpoint SHALL accept a boolean `excludeVideos` body flag that,
when true, appends a filter excluding documents whose `mime_type` is any video
MIME type, with the MIME list derived from the shared `rpg-media-types`
registry (no hand-maintained list). `mime_type` SHALL be a filterable
attribute. The flag SHALL compose with all existing search parameters (query,
smart/hybrid, sort, paging, other filters).

#### Scenario: Videos are filtered from results
- **WHEN** a search runs with `excludeVideos: true` over a corpus containing
  matching photos and videos
- **THEN** only the photos are returned, in both keyword and smart modes, and
  paging/totals reflect the filtered set

#### Scenario: New registry video format is covered automatically
- **WHEN** a new video extension is added to the rpg-media-types registry
- **THEN** documents of that format are excluded by `excludeVideos` with no
  search-code change

### Requirement: Missing mime_type is backfilled on scan
The pipeline SHALL stamp `mime_type` onto an existing document that lacks it
when the document's canonical file is visited by a scan (alongside the
existing size/mtime refresh), so documents indexed before the field existed
become filterable without a forced re-enrichment; the write SHALL carry the
established vector opt-out for vector-less documents.

#### Scenario: Pre-existing doc becomes filterable
- **WHEN** a scan visits a file whose document predates the `mime_type` base
  field
- **THEN** the document gains `mime_type` from the registry's extension→MIME
  map and subsequently honors `excludeVideos`, and the partial update does not
  fail Meili's vector validation

### Requirement: Search page offers a persisted hide-videos toggle
The search page SHALL provide a "hide videos" toggle alongside the existing
smart-search toggle, defaulting to off (videos included). Its state SHALL be
sent as `excludeVideos` on searches and SHALL persist through the URL query
(like the smart flag) so refresh, back/forward, and shared links preserve it.

#### Scenario: Toggle hides videos and survives refresh
- **WHEN** the user enables "hide videos", searches, and reloads the page
- **THEN** the results contain no videos, the toggle remains enabled after
  reload, and re-running the restored search still excludes videos

#### Scenario: Default behavior unchanged
- **WHEN** a user searches without touching the toggle
- **THEN** videos appear in results exactly as before this change
