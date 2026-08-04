# North Kona – South Kohala DST

Decision support tool for the NKSK landscape on the leeward side of Hawai'i island.

## Directory structure

```
geographies/nksk/
  index.html        ← Map app wrapper (no edits needed)
  config.js         ← All NKSK-specific settings (edit this)
  README.md         ← This file
  data/
    commval.geojson
    consval.geojson
    firevuln.geojson
```

## Setup checklist

### 1. Fill in credentials in `config.js`

At the top of `config.js`, replace:
```js
const MAPTILER_KEY = 'YOUR_MAPTILER_KEY_HERE';
const R2_BASE = 'https://YOUR_CLOUDFLARE_R2_URL_HERE';
```

Use the same MapTiler key as Hamakua. For R2, your base URL is the
public bucket URL — something like `https://pub-abc.r2.dev` or your
custom domain if you set one up.

### 2. Copy GeoJSON files into `data/`

Drop these into `geographies/nksk/data/`:
- `commval.geojson`
- `consval.geojson`
- `firevuln.geojson`

### 3. Update field names in `config.js`

Each layer entry has a `colorField` and `hoverFields` that must match
actual property names in your GeoJSON. Check your field names with:

```bash
# Quick way to see GeoJSON property names
python3 -c "import json; d=json.load(open('data/commval.geojson')); print(list(d['features'][0]['properties'].keys()))"
```

Then update in `config.js`:
```js
colorField: 'YOUR_ACTUAL_FIELD_NAME',
hoverFields: [
  { field: 'YOUR_ACTUAL_FIELD_NAME', label: 'Display label' },
]
```

### 4. Update DST field names

In the `dst.restoration.criteria` and `dst.protection.criteria` arrays,
update the `field` property to match your GeoJSON property names:

```js
{ field: 'firevuln',  ... }   // must match your actual field name
{ field: 'consval',   ... }   // must match your actual field name
{ field: 'commval',   ... }   // must match your actual field name
```

### 5. Deploy

Copy the entire `nksk/` folder into:
```
H:\My Drive\WebApplications\landscape-dst-dev\geographies\nksk\
```

The `../../shared/app.js` path in `index.html` points to the shared
app logic — this works as long as the directory structure is:
```
landscape-dst-dev/
  shared/
    app.js
    style.css
  geographies/
    hamakua/
    nksk/       ← your new folder
    palau/
    tcsi/
```

## MCDM framework

The DST uses Abbreviated Pairwise Comparisons (Saaty AHP) with 4 criteria
and 3 sliders per objective:

**Restoration** (active management priority):
1. Fire vulnerability vs Conservation value
2. Conservation value vs Community value
3. Community value vs Wildfire exposure

**Protection** (protection from fire):
1. Conservation value vs Fire vulnerability
2. Fire vulnerability vs Community value
3. Community value vs Wildfire exposure

Adjust criteria and slider labels in the `dst` block of `config.js` to
match the actual management questions for NKSK.
