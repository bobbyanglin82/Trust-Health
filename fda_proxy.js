const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

const app = express();


// A comprehensive list of all known text-bearing sections in the drug/label API
const TEXT_BEARING_SECTIONS = [
  'principal_display_panel',
  'package_label_principal_display_panel',
  'how_supplied',
  'how_supplied_table',
  'description',
  'spl_unclassified_section',
  'title' // sometimes has “Marketed by …”
];


const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

function parseManufacturingInfo(fullText) {
  const info = {
    manufactured_by: null,
    manufactured_for: null,
    distributed_by: null,
    marketed_by: null,
    product_of: null,
    raw_snippet: null
  };

  // First, normalize the entire text block to handle inconsistencies
  const normalizedText = fullText
    .replace(/\u00a0/g, ' ')      // non-breaking spaces
    .replace(/[“”]/g, '"')      // smart quotes
    .replace(/[‘’]/g, "'")      // smart single quotes
    .replace(/[‐‑‒–—―]/g, '-')  // all dash types
    .replace(/(\r?\n)+/g, '\n') // collapse multiple newlines
    .replace(/\s{2,}/g, ' ')    // collapse multiple spaces
    .trim();

  // Define all possible prefixes that start a relevant data block.
  const prefixes = [
    'Manufactured by', 'Mfd. by', 'Mfr. by',
    'Manufactured for', 'Mfd. for', 'Mfr. for',
    'Distributed by', 'Marketed by', 'Packed by', 'Product of'
  ];

  // This single regex finds a prefix, captures the text after it,
  // and intelligently stops before the next prefix or the end of the text.
  const pattern = new RegExp(
    `\\b(${prefixes.join('|')})[:\\s]*([\\s\\S]+?)(?=\\b(?:${prefixes.join('|')})|$)`,
    'gi'
  );

  let match;
  while ((match = pattern.exec(normalizedText)) !== null) {
    const key = match[1].toLowerCase();
    // Clean up the captured value: remove trailing punctuation and trim whitespace
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
    
    // Set a raw snippet from the first relevant match found
    if (!info.raw_snippet) info.raw_snippet = match[0];
  }

  return info;
}

async function fetchAndParseLabelFromAPI(splSetId) {
  if (!splSetId) {
    return {
      final_manufacturer: null,
      final_manufactured_for: null,
      raw_snippet: null,
      raw_spl_data: labelData
    };
  }

  const labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${splSetId}"&order=effective_time:desc&limit=1`;

  try {
    const response = await axios.get(labelApiUrl);
    const labelData = response?.data?.results?.[0];

    if (!labelData) {
      return {
        final_manufacturer: 'N/A (Label Not Found in API)',
        final_manufactured_for: null,
        raw_snippet: null
      };
    }

    const TEXT_BEARING_SECTIONS = [
      'principal_display_panel',
      'package_label_principal_display_panel',
      'how_supplied',
      'how_supplied_table',
      'description',
      'spl_unclassified_section',
      'title',
      'information_for_patients',
      'instructions_for_use'
    ];

    const textCorpus = (() => {
      const seen = new Set();
      const chunks = [];

      const pushChunk = (val) => {
        if (!val) return;
        if (Array.isArray(val)) {
          val.flat(Infinity).forEach(pushChunk);
          return;
        }
        if (typeof val === 'string') {
          const s = val.replace(/\u0000/g, '').trim();
          if (s && !seen.has(s)) {
            seen.add(s);
            chunks.push(s);
          }
        }
      };

      for (const key of TEXT_BEARING_SECTIONS) {
        if (Object.prototype.hasOwnProperty.call(labelData, key)) {
          pushChunk(labelData[key]);
        }
      }

      for (const [k, v] of Object.entries(labelData)) {
        if (TEXT_BEARING_SECTIONS.includes(k)) continue;
        if (typeof v === 'string') pushChunk(v);
        else if (Array.isArray(v) && v.every(x => typeof x === 'string' || Array.isArray(x))) pushChunk(v);
      }

      return chunks.join('\n\n');
    })();

    const manufacturingInfo = parseManufacturingInfo(textCorpus);

    return {
      final_manufacturer: manufacturingInfo.manufactured_by || null,
      final_manufactured_for: manufacturingInfo.manufactured_for || null,
      raw_snippet: manufacturingInfo.raw_snippet || null
    };

  } catch (error) {
    console.error(`Error fetching label for SPL Set ID ${splSetId}:`, error?.message || error);
    return {
      final_manufacturer: `API Error: ${error?.message || String(error)}`,
      final_manufactured_for: null,
      raw_snippet: null
    };
  }
}


async function downloadData() {
  let rawLabelDataForExport = [];
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join('/tmp', 'data.json');
  
  try {
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Enriching via Label API...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      const splSetId = product.spl_set_id?.[0] || product.spl_set_id;
      const parsedInfo = await fetchAndParseLabelFromAPI(splSetId);

      if (parsedInfo.raw_spl_data) { // <-- ADD THIS IF BLOCK
        rawLabelDataForExport.push(parsedInfo.raw_spl_data);
      }
      
      return {
          product_ndc: product.product_ndc,
          labeler_name: product.labeler_name,
          brand_name: product.brand_name,
          generic_name: product.generic_name,
          marketing_start_date: product.marketing_start_date,
          marketing_end_date: product.marketing_end_date,
          manufacturer_name: parsedInfo.final_manufacturer || 'N/A (Not Found on Label)',
          manufactured_for: parsedInfo.final_manufactured_for || product.labeler_name,
          raw_manufacturing_snippet: parsedInfo.raw_snippet,
          source_spl_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splSetId}`
      };
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    // --- START: ADD THIS BLOCK TO SAVE THE DEBUG FILE ---
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

// --- Server Routes & Startup (No changes) ---
cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));
app.get("/data", (req, res) => {
  const dataPath = path.join('/tmp', 'data.json');
  res.sendFile(dataPath);
});
const PORT = process.env.PORT || 3001;
async function startServer() {
  console.log('--- Server starting up ---');
  await downloadData();
  app.listen(PORT, () => {
    console.log(`✅ Data is ready. Server is now live and listening on port ${PORT}`);
  });
}
startServer();