/**
 * tcsi_app.js
 * TCSI PROMOTE DST — MapLibre GL JS 4.x application
 *
 * Requires:
 *   - maplibre-gl@4.x
 *   - @protomaps/maplibre-gl (PMTiles protocol)
 *   - tcsi_config.js (CONFIG object)
 *
 * Architecture:
 *   Raster layers: PMTiles (single-band uint8/uint16) + raster-color
 *   Vector layers: PMTiles (pbf)
 *   No jQuery, no Bootstrap, no Leaflet.
 */

'use strict';

// ─── STATE ──────────────────────────────────────────────────
const state = {
  map: null,
  activeLayers: new Set(),   // layer IDs currently visible
  currentBasemap: 'dark',
  activeLegend: null
};

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initPMTiles();
  initMap();
  buildSidebar();
  initHamburger();
  initInfoPanel();
});

// ─── PMTILES PROTOCOL ───────────────────────────────────────
function initPMTiles() {
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
  const pmtilesCache = {};

maplibregl.addProtocol('pmtiles-color', async (params) => {
  // URL format: pmtiles-color://rampName|pmtiles://https://.../{z}/{x}/{y}
  const urlWithoutProto = params.url.replace('pmtiles-color://', '');
  
  // Extract z/x/y from end of URL
  const zxyMatch = urlWithoutProto.match(/\/(\d+)\/(\d+)\/(\d+)$/);
  if (!zxyMatch) return { data: new ArrayBuffer(0) };
  
  const z = parseInt(zxyMatch[1]);
  const x = parseInt(zxyMatch[2]);
  const y = parseInt(zxyMatch[3]);
  
  // Extract ramp and base URL (strip /{z}/{x}/{y})
  const baseUrl = urlWithoutProto.replace(/\/\d+\/\d+\/\d+$/, '');
  const [rampName, pmtilesUrl] = baseUrl.split('|');
  const cleanUrl = pmtilesUrl.replace(/^pmtiles:\/\//, '');

  console.log('rampName:', rampName, 'z/x/y:', z, x, y);

  const ramp = CONFIG.colorRamps[rampName];
  if (!pmtilesCache[cleanUrl]) {
    pmtilesCache[cleanUrl] = new pmtiles.PMTiles(cleanUrl);
  }
  const pt = pmtilesCache[cleanUrl];

  try {
    const tile = await pt.getZxy(z, x, y);
    if (!tile || !tile.data) return { data: new ArrayBuffer(0) };
    const blob = new Blob([tile.data], { type: 'image/png' });
    const imageBitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const val = pixels[i];
      const color = interpolateColor(ramp, val);
      pixels[i]     = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await outBlob.arrayBuffer();
    return { data: arrayBuffer };
  } catch (e) {
    console.warn('Tile error:', e);
    return { data: new ArrayBuffer(0) };
  }
});
}


// Add 3D terrain model from Maptiler with my API key...
function addTerrain() {
  if (!state.map.getSource('terrain-dem')) {
    state.map.addSource('terrain-dem', {
      type: 'raster-dem',
      url: 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=L9m2QvkG3KvfZEuyAa2n',
      tileSize: 256
    });
  }
  state.map.setTerrain({
    source: 'terrain-dem',
    exaggeration: 1.5
  });
}

function addHillshadeOverlay() {
  if (!state.map.getSource('hillshade-overlay')) {
    state.map.addSource('hillshade-overlay', CONFIG.hillshadeOverlay);  // ← was HILLSHADE_OVERLAY
  }
  if (!state.map.getLayer('hillshade-overlay-layer')) {
    state.map.addLayer({
      id: 'hillshade-overlay-layer',
      type: 'raster',
      source: 'hillshade-overlay',
      paint: {
        'raster-opacity': 0.3,
        'raster-contrast': 0.2,
        'raster-brightness-min': 0.1
      }
    });
  }
}

function removeHillshadeOverlay() {
  if (state.map.getLayer('hillshade-overlay-layer')) {
    state.map.removeLayer('hillshade-overlay-layer');
  }
  if (state.map.getSource('hillshade-overlay')) {
    state.map.removeSource('hillshade-overlay');
  }
}

// ── COLOR INTERPOLATION ──────────────────────────────────
function interpolateColor(ramp, value) {
  if (ramp.categorical) {
    const match = ramp.classes.find(c => c.value === Math.round(value));
    const hex = match ? match.color : '#000000';
    return hexToRgb(hex);
  }

  const stops = ramp.stops;
  // Clamp to range
  if (value <= stops[0]) return hexToRgb(stops[1]);
  if (value >= stops[stops.length - 2]) return hexToRgb(stops[stops.length - 1]);

  // Find surrounding stops
  for (let i = 0; i < stops.length - 2; i += 2) {
    const v0 = stops[i],     c0 = stops[i + 1];
    const v1 = stops[i + 2], c1 = stops[i + 3];
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0);
      return lerpColor(hexToRgb(c0), hexToRgb(c1), t);
    }
  }
  return [0, 0, 0];
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function lerpColor(c0, c1, t) {
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t)
  ];
}

// ─── MAP INIT ────────────────────────────────────────────────
function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style: CONFIG.basemaps[CONFIG.defaultBasemap || 'dark'].style,
    center: CONFIG.center,
    zoom: CONFIG.zoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    pitchWithRotate: true,
    attributionControl: false
  });

  state.map.fitBounds(CONFIG.bounds, { animate: false });

  // Controls
  state.map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  state.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

  state.map.on('load', () => {
    // 3D Terrain model from Maptiler with my API Key....
    addTerrain(); 
    
    // Pre-register all sources (but don't add layers yet)
    //registerAllSources();

    // Click/hover handlers for raster pixel inspection
    initPixelInspect();

    // Pitch hint
    setTimeout(() => document.getElementById('pitch-hint')?.classList.add('hidden'), 5000);
  });
}

// ─── SOURCE REGISTRATION ────────────────────────────────────
// Register every PMTiles source upfront so layers can be added
// on demand without async delays.
function registerAllSources() {
  getAllLayers().forEach(layer => {
    const srcId = `src-${layer.id}`;
    if (state.map.getSource(srcId)) return;

if (layer.type === 'raster-pmtiles') {
  // Use colorizing protocol: pmtiles-color://rampName|pmtiles://https://...
  const colorUrl = `pmtiles-color://${layer.colorRamp}|${layer.url}`;
  state.map.addSource(srcId, {
    type: 'raster',
    url: colorUrl,
    tileSize: 256
  });
} else if (layer.type === 'vector-pmtiles') {
      state.map.addSource(srcId, {
        type: 'vector',
        url: layer.url
      });
    } else if (layer.type === 'geojson') {
      state.map.addSource(srcId, {
        type: 'geojson',
        data: layer.url
      });
    }
  });
}

// ─── LAYER ADD / REMOVE ──────────────────────────────────────
function addLayer(layerCfg) {
  const srcId = `src-${layerCfg.id}`;
  const lyrId = `lyr-${layerCfg.id}`;

  if (state.map.getLayer(lyrId)) return; // already added

  // Register source only when needed
  if (!state.map.getSource(srcId)) {
if (layerCfg.type === 'raster-pmtiles') {
  const colorUrl = `pmtiles-color://${layerCfg.colorRamp}|${layerCfg.url}`;
  state.map.addSource(srcId, {
    type: 'raster',
    tiles: [colorUrl + '/{z}/{x}/{y}'],
    tileSize: 256,
    minzoom: 9,
    maxzoom: 14
  });
} else if (layerCfg.type === 'vector-pmtiles') {
      state.map.addSource(srcId, {
        type: 'vector',
        url: layerCfg.url
      });
    }
  }

  // Then add the layer
  if (layerCfg.type === 'raster-pmtiles') {
    state.map.addLayer({
      id: lyrId,
      type: 'raster',
      source: srcId,
      paint: {
        'raster-opacity': layerCfg.defaultOpacity ?? 0.85
      }
    });
  } else if (layerCfg.type === 'vector-pmtiles') {
    const p = layerCfg.paint;
    // Detect geometry type from paint keys
    if ('line-color' in p && !('fill-color' in p)) {
      state.map.addLayer({ id: lyrId, type: 'line', source: srcId, 'source-layer': layerCfg.sourceLayer, paint: p });
    } else if ('fill-color' in p && 'line-color' in p) {
      // Add fill + outline as two sub-layers
      state.map.addLayer({ id: `${lyrId}-fill`, type: 'fill', source: srcId, 'source-layer': layerCfg.sourceLayer,
        paint: { 'fill-color': p['fill-color'], 'fill-opacity': p['fill-opacity'] ?? 0.5 } });
      state.map.addLayer({ id: `${lyrId}-line`, type: 'line', source: srcId, 'source-layer': layerCfg.sourceLayer,
        paint: { 'line-color': p['line-color'], 'line-width': p['line-width'] ?? 1 } });
    } else if ('fill-color' in p) {
      state.map.addLayer({ id: `${lyrId}-fill`, type: 'fill', source: srcId, 'source-layer': layerCfg.sourceLayer,
        paint: { 'fill-color': p['fill-color'], 'fill-opacity': p['fill-opacity'] ?? 0.5 } });
    } else if ('circle-color' in p) {
      state.map.addLayer({ id: lyrId, type: 'circle', source: srcId, 'source-layer': layerCfg.sourceLayer, paint: p });
    } else {
      state.map.addLayer({ id: lyrId, type: 'line', source: srcId, 'source-layer': layerCfg.sourceLayer, paint: p });
    }
  }

  state.activeLayers.add(layerCfg.id);

  // Boundary layers always on top
  bringBoundariesToFront();

  // Show legend
  showLegend(layerCfg);

  // Keep hillshade on top if active
  if (state.map.getLayer('hillshade-overlay-layer')) {
    state.map.moveLayer('hillshade-overlay-layer');
  }
}

function removeLayer(layerCfg) {
  const lyrId = `lyr-${layerCfg.id}`;
  [`${lyrId}`, `${lyrId}-fill`, `${lyrId}-line`].forEach(id => {
    if (state.map.getLayer(id)) state.map.removeLayer(id);
  });
  state.activeLayers.delete(layerCfg.id);
  clearLegend();
}

function setLayerOpacity(layerCfg, opacity) {
  const lyrId = `lyr-${layerCfg.id}`;
  if (layerCfg.type === 'raster-pmtiles') {
    if (state.map.getLayer(lyrId)) state.map.setPaintProperty(lyrId, 'raster-opacity', opacity);
  } else {
    const p = layerCfg.paint;
    if ('fill-color' in p && state.map.getLayer(`${lyrId}-fill`))
      state.map.setPaintProperty(`${lyrId}-fill`, 'fill-opacity', (p['fill-opacity'] ?? 0.5) * opacity);
    if ('line-color' in p && state.map.getLayer(`${lyrId}-line`))
      state.map.setPaintProperty(`${lyrId}-line`, 'line-opacity', opacity);
    if (state.map.getLayer(lyrId)) {
      if ('circle-color' in p) state.map.setPaintProperty(lyrId, 'circle-opacity', opacity);
      else state.map.setPaintProperty(lyrId, 'line-opacity', opacity);
    }
  }
}

function setLineColor(layerCfg, color) {
  const lyrId = `lyr-${layerCfg.id}`;
  if (state.map.getLayer(lyrId)) state.map.setPaintProperty(lyrId, 'line-color', color);
  if (state.map.getLayer(`${lyrId}-line`)) state.map.setPaintProperty(`${lyrId}-line`, 'line-color', color);
}

// ─── COLOR RAMP EXPRESSION BUILDER ─────────────────────────
function buildRasterColorExpr(ramp, dataRange) {
  const [dMin, dMax] = dataRange;
  
  if (ramp.categorical) {
    const expr = ['step', ['raster-value']];
    expr.push(ramp.classes[0].color);
    ramp.classes.forEach((cls, i) => {
      if (i > 0) {
        // normalize class value to 0-1
        const norm = (cls.value - dMin) / (dMax - dMin);
        expr.push(norm);
        expr.push(cls.color);
      }
    });
    return expr;
  } else {
    const expr = ['interpolate', ['linear'], ['raster-value']];
    for (let i = 0; i < ramp.stops.length; i += 2) {
      // normalize stop value to 0-1
      const norm = (ramp.stops[i] - dMin) / (dMax - dMin);
      expr.push(norm);
      expr.push(ramp.stops[i + 1]);
    }
    return expr;
  }
}

// ─── BOUNDARY LAYER Z-ORDER ──────────────────────────────────
function bringBoundariesToFront() {
  const boundaryIds = ['tcsiBounds', 'tcsiHUC12', 'tcsiHUC10'];
  boundaryIds.forEach(id => {
    if (!state.activeLayers.has(id)) return;
    const lyrId = `lyr-${id}`;
    if (state.map.getLayer(lyrId)) state.map.moveLayer(lyrId);
  });
}

// ─── LEGEND ──────────────────────────────────────────────────
function showLegend(layerCfg) {
  const ramp = CONFIG.colorRamps[layerCfg.colorRamp];
  if (!ramp) { clearLegend(); return; }

  const container = document.getElementById('legend-container');
  state.activeLegend = layerCfg.id;

  let html = `<div class="legend-title">${ramp.title}</div>`;

  if (ramp.categorical) {
    html += ramp.classes.map(c =>
      `<div class="legend-row"><span class="legend-swatch" style="background:${c.color}"></span>${c.label}</div>`
    ).join('');
  } else {
    // Gradient bar
    const colors = [];
    for (let i = 0; i < ramp.stops.length; i += 2) colors.push(ramp.stops[i + 1]);
    html += `<div class="legend-gradient" style="background:linear-gradient(to right, ${colors.join(',')})"></div>`;
    if (ramp.labels) {
      const labels = ramp.labels.filter(Boolean);
      html += `<div class="legend-labels">
        <span>${labels[0]}</span>
        <span>${labels[labels.length - 1]}</span>
      </div>`;
    }
  }

  container.innerHTML = html;
  container.classList.remove('hidden');
}

function clearLegend() {
  const container = document.getElementById('legend-container');
  if (container) { container.innerHTML = ''; container.classList.add('hidden'); }
  state.activeLegend = null;
}

// ─── PIXEL INSPECT ──────────────────────────────────────────
function initPixelInspect() {
  const box = document.getElementById('info-box');

  state.map.on('mousemove', e => {
    const features = state.map.queryRenderedFeatures(e.point);
    if (!features.length) { box.classList.add('hidden'); return; }
    const f = features[0];
    // Show layer id + properties for vector layers
    if (f.properties && Object.keys(f.properties).length > 0) {
      const entries = Object.entries(f.properties)
        .slice(0, 5)
        .map(([k, v]) => `<b>${k}:</b> ${typeof v === 'number' ? v.toFixed(3) : v}`)
        .join('<br>');
      box.innerHTML = `<small>${f.layer.id.replace('lyr-','').replace('-fill','').replace('-line','')}</small><br>${entries}`;
      box.style.left = (e.point.x + 12) + 'px';
      box.style.top  = (e.point.y + 12) + 'px';
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  });

  state.map.on('mouseleave', () => box.classList.add('hidden'));
}

// ─── BASEMAP SWITCHER ────────────────────────────────────────
function switchBasemap(key) {
  state.currentBasemap = key;
  const style = CONFIG.basemaps[key].style;

  // Snapshot active layers to re-add after basemap change
  const activeLayers = [...state.activeLayers];
  activeLayers.forEach(id => {
    const cfg = findLayer(id);
    if (cfg) removeLayer(cfg);
  });

  state.map.setStyle(style);

state.map.once('styledata', () => {
  addTerrain();
  activeLayers.forEach(id => {
    const cfg = findLayer(id);
    if (cfg) addLayer(cfg);
  });
  // Re-add hillshade if it was active
  const hsBtn = document.getElementById('hillshade-toggle');
  if (hsBtn && hsBtn.dataset.active === 'true') {
    addHillshadeOverlay();
  }
});

  // Update button states
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.basemap === key);
  });
}

// ─── SIDEBAR BUILD ───────────────────────────────────────────
function buildSidebar() {
  const sidebar = document.getElementById('mySidebar');

  // Basemap buttons
  const basemapSection = document.createElement('div');
  basemapSection.className = 'sidebar-section';
  basemapSection.innerHTML = `
    <button class="accordion">Basemaps</button>
    <div class="panel">
      ${Object.entries(CONFIG.basemaps).map(([key, bm]) =>
        `<button class="basemap-btn${key === (CONFIG.defaultBasemap || 'dark') ? ' active' : ''}"
           data-basemap="${key}">${bm.label}</button>`
      ).join('')}

      <button class="basemap-btn" id="hillshade-toggle" data-active="false">
        Hillshade overlay
      </button>
    </div>
  `;
  sidebar.appendChild(basemapSection);

  // Layer groups
  CONFIG.layerGroups.forEach(group => {
    sidebar.appendChild(buildGroupSection(group));
  });

  // Accordion behavior
  document.querySelectorAll('.accordion').forEach(btn => {
    btn.addEventListener('click', function() {
      this.classList.toggle('active');
      const panel = this.nextElementSibling;
      panel.style.maxHeight = panel.style.maxHeight ? null : panel.scrollHeight + 'px';
    });
  });

  // Sub-accordion
  document.querySelectorAll('.sub-accordion').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      this.classList.toggle('active');
      const panel = this.nextElementSibling;
      panel.style.maxHeight = panel.style.maxHeight ? null : panel.scrollHeight + 2000 + 'px';
      // Resize parent panels
      let parent = this.closest('.panel');
      while (parent) {
        parent.style.maxHeight = (parseInt(parent.style.maxHeight) || 0) + 2000 + 'px';
        parent = parent.parentElement?.closest('.panel');
      }
    });
  });

  // Basemap buttons
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    if (btn.id === 'hillshade-toggle') return;  // ← add this
    btn.addEventListener('click', () => switchBasemap(btn.dataset.basemap));
  });
}

function buildGroupSection(group) {
  const section = document.createElement('div');
  section.className = 'sidebar-section';

  // Group header with optional group-level download
  let headerInner = group.label;
  if (group.download) {
    headerInner = `<span style="flex:1;color:${group.labelColor || 'inherit'}">${group.label}</span>
      <a href="${group.download}" download class="header-dl" onclick="event.stopPropagation()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-7 2V5h2v6h1.17L12 13.17 8.83 11H10zm-8 6h18v2H4z"/></svg>
      </a>`;
  } else {
    headerInner = `<span style="color:${group.labelColor || 'inherit'}">${group.label}</span>`;
  }

  let panelHTML = '';

  if (group.subGroups) {
    // Pillar sub-groups
    panelHTML = group.subGroups.map(sg => `
      <div class="sub-group">
        <button class="sub-accordion">
          <span>${sg.label}</span>
          ${sg.download ? `<a href="${sg.download}" download class="header-dl" onclick="event.stopPropagation()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-7 2V5h2v6h1.17L12 13.17 8.83 11H10zm-8 6h18v2H4z"/></svg>
          </a>` : ''}
        </button>
        <div class="sub-panel">
          ${buildLayerTable(sg.layers)}
        </div>
      </div>
    `).join('');
  } else if (group.layers) {
    panelHTML = buildLayerTable(group.layers);
  }

  section.innerHTML = `
    <button class="accordion">${headerInner}</button>
    <div class="panel">${panelHTML}</div>
  `;
  return section;
}

function buildLayerTable(layers) {
  return `<table class="layer-table">` +
    layers.map(layer => `
      <tr data-layer-id="${layer.id}">
        <td class="col-label">
          <a class="toc-link toc-off" href="#" data-layer="${layer.id}">${layer.label}</a>
        </td>
        <td class="col-ctrl">
          ${layer.colorPicker
            ? `<input type="color" class="color-picker" data-layer="${layer.id}" value="#ffffff">`
            : `<input type="range" min="0" max="100" value="${Math.round((layer.defaultOpacity ?? 0.85) * 100)}"
                 class="opacity-slider" data-layer="${layer.id}">`
          }
        </td>
        <td class="col-info">
          ${layer.tooltip
            ? `<span class="info-tip" title="${layer.tooltip}">&#9432;</span>`
            : ''
          }
          ${layer.download
            ? `<a href="${layer.download}" download class="dl-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-7 2V5h2v6h1.17L12 13.17 8.83 11H10zm-8 6h18v2H4z"/></svg>
               </a>`
            : ''
          }
        </td>
      </tr>
    `).join('') +
  `</table>`;
}

// ─── LAYER TOC EVENT DELEGATION ──────────────────────────────
// Single delegated listener handles all toc-link clicks.
document.addEventListener('click', e => {
  const link = e.target.closest('.toc-link');
  if (!link) return;
  e.preventDefault();

  const layerId = link.dataset.layer;
  const layerCfg = findLayer(layerId);
  if (!layerCfg) return;

  if (state.map.loaded()) {
    toggleLayer(link, layerCfg);
  } else {
    state.map.once('load', () => toggleLayer(link, layerCfg));
  }
});

function toggleLayer(link, layerCfg) {
  if (link.classList.contains('toc-off')) {
    link.classList.replace('toc-off', 'toc-on');
    addLayer(layerCfg);
  } else {
    link.classList.replace('toc-on', 'toc-off');
    removeLayer(layerCfg);
  }
}

// 2. RUN ON PAGE LOAD: Automatically load a specific layer
document.addEventListener('DOMContentLoaded', () => {
  // Replace 'your-default-layer-id' with the actual ID string in your data-layer attribute
  const defaultLink = document.querySelector('.toc-link[data-layer="currentEcosystem"]');
  if (!defaultLink) return;

  const layerId = defaultLink.dataset.layer;
  const layerCfg = findLayer(layerId);
  if (!layerCfg) return;

  // Run the same map-load check used in your click listener
  if (state.map.loaded()) {
    toggleLayer(defaultLink, layerCfg);
    addHillshadeOverlay();
    const btn = e.target.closest('#hillshade-toggle');
    btn.dataset.active = 'true';
    btn.classList.add('active');
  } else {
    state.map.once('load', () => toggleLayer(defaultLink, layerCfg));
  }
});

// ─── OPACITY SLIDER EVENT DELEGATION ────────────────────────
document.addEventListener('input', e => {
  const slider = e.target.closest('.opacity-slider');
  if (!slider) return;
  const layerCfg = findLayer(slider.dataset.layer);
  if (!layerCfg) return;
  setLayerOpacity(layerCfg, slider.value / 100);
});

// ─── COLOR PICKER EVENT DELEGATION ───────────────────────────
document.addEventListener('change', e => {
  const picker = e.target.closest('.color-picker');
  if (!picker) return;
  const layerCfg = findLayer(picker.dataset.layer);
  if (!layerCfg) return;
  setLineColor(layerCfg, picker.value);
});

// HILLSHADE LISTENER
document.addEventListener('click', e => {
  const btn = e.target.closest('#hillshade-toggle');
  if (!btn) return;
  const active = btn.dataset.active === 'true';
  if (active) {
    removeHillshadeOverlay();
    btn.dataset.active = 'false';
    btn.classList.remove('active');
  } else {
    addHillshadeOverlay();
    btn.dataset.active = 'true';
    btn.classList.add('active');
  }
});

// ─── HAMBURGER ────────────────────────────────────────────────
function initHamburger() {
  const hamburger = document.querySelector('.hamburger');
  const sidebar   = document.getElementById('mySidebar');
  let open = true;

  hamburger?.addEventListener('click', () => {
    open = !open;
    hamburger.classList.toggle('is-active', open);
    sidebar.style.width = open ? (window.innerWidth > 700 ? '330px' : '100%') : '0';
  });
}

// ─── INFO PANEL (bottom panel with up/down arrow) ─────────────
function initInfoPanel() {
  const arrow = document.getElementById('info-arrow');
  const panel = document.getElementById('info-panel');
  let expanded = false;

  arrow?.addEventListener('click', () => {
    expanded = !expanded;
    arrow.classList.toggle('flipped', expanded);
    panel.classList.toggle('expanded', expanded);
  });

  // Tools button (right mini-sidebar) scrolls to info
  document.getElementById('tools-btn')?.addEventListener('click', () => {
    expanded = true;
    arrow?.classList.add('flipped');
    panel?.classList.add('expanded');
  });
}

// ─── UTILITY ─────────────────────────────────────────────────
function getAllLayers() {
  const layers = [];
  CONFIG.layerGroups.forEach(group => {
    if (group.layers) layers.push(...group.layers);
    if (group.subGroups) group.subGroups.forEach(sg => layers.push(...sg.layers));
  });
  return layers;
}

function findLayer(id) {
  return getAllLayers().find(l => l.id === id) || null;
}
