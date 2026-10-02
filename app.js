// Wiring only. The engine and the London extract live in engine.js, the
// KPIs and bar in stats.js, the map's layers in map.js, constants in data.js,
// the loading state in loading.js. Findings are listed in README.md.
//
// Remote once, local after: the first query reads Greater London straight
// from the remote GeoParquet (bbox pushed into the read, bytes counted). The
// page then copies those rows into a DuckDB table in the browser and rebuilds
// the grid over it, so every pan, zoom, filter and count after that runs in
// memory, never over the network again.
import { FROM, BASE_FILTER, LOCAL_TABLE, totalDatasetBytes } from './data.js?v=20261002f-0009';
import { createLoader } from './loading.js?v=20261002f-0009';
import { startEngine, extractLondon } from './engine.js?v=20261002f-0009';
import { refreshStats, showBytes } from './stats.js?v=20261002f-0009';
import { createMap, categoryColours, mapLayers, readout, legendHtml } from './map.js?v=20261002f-0009';

const el = (id) => document.getElementById(id);
const t0 = performance.now();
const timings = {};
const mark = (name) => { timings[name] = Math.round(performance.now() - t0); };
const { createGrid, createPushdownSource, duckdbAdapter, createChart } = LatticeGrid;

const COLUMNS = [
  { field: 'name', title: 'Name' },
  { field: 'category', title: 'Category', filter: { type: 'set' } },
  { field: 'address', title: 'Address' },
  { field: 'lat', title: 'Lat', type: 'number', format: { decimals: 5 }, layout: 90 },
  { field: 'lon', title: 'Lon', type: 'number', format: { decimals: 5 }, layout: 90 },
  { field: 'geom', title: 'Geometry', type: 'geometry' },
];

/**
 * A grid over DuckDB `from`, filtered to the London bbox. `spatial: true`
 * (GEO-2) decodes `geom` so the map can ask the engine for density cells;
 * `aggregates: 'engine'` because the page holds no rows client-side.
 * @param {object} connection the DuckDB connection
 * @param {string} from the relation: the remote read, or the local table
 * @returns {{grid: object, source: object}}
 */
function londonGrid(connection, from) {
  const adapter = duckdbAdapter({ connection, from, spatial: true });
  const source = createPushdownSource({ adapter, pageSize: 100, aggregates: { default: 'engine' } });
  const grid = createGrid(el('grid'), { rowKey: 'name', source, columns: COLUMNS });
  grid.columns.hide('geom'); // carried for the map only, not a table column
  grid.filters.set(BASE_FILTER);
  return { grid, source };
}

/**
 * Resolves once the grid's first page holds real rows, not placeholders.
 * @param {object} grid the grid
 * @returns {Promise<void>}
 */
const firstRows = (grid) => new Promise((done) => {
  const timer = setInterval(() => {
    const row = grid.rows.count() > 0 ? grid.rows.get(0) : null;
    if (row && row.data && row.data.name !== undefined) { clearInterval(timer); done(); }
  }, 100);
});

const loader = createLoader({ timeoutMs: 120_000 });
try {
  const totalBytesPromise = totalDatasetBytes();
  const remote = await startEngine(loader);
  const { sessionBytes } = remote;

  const barGrid = createGrid(document.createElement('div'), {
    rowKey: 'category', rows: [],
    columns: [{ field: 'category', title: 'Category' }, { field: 'n', title: 'Places', type: 'number' }],
  });
  createChart({
    grid: barGrid, container: el('bar'), type: 'bar', x: 'category', y: 'n',
    title: 'Top categories in view, uncategorised excluded (counted by DuckDB)',
  });

  // 1. The remote read: Greater London over HTTPS range requests.
  loader.step('reading Overture places',
    'Reading Overture places for Greater London over HTTPS range requests (~25 MB of a 203 MB file)…');
  loader.armTimeout();
  let { grid, source } = londonGrid(remote.connection, FROM);
  await firstRows(grid);
  mark('firstRows');
  loader.rowsIn('counting places and categories', 'First rows are in — counting places and categories in DuckDB…');
  const top = await refreshStats(grid, source, barGrid);
  showBytes(await sessionBytes(), await totalBytesPromise);

  // 2. Once: copy the same bbox into the browser, then rebuild over it.
  loader.step('copying the London extract', 'Copying the London rows into an indexed table in the browser, once…');
  const { local, rows: held } = await extractLondon(remote);
  mark('extracted');
  const fetchedOnce = await sessionBytes();
  loader.done('London rows copied into the browser; drawing the map…');
  grid.destroy();
  await remote.db.terminate(); // nothing reads the remote file again
  const { connection, db } = local;
  ({ grid, source } = londonGrid(connection, LOCAL_TABLE));
  showBytes(fetchedOnce, await totalBytesPromise);
  el('k-bytes').textContent = 'Bytes fetched once (remote)';

  // 3. The map: deck.gl over MapLibre street tiles, deck's view as the grid's filter.
  // Colours follow London's top categories and stay put while the view moves.
  const colours = categoryColours(top);
  el('legend').innerHTML = legendHtml(colours);
  window.__demo = { timings, held, fetchedOnce, last: null };
  const { deckgl, basemap } = createMap(el('map'), document.documentElement.dataset.theme === 'dark');
  const binding = LatticeGridDeck.bindDeck(grid, {
    deck: deckgl, viewportFilter: true, position: { geometry: 'geom' },
    layers: (rows, ctx) => {
      el('readout').textContent = readout(ctx);
      window.__demo.last = ctx.provenance;
      return mapLayers(rows, ctx, colours);
    },
  });
  grid.on('filter:changed', () => {
    refreshStats(grid, source, barGrid).catch((e) => console.error('[places demo] refreshStats', e));
  });
  await firstRows(grid);
  mark('localReady');
  el('status').textContent = `London extract held in the browser: ${held.toLocaleString()} rows, pan and zoom now run locally.`;
  Object.assign(window.__demo, { grid, source, binding, deck: deckgl, basemap, connection, db });
} catch (error) {
  loader.fail(error);
}
