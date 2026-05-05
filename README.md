# Landscape Decision Support Tools

A clean, config-driven web platform for spatial multi-criteria decision support.
Built on Leaflet 1.9, D3 v7, and vanilla JavaScript — no build step required.

---

## File structure

```
/
  index.html                ← Splash page (geography selector)
  shared/
    app.js                  ← Generic map + DST logic — NEVER EDIT THIS
    style.css               ← Shared styles — NEVER EDIT THIS
  geographies/
    hamakua/
      index.html            ← Boilerplate loader (same for every geography)
      config.js             ← ← ← THE ONLY FILE YOU EDIT PER GEOGRAPHY
      data/
        soe.geojson         ← Your GeoJSON data files go here
        tmk.geojson
        ...
    your-new-geography/     ← Copy hamakua/ folder to add a new geography
      index.html
      config.js
      data/
```

---

## Adapting to a new geography

### Step 1 — Copy the template folder
```bash
cp -r geographies/hamakua geographies/my-new-place
```

### Step 2 — Edit `config.js`
Open `geographies/my-new-place/config.js` and change:
- `title`, `subtitle`, `center`, `zoom`
- The `layers` array (see the comments in config.js for all options)
- The `dst.restoration.criteria` and `dst.protection.criteria` arrays
- The `dst.computeCriteriaArrays()` function body to extract your data properties

Everything else in the file can stay the same until you need it.

### Step 3 — Prepare your GeoJSON files
Your GeoJSON files must be valid JSON (not JavaScript).

If your existing files look like this at the top:
```javascript
var soe = {"type":"FeatureCollection", ...
```
…you need to strip the `var soe =` prefix. Use this Python one-liner:
```bash
python3 -c "
import sys
text = open(sys.argv[1]).read().strip()
# Remove JS variable wrapper
for prefix in ['var soe =', 'var trails =', 'var tmk =', 'var roads =']:
    if text.startswith(prefix):
        text = text[len(prefix):].lstrip()
        break
if text.endswith(';'):
    text = text[:-1]
open(sys.argv[2], 'w').write(text)
" input.geojson output.geojson
```
Then place the output file in the `data/` subfolder.

### Step 4 — Add the card to the splash page
Open the root `index.html` and add a new `<article class="project-card">` block
inside the `<div class="card-grid">`. Copy one of the existing cards as a template
and update the link to `geographies/my-new-place/index.html`.

---

## Adding raster layers (COG / GeoTIFF)

1. Uncomment the two `<script>` lines for `georaster` in your geography's `index.html`
2. Add a layer entry in `config.js` with `type: 'cog'` (see the commented example)
3. Put your `.tif` file in the `data/` folder

Cloud-Optimized GeoTIFFs work best — they load progressively and are faster over
the web. You can create one from any GeoTIFF with GDAL:
```bash
gdal_translate input.tif output_cog.tif -of COG -co COMPRESS=DEFLATE
```

---

## Deploying to GitHub Pages (free hosting)

### First time setup

1. **Create a GitHub account** at github.com if you don't have one.

2. **Create a new repository**
   - Go to github.com → click the `+` button → New repository
   - Name it something like `landscape-dst`
   - Set it to **Public** (required for free GitHub Pages)
   - Click "Create repository"

3. **Upload your files**
   Option A — Via the GitHub website (easiest):
   - Drag and drop your entire project folder onto the repository page
   - GitHub will ask you to commit — click "Commit changes"

   Option B — Via Git (if you have Git installed):
   ```bash
   cd /path/to/your/project
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/landscape-dst.git
   git push -u origin main
   ```

4. **Enable GitHub Pages**
   - Go to your repository on GitHub
   - Click **Settings** → **Pages** (in the left sidebar)
   - Under "Source", select **Deploy from a branch**
   - Choose branch: `main`, folder: `/ (root)`
   - Click **Save**

5. **Your site is live!**
   After ~1 minute, your site will be at:
   `https://YOUR_USERNAME.github.io/landscape-dst/`

### Updating the site

After your first deployment, any time you push new files to GitHub, the site
updates automatically within about 30 seconds.

Via the GitHub website:
- Navigate to the file you want to update, click the pencil icon to edit,
  commit when done.

Via Git:
```bash
git add .
git commit -m "Update Hamakua config"
git push
```

---

## Dependencies (all loaded from CDN — no install needed)

| Library | Version | Purpose |
|---------|---------|---------|
| Leaflet | 1.9.4 | Interactive map |
| numeric.js | 1.2.6 | Eigenvalue computation for AHP |
| D3 | 7.x | Weight visualization chart |
| georaster | latest | COG raster parsing (optional) |
| georaster-layer-for-leaflet | latest | COG layer display (optional) |

---

## Common issues

**Map doesn't load / shows blank**
- Open browser developer tools (F12) → Console tab
- Look for red error messages — usually a file path is wrong
- Make sure your GeoJSON files are in the `data/` folder and the paths in
  `config.js` match exactly (case-sensitive on GitHub)

**GeoJSON not loading**
- The file must be valid JSON (not JavaScript). Run it through
  jsonlint.com to check.
- If loading locally (file:// URL), use a local server instead:
  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```

**DST sliders don't affect the map**
- Click "Calculate" after adjusting sliders — the map updates on demand
- Make sure the Decision Score layer is turned on in the layer control

**COG raster not showing**
- Uncomment the georaster `<script>` tags in index.html
- Check the file path and make sure the COG is accessible from your server
- For local testing, CORS restrictions may block local file access; use
  a hosted URL or a local server

---

## Credits

Built by Nicholas Povak — [northcoastxy.com](http://northcoastxy.com)

Analytical Hierarchy Process: Saaty (1980)
EcoLogic methodology: Raphael & Marcot (1994); Raphael et al. (2001)
