const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();

const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

/**
 * NEW HELPER FUNCTION (Implements Pipeline Step 4)
 * Parses raw label text to find "Manufactured by/for" statements.
 */
function parseManufacturingInfo(fullText) {
    const info = {
        manufactured_by: null,
        manufactured_for: null,
        distributed_by: null,
        raw_snippet: null
    };

    // Regex to find variants of manufacturing/distribution statements and capture the following text
    const patterns = {
        manufactured_by: /Manufactured by:([\s\S]*?)(?=\n\n|Manufactured for:|Distributed by:|$)/i,
        manufactured_for: /Manufactured for:([\s\S]*?)(?=\n\n|Manufactured by:|Distributed by:|$)/i,
        distributed_by: /Distributed by:([\s\S]*?)(?=\n\n|Manufactured by:|Manufactured for:|$)/i
    };

    let longestSnippet = '';

    for (const key in patterns) {
        const match = fullText.match(patterns[key]);
        if (match && match[0]) {
            // Store the full line as the raw snippet
            if (match[0].length > longestSnippet.length) {
                longestSnippet = match[0].trim();
            }
            // Store the captured company name/address
            info[key] = match[1].trim().replace(/\s+/g, ' ');
        }
    }
    
    info.raw_snippet = longestSnippet || null;

    // Logic to consolidate distributor/for fields
    if (!info.manufactured_for && info.distributed_by) {
        info.manufactured_for = info.distributed_by;
    }

    return info;
}


/**
 * UPDATED SCRAPING FUNCTION (Implements Pipeline Steps 3 & 4)
 * Scrapes the entire label text and then passes it to the parser.
 */
async function scrapeAndParseLabel(splSetId, browser) {
  if (!splSetId) return { final_manufacturer: null, final_manufactured_for: null };
  
  const dailyMedUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splSetId}`;
  let page;
  try {
    page = await browser.newPage();
    await page.goto(dailyMedUrl, { waitUntil: 'networkidle2' });

    // Step 3: Pull the full SPL text from the body
    const labelText = await page.evaluate(() => document.body.innerText);
    
    // Step 4: Parse the text to find the structured info
    const manufacturingInfo = parseManufacturingInfo(labelText);
    
    // Return the parsed data
    return {
        final_manufacturer: manufacturingInfo.manufactured_by,
        final_manufactured_for: manufacturingInfo.manufactured_for || manufacturingInfo.distributed_by,
        raw_snippet: manufacturingInfo.raw_snippet,
        source_url: dailyMedUrl
    };

  } catch (error) {
    console.error(`Error scraping ${dailyMedUrl}:`, error.message);
    return { final_manufacturer: `Scrape Error: ${error.message}`, final_manufactured_for: null, raw_snippet: null, source_url: dailyMedUrl };
  } finally {
    if (page) await page.close();
  }
}


async function downloadData() {
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  
  // Step 1: Normalize the NDC (handled implicitly by using the API)
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Enriching...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      // Step 2: Find the SPL record tied to that NDC
      const splSetId = product.spl_set_id?.[0] || product.spl_set_id;

      // Steps 3 & 4 are now inside this function call
      const parsedInfo = await scrapeAndParseLabel(splSetId, browser);

      // Step 5: Map back to the NDC and persist
      return {
          product_ndc: product.product_ndc,
          labeler_name: product.labeler_name,
          brand_name: product.brand_name,
          generic_name: product.generic_name,
          marketing_start_date: product.marketing_start_date,
          marketing_end_date: product.marketing_end_date,
          manufacturer_name: parsedInfo.final_manufacturer || 'N/A (Not Found on Label)',
          manufactured_for: parsedInfo.final_manufactured_for || product.labeler_name,
          // New fields for auditing and quality control
          raw_manufacturing_snippet: parsedInfo.raw_snippet,
          source_spl_url: parsedInfo.source_url
      };
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
  } finally {
    if (browser) await browser.close();
  }
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