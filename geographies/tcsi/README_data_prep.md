# TCSI Data Preparation — GeoTIFF → PMTiles

## Why PMTiles + raster-color?

**Old approach:** thousands of pre-colored PNG tile files per raster (z/x/y.png pyramids).  
**New approach:** one `.pmtiles` file per raster (single-band greyscale) + GPU color ramps in MapLibre 4.x.

Benefits:
- One file per raster instead of 10,000+ PNGs
- Host anywhere static (S3, GitHub Releases, Netlify, Cloudflare R2)
- Color ramps are dynamic — change them in `tcsi_config.js` without re-tiling
- `raster-color` expression runs on the GPU; fast even for large extents
- MapLibre reads tiles on-demand (only what's in the viewport), just like PNG tiles

---

## Prerequisites

```bash
conda create -n tcsi-tiles python=3.11
conda activate tcsi-tiles
pip install gdal rio-cogeo pmtiles mbutil
# or: conda install -c conda-forge gdal
```

Also install the `pmtiles` CLI:
```bash
npm install -g pmtiles
# OR download binary from https://github.com/protomaps/go-pmtiles/releases
```

---

## Step 1 — Ensure GeoTIFF is valid and has a CRS

```bash
gdalinfo input.tif | head -30
# Should show: Coordinate System, Data Type, NoData value
```

If no NoData is set:
```bash
gdal_edit.py -a_nodata -9999 input.tif   # adjust value to match your rasters
```

---

## Step 2 — Normalize to uint8 (0–255 greyscale)

MapLibre's `raster-color` reads the 0–255 pixel value and maps it back to your
original data range using `raster-color-range: [dataMin, dataMax]`.

**Continuous rasters (scores, pDRID, TSLD, etc.):**

```bash
# Example: current condition score, data range -1 to +1
gdal_translate \
  -scale -1 1 0 255 \          # map data range → 0-255
  -ot Byte \                    # output type: 8-bit unsigned
  -a_nodata 0 \                 # treat 0 as nodata (if -1→0 maps there)
  current.tif current_uint8.tif

# Better: use a slightly shifted scale to avoid nodata collision
# Map -1→1 to 1→255; reserve 0 for nodata
gdal_translate \
  -scale -1 1 1 255 \
  -ot Byte \
  -a_nodata 0 \
  current.tif current_uint8.tif
```

> **Note:** Update `rasterColorRange` in `tcsi_config.js` to match the original
> data range. The stop values in `colorRamps.departure.stops` already use
> original units (-1 to +1), so no change needed there.

**Categorical rasters (strategy, operability, LMU, etc.):**

These are already integer values — no scaling needed. Just convert to Byte:
```bash
gdal_translate -ot Byte -a_nodata 0 strategy.tif strategy_uint8.tif
```

**For rasters with range > 255 (e.g., TSLD 0–60 years or NDIST 0–10):**

These fit in uint8 naturally. Just set nodata:
```bash
gdal_translate -ot Byte -a_nodata 255 tsld.tif tsld_uint8.tif
# rasterColorRange: [0, 50] in config
```

---

## Step 3 — Reproject to EPSG:3857 (Web Mercator)

MapLibre tile coordinates are in Web Mercator. Your rasters are likely in
EPSG:5070 or a UTM/Albers projection — reproject before tiling:

```bash
gdalwarp \
  -t_srs EPSG:3857 \
  -r bilinear \          # bilinear for continuous; near for categorical
  -co COMPRESS=LZW \
  current_uint8.tif current_3857.tif
```

---

## Step 4 — Generate raster tiles (XYZ PNG)

```bash
gdal2tiles.py \
  --zoom=9-14 \          # zoom 9 coarse, 14 full detail at 15m
  --processes=8 \        # parallel
  --tiledriver=PNG \
  --xyz \                # XYZ scheme (MapLibre default)
  current_3857.tif \
  tiles_current/
```

> Zoom levels to use:
> - 15m rasters: 9–15 gives good detail without too many files
> - 30m rasters: 9–14 is usually sufficient

---

## Step 5 — Package as MBTiles, then convert to PMTiles

```bash
# MBTiles from tile directory
mb-util --image_format=png tiles_current/ current.mbtiles

# Convert to PMTiles
pmtiles convert current.mbtiles current.pmtiles

# Verify
pmtiles show current.pmtiles
```

---

## Step 6 — Batch pipeline (all PROMOTE rasters)

```bash
#!/bin/bash
# batch_tile.sh
# Run from directory containing all promote GeoTIFFs

OUTDIR="./pmtiles/promote"
ZOOMS="9-14"
JOBS=8

declare -A SCALES=(
  ["current"]="-1 1 1 255"
  ["future"]="-1 1 1 255"
  ["ap"]="-1 1 1 255"
  ["monitor"]="0 1 1 255"
  ["protect"]="0 1 1 255"
  ["adapt"]="0 1 1 255"
  ["transform"]="0 1 1 255"
)

PILLARS=("ecosystem" "forestResilience" "fireDynamics" "fireAdaptedComm" "carbon" "biodiversity")

for pillar in "${PILLARS[@]}"; do
  mkdir -p "${OUTDIR}/${pillar}"
  for score in current future ap monitor protect adapt transform; do
    IN="${pillar}/${score}.tif"
    [ -f "$IN" ] || continue

    SCALE=${SCALES[$score]}
    OUT_BASE="${OUTDIR}/${pillar}/${score}"

    echo "Tiling: $IN → ${OUT_BASE}.pmtiles"

    gdal_translate -scale $SCALE -ot Byte -a_nodata 0 "$IN" /tmp/tcsi_uint8.tif
    gdalwarp -t_srs EPSG:3857 -r bilinear /tmp/tcsi_uint8.tif /tmp/tcsi_3857.tif
    gdal2tiles.py --zoom=$ZOOMS --processes=$JOBS --xyz /tmp/tcsi_3857.tif /tmp/tiles/
    mb-util --image_format=png /tmp/tiles/ /tmp/tcsi.mbtiles
    pmtiles convert /tmp/tcsi.mbtiles "${OUT_BASE}.pmtiles"

    rm -rf /tmp/tcsi_uint8.tif /tmp/tcsi_3857.tif /tmp/tiles/ /tmp/tcsi.mbtiles
  done
done
```

---

## Step 7 — Vector layers (shapefiles/GeoJSON → PMTiles)

For boundary layers, HUC polygons, fire perimeters, etc.:

```bash
pip install tippecanoe   # or: conda install -c conda-forge tippecanoe

tippecanoe \
  -o tcsi_boundary.pmtiles \
  -z 14 -Z 8 \
  --force \
  TCSI_boundary.shp

# For fire perimeters (many features, simplify aggressively at low zoom):
tippecanoe \
  -o fire_perims.pmtiles \
  -z 14 -Z 8 \
  --drop-densest-as-needed \
  fire_perims_1970_2021.shp
```

---

## Step 8 — Hosting

PMTiles files can be served from any static host that supports HTTP range requests:
- **AWS S3** with static website hosting
- **Cloudflare R2** (free, fast)
- **GitHub Releases** (for smaller files <2GB)
- **Netlify / Vercel** (any static host)

Update the URLs in `tcsi_config.js`:
```javascript
url: 'pmtiles://https://your-bucket.s3.amazonaws.com/tcsi/promote/ecosystem/current.pmtiles'
```

For local development:
```bash
python -m http.server 8080
# Then use: url: 'pmtiles://http://localhost:8080/pmtiles/...'
```

---

## raster-color-range reference

| Raster                         | Original range | gdal_translate scale  |
|--------------------------------|---------------|-----------------------|
| current / future scores        | -1 to +1      | `-scale -1 1 1 255`   |
| ap / impact scores             | -1 to +1      | `-scale -1 1 1 255`   |
| monitor/protect/adapt/transform| 0 to 1        | `-scale 0 1 1 255`    |
| pDRID                          | 0 to 1        | `-scale 0 1 1 255`    |
| TSLD                           | 0 to 50       | `-scale 0 50 1 255`   |
| N disturbances                 | 0 to 10       | `-scale 0 10 1 255`   |
| Operability class              | 1 to 5        | no scale needed       |
| LMU                            | 1 to N        | no scale needed       |
| Strategy                       | 1 to 8        | no scale needed       |

> Keep `rasterColorRange: [originalMin, originalMax]` in `tcsi_config.js` to
> match the original data units — MapLibre will back-transform pixel values
> for you and the color stop values will be in original units.

---

## Alternative: TiTiler (if you have a backend)

If you have a Python server available, [TiTiler](https://developmentseed.org/titiler/)
can serve COGs directly without pre-tiling:

```bash
pip install titiler[full]
uvicorn titiler.application:app --port 8000
```

MapLibre source then becomes a standard `raster` with tiles URL:
```javascript
{
  type: 'raster',
  tiles: ['http://localhost:8000/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?url=./rasters/current.tif&rescale=-1,1'],
  tileSize: 256
}
```
But PMTiles + static hosting is simpler and cheaper for a finished product.
