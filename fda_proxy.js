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

// This function now queries the openFDA API and enriches the data with SPL info
async function downloadData() {
  console.log('🔍 Stage 1: Querying the openFDA API for new NDC data...');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');

  try {
    // === STAGE 1: Fetch initial list of drug products ===
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found for the specified entities. This is normal.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} initial records. Starting Stage 2: Data Enrichment...`);

    // === STAGE 2: Fetch SPL data for each product in parallel ===
    const enrichmentPromises = initialResults.map(async (product) => {
      // Set default values
      product.manufacturer_name = 'N/A';
      product.manufactured_for = 'N/A'; // Default for manufactured_for

      const setId = product.spl_set_id;
      if (!setId) {
        product.manufacturer_name = 'N/A (No SPL ID)';
        return product;
      }
      
      const labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${setId}"&limit=1`;

      try {
        const labelResponse = await axios.get(labelApiUrl);
        const manufacturer = labelResponse.data.results?.[0]?.openfda?.manufacturer_name?.[0];
        
        // Assign the found manufacturer name, or a specific "Not Found" message
        product.manufacturer_name = manufacturer || 'N/A (Not Found in SPL)';

      } catch (e) {
        console.warn(`⚠️ Could not fetch SPL data for NDC ${product.product_ndc}.`);
        product.manufacturer_name = 'N/A (API Error)';
      }
      return product;
    });

    // Wait for all the enrichment API calls to complete
    const enrichedResults = await Promise.all(enrichmentPromises);

    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ Successfully fetched and enriched ${enrichedResults.length} records.`);

  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ No records found for the specified entities during initial fetch. This is normal.');
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