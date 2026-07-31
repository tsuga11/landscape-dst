/**
 * config.js — Babeldaob Island, Palau
 * ============================================================
 * THIS IS THE ONLY FILE YOU EDIT when adapting to a new geography.
 *
 * To create a new geography:
 *   1. Copy the geographies/hamakua/ folder to geographies/palau/
 *   2. Replace config.js with this file
 *   3. Put your GeoJSON files in the data/ subfolder
 *   4. Update the card in the root index.html
 *
 * Keys marked [REQUIRED] must be provided.
 * Keys marked [OPTIONAL] have defaults if omitted.
 * ============================================================
 */

const CONFIG = {

  // ══════════════════════════════════════════════════════════
  // GENERAL  [REQUIRED]
  // ══════════════════════════════════════════════════════════
  title:    'Palau DST',
  subtitle: 'Babeldaob Island, Palau',

  // Initial map view  [lat, lng]
  center: [7.52, 134.62],
  zoom:   12,

  // 3D Terrain [OPTIONAL]
  terrain: true,

  // Default base layer: 'light' | 'satellite' | 'topo'  [OPTIONAL]
  defaultBasemap: 'light',

  // ══════════════════════════════════════════════════════════
  // HOVER INFO BOX  [OPTIONAL]
  // Fields shown when hovering over a feature.
  //   field:    GeoJSON property name
  //   label:    Display label
  //   format:   'pct' | 'int' | 'dec' | omit for raw
  //   decimals: decimal places (used with format:'dec')
  // ══════════════════════════════════════════════════════════
  hoverFields: [
    { field: 'hydroUnit',   label: 'Catchment',           format: 'int'                },
    { field: 'Acres',       label: 'Acres',                format: 'dec', decimals: 1  },
    { field: 'propForest',  label: 'Forest cover',         format: 'pct'               },
    { field: 'propSavanna', label: 'Savanna cover',        format: 'pct'               },
    { field: 'sedCurrent',  label: 'Sediment (tons)',      format: 'dec', decimals: 2  },
    { field: 'rchCurrent',  label: 'Recharge (MG)',        format: 'dec', decimals: 2  },
    { field: 'logicRest',   label: 'EcoLogic (restore)',   format: 'dec', decimals: 3  },
    { field: 'logicProt',   label: 'EcoLogic (protect)',   format: 'dec', decimals: 3  },
  ],

  // ══════════════════════════════════════════════════════════
  // DATA LAYERS  [REQUIRED]
  // All polygon features live in data/soe.geojson.
  // Roads, streams, and corals are in their own files.
  // ══════════════════════════════════════════════════════════
  layers: [

    // ── Forest cover ─────────────────────────────────────────
    {
      id:           'forest',
      label:        'Forest cover',
      file:         'data/soe.geojson',
      type:         'geojson',
      colorField:   'propForest',
      colorBreaks:  [0, 0.125, 0.250, 0.375, 0.500, 0.625, 0.750, 0.875],
      colorPalette: ['#ffffcc','#c2e699','#78c679','#41ab5d','#238443','#006837','#004529','#002b18'],
      legendTitle:  'Forest cover',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%','50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn:    true,
    },

    // ── Savanna cover ─────────────────────────────────────────
    {
      id:           'savanna',
      label:        'Savanna cover',
      file:         'data/soe.geojson',
      type:         'geojson',
      colorField:   'propSavanna',
      colorBreaks:  [0, 0.125, 0.250, 0.375, 0.500, 0.625, 0.750, 0.875],
      colorPalette: ['#ffffd4','#fed98e','#fe9929','#d95f0e','#993404','#662100','#3d1200','#1a0700'],
      legendTitle:  'Savanna cover',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%','50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Sediment load ─────────────────────────────────────────
    // NOTE: update colorBreaks with your actual quantile values from the data.
    {
      id:           'sediment',
      label:        'Sediment load',
      file:         'data/soe.geojson',
      type:         'geojson',
      colorField:   'sedCurrent',
      colorBreaks:  [0, 0.010, 0.025, 0.060, 0.120, 0.250, 0.500, 1.000],
      colorPalette: ['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#b10026'],
      legendTitle:  'Sediment load (tons)',
      legendLabels: ['0–0.01','0.01–0.025','0.025–0.06','0.06–0.12','0.12–0.25','0.25–0.5','0.5–1.0','>1.0'],
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Groundwater recharge ──────────────────────────────────
    // NOTE: update colorBreaks with your actual quantile values from the data.
    {
      id:           'recharge',
      label:        'Groundwater recharge',
      file:         'data/soe.geojson',
      type:         'geojson',
      colorField:   'rchCurrent',
      colorBreaks:  [0, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0],
      colorPalette: ['#ffffd9','#edf8b1','#c7e9b4','#7fcdbb','#41b6c4','#1d91c0','#225ea8','#0c2c84'],
      legendTitle:  'Groundwater recharge (MG)',
      legendLabels: ['0–0.5','0.5–1','1–2','2–4','4–8','8–15','15–30','>30'],
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── EcoLogic score (dual restore / protect) ───────────────
    {
      id:           'ecologic',
      label:        'EcoLogic score',
      file:         'data/soe.geojson',
      type:         'dual',
      colorFieldA:  'logicRest',    // Restore direction
      colorFieldB:  'logicProt',    // Protect direction
      colorBreaks:  [-1.00,-0.75,-0.5,-0.25,0.00,0.25,0.5,0.75],
      colorPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
      colorPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],
      legendTitle:  'EcoLogic score',
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25','-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
      legendHeadA:  'Restore',
      legendHeadB:  'Protect',
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Decision score (computed by DST model at runtime) ─────
    {
      id:           'dst_decision',
      label:        'Decision score',
      file:         'data/soe.geojson',
      type:         'dst',
      legendTitle:  'Decision score',
      // Must match dst.decisionBreaks below, NOT the EcoLogic layer's -1..1 scale
      legendLabels: ['0–.125','.125–.25','.25–.375','.375–.5','.5–.625','.625–.75','.75–.875','>.875'],
      legendHeadA:  'Restore',
      legendHeadB:  'Protect',
      strokeWeight: 0.5,
      defaultOn:    false,
    },

    // ── Roads ─────────────────────────────────────────────────
    {
      id:           'roads',
      label:        'Roads',
      file:         'data/roads.geojson',
      type:         'geojson',
      colorField:   'road_type',
      colorType:    'categorical',
      colorBreaks:  [1],
      colorPalette: ['#8B4513'],
      legendTitle:  'Roads',
      legendLabels: ['Road'],
      strokeWeight: 1.5,
      defaultOn:    false,
    },

    // ── Streams ───────────────────────────────────────────────
    {
      id:           'streams',
      label:        'Streams',
      file:         'data/streams.geojson',
      type:         'geojson',
      colorField:   'stream_order',
      colorType:    'categorical',
      colorBreaks:  [1],
      colorPalette: ['#1f78b4'],
      legendTitle:  'Streams',
      legendLabels: ['Stream'],
      strokeWeight: 1.0,
      defaultOn:    false,
    },

    // ── Coral reefs ───────────────────────────────────────────
    {
      id:           'corals',
      label:        'Coral reefs',
      file:         'data/corals.geojson',
      type:         'geojson',
      colorField:   'reef_type',
      colorType:    'categorical',
      colorBreaks:  [1],
      colorPalette: ['#FF69B4'],
      legendTitle:  'Coral reefs',
      legendLabels: ['Reef'],
      strokeWeight: 1.0,
      defaultOn:    false,
    },

  ],

  // ══════════════════════════════════════════════════════════
  // DECISION SUPPORT TOOL — swing weighting
  //
  // The user drags one criterion into the anchor slot (its worst-to-best
  // swing becomes the reference, pinned at 100), then rates every other
  // criterion 0-100 against it. Weights are raw / sum(raw).
  //
  // Each criterion is DECLARED, not computed. app.js derives the utility
  // array and the swing shown in the panel from the same declaration, so
  // the number a user rates is always the number the model uses.
  //
  //   label      display name
  //   units      native units for the swing line ('t', 'MG', '' …)
  //   direction  'lower' or 'higher' — which end of the raw scale is better
  //   raw        f => native value, BEFORE transform or rescaling
  //   transform  'log' | 'log1p' | 'sqrt' | omit — applied before scaling
  //   scaling    how raw values map to [0,1]; omit to inherit dst.scaling
  // ══════════════════════════════════════════════════════════
  dst: {
    enabled: true,

    // Field used to sort features before indexing (must be numeric, unique)
    sortField: 'hydroUnit',

    decisionBreaks:   [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
    decisionPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
    decisionPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],

    // ── Default scaling for every criterion ───────────────────
    // Endpoints at the 5th/95th percentiles rather than min/max, so a single
    // extreme catchment cannot define the swing everyone else is rated
    // against. Units beyond the endpoints clamp to 0 or 1; the panel reports
    // what share that is (~10% is expected at 5/95).
    //
    // Override per criterion with:
    //   scaling: { method:'minmax' }
    //   scaling: { method:'percentile', lower:0.10, upper:0.90 }
    //   scaling: { method:'fixed', bounds:[-1,1] }          // raw units
    //   scaling: { method:'ramp', points:[[0,0],[50,0.6],[200,1]] }
    //
    // 'ramp' is a piecewise-linear membership function in raw units — the
    // same construct as a fuzzy logic ramp, with plateaus and thresholds.
    scaling: { method: 'percentile', lower: 0.05, upper: 0.95 },

    // ── Shared raw accessors ──────────────────────────────────
    // Declared once so the displayed swing and the computed utility can
    // never drift apart.
    raw: {
      logicRest:  f => f.properties.logicRest,
      logicProt:  f => f.properties.logicProt,
      effortRest: f => f.properties.effortRest,
      effortProt: f => f.properties.effortProt,
      diversity:  f => f.properties.diversity,
      savEdge:    f => f.properties.savEdge,
      forEdge:    f => f.properties.forEdge,
    },

    // ── Criteria ──────────────────────────────────────────────
    restoration: {
      criteria: [
        // EcoLogic is a tuned index on a meaningful absolute scale — keep it fixed
        { label: 'EcoLogic score', direction: 'higher',
          scaling: { method: 'fixed', bounds: [-1, 1] },
          raw: f => CONFIG.dst.raw.logicRest(f) },

        // Effort: higher raw = harder, so lower is better
        { label: 'Restoration effort', direction: 'lower',
          raw: f => CONFIG.dst.raw.effortRest(f) },

        { label: 'Biodiversity', direction: 'higher',
          raw: f => CONFIG.dst.raw.diversity(f) },

        // More encroachment = more restoration opportunity
        { label: 'Savanna encroachment', direction: 'higher',
          raw: f => CONFIG.dst.raw.savEdge(f) },
      ]
    },

    protection: {
      criteria: [
        { label: 'EcoLogic score', direction: 'higher',
          scaling: { method: 'fixed', bounds: [-1, 1] },
          raw: f => CONFIG.dst.raw.logicProt(f) },

        { label: 'Protection effort', direction: 'lower',
          raw: f => CONFIG.dst.raw.effortProt(f) },

        { label: 'Biodiversity', direction: 'higher',
          raw: f => CONFIG.dst.raw.diversity(f) },

        // More edge = more exposure to conversion, so more worth defending
        { label: 'Forest-savanna edge', direction: 'higher',
          raw: f => CONFIG.dst.raw.forEdge(f) },
      ]
    }

    // No computeCriteriaArrays() needed — app.js derives the utility arrays
    // from the declarations above. Define one only for logic no declarative
    // spec can express, and set dst.forceComputeFn: true to make it win.
  }

};  // end CONFIG
