// Two DuckDB-WASM engines, each used for what it does well here:
//
// - REMOTE (1.29.0, DuckDB 1.1): reads the remote GeoParquet over HTTP range
//   requests, so only the London row groups cross the wire, and counts those
//   bytes in its file statistics.
// - LOCAL (1.32.0, DuckDB 1.4): holds the London extract with an R-tree index
//   on `geom`, so the map's `withinBbox` (the adapter's `ST_CoveredBy`) is an
//   index lookup rather than a scan of 493,910 geometries.
//
// Why not one engine (measured in headless Chrome against this file, README.md):
// 1.29.0 corrupts its next query after `CREATE INDEX … USING RTREE`, and
// without the index a borough-sized count takes ~460 ms; 1.32.0 answers the
// same count in ~25 ms through the index, but opening this remote file it
// falls back to one full 203 MB GET instead of range requests.
import { PARTITION_URL, FROM, LONDON, LOCAL_TABLE } from './data.js?v=20261001c-0009';

const REMOTE_VERSION = '1.29.0';
const LOCAL_VERSION = '1.32.0';

/**
 * Start one DuckDB-WASM engine of the given version, with spatial loaded.
 * @param {string} version the @duckdb/duckdb-wasm version on jsDelivr
 * @returns {Promise<{db: object, connection: object}>}
 */
async function openDuckDB(version) {
  const duckdb = await import(`https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version}/+esm`);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = await duckdb.createWorker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();
  try { await connection.query('INSTALL spatial'); } catch (e) { console.warn('[places demo] INSTALL spatial', e); }
  await connection.query('LOAD spatial');
  return { db, connection };
}

/**
 * Start the remote engine and its byte counter over the partition.
 * @param {{step: Function, countBytes: Function}} loader the page's loading state
 * @returns {Promise<{db: object, connection: object, sessionBytes: () => Promise<number>}>}
 */
export async function startEngine(loader) {
  // The adapter (`spatial: true`) would load the extension on its first
  // query; openDuckDB loads it first, so the 5.9 MB download is its own step.
  loader.step('starting DuckDB-WASM', 'Starting DuckDB-WASM and its spatial extension (5.9 MB)…');
  const { db, connection } = await openDuckDB(REMOTE_VERSION);
  // Bytes fetched, as DuckDB-Wasm's own file statistics count them for the
  // remote partition: cold reads plus read-ahead (F-GEODEMO-A, README.md: the
  // worker's fetches are invisible to page code).
  await db.collectFileStatistics(PARTITION_URL, true);
  const sessionBytes = async () => {
    const stats = await db.exportFileStatistics(PARTITION_URL);
    return Number(stats.totalFileReadsCold) + Number(stats.totalFileReadsAhead);
  };
  loader.countBytes(sessionBytes);
  return { db, connection, sessionBytes };
}

/**
 * Copy the London bbox of the remote partition — the same columns and the
 * same bbox predicate as the first query — into a table in the local engine,
 * index its geometry, and close nothing: the caller retires the remote engine.
 * The rows travel between the two engines as an in-memory GeoParquet buffer. Every later pan, zoom, filter and aggregate reads it.
 * @param {object} remote the remote engine ({db, connection})
 * @returns {Promise<{local: {db: object, connection: object}, rows: number}>}
 */
export async function extractLondon(remote) {
  const localReady = openDuckDB(LOCAL_VERSION);
  await remote.connection.query(`COPY (
      SELECT name, category, address, lon, lat, geom FROM ${FROM}
      WHERE lat BETWEEN ${LONDON.latMin} AND ${LONDON.latMax}
        AND lon BETWEEN ${LONDON.lonMin} AND ${LONDON.lonMax}
    ) TO '${LOCAL_TABLE}.parquet' (FORMAT parquet)`);
  const buffer = await remote.db.copyFileToBuffer(`${LOCAL_TABLE}.parquet`);
  await remote.db.dropFile(`${LOCAL_TABLE}.parquet`);
  const local = await localReady;
  await local.db.registerFileBuffer(`${LOCAL_TABLE}.parquet`, buffer);
  await local.connection.query(`CREATE TABLE ${LOCAL_TABLE} AS
    SELECT name, category, address, lon, lat, geom FROM read_parquet('${LOCAL_TABLE}.parquet')`);
  await local.db.dropFile(`${LOCAL_TABLE}.parquet`);
  await local.connection.query(`CREATE INDEX ${LOCAL_TABLE}_geom ON ${LOCAL_TABLE} USING RTREE (geom)`);
  const res = await local.connection.query(`SELECT count(*)::INTEGER AS n FROM ${LOCAL_TABLE}`);
  return { local, rows: Number(res.toArray()[0].n) };
}
