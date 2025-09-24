const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

const app = express();

const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", "ASCENT PHARMACEUTICALS",
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

// This function now queries the official openFDA API
async function downloadData() {
  console.log('🔍 Querying the openFDA API for new data...');
  
  // Create the search query string from your entities list
  const searchQuery = knownEntities.map(entity => `openfda.manufacturer_name:"${entity}"`).join('+OR+');
  // We'll query for the last 100 updated records matching your entities.
  const apiUrl = `https://api.fda.gov/drug/label.json?search=${searchQuery}&sort=effective_time:desc&limit=100`;
  const outputPath = path.join(__dirname, 'data.json');

  try {
    const response = await axios.get(apiUrl);
    const data = response.data;

    // Save the clean JSON results to a file
    fs.writeFileSync(outputPath, JSON.stringify(data.results, null, 2));
    console.log(`✅ Successfully fetched and saved ${data.results.length} records.`);

  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ No records found for the specified entities. This is normal.');
      // Create an empty file so the frontend doesn't break
      fs.writeFileSync(outputPath, '[]');
    } else {
      console.error('❌ Error fetching data from openFDA API:', error.message);
    }
  }
}

// Scheduler remains the same
cron.schedule('0 8 * * *', () => downloadData(), { timezone: "UTC" });

// --- Server Routes ---
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ndc.html', (req, res) => res.sendFile(path.join(__dirname, 'ndc.html')));

// This endpoint now serves clean JSON
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