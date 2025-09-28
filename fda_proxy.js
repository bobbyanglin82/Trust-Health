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

function parseManufacturingInfo(labelData) {
    const info = {
        manufactured_by: null,
        manufactured_for: null,
    };

    // 1. Create a single, clean text corpus from a prioritized list of sections.
    // This focuses the search on the most likely places, improving accuracy.
    const searchSections = [
        'spl_unclassified_section',
        'spl_medguide',
        'information_for_patients',
        'spl_patient_package_insert',
        'how_supplied',
        'package_label_principal_display_panel'
    ];
    let textCorpus = '';
    const seen = new Set();
    for (const key of searchSections) {
        if (Object.prototype.hasOwnProperty.call(labelData, key) && labelData[key]) {
            const sectionText = Array.isArray(labelData[key]) ? labelData[key].join('\n') : String(labelData[key]);
            const cleanedText = sectionText.replace(/\u00a0/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (cleanedText && !seen.has(cleanedText)) {
                // Use double newlines to represent paragraph breaks, a key for the new regex.
                textCorpus += cleanedText + '\n\n';
            }
        }
    }
    if (!textCorpus) return info;

    // 2. A more robust cleaning function.
    const cleanValue = (value) => {
        if (!value) return null;
        // Take only the first meaningful line of a captured block.
        let firstLine = value.split('\n')[0].trim();
        // Heuristic: take only the part before the first comma to get the company name.
        let finalValue = firstLine.split(',')[0].trim();
        // Final cleanup of trailing characters.
        finalValue = finalValue.replace(/[.,;:]\s*$/, '').trim();
        return finalValue.length > 2 ? finalValue : null;
    };

    // 3. Define all possible phrases. The regex will search for these as whole phrases.
    const forPrefixes = ['Manufactured for', 'Mfd\\. for', 'Mfr\\. for'];
    const byPrefixes = ['Manufactured by', 'Mfd\\. by', 'Mfr\\. by', 'Distributed by', 'Marketed by', 'By'];
    const allPrefixes = [...forPrefixes, ...byPrefixes];
    
    // 4. This is the new Master Regex.
    // It finds a prefix and captures everything until it sees the next prefix OR a blank line OR the end of the text.
    const pattern = new RegExp(
        `\\b(${allPrefixes.join('|')})[:\\s]*([\\s\\S]+?)(?=\\b(?:${allPrefixes.join('|')})|\\n\\s*\\n|$)`,
        'gi'
    );

    // 5. Find all matches in the entire document at once.
    const matches = [...textCorpus.matchAll(pattern)];

    // 6. Process the clean, well-defined matches.
    for (const match of matches) {
        const keyRaw = match[1];
        const valueRaw = match[2];
        
        // This is a special case for "By:" to ensure it's not a common word.
        // It must have a colon or be the only word on its line.
        if (keyRaw.toLowerCase() === 'by' && !/by:/i.test(match[0]) && valueRaw.trim().split(' ').length > 5) {
            continue;
        }

        const cleaned = cleanValue(valueRaw);
        if (!cleaned) continue;

        if (forPrefixes.some(p => new RegExp(p, 'i').test(keyRaw))) {
            if (!info.manufactured_for) info.manufactured_for = cleaned;
        } else {
            if (!info.manufactured_by) info.manufactured_by = cleaned;
        }
    }
    
    return info;
}

async function downloadData() {
  let rawLabelDataForExport = [];
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  
  const searchQuery = knownEntities.map(entity => `openfda.manufacturer_name:"${entity}"`).join('+OR+');
  const labelApiUrl = `https://api.fda.gov/drug/label.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join('/tmp', 'data.json');

  try {
    const labelResponse = await axios.get(labelApiUrl);
    const labelResults = labelResponse.data.results;

    if (!labelResults || labelResults.length === 0) {
      console.log('✅ No records found for the specified entities in the Label API.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${labelResults.length} records. Fetching accurate NDC data...`);
    
    const allNdcs = labelResults.map(l => l.openfda?.product_ndc?.[0]).filter(Boolean);
    const ndcDataMap = new Map();
    
    if (allNdcs.length > 0) {
        const ndcSearchQuery = allNdcs.map(ndc => `product_ndc:"${ndc}"`).join('+OR+');
        const ndcApiUrl = `https://api.fda.gov/drug/ndc.json?search=${ndcSearchQuery}&limit=${allNdcs.length}`;
        const ndcResponse = await axios.get(ndcApiUrl);
        if (ndcResponse.data.results) {
            ndcResponse.data.results.forEach(product => {
                // Store an object with all the data we need from this API call
                ndcDataMap.set(product.product_ndc, {
                    marketing_start_date: product.marketing_start_date,
                    listing_expiration_date: product.listing_expiration_date,
                    labeler_name: product.labeler_name,
                    brand_name: product.brand_name,
                    generic_name: product.generic_name
                });
            });
        }
    }
    
    const enrichedResults = [];
    for (const labelData of labelResults) {
      if (!labelData) continue;
      
      const textCorpus = (() => {
        const TEXT_BEARING_SECTIONS = ['principal_display_panel', 'package_label_principal_display_panel', 'how_supplied', 'how_supplied_table', 'description', 'spl_unclassified_section', 'title', 'information_for_patients', 'instructions_for_use'];
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
      
      const manufacturingInfo = parseManufacturingInfo(labelData);
      const product_ndc = labelData.openfda?.product_ndc?.[0] || 'N/A';
      const ndcData = ndcDataMap.get(product_ndc) || {};
      
      // Build the final, clean object in the desired order
      enrichedResults.push({
        product_ndc: product_ndc,
        labeler_name: ndcData.labeler_name || 'N/A',
        brand_name: ndcData.brand_name || 'N/A',
        generic_name: ndcData.generic_name || 'N/A',
        marketing_start_date: ndcData.marketing_start_date || labelData.effective_time || 'N/A',
        listing_expiration_date: ndcData.listing_expiration_date || 'N/A',
        manufacturer_name: manufacturingInfo.manufactured_by || 'N/A (Not Found on Label)',
        manufacturer_by_country: manufacturingInfo.manufactured_by_country || 'N/A',
        manufactured_for: manufacturingInfo.manufactured_for || ndcData.labeler_name || 'N/A'
      });
    }

    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
    // Create an empty file on error so the site doesn't break
    fs.writeFileSync(outputPath, '[]');
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