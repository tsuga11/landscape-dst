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
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25','-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
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
  // DECISION SUPPORT TOOL (AHP)
  // ══════════════════════════════════════════════════════════
  dst: {
    enabled: true,

    // Field used to sort features before indexing (must be numeric, sequential)
    sortField: 'hydroUnit',

    // Color breaks and palettes for the decision score output layer
    decisionBreaks:   [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
    decisionPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
    decisionPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],

    // Pairwise comparison criteria.
    // Sliders compare criteria[i] vs criteria[i+1] for i = 0..n-2.
    restoration: {
      criteria: [
        'EcoLogic score',
        'Restoration effort',
        'Biodiversity',
        'Savanna encroachment',
      ]
    },
    protection: {
      criteria: [
        'EcoLogic score',
        'Protection effort',
        'Biodiversity',
        'Forest-savanna edge',
      ]
    },

    // ──────────────────────────────────────────────────────────
    // computeCriteriaArrays(features)
    //
    // Called once after GeoJSON loads. Returns utility scores in
    // [0,1] for each criterion × feature combination.
    //
    // Expected fields on data/soe.geojson features:
    //   logicRest    — EcoLogic restoration score (−1 to 1)
    //   logicProt    — EcoLogic protection score (−1 to 1)
    //   effortRest   — restoration effort index (raw; higher = harder)
    //   effortProt   — protection effort index (raw; higher = harder)
    //   diversity    — biodiversity score (species count or composite index)
    //   savEdge      — savanna encroachment / edge density
    //   forEdge      — forest-savanna edge density
    //
    // The utility() helper (from shared/app.js):
    //   utility(array, inMin, inMax, outMin, outMax)
    //   → rescales values from [inMin,inMax] to [outMin,outMax]
    //   → set outMin=1, outMax=0 to INVERT (lower raw = higher utility)
    // ──────────────────────────────────────────────────────────
    computeCriteriaArrays(features) {

      // ── Raw property arrays ───────────────────────────────
      const logicRest  = features.map(f => f.properties.logicRest);
      const logicProt  = features.map(f => f.properties.logicProt);
      const effortRest = features.map(f => f.properties.effortRest);
      const effortProt = features.map(f => f.properties.effortProt);
      const diversity  = features.map(f => f.properties.diversity);
      const savEdge    = features.map(f => f.properties.savEdge);
      const forEdge    = features.map(f => f.properties.forEdge);

      const minER = Math.min(...effortRest), maxER = Math.max(...effortRest);
      const minEP = Math.min(...effortProt), maxEP = Math.max(...effortProt);
      const minDv = Math.min(...diversity),  maxDv = Math.max(...diversity);
      const minSE = Math.min(...savEdge),    maxSE = Math.max(...savEdge);
      const minFE = Math.min(...forEdge),    maxFE = Math.max(...forEdge);

      // ── Restoration utility arrays ────────────────────────
      // Order must match restoration.criteria above!
      const restoreArrays = [
        utility(logicRest,  -1, 1,    0, 1),  // EcoLogic score
        utility(effortRest, minER, maxER, 1, 0),  // Restoration effort (inverted)
        utility(diversity,  minDv, maxDv, 0, 1),  // Biodiversity
        utility(savEdge,    minSE, maxSE, 0, 1),  // Savanna encroachment
      ];

      // ── Protection utility arrays ─────────────────────────
      // Order must match protection.criteria above!
      const protectArrays = [
        utility(logicProt,  -1, 1,    0, 1),  // EcoLogic score
        utility(effortProt, minEP, maxEP, 1, 0),  // Protection effort (inverted)
        utility(diversity,  minDv, maxDv, 0, 1),  // Biodiversity
        utility(forEdge,    minFE, maxFE, 0, 1),  // Forest-savanna edge
      ];

      return { restoreArrays, protectArrays };
    }
  }

};  // end CONFIG
