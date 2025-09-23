const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // <-- ADDED
const cron = require('node-cron'); // <-- ADDED

const app = express();

// --- NEW DOWNLOADER FUNCTION (from downloader.js) ---
async function downloadData() {
  const fdaUrl = 'https://download.open.fda.gov/drug/ndc/labeler/labeler.txt';
  const outputPath = path.join(__dirname, 'labeler.txt');

  console.log('🚚 Starting scheduled download of FDA data...');
  try {
    const response = await axios({
      method: 'get',
      url: fdaUrl,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ FDA data successfully downloaded to labeler.txt');
        resolve();
      });
      writer.on('error', reject);
    });

  } catch (error) {
    console.error('❌ Error downloading FDA data:', error.message);
  }
}

// --- NEW SCHEDULER ---
// This will run the downloadData function every day at 2 AM Central Time.
cron.schedule('0 8 * * *', () => {
  downloadData();
}, {
  timezone: "UTC"
});


// --- Existing code to serve your website ---
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ndc.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'ndc.html'));
});

app.get("/data", (req, res) => {
  const dataPath = path.join(__dirname, 'labeler.txt');
  fs.readFile(dataPath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading the data file:", err);
      return res.status(500).send("Data file not found or is currently being downloaded.");
    }
    res.type('text/plain').send(data);
  });
});

// --- Code to start the server ---
const PORT = process.env.PORT || 3001; 
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  // Run the download once immediately on startup
  console.log('Running initial data download on server start...');
  downloadData();
});