// The map window: MapLibre draws the street tiles (OpenFreeMap), deck.gl
// draws the layers and owns the view. Past the binding's cap the engine's
// density cells become hexagons; under it, one dot per place by category.
import { LONDON } from './data.js?v=20261002f-0009';

// ColorBrewer PuBu (density, quantile classes) and Tableau 10 (categories).
const DENSITY = [[241, 238, 246], [208, 209, 230], [166, 189, 219], [116, 169, 207], [43, 140, 190], [4, 90, 141]];
const PALETTE = [[78, 121, 167], [242, 142, 43], [225, 87, 89], [118, 183, 178], [89, 161, 79],
  [237, 201, 72], [176, 122, 161], [255, 157, 167], [156, 117, 95], [186, 176, 172]];
const OTHER = [150, 150, 160];
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };

/**
 * Create the basemap and the deck, fitted to Greater London.
 * @param {HTMLElement} container the map window (holds #basemap and #deck)
 * @param {boolean} dark whether the page is under data-theme="dark"
 * @returns {{deckgl: object, basemap: object}}
 */
export function createMap(container, dark) {
  const { width, height } = container.getBoundingClientRect();
  const fit = new deck.WebMercatorViewport({ width, height })
    .fitBounds([[LONDON.lonMin, LONDON.latMin], [LONDON.lonMax, LONDON.latMax]], { padding: 8 });
  const view = { longitude: fit.longitude, latitude: fit.latitude, zoom: fit.zoom };
  const basemap = new maplibregl.Map({ container: container.querySelector('#basemap'), style: STYLE[dark ? 'dark' : 'light'],
    interactive: false, center: [view.longitude, view.latitude], zoom: view.zoom, attributionControl: false });
  const deckgl = new deck.Deck({
    parent: container.querySelector('#deck'), initialViewState: view, controller: true,
    getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
    getTooltip: ({ object }) => object && object.properties
      && `${object.properties.name || '(unnamed)'}\n${object.properties.category || 'uncategorised'}`,
    // The basemap follows deck's view on every frame.
    onAfterRender: () => {
      const vp = deckgl.getViewports()[0];
      if (vp) basemap.jumpTo({ center: [vp.longitude, vp.latitude], zoom: vp.zoom });
    },
  });
  return { deckgl, basemap };
}

/**
 * One colour per category, in the bar chart's order; the rest share grey.
 * @param {{category: string}[]} top the top categories
 * @returns {Map<string, number[]>}
 */
export function categoryColours(top) {
  return new Map(top.slice(0, PALETTE.length).map((c, i) => [c.category, PALETTE[i]]));
}

/**
 * deck's layers for one render of the binding.
 * @param {object[]} rows the rows, or the engine's density cells when `ctx.binned`
 * @param {object} ctx the binding's layer context
 * @param {Map<string, number[]>} colours category colours
 * @returns {object[]} layers
 */
export function mapLayers(rows, ctx, colours) {
  if (ctx.binned) {
    // Hexagons a little wider than the engine's square cells, so each cell lands in one.
    const c = rows[0] || {};
    const cellKm = Math.abs(c.east - c.west) * 111 * Math.cos((((c.north + c.south) / 2) * Math.PI) / 180) || 0.5;
    return [new deck.HexagonLayer({
      id: 'density', data: rows, gpuAggregation: false, extruded: false, opacity: 0.6, coverage: 0.95,
      radius: Math.max(20, cellKm * 1000 * 0.75), colorRange: DENSITY, colorScaleType: 'quantile',
      getPosition: (d) => [(d.west + d.east) / 2, (d.south + d.north) / 2],
      getColorWeight: (d) => d.count, colorAggregation: 'SUM',
    })];
  }
  return [new deck.ScatterplotLayer({
    id: 'places', data: ctx.features, pickable: true, radiusUnits: 'pixels', getRadius: 3, opacity: 0.85,
    stroked: true, lineWidthUnits: 'pixels', getLineWidth: 0.5, getLineColor: [255, 255, 255],
    getPosition: (f) => f.geometry.coordinates,
    getFillColor: (f) => colours.get(f.properties.category) || OTHER,
    updateTriggers: { getFillColor: [...colours.keys()].join() },
  })];
}

/**
 * The readout under the map: drawn, matched, binned, and who counted.
 * @param {object} ctx the binding's layer context
 * @returns {string}
 */
export function readout(ctx) {
  const p = ctx.provenance;
  return `drawn ${p.rows.toLocaleString()} of ${p.matched.toLocaleString()} matched`
    + (p.binned ? ` · binned into ${p.cells.toLocaleString()} cells` : '')
    + ` · counted by ${p.computed === 'engine' ? 'engine' : 'browser'}` + (ctx.pending ? ' · loading' : '');
}

/**
 * The category legend, one swatch per coloured category.
 * @param {Map<string, number[]>} colours category colours
 * @returns {string} HTML
 */
export function legendHtml(colours) {
  return [...colours, ['other', OTHER]].map(([name, c]) =>
    `<span><i style="background:rgb(${c})"></i>${String(name).replace(/[<&]/g, '')}</span>`).join('');
}
