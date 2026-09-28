# Remote GeoParquet places, read straight from object storage

Half a million places in Greater London from Overture Maps' `places` theme,
read at query time by DuckDB-WASM from a remote GeoParquet file. No server
and no copy of the data in this repository: the browser issues HTTPS range
requests against a 203 MB file and only reads the bytes the query touches. That read happens once: the London rows are then held in an indexed table
in the browser, and a grid, a deck.gl map over street tiles and a category
bar chart are all viewers of it, and KPI tiles report exactly how many
bytes the engine pulled.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-geo-places/)**

**Bandwidth note:** each visit fetches roughly 40 MB, because the
bounding-box query has to read the row groups that cover London. Bear that
in mind on a metered connection.

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

## What it shows

- **Grid** — name, category, address, latitude and longitude: one page of a
  pushdown query whose fixed Greater London bounding box
  (`lat 51.28–51.70`, `lon -0.51–0.334`) is written into the SQL, so the
  engine never scans anything outside it.
- **Map** — deck.gl over MapLibre GL JS with OpenFreeMap Positron street
  tiles, bound with `bindDeck(grid, { viewportFilter: true, position: {
  geometry: 'geom' } })`. Past the 20,000-row cap the engine's density cells
  draw as hexagons on a quantile scale (Greater London opens that way); zoom
  into a borough and the places draw as points coloured by category. The view
  is a filter, so every pan or zoom re-queries the local table.
- **Remote once, local after** — the first query reads the remote file with
  DuckDB-WASM 1.29.0 (HTTP range requests, bytes counted); the London rows
  are then copied into a DuckDB-WASM 1.32.0 table with an R-tree index on
  `geom`, and the remote engine is closed. Measured headless: a borough
  count ~40–50 ms locally against 0.8–3.6 s remote. Two engines because
  1.29.0 corrupts its next query after building an R-tree index, and 1.32.0
  opens this file with one full 203 MB GET instead of range requests.
- **Category bar** — place counts by category, computed by
  `source.aggregate()` in DuckDB.
- **KPI tiles** — places in view (a real count), bytes fetched this session
  (read from DuckDB-WASM's own file statistics, not a client guess), the
  remote file's size (one `HEAD` request), and the fetched percentage.

## Data

[Overture Maps](https://overturemaps.org/) `places` theme, release
`2026-09-23.1`, from the AWS Open Data bucket. Of the release's 16 Parquet
files only one covers Greater London (the files are geographic bands, not a
hash partition; the other 15 hold zero matching rows), so the page reads
that single file. Licence:
[CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/); Foursquare-sourced
rows within it are Apache-2.0. Street tiles from
[OpenFreeMap](https://openfreemap.org) (© OpenMapTiles, data © OpenStreetMap
contributors).

The page reads a copy of that one partition served from our own CDN
(`https://data.latticegrid.dev/overture/places-part-00007-sorted.parquet`):
the same rows, re-sorted along a Hilbert curve and trimmed to the columns
the page uses, in 20,000-row groups with ZSTD and the GeoParquet metadata
kept — 203 MB instead of 728 MB, a 0.2 MB footer instead of 1.6 MB, and the
London row groups a quarter of the bytes. To read it straight from the
public bucket instead, point `PARTITION_URL` in `data.js` at `OVERTURE_URL`
(`https://overturemaps-us-west-2.s3.amazonaws.com/release/2026-09-23.1/theme=places/type=place/part-00007-61ac23fc-0af6-5d61-8c46-5776ba7e6bf0-c000.zstd.parquet`,
728 MB, about 35 MB fetched per visit); the SQL works unchanged.

The host was chosen by measuring three candidates (two Foursquare OS Places
mirrors and Overture) with DuckDB's own HTTPFS profiler. Neither Foursquare
mirror partitions by geography, so a bbox query against a few of its files
returns almost nothing and a query across all 81 does not finish in
reasonable time; Overture's single covering file returns all 493,914
London-area rows.

## Grid features used

`duckdbAdapter` + `createPushdownSource` over a remote `read_parquet()`, then over a local table,
(sort, filter and paging pushed to DuckDB), a `geometry` column, `bindDeck`
with `viewportFilter: true`, density binning above the viewport cap,
`source.aggregate()`, `filter:changed` driving the KPIs and bar chart, and a
bar chart. Modules loaded: `geometry`, `charts`, `deckgl`.

## Notes

- DuckDB-WASM's remote fetches run inside its own worker, so they do not
  appear in the browser's Network panel or in `performance` resource
  entries. The bytes KPI reads the engine's file statistics instead
  (`collectFileStatistics` + `exportFileStatistics`).
- A KPI that cannot yet read its number shows "unknown" rather than `NaN`.
- Cold timings in the browser against the public bucket (us-west-2, from
  London): schema 25 s, first page 4 s, count 0.1 s — the first load was
  dominated by reading the 1.6 MB file footer, which is why the CDN copy
  is re-sorted and trimmed.

## Run it locally

Any static file server will do, for example:

```
npx serve .
```

or Python's built-in server:

```
python3 -m http.server
```

Open the page it prints. No licence key is needed on localhost; a key is
only required once the page is published on a real address, which is why
one appears in `index.html` for this demo's own published address.

## Licence

The code in this repository is available under the MIT licence. See
[LICENSE](LICENSE). The data licences are named above.

Lattice Grid itself is a separate commercial product with its own terms. It
is free to use on localhost, with no key and no watermark, so a copy of
this repository runs unrestricted on your own machine. This demo carries a
key for its own published address only, which is why you will find one in
the source. Keys for your own sites come from
[latticegrid.dev](https://www.latticegrid.dev).

This demo is built on Lattice Grid 1.75.0.
