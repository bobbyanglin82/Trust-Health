const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

const app = express();

const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

// --- START: Raw NDC Query Export Function ---
async function exportRawNdcQueryResults() {
  console.log('--- Starting raw export of the initial NDC query results ---');
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'raw_ndc_query_export.json');

  try {
    console.log(`Querying API: ${apiUrl}`);
    const response = await axios.get(apiUrl);
    fs.writeFileSync(outputPath, JSON.stringify(response.data, null, 2));
    console.log(`✅ Success! The raw API response has been saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Error during raw data export:', error.message);
  }
}
// --- END: Raw NDC Query Export Function ---

function parseManufacturingInfo(fullText) {
  const info = {
    manufactured_by: null,
    manufactured_for: null,
    distributed_by: null,
    marketed_by: null,
    product_of: null,
    raw_snippet: null
  };
  const normalizedText = fullText.replace(/\u00a0/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[‐‑‒–—―]/g, '-').replace(/(\r?\n)+/g, '\n').replace(/\s{2,}/g, ' ').trim();
  const prefixes = ['Manufactured by', 'Mfd. by', 'Mfr. by', 'Manufactured for', 'Mfd. for', 'Mfr. for', 'Distributed by', 'Marketed by', 'Packed by', 'Product of'];
  const pattern = new RegExp(`\\b(${prefixes.join('|')})[:\\s]*([\\s\\S]+?)(?=\\b(?:${prefixes.join('|')})|$)`, 'gi');
  let match;
  while ((match = pattern.exec(normalizedText)) !== null) {
    const key = match[1].toLowerCase();
    let value = match[2].trim().replace(/[,.;\s]*$/, '').trim();
    if (key.includes('manufactured by')) {
      if (!info.manufactured_by) info.manufactured_by = value;
    } else if (key.includes('manufactured for')) {
      if (!info.manufactured_for) info.manufactured_for = value;
    } else if (key.includes('distributed by')) {
      if (!info.distributed_by) info.distributed_by = value;
    } else if (key.includes('marketed by')) {
      if (!info.marketed_by) info.marketed_by = value;
    } else if (key.includes('product of')) {
      if (!info.product_of) info.product_of = value;
    }
    if (!info.raw_snippet) info.raw_snippet = match[0];
  }
  return info;
}

async function downloadData() {
  let rawLabelDataForExport = [];
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');

  // This new query searches the LABEL database directly for your entities.
  const searchQuery = knownEntities.map(entity => `openfda.manufacturer_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/label.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join('/tmp', 'data.json');

  try {
    const response = await axios.get(apiUrl);
    const labelResults = response.data.results;

    if (!labelResults || labelResults.length === 0) {
      console.log('✅ No records found for the specified entities in the Label API.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }

    console.log(`👍 Found ${labelResults.length} records. Parsing and formatting...`);

    const enrichedResults = [];
    for (const labelData of labelResults) {
      if (!labelData) continue;

      // Save the raw data for debugging, as we did before
      rawLabelDataForExport.push(labelData);

      // Build the text corpus from the label data itself
      const TEXT_BEARING_SECTIONS = ['principal_display_panel', 'package_label_principal_display_panel', 'how_supplied', 'how_supplied_table', 'description', 'spl_unclassified_section', 'title', 'information_for_patients', 'instructions_for_use'];
      const textCorpus = (() => {
        const seen = new Set();
        const chunks = [];
        const pushChunk = (val) => {
          if (!val) return;
          if (Array.isArray(val)) { val.flat(Infinity).forEach(pushChunk); return; }
          if (typeof val === 'string') {
            const s = val.replace(/\u0000/g, '').trim();
            if (s && !seen.has(s)) { seen.add(s); chunks.push(s); }
          }
        };
        for (const key of TEXT_BEARING_SECTIONS) {
          if (Object.prototype.hasOwnProperty.call(labelData, key)) { pushChunk(labelData[key]); }
        }
        return chunks.join('\n\n');
      })();

      const manufacturingInfo = parseManufacturingInfo(textCorpus);

      // Extract fields from the single API result
      enrichedResults.push({
        product_ndc: labelData.openfda?.product_ndc?.[0] || 'N/A',
        labeler_name: labelData.openfda?.manufacturer_name?.[0] || 'N/A',
        brand_name: labelData.openfda?.brand_name?.[0] || 'N/A',
        generic_name: labelData.openfda?.generic_name?.[0] || 'N/A',
        marketing_start_date: labelData.effective_time || 'N/A',
        marketing_end_date: 'N/A', // This field is not reliably available in the label endpoint
        manufacturer_name: manufacturingInfo.manufactured_by || 'N/A (Not Found on Label)',
        manufactured_for: manufacturingInfo.manufactured_for || labelData.openfda?.manufacturer_name?.[0] || 'N/A',
        raw_manufacturing_snippet: manufacturingInfo.raw_snippet,
        source_spl_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${labelData.set_id}`
      });
    }

    // Save the debug file if needed
    if (rawLabelDataForExport.length > 0) {
        const debugOutputPath = path.join(__dirname, 'debug_raw_spl_data.json');
        fs.writeFileSync(debugOutputPath, JSON.stringify(rawLabelDataForExport, null, 2));
        console.log(`[DEBUG] Saved raw SPL data for ${rawLabelDataForExport.length} records to ${debugOutputPath}`);
    }

    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
  }
}

// --- Server Routes & Startup ---
cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));
app.get("/data", (req, res) => {
  const dataPath = path.join('/tmp', 'data.json');
  if (fs.existsSync(dataPath)) {
    res.sendFile(dataPath);
  } else {
    res.status(404).send("Data file not found. It may still be generating.");
  }
});
app.get("/debug-file", (req, res) => {
  const filePath = path.join(__dirname, 'debug_raw_spl_data.json');
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send("Debug file not found. The downloadData script may not have completed successfully or created the file yet.");
  }
});

const PORT = process.env.PORT || 3001;

// --- Server Startup & Export Logic ---
async function startServer() {
  console.log('--- Server starting up ---');
  await downloadData();
  app.listen(PORT, () => {
    console.log(`✅ Data is ready. Server is now live and listening on port ${PORT}`);
  });
}

if (process.argv[2] === 'export') {
  exportRawNdcQueryResults();
} else {
  startServer();
}