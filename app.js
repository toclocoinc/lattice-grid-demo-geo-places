// Wiring only. Constants and helpers live in data.js; the source probe and
// the findings this build ran into are in README.md.
import { FROM, BASE_FILTER, PARTITION_URL, totalDatasetBytes } from './data.js';

const el = (id) => document.getElementById(id);
const status = (text) => { el('status').textContent = text; };
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(2)} MB`);
// F-GEODEMO-G: a KPI that cannot yet read its number says so, rather than
// showing the literal string a failed `Number()` produces.
const fmtNumber = (n) => (Number.isFinite(n) ? n.toLocaleString() : 'unknown');

status('reading the remote dataset size…');
const totalBytesPromise = totalDatasetBytes();

status('loading DuckDB-WASM…');
const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
const worker = await duckdb.createWorker(bundle.mainWorker);
const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR), worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
const connection = await db.connect();
status('engine ready, querying the fixed London bbox…');

const { createGrid, createPushdownSource, duckdbAdapter, createChart } = LatticeGrid;

// Bytes fetched so far, as DuckDB-Wasm's own file statistics count them for
// the remote partition: cold reads plus read-ahead, the bytes its worker pulled
// over HTTP (cached reads are served from its buffer and not counted).
// F-GEODEMO-A (README.md): the worker's fetches are invisible to page code, and
// in the browser EXPLAIN ANALYZE carries no HTTPFS "in:" line (DuckDB-Wasm reads
// remote files through its own JS file system, not the httpfs extension), so
// the file statistics are the engine-reported figure available to the page.
await db.collectFileStatistics(PARTITION_URL, true);
async function sessionBytes() {
  const stats = await db.exportFileStatistics(PARTITION_URL);
  return Number(stats.totalFileReadsCold) + Number(stats.totalFileReadsAhead);
}

// `spatial: true` (GEO-2): loads the spatial extension and decodes `geom`
// (declared `type: 'geometry'` below) so the map can ask the engine for
// density cells past its viewport cap (GEO-6), rather than refusing by name
// as a plain `lon`/`lat` map does once a view holds more than the cap.
const adapter = duckdbAdapter({ connection, from: FROM, spatial: true });
// `aggregates: { default: 'engine' }`: a pushdown source computes aggregates
// client-side unless told otherwise (the documented default), and then
// `source.aggregate()` hands back only the list of aggregates the CALLER must
// compute — an empty `values`. This page holds no rows client-side, so both
// counts below must run in DuckDB.
const source = createPushdownSource({ adapter, pageSize: 100, aggregates: { default: 'engine' } });

// GEO-7 (main `80ef90c2`) fixed the two-execute()-calls-never-resolve defect
// this demo's own probe found (F-GEODEMO-F): a superseded pushdown request
// now drops cleanly instead of leaving the connection queue stuck. The
// documented `.filters.set()` path, used the same way `demo/duckdb.html`
// does, is simpler than a hand-built `state` snapshot and is what stays.
const grid = createGrid(el('grid'), {
  rowKey: 'name',
  source,
  columns: [
    { field: 'name', title: 'Name' },
    { field: 'category', title: 'Category', filter: { type: 'set' } },
    { field: 'address', title: 'Address' },
    { field: 'lat', title: 'Lat', type: 'number', format: { decimals: 5 }, layout: 90 },
    { field: 'lon', title: 'Lon', type: 'number', format: { decimals: 5 }, layout: 90 },
    { field: 'geom', title: 'Geometry', type: 'geometry' },
  ],
});
grid.columns.hide('geom'); // carried for the map only, not a table column
grid.filters.set(BASE_FILTER);

// The grid's first page arrives when DuckDB answers (~20 s cold over httpfs).
// Until then its rows are placeholders with no data, so the page does not
// report itself loaded before the first real row is in the grid.
const firstRows = new Promise((done) => {
  const timer = setInterval(() => {
    const row = grid.rows.count() > 0 ? grid.rows.get(0) : null;
    if (row && row.data && row.data.name !== undefined) { clearInterval(timer); done(); }
  }, 250);
});

// `viewportFilter: true`: a pan writes a `withinBbox` condition on `geom` to
// the grid's own filters (GEO-4) — one later call, never overlapping the
// grid's own first load. `geometry: 'geom'` (rather than `lon`/`lat`) is what
// lets the map ask the engine for density cells past its 20,000-row default
// cap (GEO-6): the fixed London bbox holds far more than that, so the view
// opens as density; zooming into a small area returns it to points.
const map = createChart({
  grid, container: el('map'), type: 'markermap',
  geometry: 'geom', label: 'name', viewportFilter: true, zoom: true,
  title: 'Places in view (pan or zoom to re-query)',
});

const barGrid = createGrid(document.createElement('div'), {
  rowKey: 'category',
  rows: [],
  columns: [{ field: 'category', title: 'Category' }, { field: 'n', title: 'Places', type: 'number' }],
});
createChart({
  grid: barGrid, container: el('bar'), type: 'bar', x: 'category', y: 'n',
  title: 'Top categories, uncategorised excluded (counted by DuckDB, not the browser)',
});

/**
 * Every KPI and the bar chart, over the grid's CURRENT filters — not a
 * one-off snapshot of `BASE_FILTER`. Re-run on `filter:changed` so the map's
 * own `viewportFilter: true` (a pan or zoom) narrows what these report, the
 * same way it narrows the grid and the map. Both aggregate calls run one
 * after another, never together, on the one shared connection.
 */
async function refreshStats() {
  const live = grid.filters.get();
  const conditions = live && Array.isArray(live.conditions) ? live.conditions : (live ? [live] : []);
  const totalAgg = await source.aggregate({ filters: conditions.length ? { op: 'and', conditions } : null },
    [{ id: 'n', col: 'name', fn: 'count' }]);
  const totalInView = Number(totalAgg.values?.n);

  // `category notBlank` is in the aggregate's own filter — DuckDB drops the
  // uncategorised rows itself, rather than the page throwing away the
  // tallest bar after the fact.
  const catFilter = { op: 'and', conditions: [...conditions, { col: 'category', op: 'notBlank' }] };
  const catAgg = await source.aggregate({ filters: catFilter, groupBy: ['category'] }, [{ id: 'n', col: 'category', fn: 'count' }]);
  const categoryRows = (catAgg.groups || [])
    .filter((g) => g.keys.length > 0 && g.keys[0])
    .map((g) => ({ category: g.keys[0], n: Number(g.values.n) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
  barGrid.rows.load(categoryRows);

  const bytesFetched = await sessionBytes();
  const totalBytes = await totalBytesPromise;
  el('t-total').textContent = fmtBytes(totalBytes);
  el('t-bytes').textContent = fmtBytes(bytesFetched);
  el('t-pct').textContent = totalBytes ? `${((100 * bytesFetched) / totalBytes).toFixed(3)}%` : 'unknown';
  el('t-rows').textContent = fmtNumber(totalInView);
}

await firstRows;
await refreshStats();
grid.on('filter:changed', () => { refreshStats(); });
status('loaded the fixed London bbox from the one covering partition — pan the map to re-query.');
window.grid = grid;
window.map = map;
window.source = source; // TEMP debug, round 5 diagnosis
