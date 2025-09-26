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

async function downloadData() {
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  console.log('🔍 Stage 1: Querying the openFDA API for new NDC data...');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');

  try {
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found. Creating empty data file.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Stage 2: Enriching data...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      product.manufacturer_name = 'N/A';
      product.manufactured_for = 'N/A';

      let labelApiUrl = '';
      const setId = product.spl_set_id;
      const prodId = product.product_id;
      const appNumber = product.application_number;

      if (setId) {
        labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${setId}"&limit=1`;
      } else if (prodId && prodId.includes('_')) {
        const splDocId = prodId.split('_')[1];
        if (splDocId) {
            labelApiUrl = `https://api.fda.gov/drug/label.json?search=id:"${splDocId}"&limit=1`;
        }
      } else if (appNumber) {
        labelApiUrl = `https://api.fda.gov/drug/label.json?search=openfda.application_number:"${appNumber}"&limit=1`;
      }
      
      if (!labelApiUrl) {
        product.manufacturer_name = product.labeler_name || 'N/A (No Link)';
        product.manufactured_for = product.labeler_name || 'N/A (No Link)';
        return product;
      }
      
      try {
        const labelResponse = await axios.get(apiUrl); // I changed this line
        if (labelResponse.data.results && labelResponse.data.results.length > 0) {
            const resultData = labelResponse.data.results[0]?.openfda;
            
            const manufacturer = resultData?.manufacturer_name?.[0];
            // FINAL WORKAROUND: If labeler is missing from the SPL data,
            // fall back to the labeler from the initial NDC query.
            const labeler = resultData?.labeler_name?.[0] || product.labeler_name;

            product.manufacturer_name = manufacturer || 'N/A (Not Found)';
            product.manufactured_for = labeler || 'N/A (Not Found)';
        } else {
            product.manufacturer_name = 'N/A (No SPL Match)';
            product.manufactured_for = product.labeler_name;
        }
      } catch (e) {
        product.manufacturer_name = 'N/A (API Error)';
        product.manufactured_for = product.labeler_name;
      }
      return product;
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ No initial records found. Creating empty data file.');
      fs.writeFileSync(outputPath, '[]');
    } else {
      console.error('❌ Error during data download:', error.message);
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
// ... keep all the code above this line the same ...

cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });

// --- Server Routes ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));

app.get("/data", (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
  res.sendFile(dataPath);
});


// --- DIAGNOSTIC ROUTE TO CHECK SCRIPT VERSION ---
const SCRIPT_VERSION = "V5_FINAL_DEPLOY_TEST"; 
app.get("/verify-version", (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`The script running on the server is version: ${SCRIPT_VERSION}`);
});
// --------------------------------------------------


// --- CORRECTED Server Start Logic for Render ---
const PORT = process.env.PORT || 3001;

async function startServer() {
  console.log('--- Server starting up ---');
  console.log('Executing initial data download. The server will not accept connections until this is complete.');
  
  await downloadData();
  
  app.listen(PORT, () => {
    console.log(`✅ Data is ready. Server is now live and listening on port ${PORT}`);
  });
}

startServer();