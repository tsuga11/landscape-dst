/**
 * config.js — Hamakua Coast, Hawai'i
 * ============================================================
 * THIS IS THE ONLY FILE YOU EDIT when adapting to a new geography.
 *
 * To create a new geography:
 *   1. Copy the geographies/hamakua/ folder to geographies/your-name/
 *   2. Edit THIS file with your data, layers, and criteria
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
  title:    'Hamakua DST',
  subtitle: "Hamakua Coast, Hawai'i",

  // Initial map view
  center: [19.89, -155.25],
  zoom:   10,

  // 3D Terrain (optional)
  terrain: true,    // enable terrian extrusions
  terrainExaggeration: 2,  // vertical scale (1 = real, 2 = double height)

  //Initial camera (optional)
  defaultPitch: 45, // tilt angle 0 - 85
  defaultBearing: -20, // rotation 0-360

  // Default base layer: 'light' | 'satellite' | 'topo'  [OPTIONAL]
  defaultBasemap: 'light',

  // ══════════════════════════════════════════════════════════
  // SEARCH BAR  [OPTIONAL — remove block to disable]
  // ══════════════════════════════════════════════════════════
  // searchField: 'hydroUnit',    // GeoJSON property to search by
  // searchLabel: 'Catchment ID', // Label shown in the search box

  // ══════════════════════════════════════════════════════════
  // HOVER INFO BOX  [OPTIONAL — remove to disable hover]
  // Fields shown when hovering over a feature.
  //   field:   GeoJSON property name
  //   label:   Display label
  //   format:  'pct' | 'int' | 'gallons' | 'dec' | omit for raw value
  //   decimals: number of decimal places (used with format:'dec')
  // ══════════════════════════════════════════════════════════
  hoverFields: [
    { field: 'Acres',           label: 'Acres',            format: 'dec', decimals: 1 },
    { field: 'SG_Proportion',   label: 'SG cover',         format: 'pct' },
    { field: 'gallons_yr',      label: 'Water yield',      format: 'gallons' },
    { field: 'saveGallons_yr',  label: 'Restored yield',   format: 'gallons' },
    { field: 'SOE_wsImprove11', label: 'EcoLogic (restore)', format: 'dec', decimals: 3 },
    { field: 'SOE_wsProtect11', label: 'EcoLogic (protect)', format: 'dec', decimals: 3 },
  ],

  // ══════════════════════════════════════════════════════════
  // DATA LAYERS  [REQUIRED]
  //
  // Each layer object:
  //   id:            unique string identifier
  //   label:         display name in the layer control
  //   file:          path to data file, relative to this config.js
  //   type:          'geojson' | 'dual' | 'dst' | 'wms' | 'cog'
  //   defaultOn:     true = layer is visible on load
  //
  // For type:'geojson':
  //   colorField:    GeoJSON property to color by
  //   colorBreaks:   array of break values (n values → n color bins)
  //   colorPalette:  array of hex colors, same length as colorBreaks
  //   colorType:     'sequential' (default) | 'categorical'
  //   legendTitle:   title shown on the legend
  //   legendLabels:  array of label strings for each color bin
  //
  // For type:'dual' (diverging: restore vs protect):
  //   colorFieldA:   GeoJSON property for "restore" score
  //   colorFieldB:   GeoJSON property for "protect" score
  //   colorBreaks:   shared break values for both palettes
  //   colorPaletteA: color ramp for "restore" direction (warm)
  //   colorPaletteB: color ramp for "protect" direction (cool)
  //   legendHeadA/B: column headers for the dual legend
  //
  // For type:'dst':
  //   Colors are computed at runtime by the DST model; no colorField needed.
  //
  // For type:'wms':
  //   url:           WMS service URL
  //   wmsLayers:     layer name string
  //   wmsFormat:     image format (default 'image/png')
  //
  // For type:'cog':
  //   file:          URL or relative path to a COG GeoTIFF
  //   colorBreaks:   pixel value breaks
  //   colorPalette:  hex colors matching each break
  // ══════════════════════════════════════════════════════════
  layers: [

    // ── Strawberry Guava cover ───────────────────────────────
    {
      id:        'sg',
      label:     'Strawberry guava',
      file:      'data/soe.geojson',
      type:      'geojson',
      colorField: 'SG_Proportion',
      colorBreaks: [0, 0.125, 0.250, 0.375, 0.500, 0.625, 0.750, 0.875],
      colorPalette: ['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#b10026'],
      legendTitle:  'Strawberry guava cover',
      legendLabels: ['0–12.5%','12.5–25%','25–37.5%','37.5–50%','50–62.5%','62.5–75%','75–87.5%','>87.5%'],
      strokeWeight: 0.5,
      defaultOn: true,
    },

    // ── EcoLogic score (watershed scale, dual restore/protect) ──
    {
      id:    'soe_ws',
      label: 'EcoLogic score (watershed)',
      file:  'data/soe.geojson',
      type:  'dual',
      colorFieldA: 'SOE_wsImprove11',   // Restore direction
      colorFieldB: 'SOE_wsProtect11',   // Protect direction
      colorBreaks:  [-1.00,-0.75,-0.5,-0.25,0.00,0.25,0.5,0.75],
      colorPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
      colorPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],
      legendTitle: 'EcoLogic score (watershed)',
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25','-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
      legendHeadA: 'Restore',
      legendHeadB: 'Protect',
      strokeWeight: 0.5,
      defaultOn: false,
    },

    // ── EcoLogic score (unit scale, dual restore/protect) ────
    {
      id:    'soe_unit',
      label: 'EcoLogic score (unit)',
      file:  'data/soe.geojson',
      type:  'dual',
      colorFieldA: 'SOE_unitImprove11',
      colorFieldB: 'SOE_unitProtect11',
      colorBreaks:  [-1.00,-0.75,-0.5,-0.25,0.00,0.25,0.5,0.75],
      colorPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
      colorPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],
      legendTitle: 'EcoLogic score (unit)',
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25','-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
      legendHeadA: 'Restore',
      legendHeadB: 'Protect',
      strokeWeight: 0.5,
      defaultOn: false,
    },

    // ── Water yield ──────────────────────────────────────────
    {
      id:        'water_yield',
      label:     'Water yield',
      file:      'data/soe.geojson',
      type:      'geojson',
      colorField:  'gallons_yr',
      colorBreaks: [0,13193780,64227387,125362568,225291458,344749056,561661204,914492064],
      colorPalette: ['#ffffd9','#edf8b1','#c7e9b4','#7fcdbb','#41b6c4','#1d91c0','#225ea8','#0c2c84'],
      legendTitle:  'Water yield (gal/yr)',
      legendLabels: ['0–13M','13–64M','64–125M','125–225M','225–345M','345–562M','562M–914M','>914M'],
      strokeWeight: 0.5,
      defaultOn: false,
    },

    // ── Restored water yield (gallons saved by SG removal) ───
    {
      id:        'save_gallons',
      label:     'Restored yield',
      file:      'data/soe.geojson',
      type:      'geojson',
      colorField:  'saveGallons_yr',
      colorBreaks: [0,39462,237327,516099,1122139,2478620,7614008,18271256],
      colorPalette: ['#ffffe5','#f7fcb9','#d9f0a3','#addd8e','#78c679','#41ab5d','#238443','#005a32'],
      legendTitle:  'Restored yield (gal/yr)',
      legendLabels: ['0–39K','39–237K','237–516K','516K–1.1M','1.1–2.5M','2.5–7.6M','7.6–18M','>18M'],
      strokeWeight: 0.5,
      defaultOn: false,
    },

    // ── Ownership (TMK) — uses a separate GeoJSON file ───────
    // NOTE: Add data/tmk.geojson to the data/ folder
    {
      id:        'ownership',
      label:     'Ownership',
      file:      'data/tmk.geojson',
      type:      'geojson',
      colorField:  'ownership_id',   // ← update this to the correct property name in tmk.geojson
      colorType:   'categorical',
      colorBreaks: [1,2,3,4,5,6,7],
      colorPalette: ['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d'],
      legendTitle:  'Ownership',
      legendLabels: ['Owner 1','Owner 2','Owner 3','Owner 4','Owner 5','Owner 6','Owner 7'],
      strokeWeight: 1,
      defaultOn: false,
    },

    // ── Decision score (computed by DST model) ────────────────
    // Colors are set at runtime when the user clicks "Calculate"
    {
      id:        'dst_decision',
      label:     'Decision score',
      file:      'data/soe.geojson',
      type:      'dst',
      legendTitle: 'Decision score',
      legendLabels: ['>0.75','0.5–0.75','0.25–0.5','0–0.25','-0.25–0','-0.5–-0.25','-0.75–-0.5','<-0.75'],
      legendHeadA: 'Restore',
      legendHeadB: 'Protect',
      strokeWeight: 0.5,
      defaultOn: false,
    },

    // --- Hillshade
    {
      id:       'hillshade',
      label:    'Hillshade',
      type:     'hillshade',   // special type
      defaultOn: false,
    },

    // ── EXAMPLE: How to add a COG raster layer ────────────────
    // Uncomment and edit when you have a GeoTIFF/COG file ready.
    // Requires the georaster CDN scripts to be added to index.html.
    // {
    //   id:        'my_raster',
    //   label:     'My Raster Layer',
    //   file:      'data/my_layer.tif',
    //   type:      'cog',
    //   colorBreaks:  [0, 25, 50, 75, 100],
    //   colorPalette: ['#ffffcc','#a1dab4','#41b6c4','#2c7fb8','#253494'],
    //   legendTitle:  'My raster',
    //   legendLabels: ['0–25','25–50','50–75','75–100','>100'],
    //   cogResolution: 256,
    //   defaultOn: false,
    // },

    // ── EXAMPLE: How to add a WMS layer ───────────────────────
    // {
    //   id:        'wms_example',
    //   label:     'WMS Example',
    //   type:      'wms',
    //   url:       'https://example.com/geoserver/wms',
    //   wmsLayers: 'workspace:layer_name',
    //   legendTitle: 'WMS Layer',
    //   defaultOn: false,
    // },

  ],

  // ══════════════════════════════════════════════════════════
  // DECISION SUPPORT TOOL — swing weighting
  //
  // The user drags one criterion into the anchor slot (its worst-to-best
  // swing becomes the reference, pinned at 100), then rates every other
  // criterion 0-100 against it. Weights are raw / sum(raw).
  //
  // Each criterion declares:
  //   label      display name
  //   units      native units, for the swing line ('$', 'min', '' …)
  //   direction  'higher' or 'lower' — which end of the raw scale is better
  //   raw        f => native value, BEFORE any transform or rescaling.
  //              app.js reads the observed min/max from this to render the
  //              real-unit swing under the label. This is the number the
  //              user is actually rating.
  //   bounds     [inMin,inMax] ONLY when utility() is given fixed bounds.
  //              Omit for min-max rescaled criteria; the observed range is
  //              then the swing by definition.
  //   transform  'log' when the value is logged before rescaling, so the
  //              row can note that the scale is not linear in these units.
  // ══════════════════════════════════════════════════════════
  dst: {
    enabled: true,

    // Field used to sort features before indexing (must be numeric, unique)
    sortField: 'hydroUnit',

    // Warm ramp = restore priority; cool ramp = protect priority
    decisionBreaks:   [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
    decisionPaletteA: ['#fff7ec','#fee8c8','#fdd49e','#fdbb84','#fc8d59','#ef6548','#d7301f','#990000'],
    decisionPaletteB: ['#fff7fb','#ece7f2','#d0d1e6','#a6bddb','#74a9cf','#3690c0','#0570b0','#034e7b'],

    // ── Shared raw accessors ──────────────────────────────────
    // Defined once so the swing display and computeCriteriaArrays() can
    // never drift apart. Costs are returned in DOLLARS here; the log
    // transform is applied later, inside computeCriteriaArrays().
    raw: {
      // Travel cost: weighted mean of initial + maintenance transport
      travelCost: f => ((f.properties.Transport_Cost * 0.8554) +
                        (f.properties.Maintenance_Travel * 0.1446)) / 1.0,

      // Labor cost: weighted mean of initial + maintenance materials
      laborCost: f => ((Math.abs(f.properties.Materials_Cost_Total) * 0.8554) +
                       (Math.abs(f.properties.Maintenance_Materials) * 0.1446)) / 1.0,

      fenceCost:  f => f.properties.Fenceline_Cost,
      travelTime: f => f.properties.Hours * 60,
      streamDeg:  f => f.properties.streamDeg,
      wsOutput:   f => f.properties.WSoutput,

      // Land designation: weighted mean of conservation score + critical habitat
      landDesig: f => ((f.properties.conScore * 0.6747) +
                       (f.properties.critHab  * 0.3373)) / 1.012,
    },

    // ── Criteria ──────────────────────────────────────────────
    // Order MUST match the utility arrays in computeCriteriaArrays().
    restoration: {
      criteria: [
        { label: 'EcoLogic score', direction: 'higher', bounds: [-1, 1],
          raw: f => f.properties.SOE_wsImprove11 },

        { label: 'Travel costs', units: '$', direction: 'lower', transform: 'log',
          raw: f => CONFIG.dst.raw.travelCost(f) },

        { label: 'Labor costs', units: '$', direction: 'lower', transform: 'log',
          raw: f => CONFIG.dst.raw.laborCost(f) },

        { label: 'Stream habitat quality', direction: 'lower', bounds: [0, 0.63],
          raw: f => CONFIG.dst.raw.streamDeg(f) },

        { label: 'Conservation status', direction: 'higher',
          raw: f => CONFIG.dst.raw.landDesig(f) },

        { label: 'Watershed output', direction: 'higher', bounds: [0, 100],
          raw: f => CONFIG.dst.raw.wsOutput(f) },
      ]
    },

    protection: {
      criteria: [
        { label: 'EcoLogic score', direction: 'higher', bounds: [-1, 1],
          raw: f => f.properties.SOE_wsProtect11 },

        { label: 'Fencing costs', units: '$', direction: 'lower',
          raw: f => CONFIG.dst.raw.fenceCost(f) },

        { label: 'Travel time', units: 'min', direction: 'lower',
          raw: f => CONFIG.dst.raw.travelTime(f) },

        { label: 'Stream habitat quality', direction: 'lower', bounds: [0, 0.63],
          raw: f => CONFIG.dst.raw.streamDeg(f) },

        { label: 'Conservation status', direction: 'higher',
          raw: f => CONFIG.dst.raw.landDesig(f) },

        { label: 'Watershed output', direction: 'higher', bounds: [0, 100],
          raw: f => CONFIG.dst.raw.wsOutput(f) },
      ]
    },

    // ──────────────────────────────────────────────────────────
    // computeCriteriaArrays(features)
    //
    // Returns one utility array per criterion, each value in [0,1], in the
    // SAME ORDER as the criteria above.
    //
    //   utility(array, inMin, inMax, outMin, outMax)
    //   → rescales linearly and clamps
    //   → outMin=1, outMax=0 INVERTS (lower raw value scores higher)
    //
    // Anywhere a fixed inMin/inMax is used here, the matching criterion
    // above must declare the same pair as `bounds`.
    // ──────────────────────────────────────────────────────────
    computeCriteriaArrays(features) {

      const R    = CONFIG.dst.raw;
      const get  = fn => features.map(fn);
      const span = a => [Math.min(...a), Math.max(...a)];

      const soe_wsImp  = get(f => f.properties.SOE_wsImprove11);
      const soe_wsProt = get(f => f.properties.SOE_wsProtect11);

      // Costs are log-transformed before rescaling: without it a single
      // extreme unit compresses every other unit into a narrow band.
      const trans   = get(f => Math.log(R.travelCost(f)));
      const effort  = get(f => Math.log(R.laborCost(f)));
      const fence   = get(R.fenceCost);
      const minutes = get(R.travelTime);
      const landd   = get(R.landDesig);
      const streamdeg = get(R.streamDeg);
      const wsout     = get(R.wsOutput);

      const [minTrans,  maxTrans ] = span(trans);
      const [minEffort, maxEffort] = span(effort);
      const [minFence,  maxFence ] = span(fence);
      const [minMin,    maxMin   ] = span(minutes);
      const [minLandd,  maxLandd ] = span(landd);

      const restoreArrays = [
        utility(soe_wsImp, -1, 1, 0, 1),                 // EcoLogic score
        utility(trans,  minTrans,  maxTrans,  1, 0),     // Travel costs (inverted)
        utility(effort, minEffort, maxEffort, 1, 0),     // Labor costs (inverted)
        utility(streamdeg, 0, 0.63, 1, 0),               // Stream habitat quality (inverted)
        utility(landd, minLandd, maxLandd, 0, 1),        // Conservation status
        utility(wsout, 0, 100, 0, 1),                    // Watershed output
      ];

      const protectArrays = [
        utility(soe_wsProt, -1, 1, 0, 1),                // EcoLogic score
        utility(fence,   minFence, maxFence, 1, 0),      // Fencing costs (inverted)
        utility(minutes, minMin,   maxMin,   1, 0),      // Travel time (inverted)
        utility(streamdeg, 0, 0.63, 1, 0),               // Stream habitat quality (inverted)
        utility(landd, minLandd, maxLandd, 0, 1),        // Conservation status
        utility(wsout, 0, 100, 0, 1),                    // Watershed output
      ];

      return { restoreArrays, protectArrays };
    }
  }

};  // end CONFIG
