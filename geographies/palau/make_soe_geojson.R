# =============================================================================
# make_soe_geojson.R
#
# Produces data/soe.geojson for the Palau DST web app.
# Output field names match exactly what config.js expects.
#
# Run from RStudio or the terminal after setting inDir below.
# Requires: sf, foreign, dplyr
# =============================================================================

library(sf)
library(foreign)
library(dplyr)

# ── Set your local paths ──────────────────────────────────────────────────────
inDir  <- "H:/My Drive/Palau/shinyR"      # ← update this
outDir <- "H:/My Drive/WebApplications/landscape-dst-dev/geographies/palau/data" # ← update to your repo path

dir.create(outDir, recursive = TRUE, showWarnings = FALSE)

# ── Source helper functions (fuzzyRamp, utility, etc.) ───────────────────────
rDST_path <- paste0(inDir, '/rDST')
for (f in list.files(rDST_path, pattern = "\\.r$|\\.R$", full.names = TRUE)) source(f)

# =============================================================================
# 1.  LOAD SPATIAL BASE (hydrounit polygons → provides geometry)
# =============================================================================
units_sf <- st_read(paste0(inDir, '/hydrounits_dissolve_simplify_new.shp'),
                    quiet = TRUE)

# Standardise the ID column name to 'hydroUnit'
# ← check your shapefile — the field may be 'HYD_UN_ID', 'GRIDCODE', etc.
if ('HYD_UN_ID' %in% names(units_sf)) units_sf <- rename(units_sf, hydroUnit = HYD_UN_ID)
if ('GRIDCODE'  %in% names(units_sf)) units_sf <- rename(units_sf, hydroUnit = GRIDCODE)

units_sf <- units_sf[order(units_sf$hydroUnit), ]

# Keep only the ID and geometry; we'll join everything else below
units_sf <- units_sf[, c('hydroUnit', 'geometry')]

# Area in acres (if not already in the shapefile)
units_sf$Acres <- as.numeric(st_area(units_sf)) * 0.000247105   # m² → acres

# =============================================================================
# 2.  VEGETATION COVER
# =============================================================================
forestDbf  <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/forestProp.dbf'))
savannaDbf <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/savannaProp.dbf'))

forestDbf  <- forestDbf[order(forestDbf$GRIDCODE),  ]
savannaDbf <- savannaDbf[order(savannaDbf$GRIDCODE), ]

propForest  <- forestDbf$MEAN
propSavanna <- savannaDbf$MEAN

# =============================================================================
# 3.  SEDIMENT
# =============================================================================
sediment <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/sediment.dbf'))
sediment <- sediment[order(sediment$HYD_UN_ID), ]
sediment <- sediment[, c('HYD_UN_ID', 'CURR_YLD', 'FOREST_YLD', 'SAVAN_YLD')]
names(sediment) <- c('hydroUnit', 'sedCurrent', 'sedForest', 'sedSavanna')

# =============================================================================
# 4.  GROUNDWATER RECHARGE
# =============================================================================
recharge <- read.csv(paste0(inDir, '/zonalSummaries/recharge_summary.csv'))
recharge <- recharge[order(recharge$HydroUnit), ]
recharge <- recharge[, c('HydroUnit', 'CUR_RCG_M', 'FOR_RCG_M', 'SAV_RCG_M')]
names(recharge) <- c('hydroUnit', 'rchCurrent', 'rchForest', 'rchSavanna')

# =============================================================================
# 5.  LOGIC MODEL SCORES
#     Logic scores stay in the −1 to 1 range for the EcoLogic layers.
# =============================================================================

# ── Vegetation logic ──────────────────────────────────────────────────────────
veg_logic_rest <- fuzzyRamp(propSavanna, breaks = c(0.0, 0.2, 0.8, 1.0), scores = c(-1, 1, 1, -1))
veg_logic_prot <- fuzzyRamp(propForest,  breaks = c(0, 1),                scores = c(-1, 1))

# ── Sediment logic ────────────────────────────────────────────────────────────
sed_full_diff     <- sediment$sedSavanna - sediment$sedForest
sed_full_diff_p90 <- quantile(sed_full_diff, 0.9)
sed_full_diff_p10 <- quantile(sed_full_diff, 0.1)

sed_rest_diff <- sediment$sedCurrent - sediment$sedForest
sed_prot_diff <- sediment$sedSavanna - sediment$sedCurrent

sed_logic_rest <- fuzzyRamp(sed_rest_diff,
                            breaks = c(0, sed_full_diff_p90),
                            scores = c(-1, 1))
sed_logic_prot <- fuzzyRamp(sed_prot_diff,
                            breaks = c(sed_full_diff_p10, sed_full_diff_p90),
                            scores = c(-1, 1))

# ── Recharge logic ────────────────────────────────────────────────────────────
rch_full_diff     <- recharge$rchForest - recharge$rchSavanna
rch_full_diff_p90 <- quantile(rch_full_diff, 0.9)
rch_full_diff_p10 <- quantile(rch_full_diff, 0.1)

rch_rest_diff <- recharge$rchForest - recharge$rchCurrent
rch_prot_diff <- recharge$rchCurrent - recharge$rchSavanna

rch_logic_rest <- fuzzyRamp(rch_rest_diff,
                            breaks = c(min(rch_full_diff), 0.33),
                            scores = c(0, 1))
rch_logic_prot <- fuzzyRamp(rch_prot_diff,
                            breaks = c(rch_full_diff_p10, rch_full_diff_p90),
                            scores = c(1, -1))

# ── Combined logic scores (weighted mean across branches) ─────────────────────
logicRest <- apply(data.frame(sed = sed_logic_rest,
                               rch = rch_logic_rest,
                               veg = veg_logic_rest),
                   1, weighted.mean, w = c(0.5, 0.2, 0.3))

logicProt <- rowMeans(data.frame(sed = sed_logic_prot,
                                  rch = rch_logic_prot,
                                  veg = veg_logic_prot))

# =============================================================================
# 6.  DECISION MODEL INPUT FIELDS
#     These are stored as RAW values; utility() is called in config.js.
#     config.js computeCriteriaArrays() will rescale them to [0,1].
# =============================================================================

# ── Biodiversity (raw score; config.js maps 1→0 utility, 5→1 utility) ─────────
diversity_dbf <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/diversity.dbf'))
diversity_dbf <- diversity_dbf[order(diversity_dbf$GRIDCODE), ]
diversity     <- pmax(diversity_dbf$MEAN, diversity_dbf$MAJORITY)

# ── Savanna edge / buffer (raw proportion 0–1) ────────────────────────────────
savEdge_dbf <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/savannaBuffer.dbf'))
savEdge_dbf <- savEdge_dbf[order(savEdge_dbf$GRIDCODE), ]
savEdge     <- savEdge_dbf$MEAN

# ── Forest edge / buffer (raw proportion 0–1) ─────────────────────────────────
forEdge_dbf <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/forestBuffer.dbf'))
forEdge_dbf <- forEdge_dbf[order(forEdge_dbf$GRIDCODE), ]
forEdge     <- forEdge_dbf$MEAN

# ── Effort (access) — raw combined score ──────────────────────────────────────
# Mean of path-distance-to-road and proportion steep slope.
# Higher = harder to access = more effort.
# config.js will INVERT this: utility(effortRest, min, max, 1, 0)
dist2rd_dbf  <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/dist2rd_dem.dbf'))
slope30_dbf  <- foreign::read.dbf(paste0(inDir, '/zonalSummaries/slope_30p.dbf'))

dist2rd_dbf  <- dist2rd_dbf[order(dist2rd_dbf$GRIDCODE), ]
slope30_dbf  <- slope30_dbf[order(slope30_dbf$GRIDCODE), ]

effortRaw    <- rowMeans(data.frame(dist = dist2rd_dbf$MEAN,
                                     slp  = slope30_dbf$MEAN))

# Same effort value for both restoration and protection (as in original R code)
effortRest <- effortRaw
effortProt <- effortRaw

# =============================================================================
# 7.  ASSEMBLE ATTRIBUTE TABLE
# =============================================================================
attrs <- data.frame(
  hydroUnit = units_sf$hydroUnit,

  # Vegetation cover
  propForest  = round(propForest,  4),
  propSavanna = round(propSavanna, 4),

  # Sediment (tons)
  sedCurrent = round(sediment$sedCurrent, 4),
  sedForest  = round(sediment$sedForest,  4),
  sedSavanna = round(sediment$sedSavanna, 4),

  # Groundwater recharge (MG)
  rchCurrent = round(recharge$rchCurrent, 4),
  rchForest  = round(recharge$rchForest,  4),
  rchSavanna = round(recharge$rchSavanna, 4),

  # EcoLogic scores  (−1 to 1)  — drives the EcoLogic map layer
  logicRest = round(logicRest, 4),
  logicProt = round(logicProt, 4),

  # Decision model raw inputs — utility() is applied in config.js
  effortRest = round(effortRest, 4),   # higher = harder (will be inverted in JS)
  effortProt = round(effortProt, 4),   # same value as effortRest
  diversity  = round(diversity,  4),   # raw 1–5 biodiversity score
  savEdge    = round(savEdge,    4),   # savanna buffer proportion (0–1)
  forEdge    = round(forEdge,    4)    # forest buffer proportion (0–1)
)

# =============================================================================
# 8.  JOIN ATTRIBUTES TO SPATIAL DATA AND EXPORT
# =============================================================================
soe_sf <- units_sf %>%
  left_join(attrs, by = 'hydroUnit') %>%
  st_transform(4326)   # GeoJSON must be WGS84

# Write GeoJSON
out_path <- file.path(outDir, 'soe.geojson')
st_write(soe_sf, out_path, driver = 'GeoJSON', delete_dsn = TRUE, quiet = TRUE)

cat("✓ Written:", out_path, "\n")
cat("  Features:", nrow(soe_sf), "\n")
cat("  Fields:  ", paste(names(st_drop_geometry(soe_sf)), collapse = ', '), "\n")


#
# Other layers that need to be converted to geojson
#
roads <- sf::st_read(paste0(inDir, '/roads.shp'))
st_write(
  roads,
  file.path(outDir, 'roads.geojson'),
  driver = 'GeoJSON',
  delete_dsn = TRUE,
  quiet = TRUE
)

streams <- sf::st_read(paste0(inDir, '/streams.shp'))
st_write(
  streams,
  file.path(outDir, 'streams.geojson'),
  driver = 'GeoJSON',
  delete_dsn = TRUE,
  quiet = TRUE
)

corals <- sf::st_read(paste0(inDir, '/corals_singlePart_clean2_simplify.shp'))
st_write(
  corals,
  file.path(outDir, 'corals.geojson'),
  driver = 'GeoJSON',
  delete_dsn = TRUE,
  quiet = TRUE
)


