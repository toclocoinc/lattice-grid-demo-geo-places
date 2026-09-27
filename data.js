// Overture Maps places (AWS open-data bucket), ONE partition of the current
// release, read straight from S3-over-HTTPS by DuckDB-WASM's httpfs. See
// README.md for the probe that picked this source over Foursquare OS Places
// (Hugging Face and Source Cooperative), and for why this is one file rather
// than all 16 (found by reading the 16 files' bbox footer stats once with
// the geotools DuckDB — this is the only partition whose bbox range covers
// Greater London; the release's 16 files are geographically banded, not
// hash-partitioned, so 15 of them provably hold zero London rows).
export const RELEASE = '2026-09-23.1';

/** The one partition covering Greater London (of 16; see README.md). */
const LONDON_PART = 'part-00007-61ac23fc-0af6-5d61-8c46-5776ba7e6bf0-c000.zstd.parquet';

export const PARTITION_URL =
  `https://overturemaps-us-west-2.s3.amazonaws.com/release/${RELEASE}/theme=places/type=place/${LONDON_PART}`;

/** Greater London, the fixed city bbox every query in this demo carries. */
export const LONDON = { lonMin: -0.51, lonMax: 0.334, latMin: 51.28, latMax: 51.70 };

/**
 * The `from` clause: the single remote partition file, flattened to the
 * plain columns the grid's own columns and filters reference. Nested struct
 * access (`names.primary`, `addresses[1].freeform`) happens once here so the
 * adapter's ordinary WHERE-clause pushdown sees flat columns.
 */
// `geom` carries the file's own `geometry` column through unchanged (GEO-1's
// `type: 'geometry'`), so the map can bin it into density cells past its
// viewport cap (GEO-6/GEO-2's spatial buckets); `lon`/`lat` stay as plain
// numbers for the grid's own two columns and the fixed bbox filter below,
// which is a plain numeric `between`, not a spatial predicate.
export const FROM = `(SELECT
    names.primary AS name,
    basic_category AS category,
    addresses[1].freeform AS address,
    bbox.xmin AS lon, bbox.ymin AS lat,
    geometry AS geom
  FROM read_parquet('${PARTITION_URL}')
) AS overture_places`;

/** The fixed base filter: never let a query scan outside the demo's city. */
export const BASE_FILTER = {
  op: 'and',
  conditions: [
    { col: 'lat', op: 'between', value: [LONDON.latMin, LONDON.latMax], bounds: '[]' },
    { col: 'lon', op: 'between', value: [LONDON.lonMin, LONDON.lonMax], bounds: '[]' },
  ],
};

/**
 * The remote file's real size via a live `HEAD`, for the "bytes fetched vs
 * file size" KPI's denominator. Not baked in as a constant: this demo's
 * whole point is a live measurement against a live remote host.
 * @returns {Promise<number>} the partition file's size in bytes
 */
export async function totalDatasetBytes() {
  try {
    const res = await fetch(PARTITION_URL, { method: 'HEAD' });
    return Number(res.headers.get('content-length') || 0);
  } catch {
    return 0;
  }
}

/**
 * Parse DuckDB's own `EXPLAIN ANALYZE` text for the HTTPFS profiler's
 * "in: <n> <unit>" line — the engine's own account of bytes pulled over the
 * wire for that one statement, the same figure the developer's probe scripts
 * (`httpfs-stats*.mjs`, not shipped here) read. Not a client-side guess.
 * @param {string} text the EXPLAIN ANALYZE output, one row per line
 * @returns {number} bytes, or 0 when the line was not found
 */
export function parseHttpfsBytesIn(text) {
  const clean = text.replace(/[│┌┐└┘─┬┴├┤]/g, ' ');
  const m = /in:\s*([\d.]+)\s*(KiB|MiB|GiB|bytes)/.exec(clean);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = { bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[m[2]];
  return Math.round(n * unit);
}
