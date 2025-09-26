const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
// REMOVED: puppeteer and chromium dependencies are no longer needed.

const app = express();

const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

// UNCHANGED: This parsing function is robust and works on any block of text.
function parseManufacturingInfo(fullText) {
    const info = {
        manufactured_by: null,
        manufactured_for: null,
        distributed_by: null,
        raw_snippet: null
    };
    const patterns = {
        manufactured_by: /Manufactured by[:\s](.*)/i,
        manufactured_for: /Manufactured for[:\s](.*)/i,
        distributed_by: /Distributed by[:\s](.*)/i
    };
    let longestSnippet = '';
    const textLines = fullText.split('\n');
    textLines.forEach(line => {
        for (const key in patterns) {
            const match = line.match(patterns[key]);
            if (match && match[1]) {
                const capturedText = match[1].trim();
                if (!info[key]) info[key] = capturedText;
                if (line.trim().length > longestSnippet.length) {
                    longestSnippet = line.trim();
                }
            }
        }
    });
    info.raw_snippet = longestSnippet || null;
    if (!info.manufactured_for && info.distributed_by) {
        info.manufactured_for = info.distributed_by;
    }
    return info;
}

/**
 * NEW FUNCTION: Fetches label data from the /drug/label API and prepares it for parsing.
 */
async function fetchAndParseLabelFromAPI(splSetId) {
  if (!splSetId) {
    return { final_manufacturer: null, final_manufactured_for: null, raw_snippet: null };
  }
  
  const labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${splSetId}"&limit=1`;
  
  try {
    const response = await axios.get(labelApiUrl);
    const labelData = response.data.results?.[0];

    if (!labelData) {
      return { final_manufacturer: 'N/A (Label Not Found in API)', final_manufactured_for: null, raw_snippet: null };
    }

    // Combine relevant text sections into a single corpus for parsing.
    // This replicates getting the "ground truth" text block.
    const textCorpus = [
      labelData.description_text?.join('\n') || '',
      labelData.indications_and_usage_text?.join('\n') || '',
      labelData.how_supplied_section_text?.join('\n') || '',
      labelData.spl_product_data_elements_text?.join('\n') || '',
      labelData.principal_display_panel_text?.join('\n') || ''
    ].join('\n\n');

    const manufacturingInfo = parseManufacturingInfo(textCorpus);

    return {
      final_manufacturer: manufacturingInfo.manufactured_by,
      final_manufactured_for: manufacturingInfo.manufactured_for,
      raw_snippet: manufacturingInfo.raw_snippet
    };
  } catch (error) {
    console.error(`Error fetching label for SPL Set ID ${splSetId}:`, error.message);
    return { final_manufacturer: `API Error: ${error.message}`, final_manufactured_for: null, raw_snippet: null };
  }
}

/**
 * REWRITTEN FUNCTION: The main data processing function, now using the dual-API approach.
 */
async function downloadData() {
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');
  
  try {
    // Step 1: Get the initial list of products
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Enriching via Label API...`);

    // Step 2: Enrich each product by calling the /drug/label API
    const enrichmentPromises = initialResults.map(async (product) => {
      const splSetId = product.spl_set_id?.[0] || product.spl_set_id;

      // This new function replaces the entire puppeteer/scraping workflow
      const parsedInfo = await fetchAndParseLabelFromAPI(splSetId);

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
          // We can still link to DailyMed for auditing, even if we don't scrape it
          source_spl_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splSetId}`
      };
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
  }
  // REMOVED: The browser.close() in the 'finally' block is no longer needed.
}

// --- Server Routes & Startup (No changes needed) ---
cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));
app.get("/data", (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
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