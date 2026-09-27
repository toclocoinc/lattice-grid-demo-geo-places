# Remote GeoParquet places, read straight from object storage

Half a million places in Greater London from Overture Maps' `places` theme,
read at query time by DuckDB-WASM from a Parquet file in the AWS Open Data
bucket. No server and no copy of the data in this repository: the browser
issues HTTPS range requests against a 728 MB file and only reads the bytes
the query touches. A grid, a marker map and a category bar chart are all
viewers of that one remote query, and KPI tiles report exactly how many
bytes the engine pulled.

**[See it running](https://toclocoinc.github.io/lattice-grid-demo-geo-places/)**

**Bandwidth note:** each visit fetches roughly 35 MB from AWS Open Data,
because the bounding-box query has to read the row groups that cover
London. Bear that in mind on a metered connection.

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
- **Marker map** — plotted from the `geom` column, not from `lon`/`lat`.
  That is what lets the map ask DuckDB for density cells once a view holds
  more than its 20,000-row cap: the full London bbox opens as density; zoom
  into a small area to return to points. The viewport is a filter, so every
  pan or zoom re-queries.
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
that single 728 MB file. Licence:
[CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/); Foursquare-sourced
rows within it are Apache-2.0. World outlines from
[Natural Earth](https://www.naturalearthdata.com/), public domain.

The host was chosen by measuring three candidates (two Foursquare OS Places
mirrors and Overture) with DuckDB's own HTTPFS profiler. Neither Foursquare
mirror partitions by geography, so a bbox query against a few of its files
returns almost nothing and a query across all 81 does not finish in
reasonable time; Overture's single covering file returns all 493,914
London-area rows.

## Grid features used

`duckdbAdapter` + `createPushdownSource` over a remote `read_parquet()`
(sort, filter and paging pushed to DuckDB), a `geometry` column, `createChart`
with the `markermap` type, `viewportFilter: true`, density binning above the
`viewportCap`, `source.aggregate()`, `filter:changed` driving the KPIs and
bar chart, the `geo-world-110m` outline pack and the KPI module. Modules
loaded: `geometry`, `charts`, `chart-markermap`, `geo-world-110m`, `kpi`.

## Notes

- DuckDB-WASM's remote fetches run inside its own worker, so they do not
  appear in the browser's Network panel or in `performance` resource
  entries. The bytes KPI reads the engine's file statistics instead
  (`collectFileStatistics` + `exportFileStatistics`).
- A KPI that cannot yet read its number shows "unknown" rather than `NaN`.
- Cold timings in the browser for the single file: schema 25 s, first page
  4 s, count 0.1 s. The first load is dominated by reading the file footer.

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

This demo is built on Lattice Grid 1.73.0.
