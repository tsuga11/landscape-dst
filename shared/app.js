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
let _models         = [];                         // resolved DST criteria models
let _critArrays     = {};                         // model key → [criterion][feature]
let _swing          = {};                         // model key → elicitation state
let _spread         = {};                         // model key → per-criterion spread
let _scaleCache     = {};                         // 'model:idx' → resolved scaling
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

  // The DST decision layer carries no palette of its own — it is coloured at
  // runtime from CONFIG.dst. Dual ramp for two criteria models, single for one.
  if (lyrDef.type === 'dst') {
    const sd     = decisionStyleDef();
    const labels = lyrDef.legendLabels || [];
    const col    = palette => palette.map((c, i) => `
      <div class="legend-item">
        <div class="legend-swatch" style="background:${c}"></div>
        <span class="legend-label">${labels[i] || ''}</span>
      </div>`).join('');

    if (_models.length >= 2) {
      const headA = lyrDef.legendHeadA || _models[0].legend;
      const headB = lyrDef.legendHeadB || _models[1].legend;
      return `${title}
        <div class="legend-dual">
          <div><div class="legend-dual-head">${headA}</div>${col(sd.colorPaletteA)}</div>
          <div><div class="legend-dual-head">${headB}</div>${col(sd.colorPaletteB)}</div>
        </div>`;
    }
    return title + col(sd.colorPalette);
  }

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
// CRITERION SCALING
//
// How raw values become utility in [0,1]. Declared in config rather than
// written imperatively, so the scaling choice is visible, reviewable, and
// drives BOTH the computed utility and the swing shown in the panel — the
// two can no longer disagree.
//
// Resolution order for a criterion's scaling spec:
//   criterion.scaling  →  CONFIG.dst.scaling  →  DEFAULT_SCALING
//
// Methods:
//   percentile  {method:'percentile', lower:0.05, upper:0.95}
//               Endpoints at data quantiles. THE DEFAULT. Robust to the
//               single extreme unit that otherwise compresses everything.
//   minmax      {method:'minmax'}
//               Endpoints at observed min/max. Hostage to outliers.
//   fixed       {method:'fixed', bounds:[lo,hi]}
//               Externally meaningful scale, in RAW units. Use when
//               comparability across geographies or time matters.
//   ramp        {method:'ramp', points:[[raw,util], …]}
//               Piecewise-linear membership function in RAW units — the
//               same shape as a fuzzy logic ramp. Allows plateaus, S-curves,
//               and thresholds. `direction` is ignored; the points carry it.
//
// Values outside the endpoints clamp to 0 or 1. The share of units clamped
// is reported in the panel so an over-tight ramp is visible rather than silent.
// =============================================================================

const DEFAULT_SCALING = { method: 'percentile', lower: 0.05, upper: 0.95 };

const TRANSFORMS = {
  log:   { fwd: v => Math.log(Math.max(v, 1e-9)),  inv: v => Math.exp(v) },
  log1p: { fwd: v => Math.log1p(Math.max(v, 0)),   inv: v => Math.expm1(v) },
  sqrt:  { fwd: v => Math.sqrt(Math.max(v, 0)),    inv: v => v * v },
};

function transformOf(name) {
  return TRANSFORMS[name] || { fwd: v => v, inv: v => v };
}

function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo  = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function resolveScaling(key, i) {
  const c = critList(key)[i];
  const spec = (c && typeof c === 'object' && c.scaling)
    || CONFIG.dst.scaling
    || DEFAULT_SCALING;
  if (typeof spec === 'string') return { method: spec };
  return spec;
}

// Piecewise-linear interpolation through raw-unit control points
function rampValue(v, points) {
  if (!points || points.length < 2) return 0;
  if (v <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (v >= last[0]) return last[1];
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1], [x1, y1] = points[k];
    if (v <= x1) {
      return x1 === x0 ? y1 : y0 + (y1 - y0) * ((v - x0) / (x1 - x0));
    }
  }
  return last[1];
}

// Everything the panel and the scorer need for one criterion.
// Returns null when the criterion is not declaratively specified.
function criterionScale(key, i) {
  const c = critList(key)[i];
  if (!c || typeof c !== 'object' || typeof c.raw !== 'function') return null;
  if (!_sortedFeatures.length) return null;

  const cacheKey = `${key}:${i}`;
  if (_scaleCache[cacheKey]) return _scaleCache[cacheKey];

  const tf   = transformOf(c.transform);
  const spec = resolveScaling(key, i);
  const lower = c.direction === 'lower';

  // Raw values, in native units
  const raw = _sortedFeatures.map(f => {
    let v; try { v = +c.raw(f); } catch (e) { v = NaN; }
    return Number.isFinite(v) ? v : NaN;
  });
  const finite = raw.filter(Number.isFinite);
  if (!finite.length) return null;

  let utilities, rawLo, rawHi, clamped = 0;

  if (spec.method === 'ramp') {
    const pts = (spec.points || []).slice().sort((a, b) => a[0] - b[0]);
    utilities = raw.map(v => Number.isFinite(v) ? rampValue(v, pts) : 0);
    rawLo = pts.length ? pts[0][0] : Math.min(...finite);
    rawHi = pts.length ? pts[pts.length - 1][0] : Math.max(...finite);
    clamped = finite.filter(v => v < rawLo || v > rawHi).length;
    // For a ramp, worst/best come from the points, not from `direction`
    const first = pts[0] || [rawLo, 0], lastP = pts[pts.length - 1] || [rawHi, 1];
    const ascending = lastP[1] >= first[1];
    var worstRaw = ascending ? rawLo : rawHi;
    var bestRaw  = ascending ? rawHi : rawLo;
  } else {
    // Work in transformed space, then report endpoints back in raw units
    const t = raw.map(v => Number.isFinite(v) ? tf.fwd(v) : NaN);
    const tFinite = t.filter(Number.isFinite).sort((a, b) => a - b);

    let tLo, tHi;
    if (spec.method === 'fixed') {
      const b = spec.bounds || [Math.min(...finite), Math.max(...finite)];
      tLo = tf.fwd(b[0]); tHi = tf.fwd(b[1]);
    } else if (spec.method === 'minmax') {
      tLo = tFinite[0]; tHi = tFinite[tFinite.length - 1];
    } else {  // percentile
      const lo = spec.lower != null ? spec.lower : DEFAULT_SCALING.lower;
      const hi = spec.upper != null ? spec.upper : DEFAULT_SCALING.upper;
      tLo = quantile(tFinite, lo); tHi = quantile(tFinite, hi);
    }
    if (!(tHi > tLo)) { tLo = tFinite[0]; tHi = tFinite[tFinite.length - 1]; }

    utilities = lower
      ? utility(t, tLo, tHi, 1, 0)
      : utility(t, tLo, tHi, 0, 1);
    utilities = utilities.map(v => Number.isFinite(v) ? v : 0);

    clamped = tFinite.filter(v => v < tLo || v > tHi).length;
    rawLo = tf.inv(tLo); rawHi = tf.inv(tHi);
    var worstRaw = lower ? rawHi : rawLo;
    var bestRaw  = lower ? rawLo : rawHi;
  }

  const out = {
    utilities, method: spec.method || 'percentile',
    worst: worstRaw, best: bestRaw,
    obsMin: Math.min(...finite), obsMax: Math.max(...finite),
    clampedFrac: clamped / finite.length,
    units: c.units || '', transform: c.transform || null,
    spec
  };
  _scaleCache[cacheKey] = out;
  return out;
}

// =============================================================================
// DST PANEL — SWING WEIGHTING
//
// Elicitation is two steps, per criteria model:
//   1. The user drags one criterion into the anchor slot. That criterion's
//      swing — the change in outcome from its worst to its best value across
//      this landscape — is the reference, pinned at 100.
//   2. Every other criterion is rated 0-100 against that reference.
// Weights are raw / sum(raw). No pairwise ratios, so no chaining and no
// consistency ratio: each criterion's weight rests on its own judgment.
//
// A geography may define one model (e.g. just "Priority") or two
// (e.g. "Restoration" + "Protection"). Two models are rendered with the
// dual restore/protect colour ramp; one model uses a single sequential ramp.
// =============================================================================

const SWING_DEFAULT = 100;   // non-anchor sliders start tied to the anchor

// -----------------------------------------------------------------------------
// Model resolution — supports both the legacy restoration/protection shape and
// a generic CONFIG.dst.models array.
// -----------------------------------------------------------------------------
function resolveDstModels() {
  const d = CONFIG.dst || {};

  if (Array.isArray(d.models) && d.models.length) {
    return d.models.map((m, i) => ({
      key:      m.key   || `model${i + 1}`,
      label:    m.label || `Criteria ${i + 1}`,
      legend:   m.legendHead || m.label || `Model ${i + 1}`,
      criteria: m.criteria || []
    }));
  }

  const out = [];
  if (d.restoration?.criteria) out.push({
    key: 'rest', label: d.restoration.label || 'Restoration criteria',
    legend: d.restoration.legendHead || 'Restore', criteria: d.restoration.criteria
  });
  if (d.protection?.criteria) out.push({
    key: 'prot', label: d.protection.label || 'Protection criteria',
    legend: d.protection.legendHead || 'Protect', criteria: d.protection.criteria
  });
  return out;
}

function modelOf(key)  { return _models.find(m => m.key === key); }
function critList(key) { return modelOf(key)?.criteria || []; }

// Criteria may be plain strings (legacy) or objects {label, units, worst, best}
function critLabel(key, i) {
  const c = critList(key)[i];
  return typeof c === 'string' ? c : (c?.label || `Criterion ${i + 1}`);
}

// Format a raw value compactly in its native units
function fmtRaw(v, units) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  let s;
  if (a >= 1e9)      s = (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  else if (a >= 1e6) s = (v / 1e6).toFixed(a >= 1e7  ? 0 : 1) + 'M';
  else if (a >= 1e4) s = Math.round(v / 1e3) + 'K';
  else if (a >= 100) s = Math.round(v).toLocaleString();
  else if (a >= 1)   s = v.toFixed(1);
  else               s = v.toFixed(2);
  if (units === '$') return (v < 0 ? '-$' : '$') + s.replace('-', '');
  return units ? `${s} ${units}` : s;
}

// The raw-unit swing a criterion is asking about, taken from the resolved
// scaling spec so the displayed endpoints are exactly the ones used to
// compute utility.
function critRawStats(key, i) {
  const sc = criterionScale(key, i);
  if (!sc) return null;
  const lower = sc.worst > sc.best;
  return {
    worst: sc.worst, best: sc.best,
    obsWorst: lower ? sc.obsMax : sc.obsMin,
    obsBest:  lower ? sc.obsMin : sc.obsMax,
    method: sc.method, clampedFrac: sc.clampedFrac,
    units: sc.units, transform: sc.transform
  };
}

function critEndpoints(key, i) {
  const c  = critList(key)[i];
  const st = critRawStats(key, i);

  // Static worst/best declared directly on the criterion
  if (!st) {
    if (!c || typeof c !== 'object' || (c.worst == null && c.best == null)) return null;
    const u = c.units ? ' ' + c.units : '';
    return `<div class="crit-ends">${c.worst}${u} <span class="ce-arrow">→</span> ${c.best}${u}</div>`;
  }

  const u    = st.units;
  const main = `${fmtRaw(st.worst, u)} <span class="ce-arrow">→</span> ${fmtRaw(st.best, u)}`;

  const METHOD_LABEL = {
    percentile: 'percentile ramp', minmax: 'full min–max',
    fixed: 'fixed scale', ramp: 'custom ramp'
  };

  const tip = [`This is the swing you are rating: ${fmtRaw(st.worst, u)} to ${fmtRaw(st.best, u)}.`];
  tip.push(`Endpoints set by ${METHOD_LABEL[st.method] || st.method}.`);
  tip.push(`Observed across all units: ${fmtRaw(st.obsWorst, u)} to ${fmtRaw(st.obsBest, u)}.`);
  if (st.clampedFrac > 0) {
    tip.push(`${(st.clampedFrac * 100).toFixed(1)}% of units fall outside and clamp to 0 or 1.`);
  }
  if (st.transform) {
    tip.push(`${st.transform}-transformed before rescaling, so the scale is not linear in these units.`);
  }

  // Note the tail only when a meaningful share of units is clamped
  const tag = st.clampedFrac >= 0.005
    ? ` <span class="ce-obs">${(st.clampedFrac * 100).toFixed(0)}% clamped</span>` : '';

  return `<div class="crit-ends" title="${tip.join(' ')}">${main}${tag}</div>`;
}

// Accepts {restoreArrays, protectArrays} (legacy), {arrays: [...]} for a single
// model, {arrays: {key: [...]}}, or {<key>Arrays: [...]}
function resolveCriteriaArrays(result) {
  const map = {};
  if (!result) return map;
  if (result.restoreArrays) map.rest = result.restoreArrays;
  if (result.protectArrays) map.prot = result.protectArrays;
  if (result.arrays) {
    if (Array.isArray(result.arrays)) {
      if (_models.length) map[_models[0].key] = result.arrays;
    } else {
      Object.assign(map, result.arrays);
    }
  }
  _models.forEach(m => {
    if (result[m.key + 'Arrays']) map[m.key] = result[m.key + 'Arrays'];
  });
  return map;
}

// True when every criterion declares raw + (implicitly) a scaling spec, so
// app.js can derive the utility arrays itself.
function isDeclarative() {
  return _models.length > 0 && _models.every(m =>
    m.criteria.length > 0 &&
    m.criteria.every(c => c && typeof c === 'object' && typeof c.raw === 'function'));
}

function loadCriteriaArrays() {
  if (!_sortedFeatures.length) return;
  _scaleCache = {};

  // Declarative path — scaling comes from the config spec, and the same
  // resolved endpoints feed both the utility arrays and the swing display.
  if (isDeclarative() && !CONFIG.dst.forceComputeFn) {
    _critArrays = {};
    _models.forEach(m => {
      _critArrays[m.key] = m.criteria.map((_, i) => {
        const sc = criterionScale(m.key, i);
        return sc ? sc.utilities : [];
      });
    });
  } else if (typeof CONFIG.dst.computeCriteriaArrays === 'function') {
    _critArrays = resolveCriteriaArrays(CONFIG.dst.computeCriteriaArrays(_sortedFeatures));
  } else {
    return;
  }

  // legacy globals kept in sync for any external code that reads them
  _restoreArrays = _critArrays.rest || [];
  _protectArrays = _critArrays.prot || [];
}

function hasCriteriaArrays() {
  return _models.some(m => (_critArrays[m.key] || []).length);
}

// -----------------------------------------------------------------------------
// Weights
// -----------------------------------------------------------------------------
function swingRaw(key, i) {
  return _swing[key].anchor === i ? 100 : _swing[key].values[i];
}

function swingWeights(key) {
  const s = _swing[key];
  if (!s || s.anchor === null) return null;
  const raws = critList(key).map((_, i) => swingRaw(key, i));
  const tot  = raws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return null;
  return raws.map(v => v / tot);
}

function swingReady() {
  return _models.length > 0 && _models.every(m => swingWeights(m.key));
}

// -----------------------------------------------------------------------------
// Utility spread — how much of the 0-1 scale each criterion actually occupies.
// span = full observed range; core = middle 80% (p10 → p90)
// -----------------------------------------------------------------------------
function computeSwingSpreads() {
  _models.forEach(m => {
    const arrs = _critArrays[m.key] || [];
    _spread[m.key] = m.criteria.map((_, i) => {
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

  _models = resolveDstModels();
  if (!_models.length) return;
  _scaleCache = {};

  // Utility arrays must exist before the panel renders — the swing bars read them
  loadCriteriaArrays();
  computeSwingSpreads();

  _swing = {};
  _models.forEach(m => {
    _swing[m.key] = {
      order:  m.criteria.map((_, i) => i),
      anchor: null,
      values: m.criteria.map(() => SWING_DEFAULT)
    };
  });
  _hasCalculated = false;

  const sections = _models.map(m => `
    <div class="dst-section" data-model="${m.key}">
      <div class="dst-section-title">
        <span>${m.label}</span><span class="dst-step" data-step="${m.key}"></span>
      </div>
      <div class="anchor-slot" data-model="${m.key}"></div>
      <div class="crit-list"  data-model="${m.key}"></div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="dst-header">
      <h2>Decision Tool</h2>
      <p>Set the <em>anchor</em> — the criterion whose worst-to-best swing moves
         the decision most — then rate the others against it.</p>
      <details class="swing-key">
        <summary>
          <span class="sk-chip"><i class="sk-core"></i></span> How to read each row
        </summary>
        <div class="sk-body">
          <div class="sk-row">
            <span class="sk-lead">Swing</span>
            <span>The line under the name gives the worst-to-best range in real
                  units. <b>That is what you are rating.</b> Ask how much that
                  movement is worth next to the anchor's.</span>
          </div>
          <div class="sk-row">
            <span class="sk-chip"><i class="sk-span" style="left:8%;width:84%"></i><i class="sk-core" style="left:26%;width:48%"></i></span>
            <span>The bar describes the data, not the swing. Gold marks where the
                  middle 80% of units fall — a narrow band means few units are
                  separated. That is not a reason to lower the rating; the model
                  already accounts for it.</span>
          </div>
          <div class="sk-row">
            <span class="sk-chip"><i class="sk-span trunc" style="left:22%;width:40%"></i><i class="sk-core" style="left:30%;width:24%"></i></span>
            <span>Red means the values never reach the ends of their scale, so the
                  swing above is wider than anything that occurs here. Narrow the
                  scale in the config rather than shading the slider down.</span>
          </div>
          <p class="sk-note">Criteria sharing units (two costs, say) should be
             rated in proportion to their ranges.</p>
        </div>
      </details>
    </div>
    <div class="dst-body">
      ${sections}
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

  _models.forEach(m => renderSwingSet(m.key));
  renderSwingTally();

  document.getElementById('btn-reset').addEventListener('click', resetDST);
  document.getElementById('btn-calculate').addEventListener('click', runDSTCalculation);

  if (!panel.dataset.swingBound) {
    panel.addEventListener('input',         onSwingSlider);
    panel.addEventListener('pointerdown',   onSwingPointerDown);
    panel.addEventListener('pointermove',   onSwingPointerMove);
    panel.addEventListener('pointerup',     onSwingPointerUp);
    panel.addEventListener('pointercancel', onSwingPointerUp);
    panel.addEventListener('keydown',       onSwingKeyDown);
    panel.dataset.swingBound = '1';
  }
}

// -----------------------------------------------------------------------------
// Row markup
// -----------------------------------------------------------------------------
function swingBarHTML(sp) {
  if (!sp) return '<div class="swing-meta"></div>';
  const pc   = n => (Math.max(n, 0) * 100).toFixed(1);
  const flag = sp.span < 0.995 ? ' truncated' : '';   // matches the 2-dp readout
  return `
    <div class="swing-meta">
      <div class="swing-bar${flag}"
           title="Distribution of the normalised values — not the swing. Values cover ${sp.min.toFixed(2)}–${sp.max.toFixed(2)} of the 0–1 scale; the middle 80% of units spans ${sp.core.toFixed(2)}. Rate the swing shown above the bar, not the width of this one.">
        <i class="sb-span" style="left:${pc(sp.min)}%;width:${pc(Math.max(sp.span, 0.008))}%"></i>
        <i class="sb-core" style="left:${pc(sp.p10)}%;width:${pc(Math.max(sp.core, 0.008))}%"></i>
      </div>
      <span class="swing-num">${sp.span.toFixed(2)}</span>
    </div>`;
}

function swingRowHTML(key, i, isAnchor) {
  const val  = swingRaw(key, i);
  const w    = swingWeights(key);
  const pct  = w ? (w[i] * 100).toFixed(1) + '%' : '—';
  const dis  = (_swing[key].anchor === null || isAnchor) ? 'disabled' : '';
  const ends = critEndpoints(key, i);
  return `
    <button class="grip" data-model="${key}" data-idx="${i}"
            aria-label="Reorder ${critLabel(key, i)}"
            title="Drag to reorder — drop on the anchor slot to make it the reference"></button>
    <div class="crit-main">
      <div class="crit-top">
        <span class="crit-name">${critLabel(key, i)}</span>
        ${isAnchor ? '<span class="anchor-pill">Anchor</span>' : ''}
      </div>
      ${ends || ''}
      ${swingBarHTML(_spread[key]?.[i])}
      <div class="slider-wrap">
        <input type="range" class="swing-slider" min="0" max="100" step="1" value="${val}"
               data-model="${key}" data-idx="${i}" ${dis}
               aria-label="${critLabel(key, i)} swing rating">
        <span class="swing-nums"><span class="sw-raw">${val}</span><span class="sw-pct">${pct}</span></span>
      </div>
    </div>`;
}

function makeSwingRow(key, i, isAnchor) {
  const el = document.createElement('div');
  el.className = 'criterion-row swing-row'
    + (isAnchor ? ' is-anchor' : '')
    + (_swing[key].anchor === null && !isAnchor ? ' locked-out' : '');
  el.dataset.model = key;
  el.dataset.idx   = i;
  el.innerHTML     = swingRowHTML(key, i, isAnchor);
  return el;
}

function renderSwingSet(key) {
  const s = _swing[key];
  if (!s) return;
  critList(key).forEach((_, i) => { if (!s.order.includes(i)) s.order.push(i); });

  const slot = document.querySelector(`.anchor-slot[data-model="${key}"]`);
  const list = document.querySelector(`.crit-list[data-model="${key}"]`);
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
    slot.appendChild(makeSwingRow(key, s.anchor, true));
  }

  list.innerHTML = '';
  s.order.filter(i => i !== s.anchor)
         .forEach(i => list.appendChild(makeSwingRow(key, i, false)));

  const step = document.querySelector(`.dst-step[data-step="${key}"]`);
  if (step) step.textContent = s.anchor === null ? 'Step 1 of 2' : 'Step 2 of 2';
}

// Cheap path while a slider is moving — numbers only, no DOM rebuild
function refreshSwingNumbers(key) {
  const w = swingWeights(key);
  document.querySelectorAll(`.swing-row[data-model="${key}"]`).forEach(row => {
    const i = +row.dataset.idx;
    row.querySelector('.sw-raw').textContent = swingRaw(key, i);
    row.querySelector('.sw-pct').textContent = w ? (w[i] * 100).toFixed(1) + '%' : '—';
  });
  renderSwingTally();
}

function renderSwingTally() {
  const host = document.getElementById('swing-tally');
  if (!host) return;

  host.innerHTML = _models.map(m => {
    const key = m.key, s = _swing[key], w = swingWeights(key);
    const name = m.label.replace(/\s*criteria$/i, '');

    if (!w) {
      return `<div class="tally-block">
                <div class="tally-head"><span class="tally-name">${name}</span>
                  <span class="tally-sum pending">no anchor yet</span></div>
                <div class="tally-bar"></div>
                <div class="tally-note">Set an anchor to start rating.</div>
              </div>`;
    }

    const sum  = critList(key).reduce((a, _, i) => a + swingRaw(key, i), 0);
    const bars = s.order.map(i => {
      const t = swingRaw(key, i) / 100;
      return `<i style="width:${(w[i] * 100).toFixed(2)}%;
                        background:hsl(${42 - t * 8} ${26 + t * 44}% ${30 + t * 28}%)"
                 title="${critLabel(key, i)} — ${(w[i] * 100).toFixed(1)}%"></i>`;
    }).join('');

    const ties = critList(key)
      .filter((_, i) => i !== s.anchor && swingRaw(key, i) >= 100).length;
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
  const key = el.dataset.model, i = +el.dataset.idx;
  _swing[key].values[i] = +el.value;
  refreshSwingNumbers(key);
  if (_hasCalculated && swingReady()) applySwingToMap();
}

// =============================================================================
// INTERACTION — drag to reorder / anchor
// =============================================================================
function onSwingPointerDown(e) {
  const grip = e.target.closest && e.target.closest('.grip');
  if (!grip) return;
  e.preventDefault();

  const row = grip.closest('.swing-row');
  const key = row.dataset.model, idx = +row.dataset.idx;

  const ghost = document.createElement('div');
  ghost.id = 'swing-ghost';
  ghost.innerHTML = `<div class="crit-name">${critLabel(key, idx)}</div>
                     <div class="gv">rating ${swingRaw(key, idx)}</div>`;
  document.body.appendChild(ghost);

  _drag = { key, idx, row, ghost, fromAnchor: _swing[key].anchor === idx };
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

  const slot = document.querySelector(`.anchor-slot[data-model="${_drag.key}"]`);
  const list = document.querySelector(`.crit-list[data-model="${_drag.key}"]`);
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
  const { key, idx, row, ghost, fromAnchor } = _drag;
  const slot = document.querySelector(`.anchor-slot[data-model="${key}"]`);
  const list = document.querySelector(`.crit-list[data-model="${key}"]`);
  const onSlot = swingHit(slot, e) && !fromAnchor;
  const onList = fromAnchor && swingHit(list, e);

  ghost.remove();
  row.classList.remove('dragging');
  slot.classList.remove('drop-active');

  const s = _swing[key];
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

  renderSwingSet(key);
  renderSwingTally();
  if (_hasCalculated && swingReady()) applySwingToMap();
}

// Keyboard: ↑/↓ reorder, Enter/Space promotes or demotes the anchor
function onSwingKeyDown(e) {
  const grip = e.target.closest && e.target.closest('.grip');
  if (!grip) return;
  const key = grip.dataset.model, idx = +grip.dataset.idx, s = _swing[key];

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

  renderSwingSet(key);
  renderSwingTally();
  if (_hasCalculated && swingReady()) applySwingToMap();
  const again = document.querySelector(`.grip[data-model="${key}"][data-idx="${idx}"]`);
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
  _models.forEach(m => {
    _swing[m.key] = {
      order:  m.criteria.map((_, i) => i),
      anchor: null,
      values: m.criteria.map(() => SWING_DEFAULT)
    };
    renderSwingSet(m.key);
  });
  _hasCalculated = false;
  renderSwingTally();

  // Blank the decision layer
  _sortedFeatures.forEach(f => {
    delete f.properties._dstColor;
    delete f.properties._dstDirection;
    _models.forEach(m => { delete f.properties[`_dstScore_${m.key}`]; });
  });
  CONFIG.layers.filter(l => l.type === 'dst').forEach(recolorLayer);

  const chart = document.getElementById('dst-chart-section');
  if (chart) chart.style.display = 'none';
}

// =============================================================================
// DST CALCULATION
// =============================================================================

// Palette/break set for the decision layer, from CONFIG.dst
function decisionStyleDef() {
  const d = CONFIG.dst || {};
  return {
    colorBreaks:   d.decisionBreaks   || [0,0.125,0.25,0.375,0.5,0.625,0.75,0.875],
    colorPalette:  d.decisionPalette  || d.decisionPaletteA ||
                   ['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#b10026'],
    colorPaletteA: d.decisionPaletteA || ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
    colorPaletteB: d.decisionPaletteB || ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b']
  };
}

// Score every feature from the current swing weights and repaint the map.
// Called by Calculate, and again on every slider move once Calculate has run.
function applySwingToMap() {
  if (!swingReady() || !_sortedFeatures.length) return null;

  const nF      = _sortedFeatures.length;
  const weights = {};
  const scores  = {};

  _models.forEach(m => {
    const w    = swingWeights(m.key);
    const arrs = _critArrays[m.key] || [];
    const acc  = new Array(nF).fill(0);
    w.forEach((wi, ci) => {
      if (!arrs[ci]) return;
      arrs[ci].forEach((v, fi) => { acc[fi] += v * wi; });
    });
    weights[m.key] = w;
    scores[m.key]  = acc;
  });

  const styleDef = decisionStyleDef();
  const dual     = _models.length >= 2;
  const kA = _models[0]?.key, kB = _models[1]?.key;

  _sortedFeatures.forEach((feat, fi) => {
    _models.forEach(m => {
      feat.properties[`_dstScore_${m.key}`] = scores[m.key][fi];
    });
    if (dual) {
      const a = scores[kA][fi], b = scores[kB][fi];
      feat.properties._dstDirection = a >= b ? modelOf(kA).legend : modelOf(kB).legend;
      feat.properties._dstScore     = Math.max(a, b);
      feat.properties._dstColor     = getDualColor(a, b, styleDef);
    } else {
      feat.properties._dstScore = scores[kA][fi];
      feat.properties._dstColor = getColor(scores[kA][fi], styleDef);
    }
  });

  CONFIG.layers.filter(l => l.type === 'dst').forEach(recolorLayer);
  return weights;
}

function runDSTCalculation() {
  if (!CONFIG.dst?.enabled || !_sortedFeatures.length) return;

  if (!hasCriteriaArrays()) {
    loadCriteriaArrays();
    computeSwingSpreads();
  }

  const weights = applySwingToMap();
  if (!weights) return;
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
  _models.forEach(m => {
    const s = _swing[m.key];
    const pool = s.order.filter(i => i !== s.anchor)
                        .sort((a, b) => swingRaw(m.key, b) - swingRaw(m.key, a));
    s.order = [s.anchor, ...pool];
    flipSwingReorder(document.querySelector(`.crit-list[data-model="${m.key}"]`),
                     () => renderSwingSet(m.key));
  });
  renderSwingTally();

  drawWeightChart(_models.map(m => ({
    label:   m.label.replace(/\s*criteria$/i, ''),
    weights: weights[m.key],
    labels:  m.criteria.map((_, i) => critLabel(m.key, i))
  })));
}

// =============================================================================
// D3 WEIGHT CHART
// Accepts [{label, weights:[…], labels:[…]}, …] — one entry per criteria model.
// =============================================================================
function drawWeightChart(groups) {
  const section = document.getElementById('dst-chart-section');
  if (section) section.style.display = '';

  const svgEl = document.getElementById('dst-chart');
  if (!svgEl || typeof d3 === 'undefined' || !d3) return;

  d3.select(svgEl).selectAll('*').remove();

  const rows = [];
  groups.forEach(g => {
    (g.weights || []).forEach((w, i) => {
      rows.push({ group: g.label, label: g.labels[i], value: w });
    });
  });
  if (!rows.length) return;

  const margin  = { top: 8, right: 10, bottom: 4, left: 8 };
  const width   = svgEl.getBoundingClientRect().width || 300;
  const nGroups = groups.length;
  const height  = rows.length * 15 + nGroups * 14 + 12;
  const barH    = 11;
  const labelW  = 92;

  svgEl.setAttribute('height', height);

  const xScale = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.value) * 1.15 || 1])
    .range([0, Math.max(40, width - margin.left - margin.right - labelW - 34)]);

  const palette = ['#c4963a', '#4682b4', '#5dbf7a', '#b07aa1'];
  const colorOf = g => palette[groups.findIndex(x => x.label === g) % palette.length];

  const svg = d3.select(svgEl).append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  let y = 0, lastGroup = null;
  rows.forEach(d => {
    if (d.group !== lastGroup) {
      y += lastGroup === null ? 8 : 14;
      svg.append('text')
        .attr('x', 0).attr('y', y - 4)
        .attr('font-size', '0.6rem')
        .attr('fill', 'rgba(255,255,255,0.35)')
        .attr('letter-spacing', '0.1em')
        .text(d.group.toUpperCase());
      lastGroup = d.group;
    }

    svg.append('text')
      .attr('x', labelW - 4).attr('y', y + barH * 0.82)
      .attr('text-anchor', 'end')
      .attr('font-size', '0.65rem')
      .attr('fill', 'rgba(255,255,255,0.6)')
      .text(d.label.length > 15 ? d.label.slice(0, 14) + '…' : d.label);

    svg.append('rect')
      .attr('x', labelW).attr('y', y)
      .attr('height', barH).attr('width', 0)
      .attr('fill', colorOf(d.group))
      .attr('opacity', 0.85)
      .transition().duration(500)
      .attr('width', xScale(d.value));

    svg.append('text')
      .attr('x', labelW + xScale(d.value) + 4).attr('y', y + barH * 0.82)
      .attr('font-size', '0.62rem')
      .attr('fill', 'rgba(255,255,255,0.5)')
      .text(d.value.toFixed(3));

    y += 15;
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
