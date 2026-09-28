// The KPI tiles and the category bar: counted by DuckDB over the grid's
// current filters, never by the browser over a page of rows.
import { fmtBytes } from './loading.js';

const el = (id) => document.getElementById(id);
// F-GEODEMO-G: a KPI that cannot yet read its number says so.
const fmtNumber = (n) => (Number.isFinite(n) ? n.toLocaleString() : 'unknown');

/**
 * The grid's live filter as a list of conditions.
 * @param {object} grid the grid
 * @returns {object[]} its conditions
 */
function conditionsOf(grid) {
  const live = grid.filters.get();
  return live && Array.isArray(live.conditions) ? live.conditions : (live ? [live] : []);
}

/**
 * Places in view and the top-12 categories, over the grid's current filters.
 * Both aggregates run one after another on the one shared connection;
 * `category notBlank` is in the aggregate's own filter, so DuckDB drops the
 * uncategorised rows itself.
 * @param {object} grid the grid whose filters are read
 * @param {object} source its pushdown source
 * @param {object} barGrid the bar chart's grid
 * @returns {Promise<{category: string, n: number}[]>} the categories drawn
 */
export async function refreshStats(grid, source, barGrid) {
  const conditions = conditionsOf(grid);
  const totalAgg = await source.aggregate({ filters: conditions.length ? { op: 'and', conditions } : null },
    [{ id: 'n', col: 'name', fn: 'count' }]);
  const catFilter = { op: 'and', conditions: [...conditions, { col: 'category', op: 'notBlank' }] };
  const catAgg = await source.aggregate({ filters: catFilter, groupBy: ['category'] }, [{ id: 'n', col: 'category', fn: 'count' }]);
  const categoryRows = (catAgg.groups || [])
    .filter((g) => g.keys.length > 0 && g.keys[0])
    .map((g) => ({ category: g.keys[0], n: Number(g.values.n) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
  barGrid.rows.load(categoryRows);
  el('t-rows').textContent = fmtNumber(Number(totalAgg.values?.n));
  return categoryRows;
}

/**
 * The three byte tiles: fetched from the remote file, its size, the share.
 * @param {number} fetched bytes the engine pulled from the partition
 * @param {number} total the partition's size
 * @returns {void}
 */
export function showBytes(fetched, total) {
  el('t-total').textContent = fmtBytes(total);
  el('t-bytes').textContent = fmtBytes(fetched);
  el('t-pct').textContent = total ? `${((100 * fetched) / total).toFixed(3)}%` : 'unknown';
}
