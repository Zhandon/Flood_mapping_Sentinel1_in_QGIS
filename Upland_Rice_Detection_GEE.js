// ============================================================================
// UPLAND RICE DETECTION SYSTEM — Philippines
// Google Earth Engine Code Editor Script
// ============================================================================
// Combines Sentinel-2 spectral indices, Sentinel-1 SAR backscatter, SRTM
// terrain data, and phenology-based scoring to automatically detect upland
// rice areas that follow slash-and-burn (kaingin) cultivation practices.
//
// HOW TO USE:
//   1. Paste this entire script into the GEE Code Editor.
//   2. Update the ASSET PATH in Section 0 to point to your barangay
//      feature collection.
//   3. Use the sidebar panel on the right to select parameters.
//   4. Click "Run Detection" to process.
//   5. Review the map layers, charts, and area statistics.
//   6. Click "Export Results" to save to Google Drive.
//
// Author: Refined for upland rice detection in Apayao, Philippines
// ============================================================================

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 0: GLOBAL CONFIGURATION                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── Asset path ──────────────────────────────────────────────────────────────
// CHANGE THIS to your uploaded barangay boundary FeatureCollection asset path.
var ASSET_PATH = 'projects/havoc-king/assets/UP_Apayao/Apayao_Brgy_Kabugao';

// ── Default parameters (overridden by UI) ───────────────────────────────────
var DEFAULT_PSGC       = '1408104015';   // Default barangay PSGC code
var DEFAULT_YEAR       = 2024;           // Detection year
var DEFAULT_N_CLUSTERS = 15;             // K-Means cluster count
var DEFAULT_SCORE_THRESHOLD = 4;         // Min phenology score (0-7) to flag as upland rice
var DEFAULT_CLOUD_PCT  = 30;             // Max cloud cover % for S2 scenes

// ── Phenology calendar for upland rice in the Philippines ───────────────────
// Planting:   May – June
// Growing:    June – September
// Harvesting: September – October
// Burning:    November – February (post-harvest slash-and-burn)
// Fallow:     Variable (area may shift next year)
var PLANT_START  = 5;   // May
var PLANT_END    = 6;   // June
var GROW_START   = 5;   // May
var GROW_END     = 10;  // October
var BURN_START   = 11;  // November
var BURN_END_MONTH = 2; // February (next year)

// ── Slope thresholds for upland areas (degrees) ────────────────────────────
var SLOPE_MIN = 3;    // Minimum slope — upland rice is on slopes
var SLOPE_MAX = 45;   // Maximum slope — too steep is not cultivable

// ── Color palettes ──────────────────────────────────────────────────────────
var CLUSTER_PALETTE = [
  '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231',
  '#911eb4','#42d4f4','#f032e6','#bfef45','#fabed4',
  '#469990','#dcbeff','#9A6324','#fffac8','#800000',
  '#aaffc3','#808000','#ffd8b1','#000075','#a9a9a9',
  '#000000','#e6beff','#aa6e28','#808080','#00FF00'
];

var SCORE_PALETTE = ['#440154','#482878','#3e4989','#31688e','#26828e',
                     '#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'];

var UPLAND_RICE_COLOR = '#FF4500';  // Orange-red for detected upland rice


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 1: UI CONFIGURATION PANEL                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Load the barangay table once for UI population
var barangayTable = ee.FeatureCollection(ASSET_PATH);

// ── Build sidebar panel ─────────────────────────────────────────────────────
var panel = ui.Panel({
  style: {width: '360px', padding: '10px'}
});
ui.root.insert(0, panel);

// Title
panel.add(ui.Label({
  value: '🌾 Upland Rice Detection System',
  style: {fontWeight: 'bold', fontSize: '18px', margin: '0 0 10px 0', color: '#2E7D32'}
}));

panel.add(ui.Label({
  value: 'Automated detection of upland rice areas using Sentinel-1, ' +
         'Sentinel-2, terrain analysis, and phenology-based scoring.',
  style: {fontSize: '12px', color: '#555', margin: '0 0 15px 0'}
}));

// ── Separator helper ────────────────────────────────────────────────────────
var addSeparator = function(parentPanel) {
  parentPanel.add(ui.Label({value: '─────────────────────────────────',
    style: {color: '#ccc', margin: '5px 0'}}));
};

// ── Section: Region Selection ───────────────────────────────────────────────
panel.add(ui.Label({value: '📍 Region Selection',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '5px 0'}}));

panel.add(ui.Label({value: 'Barangay PSGC Code:',
  style: {fontSize: '12px'}}));
var psgcInput = ui.Textbox({
  value: DEFAULT_PSGC,
  style: {width: '100%'}
});
panel.add(psgcInput);

panel.add(ui.Label({
  value: 'Tip: Leave blank and check "Process All Barangays" to batch-process the entire municipality.',
  style: {fontSize: '10px', color: '#888', margin: '2px 0 5px 0'}
}));

var batchCheckbox = ui.Checkbox('Process All Barangays in Asset', false);
panel.add(batchCheckbox);

addSeparator(panel);

// ── Section: Detection Parameters ───────────────────────────────────────────
panel.add(ui.Label({value: '⚙️ Detection Parameters',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '5px 0'}}));

panel.add(ui.Label({value: 'Detection Year:', style: {fontSize: '12px'}}));
var yearSlider = ui.Slider({
  min: 2019, max: 2026, value: DEFAULT_YEAR, step: 1,
  style: {width: '100%'}
});
panel.add(yearSlider);

panel.add(ui.Label({value: 'Number of Clusters (K-Means):', style: {fontSize: '12px'}}));
var clusterSlider = ui.Slider({
  min: 5, max: 30, value: DEFAULT_N_CLUSTERS, step: 1,
  style: {width: '100%'}
});
panel.add(clusterSlider);

panel.add(ui.Label({value: 'Upland Rice Score Threshold (0-7):', style: {fontSize: '12px'}}));
var scoreSlider = ui.Slider({
  min: 1, max: 7, value: DEFAULT_SCORE_THRESHOLD, step: 1,
  style: {width: '100%'}
});
panel.add(scoreSlider);

panel.add(ui.Label({value: 'Max Cloud Cover %:', style: {fontSize: '12px'}}));
var cloudSlider = ui.Slider({
  min: 10, max: 80, value: DEFAULT_CLOUD_PCT, step: 5,
  style: {width: '100%'}
});
panel.add(cloudSlider);

addSeparator(panel);

// ── Section: Advanced Options ───────────────────────────────────────────────
panel.add(ui.Label({value: '🔬 Advanced Options',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '5px 0'}}));

var useSlopeFilter = ui.Checkbox('Apply Slope Filter (upland terrain)', true);
panel.add(useSlopeFilter);

var useBurnDetection = ui.Checkbox('Include Burn Scar Detection (dNBR)', true);
panel.add(useBurnDetection);

var useSAR = ui.Checkbox('Include Sentinel-1 SAR Features', true);
panel.add(useSAR);

var showAllClusters = ui.Checkbox('Show All K-Means Clusters on Map', false);
panel.add(showAllClusters);

addSeparator(panel);

// ── Action Buttons ──────────────────────────────────────────────────────────
var runButton = ui.Button({
  label: '▶ Run Detection',
  style: {width: '100%', color: 'white', backgroundColor: '#2E7D32',
          fontWeight: 'bold', fontSize: '14px', margin: '5px 0'}
});
panel.add(runButton);

var exportButton = ui.Button({
  label: '💾 Export Results to Drive',
  style: {width: '100%', color: 'white', backgroundColor: '#1565C0',
          fontWeight: 'bold', fontSize: '14px', margin: '5px 0'},
  disabled: true
});
panel.add(exportButton);

addSeparator(panel);

// ── Status / Results area ───────────────────────────────────────────────────
var statusLabel = ui.Label({
  value: 'Status: Ready. Configure parameters and click Run.',
  style: {fontSize: '11px', color: '#666', margin: '5px 0'}
});
panel.add(statusLabel);

var resultsPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('vertical'),
  style: {margin: '5px 0'}
});
panel.add(resultsPanel);


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 2: CLOUD MASKING & SPECTRAL INDEX FUNCTIONS                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── Pixel-level cloud/shadow mask using SCL band ────────────────────────────
var maskS2Clouds = function(image) {
  var scl = image.select('SCL');
  // SCL classes to mask: 1=saturated, 3=cloud_shadow, 8=cloud_medium,
  // 9=cloud_high, 10=cirrus, 11=snow
  var mask = scl.neq(1).and(scl.neq(3)).and(scl.neq(8))
              .and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return image.updateMask(mask);
};

// ── Compute all spectral indices ────────────────────────────────────────────
var addAllIndices = function(image) {
  var nir  = image.select('B8');
  var red  = image.select('B4');
  var green = image.select('B3');
  var blue = image.select('B2');
  var swir1 = image.select('B11');
  var swir2 = image.select('B12');
  var re1  = image.select('B5');  // Red Edge 1

  // NDVI — Normalized Difference Vegetation Index
  var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');

  // SAVI — Soil Adjusted Vegetation Index (L=0.5)
  var savi = nir.subtract(red).multiply(1.5).divide(nir.add(red).add(0.5)).rename('SAVI');

  // NDWI — Normalized Difference Water Index (McFeeters)
  var ndwi = green.subtract(nir).divide(green.add(nir)).rename('NDWI');

  // CIgreen — Chlorophyll Index Green
  var cigreen = nir.divide(green).subtract(1).rename('CIgreen');

  // NDII — Normalized Difference Infrared Index (moisture)
  var ndii = nir.subtract(swir1).divide(nir.add(swir1)).rename('NDII');

  // MSAVI — Modified Soil Adjusted Vegetation Index
  var msavi = nir.multiply(2).add(1)
    .subtract(nir.multiply(2).add(1).pow(2).subtract(nir.subtract(red).multiply(8)).sqrt())
    .divide(2).rename('MSAVI');

  // NBR — Normalized Burn Ratio (for slash-and-burn detection)
  var nbr = nir.subtract(swir2).divide(nir.add(swir2)).rename('NBR');

  // BSI — Bare Soil Index
  var bsi = swir1.add(red).subtract(nir).subtract(blue)
    .divide(swir1.add(red).add(nir).add(blue)).rename('BSI');

  // NDRE — Normalized Difference Red Edge (crop vigor)
  var ndre = nir.subtract(re1).divide(nir.add(re1)).rename('NDRE');

  return image.addBands([ndvi, savi, ndwi, cigreen, ndii, msavi, nbr, bsi, ndre]);
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 3: DATA INGESTION — MONTHLY COMPOSITES                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Build monthly composites for a given year and ROI
var buildMonthlyComposites = function(roi, year, maxCloud) {
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate   = ee.Date.fromYMD(ee.Number(year).add(1), 1, 1);

  // Also include previous year's Nov-Dec for burn detection
  var prevNov = ee.Date.fromYMD(ee.Number(year).subtract(1), 11, 1);

  // ── Sentinel-2 ────────────────────────────────────────────────────────
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', maxCloud))
    .filterDate(prevNov, endDate)
    .map(maskS2Clouds)
    .map(addAllIndices);

  // ── Sentinel-1 (VV + VH) ─────────────────────────────────────────────
  var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(roi)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filterDate(prevNov, endDate);

  // ── Monthly date list (prev Nov, prev Dec, Jan–Dec of target year) ────
  var months = ee.List.sequence(1, 12);
  var prevMonths = ee.List([11, 12]);

  var monthlyDates = prevMonths.map(function(m) {
    return ee.Date.fromYMD(ee.Number(year).subtract(1), m, 1);
  }).cat(months.map(function(m) {
    return ee.Date.fromYMD(year, m, 1);
  }));

  // ── Spectral indices to composite ─────────────────────────────────────
  var indexNames = ['NDVI', 'SAVI', 'NDWI', 'CIgreen', 'NDII', 'MSAVI', 'NBR', 'BSI', 'NDRE'];

  // ── Build monthly S2 index composites ─────────────────────────────────
  var monthlyS2 = ee.ImageCollection.fromImages(monthlyDates.map(function(date) {
    date = ee.Date(date);
    var end = date.advance(1, 'month');
    var filtered = s2.filterDate(date, end).select(indexNames);
    var composite = filtered.median();
    // Label each band with YYYY_MM
    var label = date.format('YYYY_MM');
    var renamedBands = ee.List(indexNames.map(function(idx) {
      return ee.String(idx).cat('_').cat(label);
    }));
    return composite.rename(renamedBands).set('system:time_start', date.millis());
  }));

  // ── Build monthly S1 composites (VV, VH, VH/VV ratio) ────────────────
  var monthlyS1 = ee.ImageCollection.fromImages(monthlyDates.map(function(date) {
    date = ee.Date(date);
    var end = date.advance(1, 'month');
    var filtered = s1.filterDate(date, end);
    var vv = filtered.select('VV').median();
    var vh = filtered.select('VH').median();
    var ratio = vh.subtract(vv).rename('VH_VV_ratio');  // dB difference ≈ ratio
    var label = date.format('YYYY_MM');
    return vv.rename(ee.String('VV_').cat(label))
      .addBands(vh.rename(ee.String('VH_').cat(label)))
      .addBands(ratio.rename(ee.String('VHVVr_').cat(label)))
      .set('system:time_start', date.millis());
  }));

  return {
    s2Monthly: monthlyS2,
    s1Monthly: monthlyS1,
    monthlyDates: monthlyDates,
    s2Collection: s2,
    s1Collection: s1
  };
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 4: TERRAIN FEATURES (SRTM)                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var getTerrainFeatures = function(roi) {
  var srtm = ee.Image('USGS/SRTMGL1_003');
  var terrain = ee.Terrain.products(srtm);
  var slope = terrain.select('slope').clip(roi).rename('slope_deg');
  var aspect = terrain.select('aspect').clip(roi).rename('aspect_deg');
  var elevation = srtm.clip(roi).rename('elevation_m');
  return slope.addBands(aspect).addBands(elevation);
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 5: FEATURE ENGINEERING — TEMPORAL STATISTICS                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Compute phenology-relevant temporal statistics from monthly composites
var computeTemporalStats = function(s2Monthly, year, roi) {

  // Helper: extract a single index for months in [startMonth, endMonth] of the target year.
  // Each monthly composite image has bands like "NDVI_2024_05", "BSI_2024_03", etc.
  // We filter the collection to the desired months, then select & rename the band.
  var filterMonths = function(collection, indexName, startMonth, endMonth) {
    // Filter the collection to images whose month falls in range and year matches
    var filtered = collection.filter(ee.Filter.calendarRange(startMonth, endMonth, 'month'))
                             .filter(ee.Filter.calendarRange(year, year, 'year'));
    // For each image, select the band matching this index and rename it
    return filtered.map(function(img) {
      // The image has bands like "NDVI_2024_05", "SAVI_2024_05", etc.
      // Select all bands whose name starts with the index prefix
      var matching = img.bandNames().filter(ee.Filter.stringStartsWith('item', indexName + '_'));
      // Select the first matching band and rename to the plain index name
      return img.select(matching).rename(indexName);
    });
  };

  // ── Growing season NDVI stats (May–October) ───────────────────────────
  var growNDVI = filterMonths(s2Monthly, 'NDVI', GROW_START, GROW_END);
  var ndviMax  = growNDVI.max().rename('NDVI_grow_max');
  var ndviMin  = growNDVI.min().rename('NDVI_grow_min');
  var ndviMean = growNDVI.mean().rename('NDVI_grow_mean');
  var ndviAmp  = ndviMax.subtract(ndviMin).rename('NDVI_amplitude');

  // ── Pre-planting NDVI (March–April) — should be low (bare/burned) ─────
  var preNDVI = filterMonths(s2Monthly, 'NDVI', 3, 4);
  var ndviPre = preNDVI.mean().rename('NDVI_pre_plant');

  // ── Post-harvest NDVI (Nov–Dec of target year) — should drop sharply ──
  var postNDVI = filterMonths(s2Monthly, 'NDVI', 11, 12);
  var ndviPost = postNDVI.mean().rename('NDVI_post_harvest');

  // ── NDVI green-up rate (difference: peak growing vs pre-planting) ─────
  var greenUpRate = ndviMax.subtract(ndviPre).rename('NDVI_greenup_rate');

  // ── NDVI drop rate (peak growing vs post-harvest) ─────────────────────
  var dropRate = ndviMax.subtract(ndviPost).rename('NDVI_drop_rate');

  // ── Growing season BSI (Bare Soil Index) — should be low during growth ─
  var growBSI = filterMonths(s2Monthly, 'BSI', GROW_START, GROW_END);
  var bsiGrowMean = growBSI.mean().rename('BSI_grow_mean');

  // ── Pre-planting BSI — should be high (bare/burned soil) ──────────────
  var preBSI = filterMonths(s2Monthly, 'BSI', 3, 4);
  var bsiPre = preBSI.mean().rename('BSI_pre_plant');

  // ── NBR for burn detection ────────────────────────────────────────────
  // Pre-burn NBR (Sep–Oct, before burning)
  var preBurnNBR = filterMonths(s2Monthly, 'NBR', 9, 10);
  var nbrPreBurn = preBurnNBR.mean().rename('NBR_pre_burn');

  // Post-burn NBR (Nov–Dec or Jan–Feb next year)
  var postBurnNBR = filterMonths(s2Monthly, 'NBR', 11, 12);
  var nbrPostBurn = postBurnNBR.mean().rename('NBR_post_burn');

  // dNBR — positive values indicate burn scars
  var dNBR = nbrPreBurn.subtract(nbrPostBurn).rename('dNBR');

  // ── NDWI stats — upland rice should never have standing water ─────────
  var allNDWI = filterMonths(s2Monthly, 'NDWI', 1, 12);
  var ndwiMax = allNDWI.max().rename('NDWI_annual_max');

  return ndviMax.addBands(ndviMin).addBands(ndviMean).addBands(ndviAmp)
    .addBands(ndviPre).addBands(ndviPost).addBands(greenUpRate).addBands(dropRate)
    .addBands(bsiGrowMean).addBands(bsiPre)
    .addBands(nbrPreBurn).addBands(nbrPostBurn).addBands(dNBR)
    .addBands(ndwiMax);
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 6: PHENOLOGY-BASED UPLAND RICE SCORING                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Score each pixel 0–7 based on how well it matches upland rice phenology.
// Higher score = more likely upland rice.
var computeUplanRiceScore = function(temporalStats, terrainFeatures, includeSlope, includeBurn) {
  var score = ee.Image.constant(0).rename('upland_rice_score');

  // ── Rule 1: NDVI amplitude during growing season > 0.2 ───────────────
  // Upland rice shows strong vegetation growth then decline
  var rule1 = temporalStats.select('NDVI_amplitude').gt(0.2);
  score = score.add(rule1);

  // ── Rule 2: NDVI green-up rate > 0.15 ────────────────────────────────
  // Rapid green-up from bare/burned soil to crop canopy
  var rule2 = temporalStats.select('NDVI_greenup_rate').gt(0.15);
  score = score.add(rule2);

  // ── Rule 3: NDVI drop after harvest > 0.2 ────────────────────────────
  // Sharp decline after October harvest
  var rule3 = temporalStats.select('NDVI_drop_rate').gt(0.2);
  score = score.add(rule3);

  // ── Rule 4: Pre-planting NDVI is low (< 0.4) ─────────────────────────
  // Bare or recently burned soil before planting
  var rule4 = temporalStats.select('NDVI_pre_plant').lt(0.4);
  score = score.add(rule4);

  // ── Rule 5: No persistent water (NDWI max < 0.1) ─────────────────────
  // Upland rice relies on rain, no standing water / paddies
  var rule5 = temporalStats.select('NDWI_annual_max').lt(0.1);
  score = score.add(rule5);

  // ── Rule 6: Slope is in upland range ──────────────────────────────────
  if (includeSlope) {
    var rule6 = terrainFeatures.select('slope_deg').gte(SLOPE_MIN)
                  .and(terrainFeatures.select('slope_deg').lte(SLOPE_MAX));
    score = score.add(rule6);
  }

  // ── Rule 7: Burn scar detected (dNBR > 0.1) ──────────────────────────
  if (includeBurn) {
    var rule7 = temporalStats.select('dNBR').gt(0.1);
    score = score.add(rule7);
  }

  return score.byte();
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 7: SMART CLUSTERING WITH AUTO-SELECTION                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Pre-mask non-agricultural areas, cluster remaining pixels, then
// automatically identify the cluster(s) that best match upland rice.
var smartClustering = function(combinedBands, roi, nClusters, scoreImage, scoreThreshold) {

  // ── Step 1: Create a candidate mask ───────────────────────────────────
  // Only cluster pixels that have at least SOME upland rice likelihood
  // Use a relaxed threshold (scoreThreshold - 2, min 1) for candidate masking
  var candidateThreshold = Math.max(1, scoreThreshold - 2);
  var candidateMask = scoreImage.gte(candidateThreshold);
  var maskedBands = combinedBands.updateMask(candidateMask);

  // ── Step 2: Sample and cluster ────────────────────────────────────────
  var training = maskedBands.sample({
    region: roi,
    scale: 10,
    numPixels: 5000,
    tileScale: 8,
    seed: 42
  });

  // Handle case where not enough samples
  var clusterer = ee.Clusterer.wekaKMeans(nClusters).train({features: training});
  var clusterImage = maskedBands.cluster(clusterer).byte().rename('cluster');

  // ── Step 3: Score each cluster by mean upland rice score ──────────────
  // For each cluster, compute the mean phenology score of its pixels
  var clusterScores = ee.List.sequence(0, nClusters - 1).map(function(cid) {
    cid = ee.Number(cid);
    var mask = clusterImage.eq(cid);
    var meanScore = scoreImage.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13,
      tileScale: 4
    }).get('upland_rice_score');

    // Also get mean NDVI amplitude for this cluster
    var meanAmp = combinedBands.select(
      combinedBands.bandNames().filter(ee.Filter.stringContains('item', 'NDVI_amplitude'))
    );
    // If NDVI_amplitude band exists
    var ampVal = meanAmp.updateMask(mask).reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13,
      tileScale: 4
    });

    return ee.Feature(null, {
      'cluster_id': cid,
      'mean_score': ee.Algorithms.If(meanScore, meanScore, 0),
      'pixel_count': mask.selfMask().reduceRegion({
        reducer: ee.Reducer.count(),
        geometry: roi,
        scale: 10,
        maxPixels: 1e13,
        tileScale: 4
      }).values().get(0)
    });
  });

  var clusterScoreFC = ee.FeatureCollection(clusterScores);

  // ── Step 4: Auto-select clusters with mean score >= threshold ─────────
  var selectedClusters = clusterScoreFC
    .filter(ee.Filter.gte('mean_score', scoreThreshold));

  // Build a mask of auto-selected clusters
  var selectedIds = selectedClusters.aggregate_array('cluster_id');

  // Create a combined mask: for each selected cluster ID, create a binary mask,
  // then OR them together. Guard against empty selection with a fallback.
  var finalMask = selectedIds.iterate(function(cid, acc) {
    return ee.Image(acc).or(clusterImage.eq(ee.Number(cid)));
  }, ee.Image.constant(0).rename('cluster'));
  finalMask = ee.Image(finalMask);

  // The detected upland rice image preserves cluster IDs
  var detectedUplandRice = clusterImage.updateMask(finalMask);

  return {
    clusterImage: clusterImage,
    clusterScores: clusterScoreFC,
    selectedClusters: selectedClusters,
    detectedMask: finalMask,
    detectedUplandRice: detectedUplandRice,
    candidateMask: candidateMask
  };
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 8: VISUALIZATION HELPERS                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── NDVI time series chart for detected upland rice vs other areas ───────
var createNDVIChart = function(s2Collection, detectedMask, roi, year, brgyName) {
  // Monthly NDVI for detected upland rice pixels
  var months = ee.List.sequence(1, 12);
  var ndviTimeSeries = months.map(function(m) {
    m = ee.Number(m);
    var start = ee.Date.fromYMD(year, m, 1);
    var end = start.advance(1, 'month');
    var monthlyNDVI = s2Collection.filterDate(start, end).select('NDVI');
    var composite = monthlyNDVI.median();

    // Mean NDVI for upland rice pixels
    var upriceNDVI = composite.updateMask(detectedMask).reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13
    }).get('NDVI');

    // Mean NDVI for all other pixels
    var otherMask = detectedMask.not().or(detectedMask.unmask().not());
    var otherNDVI = composite.updateMask(otherMask).reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13
    }).get('NDVI');

    return ee.Feature(null, {
      'month': start.format('YYYY-MM'),
      'Upland Rice': ee.Algorithms.If(upriceNDVI, upriceNDVI, null),
      'Other Land': ee.Algorithms.If(otherNDVI, otherNDVI, null)
    });
  });

  var chart = ui.Chart.feature.byFeature(
    ee.FeatureCollection(ndviTimeSeries), 'month', ['Upland Rice', 'Other Land']
  ).setChartType('LineChart')
   .setOptions({
     title: 'NDVI Time Series — ' + brgyName + ' (' + year + ')',
     hAxis: {title: 'Month', slantedText: true, slantedTextAngle: 45},
     vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 1}},
     lineWidth: 3,
     pointSize: 5,
     colors: [UPLAND_RICE_COLOR, '#4CAF50'],
     curveType: 'function'
   });

  return chart;
};

// ── Multi-index time series chart ───────────────────────────────────────
var createMultiIndexChart = function(s2Collection, detectedMask, roi, year, brgyName) {
  var months = ee.List.sequence(1, 12);
  var indexNames = ['NDVI', 'SAVI', 'NBR', 'BSI'];

  var timeSeries = months.map(function(m) {
    m = ee.Number(m);
    var start = ee.Date.fromYMD(year, m, 1);
    var end = start.advance(1, 'month');
    var monthly = s2Collection.filterDate(start, end).select(indexNames);
    var composite = monthly.median().updateMask(detectedMask);

    var stats = composite.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13
    });

    return ee.Feature(null, {
      'month': start.format('YYYY-MM'),
      'NDVI': ee.Algorithms.If(stats.get('NDVI'), stats.get('NDVI'), null),
      'SAVI': ee.Algorithms.If(stats.get('SAVI'), stats.get('SAVI'), null),
      'NBR':  ee.Algorithms.If(stats.get('NBR'), stats.get('NBR'), null),
      'BSI':  ee.Algorithms.If(stats.get('BSI'), stats.get('BSI'), null)
    });
  });

  var chart = ui.Chart.feature.byFeature(
    ee.FeatureCollection(timeSeries), 'month', indexNames
  ).setChartType('LineChart')
   .setOptions({
     title: 'Multi-Index Time Series (Upland Rice Pixels) — ' + brgyName,
     hAxis: {title: 'Month', slantedText: true, slantedTextAngle: 45},
     vAxis: {title: 'Index Value'},
     lineWidth: 2,
     pointSize: 4,
     colors: ['#FF4500', '#2E7D32', '#1565C0', '#8D6E63'],
     curveType: 'function'
   });

  return chart;
};

// ── SAR backscatter time series chart ───────────────────────────────────
var createSARChart = function(s1Collection, detectedMask, roi, year, brgyName) {
  var months = ee.List.sequence(1, 12);

  var timeSeries = months.map(function(m) {
    m = ee.Number(m);
    var start = ee.Date.fromYMD(year, m, 1);
    var end = start.advance(1, 'month');
    var monthly = s1Collection.filterDate(start, end);
    var composite = monthly.median().updateMask(detectedMask);

    var stats = composite.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13
    });

    return ee.Feature(null, {
      'month': start.format('YYYY-MM'),
      'VH': ee.Algorithms.If(stats.get('VH'), stats.get('VH'), null),
      'VV': ee.Algorithms.If(stats.get('VV'), stats.get('VV'), null)
    });
  });

  var chart = ui.Chart.feature.byFeature(
    ee.FeatureCollection(timeSeries), 'month', ['VH', 'VV']
  ).setChartType('LineChart')
   .setOptions({
     title: 'SAR Backscatter (Upland Rice Pixels) — ' + brgyName,
     hAxis: {title: 'Month', slantedText: true, slantedTextAngle: 45},
     vAxis: {title: 'Backscatter (dB)'},
     lineWidth: 2,
     pointSize: 4,
     colors: ['#E91E63', '#3F51B5'],
     curveType: 'function'
   });

  return chart;
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 9: MAIN DETECTION PIPELINE                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// Global state to hold latest results for export
var LATEST_RESULTS = {};

var runDetection = function(psgcCode, year, nClusters, scoreThreshold,
                            maxCloud, applySlope, applyBurn, applySAR,
                            showClusters, isBatch) {

  // ── Resolve ROI ───────────────────────────────────────────────────────
  var roi, brgyName;
  if (isBatch) {
    roi = barangayTable;
    brgyName = 'All Barangays';
  } else {
    roi = barangayTable.filter(ee.Filter.eq('adm4_psgc', ee.Number.parse(psgcCode)));
    brgyName = roi.first().get('adm4_en');
  }

  statusLabel.setValue('Status: Processing ' + (isBatch ? 'all barangays' : 'PSGC ' + psgcCode) + '...');

  // ── Center map ────────────────────────────────────────────────────────
  Map.centerObject(roi, isBatch ? 12 : 14);

  // Clear previous layers (keep basemap)
  while (Map.layers().length() > 0) {
    Map.layers().remove(Map.layers().get(0));
  }

  // ── Add ROI boundary ──────────────────────────────────────────────────
  Map.addLayer(roi.style({color: 'black', fillColor: '00000000', width: 2}),
               {}, 'Barangay Boundary');

  // ── Add Sentinel-2 true color composite for reference ─────────────────
  var s2RGB = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', maxCloud))
    .filterDate(ee.Date.fromYMD(year, GROW_START, 1),
                ee.Date.fromYMD(year, GROW_END, 1))
    .map(maskS2Clouds)
    .median()
    .clip(roi);
  Map.addLayer(s2RGB, {bands: ['B4','B3','B2'], min: 0, max: 3000},
               'S2 True Color (Growing Season)', true);

  // ── Build monthly composites ──────────────────────────────────────────
  var composites = buildMonthlyComposites(roi, year, maxCloud);

  // ── Flatten S2 monthly into single multi-band image ───────────────────
  var s2Stack = composites.s2Monthly.toBands().clip(roi);

  // ── Terrain features ──────────────────────────────────────────────────
  var terrain = getTerrainFeatures(roi);

  // ── Temporal statistics ───────────────────────────────────────────────
  var temporalStats = computeTemporalStats(composites.s2Monthly, year, roi).clip(roi);

  // ── Phenology score ───────────────────────────────────────────────────
  var scoreImage = computeUplanRiceScore(temporalStats, terrain, applySlope, applyBurn);
  scoreImage = scoreImage.clip(roi);

  Map.addLayer(scoreImage, {min: 0, max: 7, palette: SCORE_PALETTE},
               'Upland Rice Phenology Score', false);

  // ── Build combined feature stack for clustering ───────────────────────
  var featureStack = temporalStats.addBands(terrain);

  // Add SAR features if enabled
  if (applySAR) {
    var s1Stack = composites.s1Monthly.toBands().clip(roi);
    featureStack = featureStack.addBands(s1Stack);
  }

  // Add the phenology score itself as a clustering feature
  featureStack = featureStack.addBands(scoreImage);

  // ── Smart clustering ──────────────────────────────────────────────────
  var clusterResults = smartClustering(featureStack, roi, nClusters, scoreImage, scoreThreshold);

  // ── Display all clusters if requested ─────────────────────────────────
  if (showClusters) {
    Map.addLayer(clusterResults.clusterImage,
      {min: 0, max: nClusters - 1, palette: CLUSTER_PALETTE},
      'All K-Means Clusters', false);
  }

  // ── Display candidate mask ────────────────────────────────────────────
  Map.addLayer(clusterResults.candidateMask.selfMask(),
    {palette: ['#FFEB3B'], opacity: 0.3},
    'Candidate Pixels (pre-filter)', false);

  // ── Display detected upland rice ──────────────────────────────────────
  Map.addLayer(clusterResults.detectedMask.selfMask(),
    {palette: [UPLAND_RICE_COLOR]},
    '🌾 DETECTED UPLAND RICE', true, 0.7);

  // ── Compute area ──────────────────────────────────────────────────────
  var areaImage = ee.Image.pixelArea().divide(10000); // hectares
  var totalArea = areaImage.updateMask(clusterResults.detectedMask.selfMask())
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: roi,
      scale: 10,
      maxPixels: 1e13,
      tileScale: 4
    }).get('area');

  // ── Print results ─────────────────────────────────────────────────────
  resultsPanel.clear();
  resultsPanel.add(ui.Label({
    value: '📊 Detection Results',
    style: {fontWeight: 'bold', fontSize: '14px', color: '#2E7D32'}
  }));

  // Print barangay name
  brgyName = isBatch ? 'All Barangays' : brgyName;
  ee.String(brgyName).evaluate(function(name) {
    resultsPanel.add(ui.Label({
      value: 'Barangay: ' + name,
      style: {fontSize: '12px', fontWeight: 'bold'}
    }));
  });

  // Print area
  ee.Number(totalArea).evaluate(function(area) {
    var areaStr = area !== null ? area.toFixed(2) : 'N/A';
    resultsPanel.add(ui.Label({
      value: '🌾 Detected Upland Rice Area: ' + areaStr + ' hectares',
      style: {fontSize: '13px', fontWeight: 'bold', color: UPLAND_RICE_COLOR}
    }));
  });

  // Print cluster scores
  resultsPanel.add(ui.Label({
    value: 'Cluster Scores (auto-selected ≥ ' + scoreThreshold + '):',
    style: {fontSize: '11px', fontWeight: 'bold', margin: '8px 0 2px 0'}
  }));

  clusterResults.clusterScores.evaluate(function(fc) {
    if (fc && fc.features) {
      fc.features.forEach(function(f) {
        var props = f.properties;
        var cid = props.cluster_id;
        var ms = props.mean_score !== null ? props.mean_score.toFixed(2) : 'N/A';
        var selected = props.mean_score >= scoreThreshold ? ' ✅ SELECTED' : '';
        resultsPanel.add(ui.Label({
          value: '  Cluster ' + cid + ': score=' + ms + selected,
          style: {fontSize: '10px', color: selected ? '#2E7D32' : '#888'}
        }));
      });
    }
  });

  // ── Charts ────────────────────────────────────────────────────────────
  ee.String(brgyName).evaluate(function(name) {
    // NDVI comparison chart
    var ndviChart = createNDVIChart(
      composites.s2Collection, clusterResults.detectedMask, roi, year, name || 'ROI');
    print(ndviChart);

    // Multi-index chart
    var multiChart = createMultiIndexChart(
      composites.s2Collection, clusterResults.detectedMask, roi, year, name || 'ROI');
    print(multiChart);

    // SAR chart
    if (applySAR) {
      var sarChart = createSARChart(
        composites.s1Collection, clusterResults.detectedMask, roi, year, name || 'ROI');
      print(sarChart);
    }
  });

  // ── Slope histogram for detected pixels ───────────────────────────────
  var slopeHistData = terrain.select('slope_deg').updateMask(clusterResults.detectedMask);
  var slopeHist = ui.Chart.image.histogram({
    image: slopeHistData,
    region: roi,
    scale: 30,
    maxPixels: 1e9
  }).setOptions({
    title: 'Slope Distribution of Detected Upland Rice Pixels',
    hAxis: {title: 'Slope (degrees)'},
    vAxis: {title: 'Pixel Count'},
    colors: [UPLAND_RICE_COLOR]
  });
  print(slopeHist);

  // ── Store results for export ──────────────────────────────────────────
  LATEST_RESULTS = {
    detectedMask: clusterResults.detectedMask,
    detectedUplandRice: clusterResults.detectedUplandRice,
    scoreImage: scoreImage,
    clusterImage: clusterResults.clusterImage,
    roi: roi,
    year: year,
    brgyName: brgyName
  };

  exportButton.setDisabled(false);
  statusLabel.setValue('Status: ✅ Detection complete! Review map layers and charts.');
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 10: EXPORT FUNCTIONS                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var exportResults = function() {
  if (!LATEST_RESULTS.detectedMask) {
    statusLabel.setValue('Status: ⚠️ No results to export. Run detection first.');
    return;
  }

  var roi = LATEST_RESULTS.roi;
  var year = LATEST_RESULTS.year;

  // ── Export 1: Detected upland rice binary mask ────────────────────────
  Export.image.toDrive({
    image: LATEST_RESULTS.detectedMask.selfMask().byte(),
    description: 'UplandRice_Detected_' + year,
    folder: 'GEE_Upland_Rice',
    fileNamePrefix: 'UplandRice_Detected_' + year,
    region: roi,
    scale: 10,
    crs: 'EPSG:4326',
    maxPixels: 1e13
  });

  // ── Export 2: Phenology score image ───────────────────────────────────
  Export.image.toDrive({
    image: LATEST_RESULTS.scoreImage.byte(),
    description: 'UplandRice_Score_' + year,
    folder: 'GEE_Upland_Rice',
    fileNamePrefix: 'UplandRice_Score_' + year,
    region: roi,
    scale: 10,
    crs: 'EPSG:4326',
    maxPixels: 1e13
  });

  // ── Export 3: Full cluster image ──────────────────────────────────────
  Export.image.toDrive({
    image: LATEST_RESULTS.clusterImage.byte(),
    description: 'UplandRice_Clusters_' + year,
    folder: 'GEE_Upland_Rice',
    fileNamePrefix: 'UplandRice_Clusters_' + year,
    region: roi,
    scale: 10,
    crs: 'EPSG:4326',
    maxPixels: 1e13
  });

  // ── Export 4: Detected upland rice as vector (shapefile) ──────────────
  var vectors = LATEST_RESULTS.detectedMask.selfMask()
    .reduceToVectors({
      geometry: roi,
      scale: 10,
      geometryType: 'polygon',
      eightConnected: true,
      maxPixels: 1e13,
      tileScale: 4
    });

  Export.table.toDrive({
    collection: vectors,
    description: 'UplandRice_Vectors_' + year,
    folder: 'GEE_Upland_Rice',
    fileNamePrefix: 'UplandRice_Vectors_' + year,
    fileFormat: 'SHP'
  });

  statusLabel.setValue('Status: 📤 Export tasks submitted! Check the Tasks tab.');
  print('✅ Export tasks submitted. Go to the Tasks tab (top-right) to start them.');
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 11: BATCH PROCESSING — ALL BARANGAYS                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var runBatchDetection = function(year, nClusters, scoreThreshold, maxCloud,
                                 applySlope, applyBurn, applySAR) {

  statusLabel.setValue('Status: 🔄 Batch processing all barangays...');

  var roi = barangayTable;
  Map.centerObject(roi, 11);

  // Clear previous layers
  while (Map.layers().length() > 0) {
    Map.layers().remove(Map.layers().get(0));
  }

  // Add all barangay boundaries
  Map.addLayer(roi.style({color: 'black', fillColor: '00000000', width: 1}),
               {}, 'All Barangay Boundaries');

  // ── Build composites for entire municipality ──────────────────────────
  var composites = buildMonthlyComposites(roi, year, maxCloud);
  var terrain = getTerrainFeatures(roi);
  var temporalStats = computeTemporalStats(composites.s2Monthly, year, roi).clip(roi);
  var scoreImage = computeUplanRiceScore(temporalStats, terrain, applySlope, applyBurn).clip(roi);

  // ── Build feature stack ───────────────────────────────────────────────
  var featureStack = temporalStats.addBands(terrain);
  if (applySAR) {
    var s1Stack = composites.s1Monthly.toBands().clip(roi);
    featureStack = featureStack.addBands(s1Stack);
  }
  featureStack = featureStack.addBands(scoreImage);

  // ── Cluster the entire municipality at once ───────────────────────────
  var clusterResults = smartClustering(featureStack, roi, nClusters, scoreImage, scoreThreshold);

  // ── Display results ───────────────────────────────────────────────────
  Map.addLayer(scoreImage, {min: 0, max: 7, palette: SCORE_PALETTE},
               'Phenology Score (All Barangays)', false);

  Map.addLayer(clusterResults.detectedMask.selfMask(),
    {palette: [UPLAND_RICE_COLOR]},
    '🌾 DETECTED UPLAND RICE (All Barangays)', true, 0.7);

  // ── Per-barangay area statistics ──────────────────────────────────────
  var areaImage = ee.Image.pixelArea().divide(10000);
  var maskedArea = areaImage.updateMask(clusterResults.detectedMask.selfMask());

  var brgyAreas = maskedArea.reduceRegions({
    collection: barangayTable,
    reducer: ee.Reducer.sum(),
    scale: 10,
    tileScale: 4
  });

  // Print area table
  resultsPanel.clear();
  resultsPanel.add(ui.Label({
    value: '📊 Batch Results — Upland Rice Area per Barangay',
    style: {fontWeight: 'bold', fontSize: '14px', color: '#2E7D32'}
  }));

  brgyAreas.evaluate(function(fc) {
    if (fc && fc.features) {
      var totalHa = 0;
      fc.features.forEach(function(f) {
        var name = f.properties.adm4_en || f.properties.adm4_psgc || 'Unknown';
        var area = f.properties.sum;
        var areaStr = area !== null && area !== undefined ? area.toFixed(2) : '0.00';
        totalHa += area || 0;
        resultsPanel.add(ui.Label({
          value: '  ' + name + ': ' + areaStr + ' ha',
          style: {fontSize: '11px'}
        }));
      });
      resultsPanel.add(ui.Label({
        value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        style: {fontSize: '10px', color: '#ccc'}
      }));
      resultsPanel.add(ui.Label({
        value: '  TOTAL: ' + totalHa.toFixed(2) + ' ha',
        style: {fontSize: '13px', fontWeight: 'bold', color: UPLAND_RICE_COLOR}
      }));
    }
  });

  // ── Export per-barangay area table ─────────────────────────────────────
  Export.table.toDrive({
    collection: brgyAreas.select(['adm4_en', 'adm4_psgc', 'sum']),
    description: 'UplandRice_AreaByBarangay_' + year,
    folder: 'GEE_Upland_Rice',
    fileNamePrefix: 'UplandRice_AreaByBarangay_' + year,
    fileFormat: 'CSV'
  });

  // Store for export
  LATEST_RESULTS = {
    detectedMask: clusterResults.detectedMask,
    detectedUplandRice: clusterResults.detectedUplandRice,
    scoreImage: scoreImage,
    clusterImage: clusterResults.clusterImage,
    roi: roi,
    year: year,
    brgyName: 'AllBarangays'
  };

  exportButton.setDisabled(false);
  statusLabel.setValue('Status: ✅ Batch detection complete!');
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 12: WIRE UP UI BUTTONS                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

runButton.onClick(function() {
  // Read UI values
  var psgcCode      = psgcInput.getValue();
  var year          = Math.round(yearSlider.getValue());
  var nClusters     = Math.round(clusterSlider.getValue());
  var scoreThresh   = Math.round(scoreSlider.getValue());
  var maxCloud      = Math.round(cloudSlider.getValue());
  var applySlope    = useSlopeFilter.getValue();
  var applyBurn     = useBurnDetection.getValue();
  var applySAR      = useSAR.getValue();
  var showClusters  = showAllClusters.getValue();
  var isBatch       = batchCheckbox.getValue();

  if (isBatch) {
    runBatchDetection(year, nClusters, scoreThresh, maxCloud,
                      applySlope, applyBurn, applySAR);
  } else {
    if (!psgcCode || psgcCode.trim() === '') {
      statusLabel.setValue('Status: ⚠️ Please enter a PSGC code or enable batch mode.');
      return;
    }
    runDetection(psgcCode, year, nClusters, scoreThresh, maxCloud,
                 applySlope, applyBurn, applySAR, showClusters, false);
  }
});

exportButton.onClick(function() {
  exportResults();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 13: INTERACTIVE CLUSTER INSPECTOR (click on map)              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// When the user clicks on the map after running detection, show pixel info
Map.onClick(function(coords) {
  if (!LATEST_RESULTS.scoreImage) return;

  var point = ee.Geometry.Point([coords.lon, coords.lat]);

  // Sample all relevant layers at click point
  var scoreVal = LATEST_RESULTS.scoreImage.sample(point, 10).first();
  var clusterVal = LATEST_RESULTS.clusterImage.sample(point, 10).first();

  scoreVal.evaluate(function(f) {
    if (f && f.properties) {
      var score = f.properties.upland_rice_score;
      clusterVal.evaluate(function(cf) {
        var cluster = cf && cf.properties ? cf.properties.cluster : 'N/A';
        var msg = '📍 Clicked pixel — Score: ' + score + '/7, Cluster: ' + cluster;
        statusLabel.setValue(msg);
      });
    } else {
      statusLabel.setValue('📍 Clicked pixel — Outside detection area or no data.');
    }
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 14: LEGEND                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var legendPanel = ui.Panel({
  style: {position: 'bottom-right', padding: '8px', width: '180px'}
});

legendPanel.add(ui.Label({
  value: 'Legend',
  style: {fontWeight: 'bold', fontSize: '13px', margin: '0 0 5px 0'}
}));

// Upland rice legend entry
var makeRow = function(color, label) {
  var colorBox = ui.Label({
    style: {backgroundColor: color, padding: '8px', margin: '0 4px 4px 0',
            border: '1px solid #999'}
  });
  var description = ui.Label({value: label, style: {fontSize: '11px', margin: '0 0 4px 0'}});
  return ui.Panel({widgets: [colorBox, description],
    layout: ui.Panel.Layout.flow('horizontal')});
};

legendPanel.add(makeRow(UPLAND_RICE_COLOR, 'Detected Upland Rice'));
legendPanel.add(makeRow('#FFEB3B', 'Candidate Pixels'));

// Score gradient
legendPanel.add(ui.Label({value: 'Phenology Score:', style: {fontSize: '11px', margin: '5px 0 2px 0'}}));
legendPanel.add(makeRow('#440154', '0 (Low)'));
legendPanel.add(makeRow('#1f9e89', '3-4 (Medium)'));
legendPanel.add(makeRow('#fde725', '7 (High)'));

Map.add(legendPanel);


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SECTION 15: INITIAL MESSAGE                                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

print('═══════════════════════════════════════════════════════');
print('🌾 UPLAND RICE DETECTION SYSTEM');
print('═══════════════════════════════════════════════════════');
print('Use the panel on the LEFT to configure parameters.');
print('Click "Run Detection" to start processing.');
print('');
print('Detection is based on 7 phenology rules:');
print('  1. NDVI amplitude > 0.2 during growing season (May-Oct)');
print('  2. Rapid green-up from bare soil to crop canopy');
print('  3. Sharp NDVI drop after harvest');
print('  4. Low pre-planting NDVI (bare/burned soil)');
print('  5. No standing water (NDWI always low)');
print('  6. Upland slope (3°-45°)');
print('  7. Burn scar detected (dNBR > 0.1)');
print('');
print('Pixels scoring ≥ threshold are flagged as upland rice.');
print('═══════════════════════════════════════════════════════');
