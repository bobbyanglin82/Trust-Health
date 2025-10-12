const express = require('express');
const path = require('path');
const fs = require('fs').promises; // Using the promise-based version
const axios = require('axios');
const cron = require('node-cron');
const xlsx = require('xlsx');
const { TOP_50_DRUGS } = require('./drug_list.js');
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
    // No change needed here, already using await
    await fs.writeFile(outputPath, JSON.stringify(response.data, null, 2));
    console.log(`✅ Success! The raw API response has been saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Error during raw data export:', error.message);
  }
}
// --- END: Raw NDC Query Export Function ---

function parseManufacturingInfo(labelData) {
    const info = {
        manufactured_by: null,
        manufactured_by_country: null,
        manufactured_for: null,
        manufactured_for_country: null,
    };

    const searchSections = [
        'spl_unclassified_section', 'spl_medguide', 'information_for_patients',
        'spl_patient_package_insert', 'how_supplied', 'package_label_principal_display_panel'
    ];
    let textCorpus = '';
    const seen = new Set();
    for (const key of searchSections) {
        if (Object.prototype.hasOwnProperty.call(labelData, key) && labelData[key]) {
            const sectionText = Array.isArray(labelData[key]) ? labelData[key].join('\n') : String(labelData[key]);
            const cleanedText = sectionText.replace(/\u00a0/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (cleanedText && !seen.has(cleanedText)) {
                textCorpus += cleanedText + '\n\n';
            }
        }
    }
    if (!textCorpus) return info;

    const extractEntityInfo = (textBlock) => {
        if (!textBlock) return { name: null, country: null };

        const firstLine = textBlock.split('\n')[0].trim();
        let name = firstLine;
        let country = null;
        const upperText = firstLine.toUpperCase();

        // Layer 1: High-confidence check for USA patterns.
        if (/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}/.test(upperText) || upperText.includes('USA') || upperText.includes('U.S.A')) {
            country = 'USA';
        } else {
            // Layer 2: Check against common international countries.
            const commonCountries = ['INDIA', 'IRELAND', 'GERMANY', 'SWITZERLAND', 'JAPAN', 'CHINA', 'KOREA', 'ITALY', 'FRANCE', 'CANADA', 'SPAIN', 'CAYMAN ISLANDS'];
            for (const c of commonCountries) {
                if (upperText.includes(c)) {
                    country = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase().replace(/_/g, ' ');
                }
            }
        }
        
        // --- NEW & IMPROVED Name Cleaning Logic ---
        if (country) {
            const countryIndex = upperText.lastIndexOf(country.toUpperCase());
            // Take everything before the country name.
            name = firstLine.substring(0, countryIndex).trim();
        }
        
        // Remove trailing address details like ZIP codes that don't have commas.
        // This specifically targets patterns like "Bachupally - 500 090".
        name = name.replace(/\s+[\w\s]+\s*-\s*\d+.*$/, '').trim();
        
        // Final cleanup with the comma heuristic and punctuation.
        name = name.split(',')[0].trim();
        name = name.replace(/[.,;:]\s*$/, '').trim();

        return {
            name: name.length > 2 ? name : null,
            country: country
        };
    };
    
    const forPrefixes = ['Manufactured for', 'Mfd\\. for', 'Mfr\\. for'];
    const byPrefixes = ['Manufactured by', 'Mfd\\. by', 'Mfr\\. by', 'Distributed by', 'Marketed by', 'By'];
    const allPrefixes = [...forPrefixes, ...byPrefixes];
    
    const pattern = new RegExp(`\\b(${allPrefixes.join('|')})[:\\s]*([\\s\\S]+?)(?=\\b(?:${allPrefixes.join('|')})|\\n\\s*\\n|$)`, 'gi');
    const matches = [...textCorpus.matchAll(pattern)];

    for (const match of matches) {
        const keyRaw = match[1];
        const valueRaw = match[2];
        
        if (keyRaw.toLowerCase() === 'by' && !/by:/i.test(match[0]) && valueRaw.trim().split(' ').length > 5) {
            continue;
        }
        const entityInfo = extractEntityInfo(valueRaw);
        if (!entityInfo.name) continue;

        if (forPrefixes.some(p => new RegExp(p, 'i').test(keyRaw))) {
            if (!info.manufactured_for) {
                 info.manufactured_for = entityInfo.name;
                 info.manufactured_for_country = entityInfo.country;
            }
        } else {
            if (!info.manufactured_by) {
                info.manufactured_by = entityInfo.name;
                info.manufactured_by_country = entityInfo.country;
            }
        }
    }
    
    return info;
}

/**
 * ===================================================================================
 * ENGINE 3: OPENFDA DATA ENRICHMENT (DEFINITIVE & CORRECTED)
 * This version uses the correct search strategy for the OpenFDA NDC Directory API.
 * It searches by the searchable 'brand_name' field, then filters the results
 * to find the entry that matches our specific 'product_ndc'.
 * ===================================================================================
 */
async function fetchExpirationDateForDrug(drug) {
    // We need the drug object for both its name (for searching) and its NDC (for matching).
    if (!drug || !drug.drugName || !drug.ndc10) {
        return "N/A - Missing Drug Info";
    }

    try {
        // Step 1: Search by the brand_name, which is a valid searchable field.
        const searchName = drug.drugName.split(' ')[0]; // Use first word for broader match (e.g., "Keytruda" not "Keytruda QLEX")
        const url = `https://api.fda.gov/drug/ndc.json?search=brand_name:"${searchName}"&limit=100`;
        console.log(`Querying OpenFDA for Brand Name: ${searchName}`);
        
        const response = await axios.get(url);

        // Step 2: Filter the results to find our specific product.
        if (response.data.results && response.data.results.length > 0) {
            const ndcParts = drug.ndc10.split('-');
            const targetProductNdc = `${ndcParts[0]}-${ndcParts[1]}`;

            for (const result of response.data.results) {
                // If the product_ndc from the API result matches our target, we have the right drug.
                if (result.product_ndc === targetProductNdc) {
                    const expirationDate = result.listing_expiration_date;
                    const year = expirationDate.substring(0, 4);
                    const month = expirationDate.substring(4, 6);
                    const day = expirationDate.substring(6, 8);
                    
                    console.log(`SUCCESS: Found match for ${drug.drugName}`);
                    return `${year}-${month}-${day}`;
                }
            }
        }
        
        console.warn(`No exact product_ndc match found for ${drug.drugName} in the results.`);
        return "Date Not Found";

    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn(`No records found for Brand Name: ${drug.drugName}`);
            return "Date Not Found";
        }
        console.error(`Error fetching data for ${drug.drugName}:`, error.message);
        return "Error During Lookup";
    }
}


/**
 * ===================================================================================
 * ENGINE 4, PART 1: VA DATA FILE PROCESSOR (Corrected Columns & Logic)
 * Downloads and parses the VA's master .xlsx data file from the OPAL source.
 * This version uses the correct column indexes and combines the separate FSS and Big 4 rows.
 * ===================================================================================
 */
async function updateVaPriceCache() {
    console.log("Starting VA Price Cache Update from Excel file...");
    try {
        // 1. DOWNLOAD THE VA's MASTER PRICING FILE (.xlsx)
        const vaFileURL = 'https://www.va.gov/opal/docs/nac/fss/vaFssPharmPrices.xlsx';
        console.log(`Downloading VA master Excel file from: ${vaFileURL}`);
        
        const response = await axios({
            method: 'get',
            url: vaFileURL,
            responseType: 'arraybuffer'
        });

        // 2. PARSE THE EXCEL FILE AND AGGREGATE THE PRICE DATA
        console.log("Parsing and aggregating data from Excel file...");
        const workbook = xlsx.read(response.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        const priceMap = {};
        // Start loop at 1 to skip the header row
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            
            // CORRECTED COLUMN POSITIONS based on your screenshot
            const ndc11 = row[4];      // Column E is the 11-digit NDC
            const price = row[12];     // Column M is the Price
            const priceType = row[15]; // Column P is the Price Type ('FSS' or 'Big4')

            if (ndc11 && price && priceType) {
                const ndcString = String(ndc11).trim();

                // If we haven't seen this NDC before, initialize it.
                if (!priceMap[ndcString]) {
                    priceMap[ndcString] = {
                        fss_price: "N/A",
                        big4_price: "N/A"
                    };
                }

                // Populate the correct price based on the type.
                if (String(priceType).trim().toLowerCase() === 'fss') {
                    priceMap[ndcString].fss_price = price;
                } else if (String(priceType).trim().toLowerCase() === 'big4') {
                    priceMap[ndcString].big4_price = price;
                }
            }
        }
        console.log(`VA Excel file parsed. Found prices for ${Object.keys(priceMap).length} NDCs.`);

        // 3. LOOK UP OUR 50 DRUGS AND CREATE THE FINAL CACHE OBJECT
        const vaPriceCache = {};
        for (const drug of TOP_50_DRUGS) {
            if (drug.ndc11 && priceMap[drug.ndc11]) {
                vaPriceCache[drug.ndc11] = priceMap[drug.ndc11];
            } else if (drug.ndc11) {
                vaPriceCache[drug.ndc11] = { fss_price: "Not Found in VA File", big4_price: "Not Found in VA File" };
            }
        }

        // 4. SAVE THE CACHE TO A LOCAL FILE
        const cacheFilePath = './va_price_cache.json';
        await fs.writeFile(cacheFilePath, JSON.stringify(vaPriceCache, null, 2));
        console.log(`VA price cache successfully written to ${cacheFilePath}`);
        
        return { success: true, message: `Cache written to ${cacheFilePath}`, data: vaPriceCache };

    } catch (error) {
        console.error("Error updating VA price cache:", error.message);
        return { success: false, message: error.message };
    }
}

/**
 * ===================================================================================
 * ENGINE 4, PART 2: MASTER DATA BUILDER
 * Orchestrates the full data-gathering process. It calls the VA cache builder,
 * fetches live FDA data, and combines everything into a single master data file.
 * ===================================================================================
 */
async function buildDrugDataCache() {
    console.log("Starting master data cache build...");
    try {
        // 1. First, ensure the VA price cache is up-to-date by running the function from Step 1.
        const vaCacheResult = await updateVaPriceCache();
        if (!vaCacheResult.success) {
            throw new Error("Failed to update VA price cache. Aborting master build.");
        }

        // 2. Read the newly created VA price cache from disk.
        const vaPriceData = vaCacheResult.data;

        // 3. Loop through the master drug list and enrich each entry.
        const finalDrugData = [];
        console.log("Enriching drug list with VA prices and live FDA data...");
        for (const drug of TOP_50_DRUGS) {
            // Get VA prices from our local cache
            const vaPrices = vaPriceData[drug.ndc11] || { fss_price: "N/A", big4_price: "N/A" };
            
            // Get expiration date from a live API call to OpenFDA
            const expirationDate = await fetchExpirationDateForDrug(drug);

            // Combine all data points into a single object
            finalDrugData.push({
                ...drug, // This includes rank, drugName, form, strength, ndc11, etc.
                listing_expiration_date: expirationDate,
                fss_price: vaPrices.fss_price,
                big4_price: vaPrices.big4_price,
            });

            // Optional: small delay between live FDA API calls
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 4. Save the final, combined data to the master cache file.
        const finalCachePath = path.join(__dirname, 'public', 'drug_data_cache.json');
        await fs.writeFile(finalCachePath, JSON.stringify(finalDrugData, null, 2));
        console.log(`Master drug data cache successfully written to ${finalCachePath}`);

        return { success: true, message: `Master cache written to ${finalCachePath}`, recordCount: finalDrugData.length };

    } catch (error) {
        console.error("Error building master drug data cache:", error.message);
        return { success: false, message: error.message };
    }
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
      await fs.writeFile(outputPath, '[]');
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

    await fs.writeFile(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
    // Create an empty file on error so the site doesn't break
    await fs.writeFile(outputPath, '[]');
  }
}

// --- Server Routes & Startup ---
cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));
app.get('/dtc.html', (req, res) => res.sendFile(path.join(__dirname, 'dtc.html')));
app.get('/tariff.html', (req, res) => res.sendFile(path.join(__dirname, 'tariff.html')));

// *** FIX APPLIED HERE: Converted route handler to async and replaced fs.existsSync ***
app.get("/data", async (req, res) => {
  const dataPath = path.join('/tmp', 'data.json');
  try {
    await fs.access(dataPath); // Check if the file exists and is accessible
    res.sendFile(dataPath);
  } catch {
    res.status(404).send("Data file not found. It may still be generating.");
  }
});

// *** FIX APPLIED HERE: Converted route handler to async and replaced fs.existsSync ***
app.get("/debug-file", async (req, res) => {
  const filePath = path.join(__dirname, 'debug_raw_spl_data.json');
  try {
    await fs.access(filePath); // Check if the file exists and is accessible
    res.download(filePath);
  } catch {
    res.status(404).send("Debug file not found. The downloadData script may not have completed successfully or created the file yet.");
  }
});

/**
 * ===================================================================================
 * FINAL PUBLIC ENDPOINT
 * Reads and serves the pre-built data cache for the FairRX table.
 * ===================================================================================
 */
app.get('/api/get-table-data', async (req, res) => {
    const cacheFilePath = path.join(__dirname, 'public', 'drug_data_cache.json');
    try {
        const data = await fs.readFile(cacheFilePath, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } catch (error) {
        console.error("Error reading data cache:", error);
        res.status(500).json({ error: "Data cache not available. Please run the data refresh process." });
    }
});

/**
 * ===================================================================================
 * FINAL TRIGGER ENDPOINT
 * Runs the master data builder to refresh the cache.
 * ===================================================================================
 */
app.get('/api/refresh-data-cache', async (req, res) => {
    console.log("Data cache refresh triggered via API endpoint.");
    buildDrugDataCache(); // Run in background
    res.status(202).json({ message: "Accepted. The data cache build process has started." });
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