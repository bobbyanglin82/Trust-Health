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

// This function now queries the official openFDA NDC Directory API
async function downloadData() {
  console.log('🔍 Querying the openFDA API for new data...');
  
  // The search query now uses "labeler_name"
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  
  // The API endpoint is now drug/ndc.json
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');

  try {
    const response = await axios.get(apiUrl);
    const data = response.data;

    fs.writeFileSync(outputPath, JSON.stringify(data.results, null, 2));
    console.log(`✅ Successfully fetched and saved ${data.results.length} records.`);

  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('✅ No records found for the specified entities. This is normal.');
      fs.writeFileSync(outputPath, '[]');
    } else {
      console.error('❌ Error fetching data from openFDA API:', error.message);
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