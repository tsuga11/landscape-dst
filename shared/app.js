/**
 * app.js — Generic Decision Support Tool Map Application
 *
 * This file is driven entirely by the CONFIG object defined in config.js.
 * You should NEVER need to edit this file when adapting to a new geography.
 * All geography-specific data and settings live in config.js.
 *
 * Dependencies (loaded via CDN in index.html):
 *   - Leaflet 1.9
 *   - D3 v7
 *   - numeric.js (for AHP eigenvalue calculation)
 *   - georaster + georaster-layer-for-leaflet (for COG/GeoTIFF raster layers)
 */

'use strict';

// =============================================================================
// AHP LOOKUP TABLES  (replaces the old eval() pattern)
// =============================================================================
// The 17 discrete slider positions map to standard Saaty scale values
const AHP_STEPS  = [0,6,13,19,25,31,38,44,50,56,63,69,75,81,88,94,100];
const AHP_VALUES = [1/9,1/8,1/7,1/6,1/5,1/4,1/3,1/2,1,2,3,4,5,6,7,8,9];
const AHP_LABELS = [
  'absolutely less important than',
  'critically less important than',
  'very strongly less important than',
  'strongly less important than',
  'definitely less important than',
  'moderately less important than',
  'weakly less important than',
  'barely less important than',
  'equal to',
  'barely more important than',
  'weakly more important than',
  'moderately more important than',
  'definitely more important than',
  'strongly more important than',
  'very strongly more important than',
  'critically more important than',
  'absolutely more important than'
];

function sliderPctToAhpValue(pct) {
  const idx = AHP_STEPS.indexOf(Math.round(pct));
  return idx >= 0 ? AHP_VALUES[idx] : 1;
}

function sliderPctToAhpLabel(pct) {
  const idx = AHP_STEPS.indexOf(Math.round(pct));
  return idx >= 0 ? AHP_LABELS[idx] : 'equal to';
}

function sliderPctToDisplayStr(pct) {
  const val = sliderPctToAhpValue(pct);
  if (val >= 1) return String(Math.round(val));
  // Produce fraction string like "1/3"
  const denom = Math.round(1 / val);
  return `1/${denom}`;
}

// =============================================================================
// COLOR ENGINE
// =============================================================================

/**
 * Returns a fill color for a single feature value given a layer definition.
 * Handles sequential (including reverse) and categorical color types.
 */
function getColor(value, layerDef) {
  const { colorBreaks: breaks, colorPalette: palette, colorType } = layerDef;

  if (colorType === 'categorical') {
    // Value is an integer category (e.g., ownership = 1..7)
    const idx = Math.round(value) - 1;
    return palette[Math.min(Math.max(idx, 0), palette.length - 1)];
  }

  // Sequential — find which break bin the value falls into
  if (value === null || value === undefined || isNaN(value)) return '#ccc';
  if (value <= breaks[0]) return palette[0];
  if (value >= breaks[breaks.length - 1]) return palette[palette.length - 1];

  for (let i = 0; i < breaks.length - 1; i++) {
    if (value >= breaks[i] && value < breaks[i + 1]) return palette[i];
  }
  return palette[palette.length - 1];
}

/**
 * Dual-ramp color for SOE / decision layers.
 * Uses paletteA (e.g. reds) when valueA >= valueB, paletteB (blues) otherwise.
 */
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

// =============================================================================
// MODULE STATE
// =============================================================================
let _map            = null;  // Leaflet map instance
let _layerControl   = null;  // Leaflet layer control
let _leafletLayers  = {};    // id → Leaflet layer object
let _activeLegends  = {};    // id → Leaflet control (legend)
let _geojsonCache   = {};    // filename → GeoJSON object
let _sortedFeatures = [];    // features sorted by CONFIG.dst.sortField
let _amat           = null;  // AHP pairwise matrix — restoration
let _amat_prot      = null;  // AHP pairwise matrix — protection
let _restoreArrays  = [];    // [criterionIdx][featureIdx] = utility score
let _protectArrays  = [];
let _activeLayerIds = new Set(); // which overlay layers are currently on
let _infoVisible    = false;
let _currentOpacity = 0.8;

// =============================================================================
// ENTRY POINT
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setTitle();
  initMap();
  await loadAllLayers();
  buildOpacityControl();
  buildInfoBox();
  buildSearchBox();
  if (CONFIG.dst?.enabled) {
    buildDSTPanel();
  }
});

// =============================================================================
// TITLE / NAVBAR
// =============================================================================
function setTitle() {
  document.title = CONFIG.title;
  const el = document.getElementById('app-title');
  if (el) el.textContent = CONFIG.title;
}

// =============================================================================
// MAP INITIALIZATION
// =============================================================================
function initMap() {
  // ── Base layers ──────────────────────────────────────────────────────────
  const cartoLight = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors © <a href="https://carto.com">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19 }
  );

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
      maxZoom: 19 }
  );

  const topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors, © OpenTopoMap', maxZoom: 17 }
  );

  const defaultBase = CONFIG.defaultBasemap === 'satellite' ? satellite
                    : CONFIG.defaultBasemap === 'topo'      ? topo
                    : cartoLight;

  _map = L.map('map', {
    center: CONFIG.center,
    zoom:   CONFIG.zoom,
    zoomControl: false,
    layers: [defaultBase]
  });

  L.control.zoom({ position: 'topright' }).addTo(_map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(_map);

  // Mouse position display (bottom of map)
  const MousePos = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      div.style.cssText = 'background:rgba(255,255,255,0.85);padding:2px 8px;font-size:0.72rem;color:#555;';
      div.id = 'mouse-pos';
      div.textContent = 'Lat : Lon';
      return div;
    }
  });
  new MousePos({ position: 'bottomright' }).addTo(_map);
  _map.on('mousemove', e => {
    const el = document.getElementById('mouse-pos');
    if (el) el.textContent = `${e.latlng.lat.toFixed(5)} : ${e.latlng.lng.toFixed(5)}`;
  });

  // Layer control (base maps registered here; overlays added as layers load)
  _layerControl = L.control.layers(
    { 'Light': cartoLight, 'Satellite': satellite, 'Topo': topo },
    {},
    { position: 'topright', collapsed: true }
  ).addTo(_map);

  // DST panel toggle
  const dstToggle = document.getElementById('dst-toggle');
  if (dstToggle) {
    dstToggle.addEventListener('click', () => {
      document.getElementById('dst-panel')?.classList.toggle('open');
    });
  }
}

// =============================================================================
// LAYER LOADING
// =============================================================================
async function loadAllLayers() {
  // Load GeoJSON files, caching by filename so the same file isn't fetched twice
  const filePromises = {};
  for (const lyr of CONFIG.layers) {
    if ((lyr.type === 'geojson' || lyr.type === 'dual' || lyr.type === 'dst') && lyr.file) {
      if (!filePromises[lyr.file]) {
        filePromises[lyr.file] = fetchGeoJSON(lyr.file);
      }
    }
  }
  // Await all fetches in parallel
  const entries = await Promise.all(
    Object.entries(filePromises).map(([file, promise]) =>
      promise.then(data => [file, data])
    )
  );
  entries.forEach(([file, data]) => { _geojsonCache[file] = data; });

  // Sort features by sortField (required for DST indexing to work correctly)
  if (CONFIG.dst?.enabled && CONFIG.dst?.sortField) {
    const firstFile = CONFIG.layers.find(l => l.file)?.file;
    // Use the first GeoJSON file's features as the master sorted list
    const srcFile = CONFIG.layers.find(l => l.type === 'dst' || l.type === 'dual')?.file
                 || CONFIG.layers.find(l => l.file)?.file;
    if (srcFile && _geojsonCache[srcFile]) {
      _sortedFeatures = [..._geojsonCache[srcFile].features]
        .sort((a, b) => a.properties[CONFIG.dst.sortField] - b.properties[CONFIG.dst.sortField]);
    }
  }

  // Now create Leaflet layers
  for (const lyrDef of CONFIG.layers) {
    await addLayer(lyrDef);
  }
}

async function fetchGeoJSON(file) {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
  return response.json();
}

async function addLayer(lyrDef) {
  try {
    let leafletLayer;

    if (lyrDef.type === 'geojson' || lyrDef.type === 'dual' || lyrDef.type === 'dst') {
      const data = _geojsonCache[lyrDef.file];
      if (!data) return;
      leafletLayer = L.geoJSON(data, {
        style: feature => styleFeature(feature, lyrDef),
        onEachFeature: (feature, layer) => {
          layer.on({
            mouseover: e => onFeatureHover(e, feature),
            mouseout:  () => onFeatureOut(),
            click:     e => onFeatureClick(e)
          });
        }
      });

    } else if (lyrDef.type === 'wms') {
      leafletLayer = L.tileLayer.wms(lyrDef.url, {
        layers:      lyrDef.wmsLayers,
        format:      lyrDef.wmsFormat || 'image/png',
        transparent: true,
        opacity:     _currentOpacity,
        ...lyrDef.wmsOptions
      });

    } else if (lyrDef.type === 'cog') {
      // Cloud Optimized GeoTIFF support via georaster-layer-for-leaflet
      // Requires georaster and GeoRasterLayer to be loaded from CDN
      if (typeof GeoRasterLayer === 'undefined') {
        console.warn('GeoRasterLayer not loaded — skipping COG layer:', lyrDef.id);
        return;
      }
      const response = await fetch(lyrDef.file);
      const ab = await response.arrayBuffer();
      const georaster = await parseGeoraster(ab);
      leafletLayer = new GeoRasterLayer({
        georaster,
        opacity: _currentOpacity,
        pixelValuesToColorFn: vals => {
          const v = vals[0];
          if (v === null || v === undefined) return null;
          return getColor(v, lyrDef);
        },
        resolution: lyrDef.cogResolution || 256
      });
    }

    if (!leafletLayer) return;

    _leafletLayers[lyrDef.id] = leafletLayer;

    // Add to Leaflet layer control
    _layerControl.addOverlay(leafletLayer, lyrDef.label);

    // Auto-add layers that should be on by default
    if (lyrDef.defaultOn) {
      leafletLayer.addTo(_map);
      _activeLayerIds.add(lyrDef.id);
    }

    // Track layer add/remove to show/hide the correct legend
    _map.on('overlayadd', e => {
      if (e.layer === leafletLayer) {
        _activeLayerIds.add(lyrDef.id);
        showLegend(lyrDef);
      }
    });
    _map.on('overlayremove', e => {
      if (e.layer === leafletLayer) {
        _activeLayerIds.delete(lyrDef.id);
        hideLegend(lyrDef.id);
      }
    });

    // Show initial legend for default-on layers
    if (lyrDef.defaultOn) showLegend(lyrDef);

  } catch (err) {
    console.error(`Error loading layer "${lyrDef.id}":`, err);
  }
}

// =============================================================================
// FEATURE STYLING
// =============================================================================
function styleFeature(feature, lyrDef) {
  const props = feature.properties;
  let fillColor = '#cccccc';

  if (lyrDef.type === 'dual') {
    const valA = props[lyrDef.colorFieldA];
    const valB = props[lyrDef.colorFieldB];
    fillColor = getDualColor(valA, valB, lyrDef);

  } else if (lyrDef.type === 'dst') {
    // DST colors are set at calculation time; use stored color or default
    fillColor = props._dstColor || '#cccccc';

  } else {
    const val = props[lyrDef.colorField];
    fillColor = getColor(val, lyrDef);
  }

  return {
    fillColor,
    color:        lyrDef.strokeColor || '#555',
    weight:       lyrDef.strokeWeight !== undefined ? lyrDef.strokeWeight : 0.5,
    opacity:      _currentOpacity,
    fillOpacity:  _currentOpacity
  };
}

// =============================================================================
// OPACITY CONTROL
// =============================================================================
function buildOpacityControl() {
  const container = document.getElementById('opacity-control');
  if (!container) return;
  container.innerHTML = `
    <label for="opacity-slider">Opacity</label>
    <input type="range" id="opacity-slider" min="0" max="1" step="0.05" value="${_currentOpacity}">
    <span id="opacity-val">${Math.round(_currentOpacity * 100)}%</span>
  `;
  document.getElementById('opacity-slider').addEventListener('input', e => {
    _currentOpacity = parseFloat(e.target.value);
    document.getElementById('opacity-val').textContent = Math.round(_currentOpacity * 100) + '%';
    // Update all active overlay layers
    Object.values(_leafletLayers).forEach(lyr => {
      if (typeof lyr.setStyle === 'function') {
        lyr.setStyle({ fillOpacity: _currentOpacity, opacity: _currentOpacity });
      } else if (typeof lyr.setOpacity === 'function') {
        lyr.setOpacity(_currentOpacity);
      }
    });
  });
}

// =============================================================================
// HOVER INFO BOX
// =============================================================================
function buildInfoBox() {
  const box = document.getElementById('info-box');
  if (!box) return;

  document.addEventListener('mousemove', e => {
    box.style.left = (e.clientX + 18) + 'px';
    box.style.top  = (e.clientY - 40) + 'px';
  });
}

function onFeatureHover(e, feature) {
  const box = document.getElementById('info-box');
  if (!box) return;

  const props = feature.properties;
  const fields = CONFIG.hoverFields || [];

  // Header row uses first field or a default
  const idField = CONFIG.dst?.sortField || (fields[0]?.field);
  const idVal   = idField ? props[idField] : '';
  const idLabel = CONFIG.searchLabel || 'ID';

  let rows = fields.map(f => {
    let val = props[f.field];
    if (val === null || val === undefined) return '';
    if (f.format === 'pct')     val = (val * 100).toFixed(1) + '%';
    else if (f.format === 'int') val = Math.round(val).toLocaleString();
    else if (f.format === 'dec') val = val.toFixed(f.decimals || 2);
    else if (f.format === 'gallons') val = (val / 1e6).toFixed(2) + 'M gal';
    else if (f.decimals !== undefined) val = val.toFixed(f.decimals);
    return `<div class="info-row"><span class="info-key">${f.label}</span><span class="info-val">${val}</span></div>`;
  }).join('');

  box.innerHTML = `
    <div class="info-header">
      <span>${idLabel}</span><span>${idVal}</span>
    </div>
    <div class="info-body">${rows}</div>
  `;
  box.classList.add('visible');

  // Highlight hovered feature
  e.target.setStyle({ weight: 2, color: '#333', fillOpacity: Math.min(_currentOpacity + 0.1, 1) });
  if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) e.target.bringToFront();
}

function onFeatureOut() {
  const box = document.getElementById('info-box');
  if (box) box.classList.remove('visible');
  // Reset styles on all overlay layers
  Object.values(_leafletLayers).forEach(lyr => {
    if (typeof lyr.resetStyle === 'function') lyr.resetStyle();
  });
}

function onFeatureClick(e) {
  _map.fitBounds(e.target.getBounds());
}

// =============================================================================
// LEGEND SYSTEM
// =============================================================================
function showLegend(lyrDef) {
  if (_activeLegends[lyrDef.id]) return; // already showing

  const ctrl = L.control({ position: lyrDef.legendPosition || 'bottomright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = buildLegendHTML(lyrDef);
    return div;
  };
  ctrl.addTo(_map);
  _activeLegends[lyrDef.id] = ctrl;
}

function hideLegend(layerId) {
  if (_activeLegends[layerId]) {
    _map.removeControl(_activeLegends[layerId]);
    delete _activeLegends[layerId];
  }
}

function buildLegendHTML(lyrDef) {
  const title = `<div class="legend-title">${lyrDef.legendTitle || lyrDef.label}</div>`;

  if (lyrDef.type === 'dual') {
    // Two-column legend: restore (A) and protect (B)
    const headA = lyrDef.legendHeadA || 'Restore';
    const headB = lyrDef.legendHeadB || 'Protect';
    const makeCol = (palette, labels) => palette.map((col, i) =>
      `<div class="legend-item">
         <div class="legend-swatch" style="background:${col}"></div>
         <span class="legend-label">${labels ? labels[i] || '' : ''}</span>
       </div>`
    ).join('');
    return `${title}
      <div class="legend-dual">
        <div>
          <div class="legend-dual-head">${headA}</div>
          ${makeCol(lyrDef.colorPaletteA, lyrDef.legendLabels)}
        </div>
        <div>
          <div class="legend-dual-head">${headB}</div>
          ${makeCol(lyrDef.colorPaletteB, lyrDef.legendLabels)}
        </div>
      </div>`;
  }

  // Standard sequential or categorical
  const palette = lyrDef.colorPalette || [];
  const labels  = lyrDef.legendLabels || palette.map(() => '');
  const items   = palette.map((col, i) =>
    `<div class="legend-item">
       <div class="legend-swatch" style="background:${col}"></div>
       <span class="legend-label">${labels[i] || ''}</span>
     </div>`
  ).join('');
  return title + items;
}

// =============================================================================
// SEARCH / ZOOM
// =============================================================================
function buildSearchBox() {
  const box = document.getElementById('search-box');
  if (!box || !CONFIG.searchField) return;

  box.innerHTML = `
    <input id="search-input" type="text"
      placeholder="${CONFIG.searchLabel || 'Search ID'}…"
      autocomplete="off">
    <button id="search-btn">→</button>
  `;

  function doSearch() {
    const val = document.getElementById('search-input').value.trim();
    if (!val) return;
    // Search through all GeoJSON layers
    let found = false;
    for (const lyrDef of CONFIG.layers) {
      const data = _geojsonCache[lyrDef.file];
      if (!data) continue;
      const feature = data.features.find(f =>
        String(f.properties[CONFIG.searchField]) === val
      );
      if (feature) {
        const bounds = L.geoJSON(feature).getBounds();
        _map.fitBounds(bounds, { maxZoom: 14 });
        found = true;
        break;
      }
    }
    if (!found) alert(`No feature found with ${CONFIG.searchLabel} = "${val}"`);
  }

  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
}

// =============================================================================
// DST PANEL — UI BUILD
// =============================================================================
function buildDSTPanel() {
  const panel = document.getElementById('dst-panel');
  if (!panel || !CONFIG.dst) return;

  const dst = CONFIG.dst;
  const nRestoreCriteria = dst.restoration.criteria.length;
  const nProtectCriteria = dst.protection.criteria.length;

  // 1. Initialize the matrices first!
  initAHPMatrices(dst.restoration.criteria.length, dst.protection.criteria.length);


  // ── Build pairwise comparison slider rows ──────────────────────────────────
  // There are (n-1) sequential comparisons for n criteria (abbreviated AHP)
  function buildSliderSection(criteria, prefix) {
    return criteria.slice(0, -1).map((c, i) => `
      <div class="criterion-row">
        <div class="criterion-label" id="${prefix}-label-${i}">
          <strong>${c}</strong> is <strong>equal to</strong> ${criteria[i + 1]}.
        </div>
        <div class="slider-wrap">
          <input type="range" class="ahp-slider"
            id="${prefix}-slider-${i}"
            data-prefix="${prefix}"
            data-idx="${i}"
            min="0" max="100" step="1" value="50">
          <span class="slider-val" id="${prefix}-val-${i}">1</span>
        </div>
      </div>
    `).join('');
  }

  panel.innerHTML = `
    <div class="dst-header">
      <h2>Decision Tool</h2>
      <p>Adjust pairwise importance weights. Click <em>Calculate</em> to update the map.</p>
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

  // Attach slider event listeners
  panel.querySelectorAll('.ahp-slider').forEach(slider => {
    slider.addEventListener('input', onSliderMove);
    // Set initial label
    onSliderMove({ target: slider });
  });

  document.getElementById('btn-reset').addEventListener('click', resetDST);
  document.getElementById('btn-calculate').addEventListener('click', runDSTCalculation);

  // Initialize AHP matrices
  initAHPMatrices(nRestoreCriteria, nProtectCriteria);

  // Pre-compute criterion utility arrays
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

  const val   = sliderPctToAhpValue(pct);
  const label = sliderPctToAhpLabel(pct);
  const disp  = sliderPctToDisplayStr(pct);

  // Update display value
  document.getElementById(`${prefix}-val-${idx}`).textContent = disp;

  // Update label sentence
  const dst = CONFIG.dst;
  const criteria = prefix === 'rest' ? dst.restoration.criteria : dst.protection.criteria;
  const c1 = criteria[idx], c2 = criteria[idx + 1];
  document.getElementById(`${prefix}-label-${idx}`).innerHTML =
    `<strong>${c1}</strong> is <strong>${label}</strong> ${c2}.`;

  console.log('Prefix:', prefix, 'Idx:', idx, 'Val:', val);
  console.log('Matrix:', prefix === 'rest' ? _amat : _amat_prot);

  // Update AHP matrix
  if (prefix === 'rest') {
    _amat[idx][idx + 1] = val;
    _amat[idx + 1][idx] = 1 / val;
  } else {
    _amat_prot[idx][idx + 1] = val;
    _amat_prot[idx + 1][idx] = 1 / val;
  }
}

function resetDST() {
  document.querySelectorAll('.ahp-slider').forEach(s => {
    s.value = 50;
    onSliderMove({ target: s });
  });
  const n = CONFIG.dst.restoration.criteria.length;
  const p = CONFIG.dst.protection.criteria.length;
  initAHPMatrices(n, p);
}

// =============================================================================
// AHP MATH  (cleaned-up port of decisionSupportFunctions.js)
// =============================================================================
function initAHPMatrices(nRestore, nProtect) {
  _amat      = makeIdentityMatrix(nRestore);
  _amat_prot = makeIdentityMatrix(nProtect);
}

function makeIdentityMatrix(n) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : i < j ? 1 : 1))
  );
}

/**
 * saatyIndex — compute AHP weights and Consistency Ratio from a full
 * pairwise comparison matrix.
 * Returns { weights, CR }
 */
function saatyIndex(matrix, simSize = 500) {
  const n = matrix.length;

  // Geometric-mean method for weights
  const weights = matrix.map(row => {
    const geoMean = Math.pow(row.reduce((acc, v) => acc * v, 1), 1 / n);
    return geoMean;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  weights.forEach((_, i) => (weights[i] /= weightSum));

  // Largest eigenvalue (lambda_max) via numeric.js
  let lambdaMax = n;
  let CI = 0;
  try {
    const eig = numeric.eig(matrix);
    lambdaMax = Math.max(...eig.lambda.x);
    CI = (lambdaMax - n) / (n - 1);
  } catch (err) {
    // If eigenvalue fails, CR will be 0 (no penalty)
  }

  // Random Index (RI) via Monte Carlo simulation
  const RI_arr = [];
  for (let sim = 0; sim < simSize; sim++) {
    const rnd = buildRandomMatrix(n);
    try {
      const eigR = numeric.eig(rnd);
      const lMax = Math.max(...eigR.lambda.x);
      RI_arr.push((lMax - n) / (n - 1));
    } catch (_) {}
  }
  const RI = RI_arr.length ? RI_arr.reduce((a, b) => a + b, 0) / RI_arr.length : 1;
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
        if (Math.random() < 0.5) v = 1 / v;
        m[i][j] = v;
        m[j][i] = 1 / v;
      }
    }
  }
  return m;
}

/**
 * abbr2full — expand an abbreviated AHP matrix (only adjacent pairs filled in
 * the upper triangle) to a full pairwise matrix via sequential products.
 * This matches the original abbr2full logic.
 */
function abbr2full(inmat) {
  const n = inmat.length;
  const m = inmat.map(row => [...row]); // deep copy

  // Fill upper triangle diagonals beyond the first
  for (let diag = 2; diag < n; diag++) {
    for (let row = 0; row < n - diag; row++) {
      const col = row + diag;
      // Product of adjacent comparisons along the path
      let prod = 1;
      for (let k = row; k < col; k++) prod *= m[k][k + 1];
      // Clamp to Saaty scale bounds [1/9, 9]
      if (prod >= 1)  prod = Math.min(Math.round(prod), 9);
      else            prod = 1 / Math.min(Math.round(1 / prod), 9);
      m[row][col] = prod;
    }
  }

  // Fill lower triangle as reciprocals
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i > j) m[i][j] = 1 / m[j][i];
      if (i === j) m[i][j] = 1;
    }
  }
  return m;
}

// =============================================================================
// DST CALCULATION
// =============================================================================
function runDSTCalculation() {
  if (!CONFIG.dst?.enabled) return;

  if (!_sortedFeatures.length) {
    alert('Features not yet loaded. Please wait a moment and try again.');
    return;
  }

  // Re-compute criteria arrays if not yet done (safety check)
  if (!_restoreArrays.length && typeof CONFIG.dst.computeCriteriaArrays === 'function') {
    const result = CONFIG.dst.computeCriteriaArrays(_sortedFeatures);
    _restoreArrays = result.restoreArrays;
    _protectArrays = result.protectArrays;
  }

  // Expand abbreviated AHP matrices and compute weights
  const fullRestore = abbr2full(_amat);
  const fullProtect = abbr2full(_amat_prot);
  const resResult   = saatyIndex(fullRestore);
  const protResult  = saatyIndex(fullProtect);

  // Update consistency index display
  updateCRDisplay('cr-restore', resResult.CR);
  updateCRDisplay('cr-protect', protResult.CR);

  // Weighted sum of utility scores → decision score per feature
  const nFeatures = _sortedFeatures.length;
  const impVals  = new Array(nFeatures).fill(0);
  const protVals = new Array(nFeatures).fill(0);

  resResult.weights.forEach((w, ci) => {
    if (!_restoreArrays[ci]) return;
    _restoreArrays[ci].forEach((v, fi) => { impVals[fi] += v * w; });
  });
  protResult.weights.forEach((w, ci) => {
    if (!_protectArrays[ci]) return;
    _protectArrays[ci].forEach((v, fi) => { protVals[fi] += v * w; });
  });

  // Map decision scores to colors using the dual-color scheme
  const decBreaks  = CONFIG.dst.decisionBreaks  || [0,0.125,0.25,0.375,0.5,0.625,0.75,0.875];
  const decPalA    = CONFIG.dst.decisionPaletteA || ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'];
  const decPalB    = CONFIG.dst.decisionPaletteB || ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'];

  const dstLyrDef = { colorBreaks: decBreaks, colorPaletteA: decPalA, colorPaletteB: decPalB };

  // Store computed colors in feature properties and redraw DST layers
  _sortedFeatures.forEach((feat, fi) => {
    feat.properties._dstColor = getDualColor(impVals[fi], protVals[fi], dstLyrDef);
  });

  // Redraw all 'dst' type layers
  CONFIG.layers.filter(l => l.type === 'dst').forEach(lyrDef => {
    const lyr = _leafletLayers[lyrDef.id];
    if (lyr) lyr.setStyle(feature => styleFeature(feature, lyrDef));
  });

  // Draw weight chart
  drawWeightChart(resResult.weights, protResult.weights,
    CONFIG.dst.restoration.criteria, CONFIG.dst.protection.criteria);
}

function updateCRDisplay(elId, CR) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = Math.abs(CR).toFixed(3);
  el.className = 'cr-value ' + (CR > 0.10 ? 'cr-bad' : 'cr-good');
}

// =============================================================================
// D3 WEIGHT CHART  (D3 v7)
// =============================================================================
function drawWeightChart(restoreWeights, protectWeights, restoreLabels, protectLabels) {
  const section = document.getElementById('dst-chart-section');
  if (section) section.style.display = '';

  const svgEl = document.getElementById('dst-chart');
  if (!svgEl || typeof d3 === 'undefined') return;

  d3.select(svgEl).selectAll('*').remove();

  const allData = [
    ...restoreWeights.map((w, i) => ({ label: restoreLabels[i], value: w, group: 'Restore' })),
    { label: '', value: 0, group: 'spacer' },   // gap between sections
    ...protectWeights.map((w, i) => ({ label: protectLabels[i], value: w, group: 'Protect' }))
  ];

  const labelWidth = 130;   // wider label column
  const barH      = 14;
  const rowH      = barH + 5;
  const margin = { top: 20, right: 45, bottom: 4, left: 8 };
  const svgWidth  = svgEl.getBoundingClientRect().width || 290;
  const barWidth  = svgWidth - margin.left - margin.right - labelWidth;
  const svgHeight = allData.length * rowH + 30;

  const xScale = d3.scaleLinear()
    .domain([0, d3.max(allData, d => d.value) * 1.15])
    .range([0, barWidth]);

  const colorScale = d3.scaleOrdinal()
    .domain(['Restore', 'Protect'])
    .range(['#c4963a', '#4682b4']);

  d3.select(svgEl).attr('height', svgHeight);

  const svg = d3.select(svgEl)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  let lastGroup = null;
  let yOffset = 0;

  allData.forEach((d) => {
    if (d.group === 'spacer') { yOffset += rowH; return; }

    // Group header — printed once per group with a gap above
    if (d.group !== lastGroup) {
      svg.append('text')
        .attr('x', labelWidth)
        .attr('y', yOffset - 2)
        .attr('font-size', '0.6rem')
        .attr('fill', 'rgba(255,255,255,0.35)')
        .attr('letter-spacing', '0.1em')
        .text(d.group.toUpperCase());
      lastGroup = d.group;
      yOffset += 10;  // small gap after header
    }

    const y = yOffset;

    // Label — full text, right-aligned
    svg.append('text')
      .attr('x', labelWidth - 6)
      .attr('y', y + barH * 0.78)
      .attr('text-anchor', 'end')
      .attr('font-size', '0.68rem')
      .attr('fill', 'rgba(255,255,255,0.65)')
      .text(d.label);

    // Bar
    svg.append('rect')
      .attr('x', labelWidth)
      .attr('y', y)
      .attr('height', barH)
      .attr('width', 0)
      .attr('fill', colorScale(d.group))
      .attr('opacity', 0.85)
      .transition().duration(500)
      .attr('width', xScale(d.value));

    // Value
    svg.append('text')
      .attr('x', labelWidth + xScale(d.value) + 4)
      .attr('y', y + barH * 0.78)
      .attr('font-size', '0.65rem')
      .attr('fill', 'rgba(255,255,255,0.5)')
      .text(d.value.toFixed(3));

    yOffset += rowH;
  });
}

// =============================================================================
// UTILITY FUNCTIONS  (used by config.js in computeCriteriaArrays)
// =============================================================================

/**
 * utility — linear rescale from [inMin, inMax] to [outMin, outMax].
 * Equivalent to the original utility() function.
 */
function utility(array, inMin, inMax, outMin, outMax) {
  return array.map(x => {
    const scaled = ((x - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
    return Math.min(Math.max(scaled, Math.min(outMin, outMax)), Math.max(outMin, outMax));
  });
}

// Expose globally so config.js can use it
window.utility = utility;
