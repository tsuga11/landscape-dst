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
 *   - numeric.js
 */

'use strict';

// =============================================================================
// AHP LOOKUP TABLES
// =============================================================================
const AHP_STEPS  = [0,6,13,19,25,31,38,44,50,56,63,69,75,81,88,94,100];
const AHP_VALUES = [1/9,1/8,1/7,1/6,1/5,1/4,1/3,1/2,1,2,3,4,5,6,7,8,9];
const AHP_LABELS = [
  'absolutely less important than','critically less important than',
  'very strongly less important than','strongly less important than',
  'definitely less important than','moderately less important than',
  'weakly less important than','barely less important than','equal to',
  'barely more important than','weakly more important than',
  'moderately more important than','definitely more important than',
  'strongly more important than','very strongly more important than',
  'critically more important than','absolutely more important than'
];

function sliderToIndex(val) {
  // val is now 0-16 directly — no lookup needed
  return Math.max(0, Math.min(16, Math.round(val)));
}

function sliderPctToAhpValue(val) {
  return AHP_VALUES[sliderToIndex(val)];
}

function sliderPctToAhpLabel(val) {
  return AHP_LABELS[sliderToIndex(val)];
}

function sliderPctToDisplayStr(val) {
  const v = sliderPctToAhpValue(val);
  if (v >= 1) return String(Math.round(v));
  return `1/${Math.round(1/v)}`;
}

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
let _amat           = null;
let _amat_prot      = null;
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
// DST PANEL  (identical to Leaflet version)
// =============================================================================
function buildDSTPanel() {
  const panel = document.getElementById('dst-panel');
  if (!panel || !CONFIG.dst) return;

  const dst = CONFIG.dst;

  function buildSliderSection(criteria, prefix) {
    return criteria.slice(0, -1).map((c, i) => `
      <div class="criterion-row">
        <div class="criterion-label" id="${prefix}-label-${i}">
          <strong>${c}</strong> is <strong>equal to</strong> ${criteria[i+1]}.
        </div>
        <div class="slider-wrap">
          <input type="range" class="ahp-slider" id="${prefix}-slider-${i}"
            data-prefix="${prefix}" data-idx="${i}"
            min="0" max="16" step="1" value="8">
          <span class="slider-val" id="${prefix}-val-${i}">1</span>
        </div>
      </div>`).join('');
  }

  panel.innerHTML = `
    <div class="dst-header">
      <h2>Decision Tool</h2>
      <p>Adjust pairwise importance weights, then click <em>Calculate</em>.</p>
    </div>
    <div class="dst-body">
      <div class="dst-section">
        <div class="dst-section-title">Restoration criteria</div>
        ${buildSliderSection(dst.restoration.criteria, 'rest')}
      </div>
      <div class="dst-section">
        <div class="dst-section-title">Protection criteria</div>
        ${buildSliderSection(dst.protection.criteria, 'prot')}
      </div>
      <div class="dst-section">
        <div class="dst-section-title">Consistency indices</div>
        <div class="consistency-row">
          <span>Restoration</span>
          <span class="cr-value cr-good" id="cr-restore">0.000</span>
        </div>
        <div class="consistency-row">
          <span>Protection</span>
          <span class="cr-value cr-good" id="cr-protect">0.000</span>
        </div>
        <p style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:0.5rem;">
          CR &lt; 0.10 = acceptable consistency
        </p>
      </div>
      <div class="dst-section" id="dst-chart-section" style="display:none;">
        <div class="dst-section-title">Priority weights</div>
        <svg id="dst-chart" width="100%" height="160"></svg>
      </div>
    </div>
    <div class="dst-footer">
      <button id="btn-reset">Reset</button>
      <button id="btn-calculate">Calculate</button>
    </div>
  `;

   panel.querySelectorAll('.ahp-slider').forEach(s => {
     s.addEventListener('input', onSliderMove);
     // Defer initial call until DOM is fully ready
     setTimeout(() => onSliderMove({ target: s }), 0);
   });

  document.getElementById('btn-reset').addEventListener('click', resetDST);
  document.getElementById('btn-calculate').addEventListener('click', runDSTCalculation);

  initAHPMatrices(dst.restoration.criteria.length, dst.protection.criteria.length);

  if (typeof CONFIG.dst.computeCriteriaArrays === 'function' && _sortedFeatures.length) {
    const result = CONFIG.dst.computeCriteriaArrays(_sortedFeatures);
    _restoreArrays = result.restoreArrays;
    _protectArrays = result.protectArrays;
  }
}

function onSliderMove(e) {
  const slider = e.target;
  const prefix = slider.dataset.prefix;
  const idx    = parseInt(slider.dataset.idx);
  const pct    = parseInt(slider.value);
  const val    = sliderPctToAhpValue(pct);
  const label  = sliderPctToAhpLabel(pct);
  const disp   = sliderPctToDisplayStr(pct);

  document.getElementById(`${prefix}-val-${idx}`).textContent = disp;
  const criteria = prefix === 'rest'
    ? CONFIG.dst.restoration.criteria
    : CONFIG.dst.protection.criteria;
  document.getElementById(`${prefix}-label-${idx}`).innerHTML =
    `<strong>${criteria[idx]}</strong> is <strong>${label}</strong> ${criteria[idx+1]}.`;

  if (prefix === 'rest') { _amat[idx][idx+1] = val; _amat[idx+1][idx] = 1/val; }
  else { _amat_prot[idx][idx+1] = val; _amat_prot[idx+1][idx] = 1/val; }
}

function resetDST() {
  document.querySelectorAll('.ahp-slider').forEach(s => {
    s.value = 8;   // ← was 50
    onSliderMove({ target: s });
  });
  initAHPMatrices(CONFIG.dst.restoration.criteria.length, CONFIG.dst.protection.criteria.length);
}

// =============================================================================
// AHP MATH  (unchanged)
// =============================================================================
function initAHPMatrices(nR, nP) {
  _amat      = makeIdentityMatrix(nR);
  _amat_prot = makeIdentityMatrix(nP);
}

function makeIdentityMatrix(n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 1))
  );
}

function saatyIndex(matrix, simSize = 500) {
  const n = matrix.length;
  const weights = matrix.map(row => {
    const geoMean = Math.pow(row.reduce((a, v) => a * v, 1), 1/n);
    return geoMean;
  });
  const wSum = weights.reduce((a,b) => a+b, 0);
  weights.forEach((_, i) => (weights[i] /= wSum));

  let CI = 0;
  try {
    const eig = numeric.eig(matrix);
    const lambdaMax = Math.max(...eig.lambda.x);
    CI = (lambdaMax - n) / (n - 1);
  } catch (_) {}

  const RI_arr = [];
  for (let s = 0; s < simSize; s++) {
    try {
      const rnd  = buildRandomMatrix(n);
      const eigR = numeric.eig(rnd);
      const lMax = Math.max(...eigR.lambda.x);
      RI_arr.push((lMax - n) / (n - 1));
    } catch (_) {}
  }
  const RI = RI_arr.length ? RI_arr.reduce((a,b) => a+b, 0) / RI_arr.length : 1;
  const CR = RI > 0 ? CI / RI : 0;
  return { weights, CR };
}

function buildRandomMatrix(n) {
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { m[i][j] = 1; continue; }
      if (i < j) {
        let v = Math.floor(Math.random() * 9) + 1;
        if (Math.random() < 0.5) v = 1/v;
        m[i][j] = v; m[j][i] = 1/v;
      }
    }
  }
  return m;
}

function abbr2full(inmat) {
  const n = inmat.length;
  const m = inmat.map(row => [...row]);
  for (let diag = 2; diag < n; diag++) {
    for (let row = 0; row < n - diag; row++) {
      const col = row + diag;
      let prod = 1;
      for (let k = row; k < col; k++) prod *= m[k][k+1];
      if (prod >= 1) prod = Math.min(Math.round(prod), 9);
      else           prod = 1 / Math.min(Math.round(1/prod), 9);
      m[row][col] = prod;
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i > j) m[i][j] = 1/m[j][i];
      if (i === j) m[i][j] = 1;
    }
  return m;
}

// =============================================================================
// DST CALCULATION
// =============================================================================
function runDSTCalculation() {
  if (!CONFIG.dst?.enabled || !_sortedFeatures.length) return;

  if (!_restoreArrays.length && typeof CONFIG.dst.computeCriteriaArrays === 'function') {
    const r = CONFIG.dst.computeCriteriaArrays(_sortedFeatures);
    _restoreArrays = r.restoreArrays;
    _protectArrays = r.protectArrays;
  }

  const resResult  = saatyIndex(abbr2full(_amat));
  const protResult = saatyIndex(abbr2full(_amat_prot));

  updateCRDisplay('cr-restore', resResult.CR);
  updateCRDisplay('cr-protect', protResult.CR);

  const nF      = _sortedFeatures.length;
  const impVals = new Array(nF).fill(0);
  const prtVals = new Array(nF).fill(0);

  resResult.weights.forEach((w, ci) => {
    if (!_restoreArrays[ci]) return;
    _restoreArrays[ci].forEach((v, fi) => { impVals[fi] += v * w; });
  });
  protResult.weights.forEach((w, ci) => {
    if (!_protectArrays[ci]) return;
    _protectArrays[ci].forEach((v, fi) => { prtVals[fi] += v * w; });
  });

  const decBreaks = CONFIG.dst.decisionBreaks  || [0,0.125,0.25,0.375,0.5,0.625,0.75,0.875];
  const decPalA   = CONFIG.dst.decisionPaletteA || ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'];
  const decPalB   = CONFIG.dst.decisionPaletteB || ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'];
  const dstLyrDef = { colorBreaks: decBreaks, colorPaletteA: decPalA, colorPaletteB: decPalB };

  _sortedFeatures.forEach((feat, fi) => {
    feat.properties._dstColor = getDualColor(impVals[fi], prtVals[fi], dstLyrDef);
  });

  CONFIG.layers.filter(l => l.type === 'dst').forEach(recolorLayer);

  drawWeightChart(resResult.weights, protResult.weights,
    CONFIG.dst.restoration.criteria, CONFIG.dst.protection.criteria);
}

function updateCRDisplay(elId, CR) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = Math.abs(CR).toFixed(3);
  el.className   = 'cr-value ' + (CR > 0.10 ? 'cr-bad' : 'cr-good');
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
