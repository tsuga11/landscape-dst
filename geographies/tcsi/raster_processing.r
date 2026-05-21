library(terra)




# Install CLI using command line (cmd)
# msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

# Configure AWS in command line
# aws configure set region us-east-2
# aws login
# s3 cp s3://northcoastxy.com/tcsi/ H:/My Drive/TCSI --recursive
# s3 cp s3://northcoastxy.com/tcsi/rasters H:/My Drive/TCSI/rasters --recursive

# To convert rasters --> PMTiles -- requires many steps

# Get miniforge -- conda lite...
# downloaded Miniforge3-Windows-x86_64.exe, which is a conda lite -- https://github.com/conda-forge/miniforge/releases/latest
#installed it here 'C:\tools\miniforge3'
# Uncheck 'Add Miniforge3 to my PATH' — this is the key one
# Uncheck 'Register Miniforge3 as my default Python'
# Then hit windows key -- search for miniforge, and it will open command prompt, then
# conda config --set auto_activate_base false
# All of this makes it so conda doesn't take over my computer!

# in miniforge
# conda create -n tcsi-tiles python=3.11
# conda activate tcsi-tiles
# conda install -c conda-forge gdal

# download binary https://github.com/protomaps/go-pmtiles/releases

# gdalinfo 'H:/My Drive/TCSI/rasters/PROMOTE_v3/ecosystem/adapt.tif'

library(terra)

rescale_to_uint8 <- function(r, out_path) {
  message("  Rescaling: ", names(r)[1], " | ", date())
  r_scaled <- round((r + 1) / 2 * 100)
  r_scaled <- clamp(r_scaled, 0, 100)
  writeRaster(
    r_scaled,
    out_path,
    datatype = "INT1U",
    NAflag = 255,
    overwrite = TRUE
  )
}

fix_mbtiles_metadata <- function(
  mb_path,
  name,
  python_exe,
  bounds = "-121.326742,38.607299,-119.875002,39.780395",
  center = "-120.6,39.19,9",
  minzoom = 9,
  maxzoom = 14
) {
  py_cmd <- paste0(
    "import sqlite3; ",
    "db=sqlite3.connect(r'",
    mb_path,
    "'); ",
    "db.execute(\"DELETE FROM metadata\"); ",
    "db.executemany(\"INSERT INTO metadata (name, value) VALUES (?, ?)\", ",
    "[",
    "('name','",
    name,
    "'),",
    "('format','png'),",
    "('bounds','",
    bounds,
    "'),",
    "('center','",
    center,
    "'),",
    "('minzoom','",
    minzoom,
    "'),",
    "('maxzoom','",
    maxzoom,
    "'),",
    "('type','overlay'),",
    "('version','1.0')",
    "]); ",
    "db.commit(); db.close(); ",
    "print('metadata ok: ",
    name,
    "')"
  )

  cmd <- paste0('"', python_exe, '" -c "', py_cmd, '"')
  ret <- system(cmd, intern = FALSE)
  if (ret != 0) warning("metadata insert failed: ", mb_path)
}

run_cmd <- function(cmd, tmpdir) {
  bat_file <- file.path(tmpdir, "run_cmd.bat")
  writeLines(
    c(
      "@echo off",
      "call C:/tools/miniforge3/Scripts/activate.bat tcsi-tiles",
      cmd
    ),
    bat_file
  )
  ret <- shell(bat_file, mustWork = FALSE)
  ret
}




# process_rasters("ecosystem")
process_rasters <- function(pillars = "ecosystem") {
  # ── Use C:/tcsi_tmp to avoid spaces-in-path issues ─────────
  indir <- "H:/My Drive/TCSI/rasters"
  tmpdir <- "C:/tcsi_tmp/tmp"
  mbdir <- "C:/tcsi_tmp/mbtiles"
  outdir <- "C:/tcsi_tmp/pmtiles"
  final_outdir <- "H:/My Drive/TCSI/pmtiles" # final destination

  gdal2tiles_exe <- "C:/tools/miniforge3/envs/tcsi-tiles/Scripts/gdal2tiles.exe"
  gdalwarp_exe <- "C:/tools/miniforge3/envs/tcsi-tiles/Library/bin/gdalwarp.exe"
  python_exe <- "C:/tools/miniforge3/envs/tcsi-tiles/python.exe"
  mbutil_script <- "C:/tools/miniforge3/envs/tcsi-tiles/Scripts/mb-util"
  pmtiles_exe <- "C:/tools/pmtiles/pmtiles.exe"

  tcsi_bounds <- "-121.326742,38.607299,-119.875002,39.780395"
  tcsi_center <- "-120.6,39.19,9"

  # Write Python metadata helper to a no-spaces path
  py_helper <- "C:/tcsi_tmp/fix_metadata.py"
  if (!dir.exists("C:/tcsi_tmp")) {
    dir.create("C:/tcsi_tmp", recursive = TRUE)
  }
  writeLines(
    c(
      "import sqlite3, sys",
      "mb_path, name, bounds, center, minzoom, maxzoom = sys.argv[1:]",
      "db = sqlite3.connect(mb_path)",
      "db.execute('DELETE FROM metadata')",
      "db.executemany('INSERT INTO metadata (name, value) VALUES (?, ?)', [",
      "    ('name', name), ('format', 'png'), ('bounds', bounds),",
      "    ('center', center), ('minzoom', minzoom), ('maxzoom', maxzoom),",
      "    ('type', 'overlay'), ('version', '1.0')",
      "])",
      "db.commit()",
      "db.close()",
      "print('metadata ok:', name)"
    ),
    py_helper
  )

  for (d in c(tmpdir, mbdir, outdir, final_outdir)) {
    if (!dir.exists(d)) dir.create(d, recursive = TRUE)
  }

  keep <- c(
    "current",
    "future",
    "ap",
    "monitor",
    "protect",
    "adapt",
    "transform"
  )

  promote_dirs <- list.dirs(
    file.path(indir, "PROMOTE_v3"),
    recursive = FALSE,
    full.names = TRUE
  )

  for (thisdir in promote_dirs) {
    bnm <- basename(thisdir)
    if (!bnm %in% pillars) {
      next
    }

    message("\n=== Pillar: ", bnm, " ===")

    tif_subdir <- file.path(thisdir, "tif")
    search_dir <- if (dir.exists(tif_subdir)) tif_subdir else thisdir
    theserasts <- list.files(search_dir, pattern = "\\.tif$", full.names = TRUE)

    theserasts <- theserasts[
      tools::file_path_sans_ext(basename(theserasts)) %in% keep
    ]

    # ── Step 1: rescale to uint8 — reads from Drive, writes locally
    uint8_dir <- file.path(tmpdir, "uint8", bnm)
    if (!dir.exists(uint8_dir)) {
      dir.create(uint8_dir, recursive = TRUE)
    }

    uint8_paths <- lapply(theserasts, function(tif) {
      r <- rast(tif)
      of <- file.path(uint8_dir, paste0(names(r)[1], ".tif"))
      if (!file.exists(of)) {
        rescale_to_uint8(r, of)
      }
      of
    })

    # ── Step 2: gdalwarp ─────────────────────────────────────
    warp_dir <- file.path(tmpdir, "warped", bnm)
    if (!dir.exists(warp_dir)) {
      dir.create(warp_dir, recursive = TRUE)
    }

    warped_paths <- lapply(uint8_paths, function(uint8_tif) {
      nm <- tools::file_path_sans_ext(basename(uint8_tif))
      warp_out <- file.path(warp_dir, paste0(nm, "_3857.tif"))
      if (!file.exists(warp_out)) {
        message("  Warping:   ", basename(uint8_tif))
        cmd <- paste0(
          '"',
          gdalwarp_exe,
          '"',
          ' -t_srs EPSG:3857 -r near -ot Byte -dstnodata 255 -co COMPRESS=LZW',
          ' "',
          uint8_tif,
          '"',
          ' "',
          warp_out,
          '"'
        )
        ret <- run_cmd(cmd, tmpdir)
        if (ret != 0) warning("gdalwarp failed: ", uint8_tif)
      }
      warp_out
    })

    # ── Step 3: gdal2tiles ───────────────────────────────────
    tiles_base <- file.path(tmpdir, "tiles", bnm)
    if (!dir.exists(tiles_base)) {
      dir.create(tiles_base, recursive = TRUE)
    }

    tile_dirs <- lapply(warped_paths, function(warp_tif) {
      nm <- tools::file_path_sans_ext(basename(warp_tif))
      tiles_out <- file.path(tiles_base, nm)
      if (!dir.exists(tiles_out)) {
        message("  Tiling:    ", basename(warp_tif))
        cmd <- paste0(
          '"',
          gdal2tiles_exe,
          '"',
          ' --zoom=9-14 --processes=4 --xyz --tiledriver=PNG --webviewer=none',
          ' "',
          warp_tif,
          '"',
          ' "',
          tiles_out,
          '"'
        )
        ret <- run_cmd(cmd, tmpdir)
        if (ret != 0) warning("gdal2tiles failed: ", warp_tif)
      }
      tiles_out
    })

    # ── Step 4: mb-util ──────────────────────────────────────
    mb_pillar_dir <- file.path(mbdir, bnm)
    if (!dir.exists(mb_pillar_dir)) {
      dir.create(mb_pillar_dir, recursive = TRUE)
    }

    mbtiles_paths <- lapply(tile_dirs, function(tile_dir) {
      nm <- basename(tile_dir)
      mb_out <- file.path(mb_pillar_dir, paste0(nm, ".mbtiles"))
      if (!file.exists(mb_out)) {
        message("  MBTiles:   ", nm)
        cmd <- paste0(
          '"',
          python_exe,
          '" "',
          mbutil_script,
          '"',
          ' --image_format=png',
          ' "',
          tile_dir,
          '"',
          ' "',
          mb_out,
          '"'
        )
        ret <- run_cmd(cmd, tmpdir)
        if (ret != 0) warning("mb-util failed: ", tile_dir)
      }
      mb_out
    })

    # ── Step 4b: fix metadata ────────────────────────────────
    lapply(mbtiles_paths, function(mb_path) {
      nm <- tools::file_path_sans_ext(basename(mb_path))
      cmd <- paste0(
        '"',
        python_exe,
        '" "',
        py_helper,
        '"',
        ' "',
        mb_path,
        '"',
        ' "',
        nm,
        '"',
        ' "',
        tcsi_bounds,
        '"',
        ' "',
        tcsi_center,
        '"',
        ' 9 14'
      )
      ret <- run_cmd(cmd, tmpdir)
      if (ret != 0) warning("metadata failed: ", mb_path)
    })

    # ── Step 5: pmtiles convert ──────────────────────────────
    pm_pillar_dir <- file.path(outdir, bnm)
    if (!dir.exists(pm_pillar_dir)) {
      dir.create(pm_pillar_dir, recursive = TRUE)
    }

    pm_paths <- lapply(mbtiles_paths, function(mb_path) {
      nm <- tools::file_path_sans_ext(basename(mb_path))
      pm_out <- file.path(pm_pillar_dir, paste0(nm, ".pmtiles"))
      if (!file.exists(pm_out)) {
        message("  PMTiles:   ", nm)
        cmd <- paste0(
          '"',
          pmtiles_exe,
          '" convert',
          ' "',
          mb_path,
          '"',
          ' "',
          pm_out,
          '"'
        )
        ret <- run_cmd(cmd, tmpdir)
        if (ret != 0) warning("pmtiles failed: ", mb_path)
      }
      pm_out
    })

    # ── Step 6: copy PMTiles to Google Drive ─────────────────
    final_pillar_dir <- file.path(final_outdir, bnm)
    if (!dir.exists(final_pillar_dir)) {
      dir.create(final_pillar_dir, recursive = TRUE)
    }

    lapply(pm_paths, function(pm_path) {
      dest <- file.path(final_pillar_dir, basename(pm_path))
      if (!file.exists(dest) && file.exists(pm_path)) {
        message("  Copying:   ", basename(pm_path), " → Drive")
        file.copy(pm_path, dest)
      }
    })
  } # end pillar loop

  message("\nDone. PMTiles written to: ", final_outdir)
}


rename_output_pmtiles <- function(){
  # Run after processing is complete
  pm_files <- list.files(
    "H:/My Drive/TCSI/pmtiles",
    pattern = "\\.pmtiles$",
    recursive = TRUE,
    full.names = TRUE
  )

  # Rename adapt_3857.pmtiles -> adapt.pmtiles etc.
  file.rename(pm_files, gsub("_3857\\.pmtiles$", ".pmtiles", pm_files))
}


#
# pm_tiles structure for GitHUb Releases needs to have a flat file structure and so
#  we have to rename the tiles...
#
# prepare_for_release()
prepare_for_release <- function() {
  pmtiles_dir <- "H:/My Drive/TCSI/pmtiles"
  release_dir <- "C:/tcsi_tmp/release"

  if (!dir.exists(release_dir)) {
    dir.create(release_dir, recursive = TRUE)
  }

  # Find all pmtiles files
  pm_files <- list.files(
    pmtiles_dir,
    pattern = "\\.pmtiles$",
    recursive = TRUE,
    full.names = TRUE
  )

  lapply(pm_files, function(f) {
    # Get pillar name from parent folder
    pillar <- basename(dirname(f))

    # Clean up the filename: remove _3857 suffix
    nm <- gsub("_3857\\.pmtiles$", ".pmtiles", basename(f))

    # New name: pillar_layername.pmtiles
    new_nm <- paste0(pillar, "_", nm)
    dest <- file.path(release_dir, new_nm)

    message("  ", basename(f), " → ", new_nm)
    file.copy(f, dest, overwrite = TRUE)
  })

  message("\nDone. Files ready for GitHub Release upload in: ", release_dir)
  message("Total files: ", length(pm_files))
}

