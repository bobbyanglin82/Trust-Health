const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const puppeteer = require('puppeteer');

const app = express();

const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

// New helper function to scrape the true manufacturer from DailyMed
async function scrapeManufacturer(splSetId, browser) {
  if (!splSetId) return null;
  
  const dailyMedUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splSetId}`;
  let page;
  try {
    page = await browser.newPage();
    await page.goto(dailyMedUrl, { waitUntil: 'networkidle2' });

    // This function runs in the browser context to find the manufacturer text
    const manufacturerText = await page.evaluate(() => {
      // Find all text nodes on the page
      const allTextNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let currentNode;
      while (currentNode = allTextNodes.nextNode()) {
        const text = currentNode.nodeValue.trim();
        // Check if the text contains "Manufactured by:"
        if (text.toLowerCase().startsWith('manufactured by:')) {
          // Return the text, removing the "Manufactured by:" part
          return text.substring(16).trim();
        }
      }
      return null;
    });
    
    return manufacturerText;
  } catch (error) {
    console.error(`Error scraping ${dailyMedUrl}:`, error.message);
    return null;
  } finally {
    if (page) await page.close();
  }
}


async function downloadData() {
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  console.log('🔍 Stage 1: Querying the openFDA API for initial data...');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found. Creating empty data file.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Stage 2: Enriching with scraped data...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      const splSetId = product.spl_set_id?.[0] || product.spl_set_id;

      const scrapedManufacturer = await scrapeManufacturer(splSetId, browser);

      product.manufacturer_name = scrapedManufacturer || product.labeler_name; // Fallback to labeler if scrape fails
      product.manufactured_for = product.labeler_name;

      return product;
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
  } finally {
    await browser.close();
  }
}

// --- Server Routes & Startup ---
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
  console.log('Executing initial data download. This may take several minutes due to web scraping.');
  
  await downloadData();
  
  app.listen(PORT, () => {
    console.log(`✅ Data is ready. Server is now live and listening on port ${PORT}`);
  });
}

startServer();