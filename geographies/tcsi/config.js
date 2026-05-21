/**
 * tcsi_config.js
 * TCSI PROMOTE DST — MapLibre GL JS 4.x configuration
 *
 * COLOR RAMPS use MapLibre's raster-color paint property (v4+).
 * Each raster layer stores a single-band uint8 or uint16 greyscale value.
 * rasterColorRange maps [0,255] → [dataMin, dataMax] so MapLibre can
 * reconstruct original data values and apply the color stops below.
 *
 * DATA PREP (see README_data_prep.md):
 *   COG/GeoTIFF → normalize to uint8 → gdal2tiles → PMTiles
 */

const RELEASE_URL = 'https://pub-79bd7cf474e04912a703cf917dd8855e.r2.dev';


// ─────────────────────────────────────────────────────────────
// CAMERA / BOUNDS
// ─────────────────────────────────────────────────────────────
const CONFIG = {

  title: 'TCSI BLUEPRINT v3',
  center: [-120.548, 39.146],
  zoom: 9,
  minZoom: 8,
  maxZoom: 17,
  bounds: [[-121.22, 38.614], [-119.876, 39.678]],

  // ─── BASEMAPS ───────────────────────────────────────────────
  // All free/open; no Mapbox token required.
  // Swap 'dark' for your Mapbox custom style if desired.
  basemaps: {
    dark: {
      label: 'Relief',
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
    },
    satellite: {
      label: 'Satellite',
      // ESRI World Imagery — no key needed
      style: {
        version: 8,
        sources: {
          esri: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Esri, Maxar, Earthstar Geographics'
          }
        },
        layers: [{ id: 'esri-satellite', type: 'raster', source: 'esri' }]
      }
    }
  },
  // ── HILLSHADE OVERLAY ──────────────────────────────────────
  // Semi-transparent hillshade that sits on top of any basemap
  // and under/over data layers to give terrain texture
  hillshadeOverlay: {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: 'Esri'
  },

  // ─── COLOR RAMPS ────────────────────────────────────────────
  // Used with MapLibre's raster-color paint property.
  // Format: flat array of [value, color, value, color, ...]
  // Values correspond to the *original* data range (not 0-255).
colorRamps: {

  departure: {
    title: 'Condition score',
    stops: [0,'#F5191C', 14,'#E97000', 28,'#E79812', 43,'#EABA21',
            57,'#C1C88C', 71,'#8BBD94', 85,'#4CAFA1', 100,'#3B99B1'],
    labels: ['Fully departed','','','','','','','Within target']
  },

  apScore: {
    title: 'Mgmt benefit',
    stops: [0,'#3B99B1', 14,'#4CAFA1', 28,'#8BBD94', 43,'#C1C88C',
            57,'#EABA21', 71,'#E79812', 85,'#E97000', 100,'#F5191C'],
    labels: ['Lowest benefit','','','','','','','Highest benefit']
  },

  adapt: {
    title: 'Adapt score',
    stops: [0,'#FCFBFF', 14,'#EAE9F7', 28,'#D1CDE8', 43,'#B4AED6',
            57,'#968CC2', 71,'#7867AF', 86,'#5C3E9E', 100,'#3D1778'],
    labels: ['Lowest','','','','','','','Highest']
  },

  protect: {
    title: 'Protect score',
    stops: [0,'#FEF5EC', 14,'#FFE2C6', 28,'#FFC693', 43,'#FBA453',
            57,'#F27E00', 71,'#DE5600', 86,'#B03F00', 100,'#802A07'],
    labels: ['Lowest','','','','','','','Highest']
  },

  monitor: {
    title: 'Monitor score',
    stops: [0,'#EBF5FB', 14,'#C2DFEF', 28,'#99CAE3', 43,'#6FB5D7',
            57,'#469FCB', 71,'#2185B8', 86,'#1A6A94', 100,'#273871'],
    labels: ['Lowest','','','','','','','Highest']
  },

  transform: {
    title: 'Transform score',
    stops: [0,'#FFF0F3', 14,'#FFD0D9', 28,'#FFAABB', 43,'#FF7A93',
            57,'#E84D6A', 71,'#C23054', 86,'#971040', 100,'#6D0026'],
    labels: ['Lowest','','','','','','','Highest']
  },

    // Strategy score (8-class categorical)
    strategy: {
      title: 'Strategy',
      categorical: true,
      classes: [
        { value: 1, color: '#273871', label: 'Monitor — strong' },
        { value: 2, color: '#6FB5D7', label: 'Monitor — weak' },
        { value: 3, color: '#802A07', label: 'Protect — strong' },
        { value: 4, color: '#FBA453', label: 'Protect — weak' },
        { value: 5, color: '#3D1778', label: 'Adapt — strong' },
        { value: 6, color: '#968CC2', label: 'Adapt — weak' },
        { value: 7, color: '#6D0026', label: 'Transform — strong' },
        { value: 8, color: '#FF7A93', label: 'Transform — weak' }
      ]
    },

    // pDRID: 0–1 continuous, red = high disturbance
drid: {
  stops: [0,'#ffffcc', 25,'#fd8d3c', 50,'#f03b20', 75,'#bd0026', 100,'#67000d'],
  labels: ['Low','','','','High']
},

    // Time since last disturbance: 0–50 yrs, dark = recent
tsld: {
  stops: [0,'#67000d', 25,'#f03b20', 50,'#fd8d3c', 75,'#ffffcc', 100,'#f7f7f7'],
  labels: ['Recent (0 yr)','','','','Old (50+ yr)']
},

    // Number of disturbances: 0–10
nDist: {
  stops: [0,'#f7f7f7', 25,'#fc9272', 50,'#ef3b2c', 75,'#cb181d', 100,'#67000d'],
  labels: ['None','','','','Many']
},

    // Operability class (1–5 categorical)
    operability: {
      title: 'Operability',
      categorical: true,
      classes: [
        { value: 1, color: '#1a9641', label: 'Class 1 — most operable' },
        { value: 2, color: '#a6d96a', label: 'Class 2' },
        { value: 3, color: '#ffffbf', label: 'Class 3' },
        { value: 4, color: '#fdae61', label: 'Class 4' },
        { value: 5, color: '#d7191c', label: 'Class 5 — least operable' }
      ]
    },

    // HUC12 summary score: 0–1
    huc12score: {
      title: 'HUC-12 score',
      stops: [0,'#f7f7f7', 0.25,'#fec44f', 0.5,'#fe9929', 0.75,'#d95f0e', 1.0,'#662506'],
      labels: ['Low','','','','High']
    },

    // LMU / climate classes — generic categorical
    lmu: {
      title: 'LMU',
      categorical: true,
      classes: [
        { value: 1,  color: '#1f78b4', label: 'LMU 1' },
        { value: 2,  color: '#33a02c', label: 'LMU 2' },
        { value: 3,  color: '#e31a1c', label: 'LMU 3' },
        { value: 4,  color: '#ff7f00', label: 'LMU 4' },
        { value: 5,  color: '#6a3d9a', label: 'LMU 5' },
        { value: 6,  color: '#b15928', label: 'LMU 6' },
        { value: 7,  color: '#a6cee3', label: 'LMU 7' },
        { value: 8,  color: '#b2df8a', label: 'LMU 8' },
        { value: 9,  color: '#fb9a99', label: 'LMU 9' },
        { value: 10, color: '#fdbf6f', label: 'LMU 10' }
      ]
    },

    // Binary / presence-absence (CSO habitat, etc.)
    binary: {
      title: 'Presence',
      stops: [0,'transparent', 1,'#2ca25f'],
      labels: ['Absent','Present']
    }
  },

  // ─── LAYER GROUPS ───────────────────────────────────────────
  // Each group corresponds to an accordion section in the sidebar.
  // layer.type:
  //   'raster-pmtiles'  → single-band greyscale PMTiles; colorized via raster-color
  //   'vector-pmtiles'  → vector PMTiles (boundaries, polygons)
  //   'geojson'         → small GeoJSON loaded at runtime
  //
  // layer.rasterColorRange: [0, 255]   //   MapLibre maps rasterColorRange → [0,255] so raster-color stops
  //   can use original data units.
  //
  // layer.colorRamp: key into CONFIG.colorRamps above
  //
  // PMTiles URLs below use placeholder paths. Update to match
  // your hosting (S3, GitHub Releases, CDN, etc.).
  // See README_data_prep.md for the GeoTIFF → PMTiles pipeline.

  layerGroups: [

    // ── BOUNDARY LAYERS ─────────────────────────────────────
    {
      id: 'boundary',
      label: 'Boundary layers',
      layers: [
        {
          id: 'tcsiBounds',
          label: 'TCSI boundary',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/TCSI_boundary.pmtiles',
          sourceLayer: 'TCSI_boundary',
          paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 1 },
          colorPicker: true,       // show color picker in sidebar
          defaultOpacity: 1,
          download: './rasters/TCSI_boundary.zip'
        },
        {
          id: 'tcsiHUC12',
          label: 'HUC-12',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/huc12.pmtiles',
          sourceLayer: 'huc12',
          paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.8, 'fill-opacity': 0 },
          colorPicker: true,
          defaultOpacity: 1,
          download: './rasters/HUC12.zip'
        },
        {
          id: 'tcsiHUC10',
          label: 'HUC-10',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/huc10.pmtiles',
          sourceLayer: 'huc10',
          paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.8 },
          colorPicker: true,
          defaultOpacity: 1,
          download: './rasters/HUC10.zip'
        },
        {
          id: 'lmu',
          label: 'LMU',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/lmu.pmtiles',
          colorRamp: 'lmu',
          rasterColorRange: [1, 10],
          defaultOpacity: 0.8,
          download: './rasters/climClasses_v02_015m_int.zip'
        },
        {
          id: 'climClass',
          label: 'Climate class',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/clim_class.pmtiles',
          colorRamp: 'lmu',
          rasterColorRange: [1, 10],
          defaultOpacity: 0.8,
          download: './rasters/ClimClass_TCSI.zip'
        },
        {
          id: 'natForest',
          label: 'National Forest',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/national_forest.pmtiles',
          sourceLayer: 'national_forest',
          paint: { 'line-color': '#4CAF50', 'line-width': 1.5, 'fill-color': '#4CAF50', 'fill-opacity': 0.15 },
          defaultOpacity: 0.8,
          download: './rasters/national_forest.zip'
        }
      ]
    },

    // ── DISTURBANCE LAYERS ──────────────────────────────────
    {
      id: 'disturbance',
      label: 'Disturbance layers',
      layers: [
        {
          id: 'drid',
          label: 'pDRID',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/drid.pmtiles',
          colorRamp: 'drid',
          rasterColorRange: [0, 1],
          defaultOpacity: 0.85,
          tooltip: 'Probability of Disturbance-caused Resource Impact and Degradation (1970–2019).',
          download: './rasters/drid_1970_2019_final_TCSI.tif'
        },
        {
          id: 'tsld',
          label: 'Years since last disturbance',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/tsld.pmtiles',
          colorRamp: 'tsld',
          rasterColorRange: [0, 50],
          defaultOpacity: 0.85,
          tooltip: 'Years since last recorded disturbance event (1970–2019).',
          download: './rasters/tsld_1970_2019_TCSI.tif'
        },
        {
          id: 'nDist',
          label: 'Number of disturbances',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/n_disturbances.pmtiles',
          colorRamp: 'nDist',
          rasterColorRange: [0, 10],
          defaultOpacity: 0.85,
          tooltip: 'Total number of disturbance events recorded 1970–2019.',
          download: './rasters/n_disturbances_1970_2019_TCSI.tif'
        },
        {
          id: 'firePerims',
          label: 'Fires',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/fire_perims.pmtiles',
          sourceLayer: 'fire_perims',
          paint: { 'fill-color': '#E25822', 'fill-opacity': 0.5, 'line-color': '#E25822', 'line-width': 0.5 },
          defaultOpacity: 0.8,
          download: './rasters/fire_perims_1970_2021.zip'
        },
        {
          id: 'rxBurns',
          label: 'Rx fires',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/rxburn.pmtiles',
          sourceLayer: 'rxburn',
          paint: { 'fill-color': '#9B59B6', 'fill-opacity': 0.5, 'line-color': '#9B59B6', 'line-width': 0.5 },
          defaultOpacity: 0.8,
          download: './rasters/rxburn_1970_2020.zip'
        }
      ]
    },

    // ── RESOURCE LAYERS ─────────────────────────────────────
    {
      id: 'resource',
      label: 'Resource layers',
      layers: [
        {
          id: 'icluse',
          label: 'Management zones',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/icluse.pmtiles',
          colorRamp: 'lmu',
          rasterColorRange: [1, 8],
          defaultOpacity: 0.8,
          download: './rasters/iCluse.zip'
        },
        {
          id: 'csoHab',
          label: 'CSO modeled habitat',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/cso_habitat.pmtiles',
          colorRamp: 'binary',
          rasterColorRange: [0, 1],
          defaultOpacity: 0.75,
          download: './rasters/cso_habitat_18Oct2021.tif'
        },
        {
          id: 'csoPacs',
          label: 'CSO PACs',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/cso_pacs.pmtiles',
          sourceLayer: 'cso_pacs',
          paint: { 'fill-color': '#2ECC71', 'fill-opacity': 0.4, 'line-color': '#2ECC71', 'line-width': 1 },
          defaultOpacity: 0.8,
          download: './rasters/CSO_PACS_TCSI.zip'
        },
        {
          id: 'electricLines',
          label: 'Power lines',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/electric_lines.pmtiles',
          sourceLayer: 'electric_lines',
          paint: { 'line-color': '#F1C40F', 'line-width': 1 },
          defaultOpacity: 0.8,
          download: './rasters/electric_lines.zip'
        },
        {
          id: 'highways',
          label: 'Highways',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/highways.pmtiles',
          sourceLayer: 'highways',
          paint: { 'line-color': '#95A5A6', 'line-width': 1.5 },
          defaultOpacity: 0.8,
          download: './rasters/highways_tcsi.zip'
        },
        {
          id: 'dams',
          label: 'Dams',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/dams.pmtiles',
          sourceLayer: 'dams',
          paint: { 'circle-color': '#3498DB', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
          defaultOpacity: 0.9,
          download: './rasters/dams_tcsi.zip'
        },
        {
          id: 'streams',
          label: 'Streams',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/streams.pmtiles',
          sourceLayer: 'streams',
          paint: { 'line-color': '#3498DB', 'line-width': 0.8 },
          defaultOpacity: 0.8,
          download: './rasters/Streams.zip'
        },
        {
          id: 'lakes',
          label: 'Lakes',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/lakes.pmtiles',
          sourceLayer: 'lakes',
          paint: { 'fill-color': '#3498DB', 'fill-opacity': 0.6, 'line-color': '#2980B9', 'line-width': 0.5 },
          defaultOpacity: 0.8,
          download: './rasters/lakes_tcsi.zip'
        }
      ]
    },

    // ── PROMOTE ECOSYSTEM SCORES ────────────────────────────
    {
      id: 'ecosystem',
      label: 'Ecosystem scores',
      labelColor: '#6e6112',
      download: './rasters/PROMOTE_v3/ecosystem.zip',
      layers: [
        { id: 'currentEcosystem',  label: 'Current',      type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_current.pmtiles`,   colorRamp:'departure', rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'futureEcosystem',   label: 'Future',       type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_future.pmtiles`,    colorRamp:'departure', rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'apEcosystem',       label: 'Impact score', type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_ap.pmtiles`,        colorRamp:'apScore',   rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'strategyEcosystem', label: 'Strategy',     type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_strategy.pmtiles`,  colorRamp:'strategy',  rasterColorRange:[1,8],   defaultOpacity:0.85 },
        { id: 'monitorEcosystem',  label: 'Monitor',      type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_monitor.pmtiles`,   colorRamp:'monitor',   rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'protectEcosystem',  label: 'Protect',      type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_protect.pmtiles`,   colorRamp:'protect',   rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'adaptEcosystem',    label: 'Adapt',        type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_adapt.pmtiles`,     colorRamp:'adapt',     rasterColorRange:[0,255], defaultOpacity:0.85 },
        { id: 'transformEcosystem',label: 'Transform',    type:'raster-pmtiles', url:`pmtiles://${RELEASE_URL}/ecosystem_transform.pmtiles`, colorRamp:'transform', rasterColorRange:[0,255], defaultOpacity:0.85 }
      ]
    },

    // ── PILLAR-LEVEL SCORES ─────────────────────────────────
    // Sub-grouped: Forest Resilience, Fire Dynamics,
    //              Fire Adapted Communities, Carbon, Biodiversity.
    // Each sub-group follows the same 7-layer pattern.
    {
      id: 'pillars',
      label: 'Pillar-level scores',
      subGroups: [

        {
          id: 'forestResilience',
          label: 'Forest resilience',
          download: './rasters/PROMOTE_v3/forestResilience.zip',
          layers: makePillarLayers('forestResilience', 'forestResilience')
        },
        {
          id: 'fireDynamics',
          label: 'Fire dynamics',
          download: './rasters/PROMOTE_v3/fireDynamics.zip',
          layers: makePillarLayers('fireDynamics', 'fireDynamics')
        },
        {
          id: 'fireAdaptedComm',
          label: 'Fire adapted communities',
          download: './rasters/PROMOTE_v3/fireAdaptedComm.zip',
          layers: makePillarLayers('fireAdaptedComm', 'fireAdaptedComm')
        },
        {
          id: 'carbon',
          label: 'Carbon sequestration',
          download: './rasters/PROMOTE_v3/carbon.zip',
          layers: makePillarLayers('carbon', 'carbon')
        },
        {
          id: 'biodiversity',
          label: 'Biodiversity',
          download: './rasters/PROMOTE_v3/biodiversity.zip',
          layers: makePillarLayers('biodiversity', 'biodiversity')
        }
      ]
    },

    // ── OPTIMIZATION ────────────────────────────────────────
    {
      id: 'optimization',
      label: 'Optimization',
      layers: [
        {
          id: 'operab',
          label: 'Operability',
          type: 'raster-pmtiles',
          url: 'pmtiles://./pmtiles/operability.pmtiles',
          colorRamp: 'operability',
          rasterColorRange: [1, 5],
          defaultOpacity: 0.8,
          download: './rasters/operability_class_with_scA_final.tif'
        },
        {
          id: 'huc12_summary',
          label: 'HUC-12 score',
          type: 'vector-pmtiles',
          url: 'pmtiles://./pmtiles/huc12_summary.pmtiles',
          sourceLayer: 'huc12_summary',
          paint: {
            'fill-color': ['interpolate',['linear'],['get','score'],
              0,'#f7f7f7', 0.25,'#fec44f', 0.5,'#fe9929', 0.75,'#d95f0e', 1,'#662506'],
            'fill-opacity': 0.75,
            'line-color': '#333',
            'line-width': 0.5
          },
          defaultOpacity: 0.8,
          tooltip: 'HUC-12 watershed-level priority score from optimization model.',
          download: './rasters/huc12_sequenced_weightedacres_01182022.zip'
        }
      ]
    }
  ]
};

// ─── HELPER: build standard 7-layer pillar config ────────────
function makePillarLayers(folder, idPrefix) {
  const fp = folder;
  const base = `pmtiles://${RELEASE_URL}`;

const tooltips = {
    current:   'Current condition score (0-100).',
    future:    'Future condition score using LANDIS-II projections (0-100).',
    ap:        'Impact score: opportunity for management to protect or adapt.',
    monitor:   'Monitor: good condition now and into the future.',
    protect:   'Protect: good condition now, deteriorates over time.',
    adapt:     'Adapt: poor condition now, capacity to reach desired state.',
    transform: 'Transform: poor condition now and remains so over time.'
  };
  
  return [
    { id: `current${idPrefix}`,  label: 'Current',      type:'raster-pmtiles', url:`${base}/${fp}_current.pmtiles`,   colorRamp:'departure', rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.current  },
    { id: `future${idPrefix}`,   label: 'Future',       type:'raster-pmtiles', url:`${base}/${fp}_future.pmtiles`,    colorRamp:'departure', rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.future   },
    { id: `ap${idPrefix}`,       label: 'Impact score', type:'raster-pmtiles', url:`${base}/${fp}_ap.pmtiles`,        colorRamp:'apScore',   rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.ap      },
    { id: `monitor${idPrefix}`,  label: 'Monitor',      type:'raster-pmtiles', url:`${base}/${fp}_monitor.pmtiles`,   colorRamp:'monitor',   rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.monitor  },
    { id: `protect${idPrefix}`,  label: 'Protect',      type:'raster-pmtiles', url:`${base}/${fp}_protect.pmtiles`,   colorRamp:'protect',   rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.protect  },
    { id: `adapt${idPrefix}`,    label: 'Adapt',        type:'raster-pmtiles', url:`${base}/${fp}_adapt.pmtiles`,     colorRamp:'adapt',     rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.adapt    },
    { id: `transform${idPrefix}`,label: 'Transform',    type:'raster-pmtiles', url:`${base}/${fp}_transform.pmtiles`, colorRamp:'transform', rasterColorRange:[0,255], defaultOpacity:0.85, tooltip: tooltips.transform }
  ];
}
