# Search Cache & Ranking — UX/UI

## Network Tab Changes

New fields added to the existing **Network** tab form:

- **Search Timeout**: Slider + number input, 5000–120000ms, step 1000, label "Search timeout (ms)"
- **Stream Timeout**: Slider + number input, 5000–120000ms, step 1000, label "Stream timeout (ms)"
- **Cache TTL**: Slider + number input, 1–1440min, step 5, label "Cache TTL (minutes)"
- **Manage Cache** button → opens CacheManagerModal

Layout: same grid as existing Network fields (2 columns on desktop).

## Cache Manager Modal

Opened via button on Network tab. Full-screen overlay dialog.

**Header**: "Search Cache Manager" + close X.

**Tabs**: "Search Results" | "MB→YT Mappings" | "Ranking History"

### Search Results tab

Grouped by provider:
- MusicBrainz section — expandable
- YouTube Pure section — expandable
- Local section — expandable

Each section has a table (per provider):
| Query | Results | Cached At | Actions |
|---|---|---|---|
| "mozart" | 12 songs | 2m ago | [Delete] |
| "beethoven" | 8 songs | 15m ago | [Delete] |

Per-section header: "MusicBrainz (3 cached queries)" + [Clear All] button.

Empty state: "No cached queries for this provider."

### MB→YT Mappings tab

Table:
| MB Recording ID | YouTube Video | Uploader | Confidence | Last Used | Actions |
|---|---|---|---|---|---|
| mbid-xxx | Song Title | Artist | 0.95 | 5m ago | [Delete] |

Actions column: [Delete] per row.  
Header: "Total: 42 mappings" + [Clear All] button.

### Ranking History tab

Table:
| Query | Winner | Score | Candidates | When | Scores Breakdown |
|---|---|---|---|---|---|
| "Mozart Lacrimosa" | Video Title | 2.5 | 20 | 3m ago | T:1 A:0.5 D:1 Ch:0.3 |

Scores column expandable on click showing individual weights.

## Ranking Tab (new)

New tab in Settings between "Network" and "Appearance".

### Configuration section

Card with heading "Ranking Weights":

- **Title match weight**: Slider 0.0–2.0, step 0.1, default 1.0
- **Artist match weight**: Slider 0.0–2.0, step 0.1, default 0.5
- **Album match weight**: Slider 0.0–2.0, step 0.1, default 1.0
- **Duration match weight**: Slider 0.0–2.0, step 0.1, default 0.5
- **Artist on channel weight**: Slider 0.0–2.0, step 0.1, default 0.3

Each slider with number input beside it.

### History section

Card with heading "Recent Ranking Decisions" + [Clear History] button.

Table (same as Cache Manager modal's Ranking History tab):
| Query | Winner | Score | Candidates | When |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

Empty state: "No ranking decisions recorded yet."

Pagination: 20 per page with "Load more" button.
