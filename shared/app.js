/**
 * app.js — MapLibre GL JS port of the DST Map Application
 *
 * Drop-in replacement for the Leaflet version.
 * CONFIG object in config.js is unchanged.
 *
 * New capabilities vs. Leaflet version:
 *   - Right-click drag  → pitch/tilt (0–85°)
 *   - Two-finger rotate → bearing
 *   - 3D terrain        → enable CONFIG.terrain: true
 *   - Hardware-accelerated WebGL rendering
 *   - Native COG/raster support via addSource type:'raster'
 *
 * Dependencies (loaded via CDN in index.html):
 *   - MapLibre GL JS 4.x
 *   - D3 v7
 */

'use strict';

// =============================================================================
// COLOR ENGINE  (unchanged from Leaflet version)
// =============================================================================
function getColor(value, layerDef) {
  const { colorBreaks: breaks, colorPalette: palette, colorType } = layerDef;
  if (colorType === 'categorical') {
    if (value == null || isNaN(Number(value))) return palette[0]; // ← ADD THIS LINE
    const idx = Math.round(value) - 1;
    return palette[Math.min(Math.max(idx, 0), palette.length - 1)];
  }
  if (value === null || value === undefined || isNaN(value)) return '#cccccc';
  if (value <= breaks[0]) return palette[0];
  if (value >= breaks[breaks.length - 1]) return palette[palette.length - 1];
  for (let i = 0; i < breaks.length - 1; i++) {
    if (value >= breaks[i] && value < breaks[i + 1]) return palette[i];
  }
  return palette[palette.length - 1];
}

function getDualColor(valueA, valueB, layerDef) {
  const { colorBreaks: breaks, colorPaletteA: palA, colorPaletteB: palB } = layerDef;
  const dominant = valueA >= valueB ? valueA : valueB;
  const palette  = valueA >= valueB ? palA : palB;
  if (dominant >= breaks[breaks.length - 1]) return palette[palette.length - 1];
  if (dominant <= breaks[0]) return palette[0];
  for (let i = 0; i < breaks.length - 1; i++) {
    if (dominant > breaks[i] && dominant <= breaks[i + 1]) return palette[i];
  }
  return palette[palette.length - 1];
}

// Build a MapLibre match expression for sequential color breaks
function buildMatchExpression(field, breaks, palette) {
  const expr = ['step', ['get', field]];
  expr.push(palette[0]);
  for (let i = 0; i < breaks.length - 1; i++) {
    expr.push(breaks[i + 1]);
    expr.push(palette[Math.min(i + 1, palette.length - 1)]);
  }
  return expr;
}

// =============================================================================
// MODULE STATE
// =============================================================================
let _map            = null;
let _geojsonCache   = {};
let _sortedFeatures = [];
let _layerDefs      = {};      // id → layerDef (config entry)
let _activeLayers   = new Set();
let _currentOpacity = 0.8;
let _swing          = { rest: null, prot: null };  // swing-weight elicitation state
let _spread         = { rest: [], prot: [] };     // per-criterion utility spread
let _hasCalculated  = false;                      // live map updates after first Calculate
let _drag           = null;                       // in-flight row drag
let _restoreArrays  = [];
let _protectArrays  = [];
let _popup          = null;
let _legendControls = {};

// =============================================================================
// ENTRY POINT
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setTitle();
  initMap();
  // Map must be loaded before adding layers
  _map.on('load', async () => {
    if (CONFIG.terrain) addTerrain();
    await loadAllLayers();
    buildLayerPanel();
    buildOpacityControl();
    buildInfoPopup();
    if (CONFIG.dst?.enabled) buildDSTPanel();
  });
});

// =============================================================================
// TITLE
// =============================================================================
function setTitle() {
  document.title = CONFIG.title;
  const el = document.getElementById('app-title');
  if (el) el.textContent = CONFIG.title;
}

// =============================================================================
// MAP INIT
// =============================================================================
function initMap() {
  _map = new maplibregl.Map({
    container: 'map',
    style: getBaseStyle(CONFIG.defaultBasemap || 'light'),
    center:  [CONFIG.center[1], CONFIG.center[0]], // MapLibre uses [lng, lat]
    zoom:    CONFIG.zoom,
    pitch:   CONFIG.defaultPitch   || 0,
    bearing: CONFIG.defaultBearing || 0,
    antialias: true
  });

  // Navigation control (zoom + compass + pitch reset)
  _map.addControl(new maplibregl.NavigationControl({
    visualizePitch: true
  }), 'top-right');

  // Scale
  _map.addControl(new maplibregl.ScaleControl({
    unit: 'imperial'
  }), 'bottom-left');

  // Fullscreen
  _map.addControl(new maplibregl.FullscreenControl(), 'top-right');

  // Popup (reused for hover)
  _popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'dst-popup'
  });

  // DST panel toggle
  document.getElementById('dst-toggle')?.addEventListener('click', () => {
    document.getElementById('dst-panel')?.classList.toggle('open');
  });



  // Back link
  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = CONFIG.backLink || '/';
}

function getBaseStyle(name) {
  const styles = {
    light:     'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    dark:      'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    satellite: 'https://api.maptiler.com/maps/satellite/style.json?key=L9m2QvkG3KvfZEuyAa2n',
    topo:      'https://api.maptiler.com/maps/topo-v2/style.json?key=L9m2QvkG3KvfZEuyAa2n',
    // Free alternative that needs no API key:
    osm:       'https://tiles.openfreemap.org/styles/liberty'
  };
  // Default to CartoDB light if key not set
  return styles[name] || styles.light;
}

// =============================================================================
// 3D TERRAIN
// =============================================================================
function addTerrain() {
  // Uses MapTiler terrain tiles — swap for any DEM source
  if (!_map.getSource('terrain-dem')) {
    _map.addSource('terrain-dem', {
      type: 'raster-dem',
      url:  'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=L9m2QvkG3KvfZEuyAa2n',
      tileSize: 256
    });
  }
  _map.setTerrain({ 
      source: 'terrain-dem', 
      exaggeration: CONFIG.terrainExaggeration || 1.5 
  });
}

// =============================================================================
// LAYER LOADING
// =============================================================================
async function loadAllLayers() {
  // Fetch all unique GeoJSON files in parallel
  const filePromises = {};
  for (const lyr of CONFIG.layers) {
    if (lyr.file && !filePromises[lyr.file]) {
      filePromises[lyr.file] = fetchGeoJSON(lyr.file);
    }
  }
  const entries = await Promise.all(
    Object.entries(filePromises).map(([f, p]) => p.then(d => [f, d]))
  );
  entries.forEach(([f, d]) => { _geojsonCache[f] = d; });

  // Sort features for DST indexing
  if (CONFIG.dst?.enabled && CONFIG.dst?.sortField) {
    const srcFile = CONFIG.layers.find(l => l.type === 'dst' || l.type === 'dual')?.file
                 || CONFIG.layers.find(l => l.file)?.file;
    if (srcFile && _geojsonCache[srcFile]) {
      _sortedFeatures = [..._geojsonCache[srcFile].features]
        .sort((a, b) => a.properties[CONFIG.dst.sortField] - b.properties[CONFIG.dst.sortField]);
    }
  }

  for (const lyrDef of CONFIG.layers) {
    _layerDefs[lyrDef.id] = lyrDef;
    await addLayer(lyrDef);
    if (lyrDef.defaultOn) {
      _activeLayers.add(lyrDef.id);
    }
  }
}

async function fetchGeoJSON(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return res.json();
}

async function addLayer(lyrDef) {
  try {
    if (lyrDef.type === 'geojson' || lyrDef.type === 'dual' || lyrDef.type === 'dst') {
      await addGeoJSONLayer(lyrDef);
    } else if (lyrDef.type === 'wms') {
      addWMSLayer(lyrDef);
    } else if (lyrDef.type === 'cog') {
      addCOGLayer(lyrDef);
    } else if (lyrDef.type === 'hillshade') {
      // Reuse the terrain-dem source if already loaded, otherwise add it
      if (!_map.getSource('terrain-dem')) {
        _map.addSource('terrain-dem', {
          type: 'raster-dem',
          url:  'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=YOUR_NEW_KEY',
          tileSize: 256
        });
      }
      _map.addLayer({
        id:     'layer-hillshade',
        type:   'hillshade',
        source: 'terrain-dem',
        layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
        paint: {
          'hillshade-exaggeration':        0.6,
          'hillshade-shadow-color':     '#3a2a1a',
          'hillshade-highlight-color':  '#ffffff',
          'hillshade-accent-color':     '#5a4a3a',
          'hillshade-illumination-direction': 315  // NW light source
        }
      }, 'layer-sg') // ← inserts BELOW your data layers so they show on top
    }


  } catch (err) {
    console.error(`Error adding layer "${lyrDef.id}":`, err);
  }
}

async function addGeoJSONLayer(lyrDef) {
  const data = _geojsonCache[lyrDef.file];
  if (!data) return;

  const sourceId = `source-${lyrDef.id}`;
  const layerId  = `layer-${lyrDef.id}`;

  // Add GeoJSON with computed fill colors as a feature property
  const colored = applyColorsToFeatures(data, lyrDef);

  _map.addSource(sourceId, { type: 'geojson', data: colored });

  // Determine geometry type
  const geomType = data.features[0]?.geometry?.type || 'Polygon';
  const isLine   = geomType.includes('LineString');
  const isPoint  = geomType.includes('Point');

  if (isLine) {
    _map.addLayer({
      id:     layerId,
      type:   'line',
      source: sourceId,
      layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
      paint: {
        'line-color':   ['get', '_fillColor'],
        'line-width':   lyrDef.strokeWeight || 2,
        'line-opacity': _currentOpacity
      }
    });
  } else if (isPoint) {
    _map.addLayer({
      id:     layerId,
      type:   'circle',
      source: sourceId,
      layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
      paint: {
        'circle-color':        ['get', '_fillColor'],
        'circle-radius':       lyrDef.pointRadius || 6,
        'circle-opacity':      _currentOpacity,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
      }
    });
  } else {
    // Polygon fill
    _map.addLayer({
      id:     layerId,
      type:   'fill',
      source: sourceId,
      layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
      paint: {
        'fill-color':   ['get', '_fillColor'],
        'fill-opacity': _currentOpacity
      }
    });

    // Polygon outline
    _map.addLayer({
      id:     `${layerId}-outline`,
      type:   'line',
      source: sourceId,
      layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
      paint: {
        'line-color':   lyrDef.strokeColor || '#555',
        'line-width':   lyrDef.strokeWeight !== undefined ? lyrDef.strokeWeight : 0.5,
        'line-opacity': Math.min(_currentOpacity + 0.1, 1)
      }
    });

    // Hover highlight layer
    _map.addLayer({
      id:     `${layerId}-hover`,
      type:   'fill',
      source: sourceId,
      layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
      paint: {
        'fill-color':   '#fff',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.25, 0]
      }
    });
  }

  // Hover interactions
  let hoveredId = null;
  _map.on('mousemove', layerId, e => {
    _map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0) {
      if (hoveredId !== null) {
        _map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false });
      }
      hoveredId = e.features[0].id;
      _map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: true });
      showPopup(e.lngLat, e.features[0].properties);
    }
  });

  _map.on('mouseleave', layerId, () => {
    _map.getCanvas().style.cursor = '';
    if (hoveredId !== null) {
      _map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false });
    }
    hoveredId = null;
    _popup.remove();
  });

  _map.on('click', layerId, e => {
    _map.fitBounds(
      turf_bbox(e.features[0].geometry),
      { padding: 60, maxZoom: 14 }
    );
  });
}

function addWMSLayer(lyrDef) {
  _map.addSource(`source-${lyrDef.id}`, {
    type:  'raster',
    tiles: [`${lyrDef.url}?bbox={bbox-epsg-3857}&format=${lyrDef.wmsFormat || 'image/png'}&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&transparent=true&width=256&height=256&layers=${lyrDef.wmsLayers}`],
    tileSize: 256
  });
  _map.addLayer({
    id:     `layer-${lyrDef.id}`,
    type:   'raster',
    source: `source-${lyrDef.id}`,
    layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
    paint:  { 'raster-opacity': _currentOpacity }
  });
}

function addCOGLayer(lyrDef) {
  // COG via raster tile protocol — works for any HTTP-accessible GeoTIFF
  // For local files, use a tile server or convert to MBTiles
  _map.addSource(`source-${lyrDef.id}`, {
    type: 'raster',
    url:  lyrDef.file,
    tileSize: 256
  });
  _map.addLayer({
    id:     `layer-${lyrDef.id}`,
    type:   'raster',
    source: `source-${lyrDef.id}`,
    layout: { visibility: lyrDef.defaultOn ? 'visible' : 'none' },
    paint:  { 'raster-opacity': _currentOpacity }
  });
}

// Reload all layers after basemap style change
function reloadLayers() {
  for (const lyrDef of CONFIG.layers) {
    addLayer(lyrDef).catch(console.error);
  }
  updateAllLayerVisibility();
}

// =============================================================================
// COLOR APPLICATION
// =============================================================================
function applyColorsToFeatures(geojson, lyrDef) {
  return {
    ...geojson,
    features: geojson.features.map((feat, idx) => {
      const props = feat.properties;
      let fillColor = '#cccccc';

      if (lyrDef.type === 'dual') {
        fillColor = getDualColor(props[lyrDef.colorFieldA], props[lyrDef.colorFieldB], lyrDef);
      } else if (lyrDef.type === 'dst') {
        fillColor = props._dstColor || '#cccccc';
      } else {
        fillColor = getColor(props[lyrDef.colorField], lyrDef);
      }

      return {
        ...feat,
        id: idx,  // required for feature-state (hover)
        properties: { ...props, _fillColor: fillColor }
      };
    })
  };
}

// Recolor a layer after DST calculation
function recolorLayer(lyrDef) {
  const sourceId = `source-${lyrDef.id}`;
  if (!_map.getSource(sourceId)) return;
  const data    = _geojsonCache[lyrDef.file];
  const colored = applyColorsToFeatures(data, lyrDef);
  _map.getSource(sourceId).setData(colored);
}

// =============================================================================
// LAYER PANEL  (custom — replaces Leaflet layer control)
// =============================================================================
function buildLayerPanel() {
  const panel = document.getElementById('layer-panel-inner');  // ← changed
  if (!panel) return;

  // Basemap switcher
  let html = `
    <div class="lp-section">
      <div class="lp-title">Base map</div>
      <select id="basemap-select" class="lp-select">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="osm">OpenStreetMap</option>
        <option value="satellite">Satellite</option>
        <option value="topo">Topo</option>
      </select>
    </div>
    <div class="lp-section">
      <div class="lp-title">Layers</div>
  `;

  for (const lyrDef of CONFIG.layers) {
    const checked = lyrDef.defaultOn ? 'checked' : '';
    html += `
      <label class="lp-row">
        <input type="checkbox" class="lp-check" data-layer="${lyrDef.id}" ${checked}>
        <span>${lyrDef.label}</span>
      </label>
    `;
  }

  html += `</div>`;
  panel.innerHTML = html;

  panel.querySelectorAll('.lp-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const id  = e.target.dataset.layer;
      const vis = e.target.checked ? 'visible' : 'none';
      setLayerVisibility(id, vis);
      e.target.checked ? _activeLayers.add(id) : _activeLayers.delete(id);
      e.target.checked ? showLegend(_layerDefs[id]) : hideLegend(id);
    });
  });

  // Show initial legends
  CONFIG.layers.filter(l => l.defaultOn).forEach(showLegend);

  document.getElementById('basemap-select').addEventListener('change', e => {
    _map.setStyle(getBaseStyle(e.target.value));
    _map.once('styledata', () => {
      if (CONFIG.terrain) addTerrain();
      reloadLayers();
    });
  });
}

function setLayerVisibility(id, visibility) {
  const layerId = `layer-${id}`;
  ['', '-outline', '-hover'].forEach(suffix => {
    if (_map.getLayer(layerId + suffix)) {
      _map.setLayoutProperty(layerId + suffix, 'visibility', visibility);
    }
  });
}

function updateAllLayerVisibility() {
  CONFIG.layers.forEach(l => {
    setLayerVisibility(l.id, _activeLayers.has(l.id) ? 'visible' : 'none');
  });
}

// =============================================================================
// OPACITY CONTROL
// =============================================================================
function buildOpacityControl() {
  const panel = document.getElementById('layer-panel-inner');  // ← changed
  if (!panel) return;

  const wrap = document.createElement('div');
  wrap.className = 'lp-section';
  wrap.innerHTML = `
    <div class="lp-title">Opacity</div>
    <div style="display:flex;align-items:center;gap:8px;">
      <input type="range" id="opacity-slider" min="0" max="1" step="0.05"
        value="${_currentOpacity}" style="flex:1;">
      <span id="opacity-val" style="font-size:11px;width:30px;">${Math.round(_currentOpacity*100)}%</span>
    </div>
  `;
  panel.appendChild(wrap);

  document.getElementById('opacity-slider').addEventListener('input', e => {
    _currentOpacity = parseFloat(e.target.value);
    document.getElementById('opacity-val').textContent = Math.round(_currentOpacity * 100) + '%';
    CONFIG.layers.forEach(l => {
      const lid = `layer-${l.id}`;
      if (_map.getLayer(lid)) {
        const type = _map.getLayer(lid).type;
        if      (type === 'fill')   _map.setPaintProperty(lid, 'fill-opacity', _currentOpacity);
        else if (type === 'line')   _map.setPaintProperty(lid, 'line-opacity', _currentOpacity);
        else if (type === 'circle') _map.setPaintProperty(lid, 'circle-opacity', _currentOpacity);
        else if (type === 'raster') _map.setPaintProperty(lid, 'raster-opacity', _currentOpacity);
      }
    });
  });
}

// =============================================================================
// HOVER POPUP
// =============================================================================
function buildInfoPopup() {
  // Popup CSS injected dynamically
  const style = document.createElement('style');
  style.textContent = `
    .dst-popup .maplibregl-popup-content {
      background: rgba(255,255,255,0.97);
      border-radius: 4px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      padding: 0;
      min-width: 200px;
      max-width: 280px;
      font-family: 'DM Sans', sans-serif;
      font-size: 0.8rem;
      overflow: hidden;
    }
    .dst-popup .maplibregl-popup-tip { border-top-color: rgba(255,255,255,0.97); }
    .popup-header { background:#555;color:#fff;padding:5px 10px;font-weight:500; }
    .popup-row { display:flex;justify-content:space-between;padding:3px 10px;border-bottom:1px solid #f0f0f0; }
    .popup-row:last-child { border-bottom:none; }
    .popup-key { color:#666; }
    .popup-val { font-weight:500;color:#222; }
  `;
  document.head.appendChild(style);
}

function showPopup(lngLat, props) {
  const fields = CONFIG.hoverFields || [];
  const idField = CONFIG.dst?.sortField || fields[0]?.field;
  const idVal   = idField ? props[idField] : '';

  let rows = fields.map(f => {
    let val = props[f.field];
    if (val === null || val === undefined) return '';
    if      (f.format === 'pct')     val = (val * 100).toFixed(1) + '%';
    else if (f.format === 'int')     val = Math.round(val).toLocaleString();
    else if (f.format === 'gallons') val = (val / 1e6).toFixed(2) + 'M gal';
    else if (f.decimals !== undefined) val = Number(val).toFixed(f.decimals);
    return `<div class="popup-row"><span class="popup-key">${f.label}</span><span class="popup-val">${val}</span></div>`;
  }).join('');

  _popup
    .setLngLat(lngLat)
    .setHTML(`<div class="popup-header">${CONFIG.searchLabel || 'ID'}: ${idVal}</div><div>${rows}</div>`)
    .addTo(_map);
}

// =============================================================================
// LEGEND SYSTEM  (unchanged logic, rendered as custom HTML controls)
// =============================================================================
function showLegend(lyrDef) {
  if (lyrDef.type === 'hillshade') return;  // ← add this line
  if (_legendControls[lyrDef.id]) return;

  const container = document.getElementById('legend-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className  = 'map-legend';
  div.dataset.id = lyrDef.id;
  div.innerHTML  = buildLegendHTML(lyrDef);
  container.appendChild(div);
  _legendControls[lyrDef.id] = div;
}

function hideLegend(layerId) {
  const el = _legendControls[layerId];
  if (el) { el.remove(); delete _legendControls[layerId]; }
}

function buildLegendHTML(lyrDef) {
  const title = `<div class="legend-title">${lyrDef.legendTitle || lyrDef.label}</div>`;
  if (lyrDef.type === 'dual') {
    const headA  = lyrDef.legendHeadA || 'Restore';
    const headB  = lyrDef.legendHeadB || 'Protect';
    const labels = lyrDef.legendLabels || [];
    const col    = (palette) => palette.map((c, i) => `
      <div class="legend-item">
        <div class="legend-swatch" style="background:${c}"></div>
        <span class="legend-label">${labels[i] || ''}</span>
      </div>`).join('');
    return `${title}
      <div class="legend-dual">
        <div><div class="legend-dual-head">${headA}</div>${col(lyrDef.colorPaletteA)}</div>
        <div><div class="legend-dual-head">${headB}</div>${col(lyrDef.colorPaletteB)}</div>
      </div>`;
  }
  const palette = lyrDef.colorPalette || [];
  const labels  = lyrDef.legendLabels || palette.map(() => '');
  return title + palette.map((c, i) => `
    <div class="legend-item">
      <div class="legend-swatch" style="background:${c}"></div>
      <span class="legend-label">${labels[i]}</span>
    </div>`).join('');
}

// =============================================================================
// DST PANEL — SWING WEIGHTING (replaces abbreviated AHP)
//
// Elicitation is two steps:
//   1. The user drags one criterion into the anchor slot. That criterion's
//      swing — the change in outcome from its worst to its best value across
//      this landscape — is the reference, pinned at 100.
//   2. Every other criterion is rated 0-100 against that reference.
// Weights are raw / sum(raw). No pairwise ratios, so no chaining and no
// consistency ratio: each criterion's weight rests on its own judgment.
// =============================================================================

const SWING_DEFAULT = 100;   // non-anchor sliders start tied to the anchor

function critList(prefix) {
  return prefix === 'rest'
    ? CONFIG.dst.restoration.criteria
    : CONFIG.dst.protection.criteria;
}

// Criteria may be plain strings (legacy) or objects {label, units, worst, best}
function critLabel(prefix, i) {
  const c = critList(prefix)[i];
  return typeof c === 'string' ? c : (c.label || `Criterion ${i + 1}`);
}

function critEndpoints(prefix, i) {
  const c = critList(prefix)[i];
  if (typeof c !== 'object') return null;
  if (c.worst == null && c.best == null) return null;
  const u = c.units ? ' ' + c.units : '';
  return `${c.worst}${u} → ${c.best}${u}`;
}

function utilArrays(prefix) {
  return prefix === 'rest' ? _restoreArrays : _protectArrays;
}

// Raw 0-100 rating; the anchor is always 100
function swingRaw(prefix, i) {
  return _swing[prefix].anchor === i ? 100 : _swing[prefix].values[i];
}

// Normalised weights, or null while no anchor has been set
function swingWeights(prefix) {
  if (_swing[prefix].anchor === null) return null;
  const raws = critList(prefix).map((_, i) => swingRaw(prefix, i));
  const tot  = raws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return null;
  return raws.map(v => v / tot);
}

function swingReady() {
  return !!(swingWeights('rest') && swingWeights('prot'));
}

// -----------------------------------------------------------------------------
// Utility spread — how much of the 0-1 scale each criterion actually occupies.
// span  = full observed range (min → max)
// core  = middle 80% (p10 → p90), which is what most features really see
// -----------------------------------------------------------------------------
function computeSwingSpreads() {
  ['rest', 'prot'].forEach(prefix => {
    const arrs = utilArrays(prefix) || [];
    _spread[prefix] = critList(prefix).map((_, i) => {
      const a = arrs[i];
      if (!a || !a.length) return null;
      const v = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
      if (!v.length) return null;
      const q = p => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
      const min = v[0], max = v[v.length - 1], p10 = q(0.10), p90 = q(0.90);
      return { min, max, p10, p90, span: max - min, core: p90 - p10 };
    });
  });
}

// =============================================================================
// PANEL BUILD
// =============================================================================
function buildDSTPanel() {
  const panel = document.getElementById('dst-panel');
  if (!panel || !CONFIG.dst) return;

  // Utility arrays must exist before the panel renders — the swing bars read them
  if (typeof CONFIG.dst.computeCriteriaArrays === 'function' && _sortedFeatures.length) {
    const r = CONFIG.dst.computeCriteriaArrays(_sortedFeatures);
    _restoreArrays = r.restoreArrays;
    _protectArrays = r.protectArrays;
  }
  computeSwingSpreads();

  ['rest', 'prot'].forEach(prefix => {
    _swing[prefix] = {
      order:  critList(prefix).map((_, i) => i),
      anchor: null,
      values: critList(prefix).map(() => SWING_DEFAULT)
    };
  });
  _hasCalculated = false;

  panel.innerHTML = `
    <div class="dst-header">
      <h2>Decision Tool</h2>
      <p>Set the <em>anchor</em> — the criterion whose worst-to-best swing moves
         the decision most — then rate the others against it.</p>
    </div>
    <div class="dst-body">
      <div class="dst-section" data-prefix="rest">
        <div class="dst-section-title">
          <span>Restoration criteria</span><span class="dst-step" data-step="rest"></span>
        </div>
        <div class="anchor-slot" data-prefix="rest"></div>
        <div class="crit-list"  data-prefix="rest"></div>
      </div>

      <div class="dst-section" data-prefix="prot">
        <div class="dst-section-title">
          <span>Protection criteria</span><span class="dst-step" data-step="prot"></span>
        </div>
        <div class="anchor-slot" data-prefix="prot"></div>
        <div class="crit-list"  data-prefix="prot"></div>
      </div>

      <div class="dst-section">
        <div class="dst-section-title"><span>Weight tally</span></div>
        <div id="swing-tally"></div>
      </div>

      <div class="dst-section" id="dst-chart-section" style="display:none;">
        <div class="dst-section-title"><span>Priority weights</span></div>
        <svg id="dst-chart" width="100%" height="160"></svg>
      </div>
    </div>
    <div class="dst-footer">
      <button id="btn-reset">Start over</button>
      <button id="btn-calculate" disabled>Calculate</button>
    </div>
  `;

  renderSwingSet('rest');
  renderSwingSet('prot');
  renderSwingTally();

  document.getElementById('btn-reset').addEventListener('click', resetDST);
  document.getElementById('btn-calculate').addEventListener('click', runDSTCalculation);

  if (!panel.dataset.swingBound) {
    panel.addEventListener('input',        onSwingSlider);
    panel.addEventListener('pointerdown',  onSwingPointerDown);
    panel.addEventListener('pointermove',  onSwingPointerMove);
    panel.addEventListener('pointerup',    onSwingPointerUp);
    panel.addEventListener('pointercancel', onSwingPointerUp);
    panel.addEventListener('keydown',      onSwingKeyDown);
    panel.dataset.swingBound = '1';
  }
}

// -----------------------------------------------------------------------------
// Row markup
// -----------------------------------------------------------------------------
function swingBarHTML(sp) {
  if (!sp) return '<div class="swing-meta"></div>';
  const pc = n => (Math.max(n, 0) * 100).toFixed(1);
  const flag = sp.span < 0.999 ? ' truncated' : '';
  return `
    <div class="swing-meta">
      <div class="swing-bar${flag}"
           title="Utility spans ${sp.min.toFixed(2)}–${sp.max.toFixed(2)} of the 0–1 scale. Middle 80% of features spans ${sp.core.toFixed(2)}.">
        <i class="sb-span" style="left:${pc(sp.min)}%;width:${pc(Math.max(sp.span, 0.008))}%"></i>
        <i class="sb-core" style="left:${pc(sp.p10)}%;width:${pc(Math.max(sp.core, 0.008))}%"></i>
      </div>
      <span class="swing-num">${sp.span.toFixed(2)}</span>
    </div>`;
}

function swingRowHTML(prefix, i, isAnchor) {
  const val = swingRaw(prefix, i);
  const w   = swingWeights(prefix);
  const pct = w ? (w[i] * 100).toFixed(1) + '%' : '—';
  const dis = (_swing[prefix].anchor === null || isAnchor) ? 'disabled' : '';
  const ends = critEndpoints(prefix, i);
  return `
    <button class="grip" data-prefix="${prefix}" data-idx="${i}"
            aria-label="Reorder ${critLabel(prefix, i)}"
            title="Drag to reorder — drop on the anchor slot to make it the reference"></button>
    <div class="crit-main">
      <div class="crit-top">
        <span class="crit-name">${critLabel(prefix, i)}</span>
        ${isAnchor ? '<span class="anchor-pill">Anchor</span>' : ''}
      </div>
      ${ends ? `<div class="crit-ends">${ends}</div>` : ''}
      ${swingBarHTML(_spread[prefix][i])}
      <div class="slider-wrap">
        <input type="range" class="swing-slider" min="0" max="100" step="1" value="${val}"
               data-prefix="${prefix}" data-idx="${i}" ${dis}
               aria-label="${critLabel(prefix, i)} swing rating">
        <span class="swing-nums"><span class="sw-raw">${val}</span><span class="sw-pct">${pct}</span></span>
      </div>
    </div>`;
}

function makeSwingRow(prefix, i, isAnchor) {
  const el = document.createElement('div');
  el.className = 'criterion-row swing-row'
    + (isAnchor ? ' is-anchor' : '')
    + (_swing[prefix].anchor === null && !isAnchor ? ' locked-out' : '');
  el.dataset.prefix = prefix;
  el.dataset.idx    = i;
  el.innerHTML      = swingRowHTML(prefix, i, isAnchor);
  return el;
}

function renderSwingSet(prefix) {
  const s = _swing[prefix];
  critList(prefix).forEach((_, i) => { if (!s.order.includes(i)) s.order.push(i); });

  const slot = document.querySelector(`.anchor-slot[data-prefix="${prefix}"]`);
  const list = document.querySelector(`.crit-list[data-prefix="${prefix}"]`);
  if (!slot || !list) return;

  slot.innerHTML = '';
  if (s.anchor === null) {
    slot.innerHTML = `
      <div class="anchor-empty">
        <strong>Set the anchor</strong>
        <span>Drag the criterion whose full range across these units moves the
              decision most. It sets the 100-point scale.</span>
      </div>`;
  } else {
    slot.appendChild(makeSwingRow(prefix, s.anchor, true));
  }

  list.innerHTML = '';
  s.order.filter(i => i !== s.anchor)
         .forEach(i => list.appendChild(makeSwingRow(prefix, i, false)));

  const step = document.querySelector(`.dst-step[data-step="${prefix}"]`);
  if (step) step.textContent = s.anchor === null ? 'Step 1 of 2' : 'Step 2 of 2';
}

// Cheap path while a slider is moving — numbers only, no DOM rebuild
function refreshSwingNumbers(prefix) {
  const w = swingWeights(prefix);
  document.querySelectorAll(`.swing-row[data-prefix="${prefix}"]`).forEach(row => {
    const i = +row.dataset.idx;
    row.querySelector('.sw-raw').textContent = swingRaw(prefix, i);
    row.querySelector('.sw-pct').textContent = w ? (w[i] * 100).toFixed(1) + '%' : '—';
  });
  renderSwingTally();
}

function renderSwingTally() {
  const host = document.getElementById('swing-tally');
  if (!host) return;

  host.innerHTML = ['rest', 'prot'].map(prefix => {
    const s = _swing[prefix], w = swingWeights(prefix);
    const name = prefix === 'rest' ? 'Restoration' : 'Protection';

    if (!w) {
      return `<div class="tally-block">
                <div class="tally-head"><span class="tally-name">${name}</span>
                  <span class="tally-sum pending">no anchor yet</span></div>
                <div class="tally-bar"></div>
                <div class="tally-note">Set an anchor to start rating.</div>
              </div>`;
    }

    const sum  = critList(prefix).reduce((a, _, i) => a + swingRaw(prefix, i), 0);
    const bars = s.order.map(i => {
      const t = swingRaw(prefix, i) / 100;
      return `<i style="width:${(w[i] * 100).toFixed(2)}%;
                        background:hsl(${42 - t * 8} ${26 + t * 44}% ${30 + t * 28}%)"
                 title="${critLabel(prefix, i)} — ${(w[i] * 100).toFixed(1)}%"></i>`;
    }).join('');

    const ties = critList(prefix)
      .filter((_, i) => i !== s.anchor && swingRaw(prefix, i) >= 100).length;
    const note = ties
      ? `<div class="tally-note">${ties} criteri${ties > 1 ? 'a tie' : 'on ties'} the anchor — judged equally influential.</div>`
      : `<div class="tally-note">Σ ${sum} raw points → weights sum to 1.000.</div>`;

    return `<div class="tally-block">
              <div class="tally-head"><span class="tally-name">${name}</span>
                <span class="tally-sum">Σ ${sum}</span></div>
              <div class="tally-bar">${bars}</div>
              ${note}
            </div>`;
  }).join('');

  const calc = document.getElementById('btn-calculate');
  if (calc) calc.disabled = !swingReady();
}

// =============================================================================
// INTERACTION — sliders
// =============================================================================
function onSwingSlider(e) {
  const el = e.target;
  if (!el.classList || !el.classList.contains('swing-slider')) return;
  const prefix = el.dataset.prefix, i = +el.dataset.idx;
  _swing[prefix].values[i] = +el.value;
  refreshSwingNumbers(prefix);
  if (_hasCalculated && swingReady()) applySwingToMap();
}

// =============================================================================
// INTERACTION — drag to reorder / anchor
// =============================================================================
function onSwingPointerDown(e) {
  const grip = e.target.closest && e.target.closest('.grip');
  if (!grip) return;
  e.preventDefault();

  const row    = grip.closest('.swing-row');
  const prefix = row.dataset.prefix, idx = +row.dataset.idx;

  const ghost = document.createElement('div');
  ghost.id = 'swing-ghost';
  ghost.innerHTML = `<div class="crit-name">${critLabel(prefix, idx)}</div>
                     <div class="gv">rating ${swingRaw(prefix, idx)}</div>`;
  document.body.appendChild(ghost);

  _drag = { prefix, idx, row, ghost, fromAnchor: _swing[prefix].anchor === idx };
  row.classList.add('dragging');
  grip.setPointerCapture(e.pointerId);
  moveSwingGhost(e);
}

function moveSwingGhost(e) {
  _drag.ghost.style.left = (e.clientX - 150) + 'px';
  _drag.ghost.style.top  = (e.clientY - 18)  + 'px';
}

function swingHit(el, e) {
  const b = el.getBoundingClientRect();
  return e.clientX >= b.left && e.clientX <= b.right &&
         e.clientY >= b.top - 6 && e.clientY <= b.bottom + 6;
}

function onSwingPointerMove(e) {
  if (!_drag) return;
  moveSwingGhost(e);

  const slot = document.querySelector(`.anchor-slot[data-prefix="${_drag.prefix}"]`);
  const list = document.querySelector(`.crit-list[data-prefix="${_drag.prefix}"]`);
  const overSlot = swingHit(slot, e) && !_drag.fromAnchor;
  slot.classList.toggle('drop-active', overSlot);
  if (overSlot || _drag.fromAnchor) return;

  const rows = [...list.children].filter(r => r !== _drag.row);
  let before = null;
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (e.clientY < b.top + b.height / 2) { before = r; break; }
  }
  before ? list.insertBefore(_drag.row, before) : list.appendChild(_drag.row);
}

function onSwingPointerUp(e) {
  if (!_drag) return;
  const { prefix, idx, row, ghost, fromAnchor } = _drag;
  const slot = document.querySelector(`.anchor-slot[data-prefix="${prefix}"]`);
  const list = document.querySelector(`.crit-list[data-prefix="${prefix}"]`);
  const onSlot = swingHit(slot, e) && !fromAnchor;
  const onList = fromAnchor && swingHit(list, e);

  ghost.remove();
  row.classList.remove('dragging');
  slot.classList.remove('drop-active');

  const s = _swing[prefix];
  const oldAnchor = s.anchor;
  let pool = [...list.children].map(r => +r.dataset.idx);

  if (onSlot) {
    // Promote. The outgoing anchor keeps its 100 and rejoins the pool, unlocked.
    pool = pool.filter(i => i !== idx);
    if (oldAnchor !== null && oldAnchor !== idx) {
      s.values[oldAnchor] = 100;
      pool.unshift(oldAnchor);
    }
    s.anchor = idx;
    s.values[idx] = 100;
  } else if (onList) {
    // Demote — slider unlocks at its last value
    s.anchor = null;
    pool.unshift(idx);
  }
  // A plain reorder needs nothing: the DOM already holds the new order

  s.order = s.anchor === null ? pool : [s.anchor, ...pool.filter(i => i !== s.anchor)];
  _drag = null;

  renderSwingSet(prefix);
  renderSwingTally();
  if (_hasCalculated && swingReady()) applySwingToMap();
}

// Keyboard: ↑/↓ reorder, Enter/Space promotes or demotes the anchor
function onSwingKeyDown(e) {
  const grip = e.target.closest && e.target.closest('.grip');
  if (!grip) return;
  const prefix = grip.dataset.prefix, idx = +grip.dataset.idx, s = _swing[prefix];

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (s.anchor === idx) {
      s.anchor = null;
    } else {
      if (s.anchor !== null) s.values[s.anchor] = 100;
      s.anchor = idx;
      s.values[idx] = 100;
      s.order = [idx, ...s.order.filter(i => i !== idx)];
    }
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (s.anchor === idx) return;
    const pool = s.order.filter(i => i !== s.anchor);
    const at = pool.indexOf(idx), to = at + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= pool.length) return;
    pool.splice(at, 1);
    pool.splice(to, 0, idx);
    s.order = s.anchor === null ? pool : [s.anchor, ...pool];
  } else return;

  renderSwingSet(prefix);
  renderSwingTally();
  if (_hasCalculated && swingReady()) applySwingToMap();
  const again = document.querySelector(`.grip[data-prefix="${prefix}"][data-idx="${idx}"]`);
  if (again) again.focus();
}

// FLIP so the post-Calculate re-rank reads as movement, not a jump cut
function flipSwingReorder(container, mutate) {
  if (!container) { mutate(); return; }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = new Map([...container.children]
    .map(el => [el.dataset.idx, el.getBoundingClientRect().top]));
  mutate();
  if (reduce) return;
  [...container.children].forEach(el => {
    const y0 = before.get(el.dataset.idx);
    if (y0 == null) return;
    const dy = y0 - el.getBoundingClientRect().top;
    if (!dy) return;
    el.style.transition = 'none';
    el.style.transform  = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform .38s cubic-bezier(.2,.8,.2,1)';
      el.style.transform  = '';
    });
  });
}

function resetDST() {
  ['rest', 'prot'].forEach(prefix => {
    _swing[prefix] = {
      order:  critList(prefix).map((_, i) => i),
      anchor: null,
      values: critList(prefix).map(() => SWING_DEFAULT)
    };
    renderSwingSet(prefix);
  });
  _hasCalculated = false;
  renderSwingTally();

  // Blank the decision layer
  _sortedFeatures.forEach(f => { delete f.properties._dstColor; });
  CONFIG.layers.filter(l => l.type === 'dst').forEach(recolorLayer);

  const chart = document.getElementById('dst-chart-section');
  if (chart) chart.style.display = 'none';
}

// =============================================================================
// DST CALCULATION
// =============================================================================

// Score every feature from the current swing weights and repaint the map.
// Called by Calculate, and again on every slider move once Calculate has run.
function applySwingToMap() {
  const wRest = swingWeights('rest');
  const wProt = swingWeights('prot');
  if (!wRest || !wProt || !_sortedFeatures.length) return null;

  const nF      = _sortedFeatures.length;
  const impVals = new Array(nF).fill(0);
  const prtVals = new Array(nF).fill(0);

  wRest.forEach((w, ci) => {
    if (!_restoreArrays[ci]) return;
    _restoreArrays[ci].forEach((v, fi) => { impVals[fi] += v * w; });
  });
  wProt.forEach((w, ci) => {
    if (!_protectArrays[ci]) return;
    _protectArrays[ci].forEach((v, fi) => { prtVals[fi] += v * w; });
  });

  const decBreaks = CONFIG.dst.decisionBreaks   || [0,0.125,0.25,0.375,0.5,0.625,0.75,0.875];
  const decPalA   = CONFIG.dst.decisionPaletteA || ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'];
  const decPalB   = CONFIG.dst.decisionPaletteB || ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'];
  const dstLyrDef = { colorBreaks: decBreaks, colorPaletteA: decPalA, colorPaletteB: decPalB };

  _sortedFeatures.forEach((feat, fi) => {
    feat.properties._dstScoreRestore = impVals[fi];
    feat.properties._dstScoreProtect = prtVals[fi];
    feat.properties._dstDirection    = impVals[fi] >= prtVals[fi] ? 'Restore' : 'Protect';
    feat.properties._dstColor        = getDualColor(impVals[fi], prtVals[fi], dstLyrDef);
  });

  CONFIG.layers.filter(l => l.type === 'dst').forEach(recolorLayer);
  return { wRest, wProt };
}

function runDSTCalculation() {
  if (!CONFIG.dst?.enabled || !_sortedFeatures.length) return;

  if (!_restoreArrays.length && typeof CONFIG.dst.computeCriteriaArrays === 'function') {
    const r = CONFIG.dst.computeCriteriaArrays(_sortedFeatures);
    _restoreArrays = r.restoreArrays;
    _protectArrays = r.protectArrays;
    computeSwingSpreads();
  }

  const res = applySwingToMap();
  if (!res) return;
  _hasCalculated = true;

  // Turn the decision layer on so the result is actually visible
  CONFIG.layers.filter(l => l.type === 'dst').forEach(l => {
    if (!_activeLayers.has(l.id)) {
      _activeLayers.add(l.id);
      setLayerVisibility(l.id, 'visible');
      showLegend(l);
      const cb = document.querySelector(`.lp-check[data-layer="${l.id}"]`);
      if (cb) cb.checked = true;
    }
  });

  // Re-rank rows high → low so the panel mirrors the weights
  ['rest', 'prot'].forEach(prefix => {
    const s = _swing[prefix];
    const pool = s.order.filter(i => i !== s.anchor)
                        .sort((a, b) => swingRaw(prefix, b) - swingRaw(prefix, a));
    s.order = [s.anchor, ...pool];
    flipSwingReorder(document.querySelector(`.crit-list[data-prefix="${prefix}"]`),
                     () => renderSwingSet(prefix));
  });
  renderSwingTally();

  drawWeightChart(
    res.wRest, res.wProt,
    critList('rest').map((_, i) => critLabel('rest', i)),
    critList('prot').map((_, i) => critLabel('prot', i))
  );
}

// =============================================================================
// D3 WEIGHT CHART  (unchanged from Leaflet version)
// =============================================================================
function drawWeightChart(rW, pW, rL, pL) {
  const section = document.getElementById('dst-chart-section');
  if (section) section.style.display = '';
  const svgEl = document.getElementById('dst-chart');
  if (!svgEl || typeof d3 === 'undefined') return;
  d3.select(svgEl).selectAll('*').remove();

  const allData = [
    ...rW.map((w,i) => ({ label: rL[i], value: w, group: 'Restore' })),
    { label: '', value: 0, group: 'spacer' },
    ...pW.map((w,i) => ({ label: pL[i], value: w, group: 'Protect' }))
  ];

  const labelWidth = 130, barH = 14, rowH = barH + 5;
  const margin = { top: 20, right: 45, bottom: 4, left: 8 };
  const svgWidth = svgEl.getBoundingClientRect().width || 290;
  const barWidth = svgWidth - margin.left - margin.right - labelWidth;
  const svgHeight = allData.length * rowH + 30;

  const xScale = d3.scaleLinear()
    .domain([0, d3.max(allData, d => d.value) * 1.15])
    .range([0, barWidth]);
  const colorScale = d3.scaleOrdinal()
    .domain(['Restore','Protect'])
    .range(['#c4963a','#4682b4']);

  d3.select(svgEl).attr('height', svgHeight);
  const svg = d3.select(svgEl).append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  let lastGroup = null, yOffset = 0;
  allData.forEach(d => {
    if (d.group === 'spacer') { yOffset += rowH; return; }
    if (d.group !== lastGroup) {
      svg.append('text').attr('x', labelWidth).attr('y', yOffset - 2)
        .attr('font-size','0.6rem').attr('fill','rgba(255,255,255,0.35)')
        .attr('letter-spacing','0.1em').text(d.group.toUpperCase());
      lastGroup = d.group; yOffset += 10;
    }
    const y = yOffset;
    svg.append('text').attr('x', labelWidth - 6).attr('y', y + barH * 0.78)
      .attr('text-anchor','end').attr('font-size','0.68rem')
      .attr('fill','rgba(255,255,255,0.65)').text(d.label);
    svg.append('rect').attr('x', labelWidth).attr('y', y)
      .attr('height', barH).attr('width', 0)
      .attr('fill', colorScale(d.group)).attr('opacity', 0.85)
      .transition().duration(500).attr('width', xScale(d.value));
    svg.append('text').attr('x', labelWidth + xScale(d.value) + 4)
      .attr('y', y + barH * 0.78).attr('font-size','0.65rem')
      .attr('fill','rgba(255,255,255,0.5)').text(d.value.toFixed(3));
    yOffset += rowH;
  });
}

// =============================================================================
// UTILITY
// =============================================================================
function utility(array, inMin, inMax, outMin, outMax) {
  return array.map(x => {
    const scaled = ((x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
    return Math.min(Math.max(scaled, Math.min(outMin, outMax)), Math.max(outMin, outMax));
  });
}

// Simple bbox without Turf dependency
function turf_bbox(geometry) {
  let minLng=Infinity, minLat=Infinity, maxLng=-Infinity, maxLat=-Infinity;
  const coords = geometry.type === 'Polygon' ? geometry.coordinates[0]
               : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(2)
               : [geometry.coordinates];
  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng; if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng; if (lat > maxLat) maxLat = lat;
  });
  return [[minLng, minLat], [maxLng, maxLat]];
}

window.utility = utility;
