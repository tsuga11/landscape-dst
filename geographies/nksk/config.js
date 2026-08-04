/**
 * config.js — North Kona / South Kohala, Hawai'i
 * ============================================================
 * Blends Hamakua-style GeoJSON DST layers with TCSI-style
 * raster PMTiles layers. All PMTile rasters are hosted on
 * Cloudflare R2 and colorized via the pmtiles-color:// protocol
 * defined in /shared/app.js.
 *
 * TO SET UP:
 *   1. Replace RELEASE_URL with your actual R2 bucket URL
 *   2. Update hoverFields to match actual GeoJSON property names
 *   3. Update dst.sortField to your sequential feature ID field
 *   4. Update computeCriteriaArrays() field names to match GeoJSON
 *   5. Update rasterColorRange values once you know the data extents
 * ============================================================
 */

// ── Your Cloudflare R2 public URL ────────────────────────────
// Example: 'https://pub-abc123def456.r2.dev'
const RELEASE_URL = 'https://pub-79bd7cf474e04912a703cf917dd8855e.r2.dev';


const CONFIG = {

  // ══════════════════════════════════════════════════════════
  // GENERAL
  // ══════════════════════════════════════════════════════════
  title:    'N. Kona – S. Kohala DST',
  subtitle: 'North Kona / South Kohala, Hawai\'i',

  center: [19.918941, -155.765171],   // [lat, lng] — same convention as Hamakua
  zoom:   11,

  terrain: true,
  terrainExaggeration: 1.8,

  defaultPitch:   30,
  defaultBearing: -10,

  defaultBasemap: 'light',

  // ══════════════════════════════════════════════════════════
  // COLOR RAMPS (for raster-pmtiles layers)
  // Referenced by key from each layer's colorRamp property.
  // Format: stops array = [value, color, value, color, ...]
  // Values correspond to the *original* data range (rasterColorRange)
  // ══════════════════════════════════════════════════════════
  colorRamps: {

    // Fire / wildfire hazard — yellow → dark red
    wildfire: {
      title: 'Wildfire hazard',
      stops: [0,'#ffffb2', 32,'#fecc5c', 64,'#fd8d3c', 96,'#f03b20',
              128,'#bd0026', 160,'#7a0020', 192,'#490014', 255,'#1a0007'],
      labels: ['Very low','Low','Mod-low','Moderate','Mod-high','High','Very high','Extreme']
    },

    // Community / socioeconomic value — light → dark blue
    commval: {
      title: 'Community value',
      stops: [0,'#f7fbff', 32,'#deebf7', 64,'#c6dbef', 96,'#9ecae1',
              128,'#6baed6', 160,'#4292c6', 192,'#2171b5', 255,'#08306b'],
      labels: ['Very low','Low','Mod-low','Moderate','Mod-high','High','Very high','Extreme']
    },

    // Conservation value — light → dark green
    consval: {
      title: 'Conservation value',
      stops: [0,'#f7fcf5', 32,'#e5f5e0', 64,'#c7e9c0', 96,'#a1d99b',
              128,'#74c476', 160,'#41ab5d', 192,'#238b45', 255,'#00441b'],
      labels: ['Very low','Low','Mod-low','Moderate','Mod-high','High','Very high','Extreme']
    },

  },

  // ══════════════════════════════════════════════════════════
  // HOVER INFO BOX
  // ← Update field names to match your actual GeoJSON properties
  // ══════════════════════════════════════════════════════════
  hoverFields: [
    { field: 'area_acres',  label: 'Acres',              format: 'dec', decimals: 1 },
    { field: 'firevuln',    label: 'Fire vulnerability',  format: 'dec', decimals: 3 },
    { field: 'consval',     label: 'Conservation value',  format: 'dec', decimals: 3 },
    { field: 'commval',     label: 'Community value',     format: 'dec', decimals: 3 },
    { field: 'wildfire_lm', label: 'Wildfire hazard',     format: 'dec', decimals: 3 },
  ],

  // ══════════════════════════════════════════════════════════
  // DATA LAYERS
  // Mixes Hamakua-style GeoJSON layers with TCSI-style PMTiles.
  //
  // GeoJSON:        type:'geojson'       — colorBreaks + colorPalette
  // Raster PMTile:  type:'raster-pmtiles' — colorRamp key + rasterColorRange
  // DST output:     type:'dst'           — colors set at runtime
  // Hillshade:      type:'hillshade'
  // ══════════════════════════════════════════════════════════
  layers: [

    // ── Fire vulnerability (GeoJSON polygon) ────────────────
    // Primary layer for the DST. Must contain all fields used
    // in computeCriteriaArrays() below.
    {
      id:           'firevuln',
      label:        'Fire vulnerability',
      file:         'data/firevuln.geojson',
      type:         'geojson',
      colorField:   'firevuln',              // ← update to actual field name
      colorBreaks:  [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
      colorPalette: ['#ffffb2','#fecc5c','#fd8d3c','#f03b20',
                     '#bd0026','#7a0020','#490014','#1a0007'],
      legendTitle:  'Fire vulnerability',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%',
                     '50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn:    true,
    },

    // ── Conservation values (GeoJSON polygon) ───────────────
    {
      id:           'consval',
      label:        'Conservation values',
      file:         'data/consval.geojson',
      type:         'geojson',
      colorField:   'consval',               // ← update to actual field name
      colorBreaks:  [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
      colorPalette: ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b',
                     '#74c476','#41ab5d','#238b45','#00441b'],
      legendTitle:  'Conservation value',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%',
                     '50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Community / socioeconomic values (GeoJSON polygon) ──
    {
      id:           'commval',
      label:        'Community values',
      file:         'data/commval.geojson',
      type:         'geojson',
      colorField:   'commval',               // ← update to actual field name
      colorBreaks:  [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
      colorPalette: ['#f7fbff','#deebf7','#c6dbef','#9ecae1',
                     '#6baed6','#4292c6','#2171b5','#08306b'],
      legendTitle:  'Community value',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%',
                     '50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Wildfire Landscape Model — May 2026 (PMTiles raster) ─
    // Greyscale uint8 raster (0-255) colorized via colorRamp key.
    // rasterColorRange: [dataMin, dataMax] of the *original* data values.
    // ← Update rasterColorRange once you know your data extents.
    {
      id:               'wildfire_lm_may',
      label:            'Wildfire LM — May 2026',
      type:             'raster-pmtiles',
      url:              `pmtiles://${RELEASE_URL}/nksk_wildfireLM_052926.pmtiles`,
      colorRamp:        'wildfire',
      rasterColorRange: [0, 255],            // ← update to actual data range
      defaultOpacity:   0.8,
      defaultOn:        false,
    },

    // ── Wildfire Landscape Model — June 2026 (PMTiles raster) ─
    {
      id:               'wildfire_lm_jun',
      label:            'Wildfire LM — Jun 2026',
      type:             'raster-pmtiles',
      url:              `pmtiles://${RELEASE_URL}/wildfire_lm_060826.pmtiles`,
      colorRamp:        'wildfire',
      rasterColorRange: [0, 255],            // ← update to actual data range
      defaultOpacity:   0.8,
      defaultOn:        false,
    },

    // ── Community values — June 2026 (PMTiles raster) ────────
    {
      id:               'commval_raster',
      label:            'Community values (raster)',
      type:             'raster-pmtiles',
      url:              `pmtiles://${RELEASE_URL}/commval_060826.pmtiles`,
      colorRamp:        'commval',
      rasterColorRange: [0, 255],            // ← update to actual data range
      defaultOpacity:   0.8,
      defaultOn:        false,
    },

    // ── Conservation values — June 2026 (PMTiles raster) ─────
    {
      id:               'consval_raster',
      label:            'Conservation values (raster)',
      type:             'raster-pmtiles',
      url:              `pmtiles://${RELEASE_URL}/consval_060826.pmtiles`,
      colorRamp:        'consval',
      rasterColorRange: [0, 255],            // ← update to actual data range
      defaultOpacity:   0.8,
      defaultOn:        false,
    },

    // ── Decision score (computed by DST at runtime) ───────────
    // file must be the same GeoJSON used in computeCriteriaArrays()
    {
      id:          'dst_decision',
      label:       'Decision score',
      file:        'data/firevuln.geojson',  // ← same file as DST source
      type:        'dst',
      legendTitle: 'Decision score',
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25',
                     '-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
      legendHeadA: 'Manage',
      legendHeadB: 'Protect',
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Hillshade ─────────────────────────────────────────────
    {
      id:        'hillshade',
      label:     'Hillshade',
      type:      'hillshade',
      defaultOn:  true,
    },

  ],

  // ══════════════════════════════════════════════════════════
  // DECISION SUPPORT TOOL (AHP)
  // ══════════════════════════════════════════════════════════
  dst: {
    enabled: true,

    // Sequential ID field used to sort features before indexing.
    // ← Replace with your GeoJSON's unique numeric feature ID.
    sortField: 'unit_id',

    // Diverging color palettes for the decision score output layer.
    // Warm = manage/restore priority; cool = protect priority.
    decisionBreaks:   [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
    decisionPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84',
                       '#fc8d59','#ef6548','#d7301f','#990000'],
    decisionPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb',
                       '#74a9cf','#3690c0','#0570b0','#034e7b'],

    // Pairwise comparison criteria.
    // Sliders compare criteria[i] vs criteria[i+1] (n−1 sliders for n criteria).
    // Labels are what the user sees in the DST panel.
    restoration: {
      criteria: [
        'Fire vulnerability',
        'Conservation value',
        'Community value',
        'Wildfire exposure',
      ]
    },
    protection: {
      criteria: [
        'Conservation value',
        'Fire vulnerability',
        'Community value',
        'Wildfire exposure',
      ]
    },

    // ──────────────────────────────────────────────────────────
    // computeCriteriaArrays(features)
    //
    // Called once after the DST GeoJSON loads (dst_decision.file).
    // Returns { restoreArrays, protectArrays } where each inner
    // array has one utility value per feature in [0, 1].
    // Array order must match restoration.criteria / protection.criteria.
    //
    // utility(array, inMin, inMax, outMin, outMax) available globally:
    //   outMin=1, outMax=0  → INVERTS (lower raw = higher utility)
    //
    // ← Update all field names to match your actual GeoJSON properties.
    // ──────────────────────────────────────────────────────────
    computeCriteriaArrays(features) {

      // ── Extract raw property arrays ───────────────────────
      const firevuln    = features.map(f => f.properties.firevuln);
      const consval     = features.map(f => f.properties.consval);
      const commval     = features.map(f => f.properties.commval);
      const wildfire_lm = features.map(f => f.properties.wildfire_lm);

      const minFire = Math.min(...firevuln),    maxFire = Math.max(...firevuln);
      const minCons = Math.min(...consval),      maxCons = Math.max(...consval);
      const minComm = Math.min(...commval),      maxComm = Math.max(...commval);
      const minWF   = Math.min(...wildfire_lm),  maxWF   = Math.max(...wildfire_lm);

      // ── Restoration utility arrays ────────────────────────
      // Order must match restoration.criteria above.
      const restoreArrays = [
        utility(firevuln,    minFire, maxFire, 0, 1),  // Fire vulnerability: high → high priority
        utility(consval,     minCons, maxCons, 0, 1),  // Conservation value: high → high priority
        utility(commval,     minComm, maxComm, 0, 1),  // Community value: high → high priority
        utility(wildfire_lm, minWF,   maxWF,   0, 1),  // Wildfire exposure: high → high priority
      ];

      // ── Protection utility arrays ─────────────────────────
      // Order must match protection.criteria above.
      const protectArrays = [
        utility(consval,     minCons, maxCons, 0, 1),  // Conservation value: high → high priority
        utility(firevuln,    minFire, maxFire, 0, 1),  // Fire vulnerability: high → more at risk
        utility(commval,     minComm, maxComm, 0, 1),  // Community value: high → more to protect
        utility(wildfire_lm, minWF,   maxWF,   0, 1),  // Wildfire exposure: high → more at risk
      ];

      return { restoreArrays, protectArrays };
    }
  }

};  // end CONFIG
