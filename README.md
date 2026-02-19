# 🌾 Upland Rice Detection System — Philippines

Automated detection of **upland rice areas** in the Philippines using Google Earth Engine (GEE), combining **Sentinel-2** spectral indices, **Sentinel-1** SAR backscatter, **SRTM** terrain data, and a **phenology-based scoring engine** tailored to slash-and-burn (kaingin) cultivation practices.

---

## 📋 Overview

Upland rice cultivation in the Philippines follows a unique cycle:

| Phase | Months | Characteristics |
|-------|--------|-----------------|
| **Pre-planting** | Mar–Apr | Bare/burned soil, low NDVI, high BSI |
| **Planting** | May–Jun | Rapid green-up, NDVI increases sharply |
| **Growing** | Jun–Sep | Peak vegetation, high NDVI/SAVI, SAR backscatter rises |
| **Harvest** | Sep–Oct | NDVI begins to decline |
| **Burning/Fallow** | Nov–Feb | Slash-and-burn, high dNBR, NDVI drops to minimum |

This system exploits these phenological signatures to automatically detect upland rice pixels — even in large, mixed-use areas where traditional K-Means clustering alone becomes unreliable.

---

## 🚀 How It Works

### Phenology-Based Scoring (7 Rules)

Each pixel is scored 0–7 based on how well it matches the upland rice signature:

| # | Rule | Threshold |
|---|------|-----------|
| 1 | NDVI amplitude during growing season (May–Oct) | > 0.2 |
| 2 | Rapid green-up rate (peak NDVI − pre-planting NDVI) | > 0.15 |
| 3 | Sharp NDVI drop after harvest | > 0.2 |
| 4 | Low pre-planting NDVI (bare/burned soil) | < 0.4 |
| 5 | No standing water year-round (NDWI max) | < 0.1 |
| 6 | Upland slope range | 3°–45° |
| 7 | Burn scar detected (dNBR) | > 0.1 |

### Smart Clustering Pipeline

1. **Pre-filter**: Mask out pixels with very low phenology scores (non-agricultural land).
2. **K-Means clustering**: Cluster only candidate pixels using temporal indices + terrain + SAR features.
3. **Auto-select**: Automatically identify clusters whose mean phenology score ≥ your threshold.
4. **No manual cluster picking needed!**

---

## 🛠️ Setup & Usage

### Prerequisites

- A [Google Earth Engine](https://earthengine.google.com/) account.
- Your barangay boundary FeatureCollection uploaded as a GEE asset.

### Step-by-Step

1. **Open** the [GEE Code Editor](https://code.earthengine.google.com/).

2. **Copy** the entire contents of `Upland_Rice_Detection_GEE.js` and paste into a new script.

3. **Update the asset path** (line ~25):
   ```javascript
   var ASSET_PATH = 'projects/havoc-king/assets/UP_Apayao/Apayao_Brgy_Kabugao';
   ```
   Change this to your own uploaded FeatureCollection path.

4. **Click Run** in the Code Editor. A sidebar panel will appear on the left.

5. **Configure parameters** in the sidebar:
   - **Barangay PSGC Code**: Enter the PSGC code of the target barangay.
   - **Detection Year**: Select the year to analyze (2019–2026).
   - **Number of Clusters**: K-Means cluster count (default: 15).
   - **Score Threshold**: Minimum phenology score to flag as upland rice (default: 4).
   - **Max Cloud Cover %**: Filter for Sentinel-2 scenes.
   - **Advanced Options**: Toggle slope filter, burn detection, SAR features.

6. **Click "▶ Run Detection"** to process.

7. **Review results**:
   - Map layers: detected upland rice (orange-red), phenology score heatmap, clusters.
   - Charts: NDVI time series, multi-index comparison, SAR backscatter, slope histogram.
   - Sidebar: area statistics, cluster scores with auto-selection indicators.

8. **Click on the map** to inspect individual pixel scores and cluster IDs.

9. **Click "💾 Export Results to Drive"** to export:
   - Detected upland rice mask (GeoTIFF)
   - Phenology score image (GeoTIFF)
   - Cluster image (GeoTIFF)
   - Detected areas as vector polygons (Shapefile)

### Batch Processing

To process **all barangays** in the municipality at once:
1. Check the **"Process All Barangays in Asset"** checkbox.
2. Click **"▶ Run Detection"**.
3. Results include a per-barangay area table exported as CSV.

---

## 📊 Data Sources

| Source | Bands/Products Used | Purpose |
|--------|-------------------|---------|
| **Sentinel-2 SR Harmonized** | B2–B12, SCL | Spectral indices (NDVI, SAVI, NDWI, NBR, BSI, NDRE, CIgreen, NDII, MSAVI) |
| **Sentinel-1 GRD** | VV, VH | SAR backscatter for crop structure detection |
| **SRTM 30m** | Elevation | Slope and aspect for upland terrain filtering |

---

## 📁 Files

| File | Description |
|------|-------------|
| `Upland_Rice_Detection_GEE.js` | Main GEE Code Editor script — paste into code.earthengine.google.com |
| `Flood_mapping_from_GEE_Sentine1_in QGIS_directly.py` | Original flood mapping script (unrelated, kept for reference) |

---

## 🔧 Customization

### Adjusting Phenology Rules

The scoring thresholds in **Section 6** of the script can be tuned for your specific region:

```javascript
// Rule 1: NDVI amplitude — lower for areas with less vigorous growth
var rule1 = temporalStats.select('NDVI_amplitude').gt(0.2);  // Try 0.15 for subtle areas

// Rule 4: Pre-planting NDVI — raise if area has more residual vegetation
var rule4 = temporalStats.select('NDVI_pre_plant').lt(0.4);  // Try 0.35 or 0.45

// Rule 7: Burn scar sensitivity
var rule7 = temporalStats.select('dNBR').gt(0.1);  // Try 0.08 for subtle burns
```

### Adjusting Slope Range

```javascript
var SLOPE_MIN = 3;    // Lower for gently sloping areas
var SLOPE_MAX = 45;   // Upper limit for cultivable terrain
```

### Adding More Barangays

Upload additional FeatureCollections to GEE Assets and update `ASSET_PATH`. The script reads the `adm4_psgc` and `adm4_en` columns for filtering and labeling.

---

## 📈 Improvements Over Manual Workflow

| Aspect | Before (Manual) | After (This System) |
|--------|-----------------|---------------------|
| Cluster selection | Visual inspection, trial-and-error | Automated phenology scoring |
| Processing unit | One barangay at a time (edit code) | UI dropdown + batch mode |
| Large/complex areas | Erratic clustering | Pre-filtered candidates + terrain masking |
| Burn detection | Not included | dNBR-based burn scar scoring |
| Terrain awareness | None | SRTM slope/aspect filtering |
| SAR integration | VH only | VV + VH + VH/VV ratio |
| Cloud masking | Scene-level % filter | Pixel-level SCL mask + scene filter |
| Export | Manual per cluster | One-click: raster + vector + CSV |
| Reproducibility | Requires remembering cluster IDs | Score-based, parameter-driven |

---

## 📜 License

See [LICENSE](LICENSE) for details.
