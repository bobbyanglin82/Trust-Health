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

// This function enriches data using the most robust 3-tier fallback logic
async function downloadData() {
  console.log('🔍 Stage 1: Querying the openFDA API for new NDC data...');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');

  try {
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found for the specified entities. This is normal.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} initial records. Starting Stage 2: Data Enrichment...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      product.manufacturer_name = 'N/A';
      product.manufactured_for = 'N/A';

      // --- NEW: 3-Tier Fallback Logic ---
      let labelApiUrl = '';
      const setId = product.spl_set_id;
      const prodId = product.product_id;
      const appNumber = product.application_number;

      // Tier 1: Use spl_set_id if it exists (most reliable)
      if (setId) {
        labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${setId}"&limit=1`;
      } 
      // Tier 2: Parse the ProductID to get the specific SPL Document ID
      else if (prodId && prodId.includes('_')) {
        const splDocId = prodId.split('_')[1];
        if (splDocId) {
            console.log(`- No SPL_SET_ID for ${product.product_ndc}. Using parsed ProductID: ${splDocId}`);
            // The document ID is searchable via the 'id' field in the label API
            labelApiUrl = `https://api.fda.gov/drug/label.json?search=id:"${splDocId}"&limit=1`;
        }
      }
      // Tier 3: Use the application_number as the final fallback
      else if (appNumber) {
        console.log(`- No SPL info for NDC ${product.product_ndc}. Falling back to Application #: ${appNumber}`);
        labelApiUrl = `https://api.fda.gov/drug/label.json?search=openfda.application_number:"${appNumber}"&limit=1`;
      } 
      
      // If no lookup URL was created, we cannot search
      if (!labelApiUrl) {
        product.manufacturer_name = 'N/A (No ID)';
        return product;
      }
      
      try {
        const labelResponse = await axios.get(labelApiUrl);
        if (labelResponse.data.results && labelResponse.data.results.length > 0) {
            const manufacturer = labelResponse.data.results[0]?.openfda?.manufacturer_name?.[0];
            product.manufacturer_name = manufacturer || 'N/A (Not Found in SPL)';
        } else {
            product.manufacturer_name = 'N/A (No SPL Match)';
        }
      } catch (e) {
        if (e.response && e.response.status === 404) {
            product.manufacturer_name = 'N/A (No SPL Match)';
        } else {
            console.warn(`⚠️ API error fetching SPL data for NDC ${product.product_ndc}.`);
            product.manufacturer_name = 'N/A (API Error)';
        }
      }
      return product;
    });

    const enrichedResults = await Promise.all(enrichmentPromises);

    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ Successfully fetched and enriched ${enrichedResults.length} records.`);

  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ No records found for the specified entities during initial fetch.');
      fs.writeFileSync(outputPath, '[]');
    } else {
      console.error('❌ An error occurred during the data download process:', error.message);
    }
  }
}


cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });

// --- Server Routes ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));

app.get("/data", (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
  res.sendFile(dataPath);
});

// --- Server Start ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  downloadData(); // Run once on startup
});