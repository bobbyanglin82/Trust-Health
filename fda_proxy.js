const express = require("express");
const puppeteer = require("puppeteer"); // Import Puppeteer
const app = express();
const PORT = 3001;

const fdaUrl = "https://download.open.fda.gov/drug/ndc/labeler/labeler.txt";

app.get("/fda", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  let browser = null; // Define browser outside the try block
  try {
    console.log("🚀 Launching browser to fetch FDA data...");
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Go to the URL. Puppeteer handles all the browser-level details.
    await page.goto(fdaUrl, { waitUntil: 'networkidle0' });

    // Extract the raw text content from the page
    const data = await page.evaluate(() => document.querySelector('body').innerText);
    
    console.log("✅ Successfully fetched data.");
    res.send(data);

  } catch (error) {
    console.error("❌ Error fetching FDA data with Puppeteer:", error.message);
    res.status(500).send("Failed to fetch FDA labeler data with Puppeteer.");
  } finally {
    // IMPORTANT: Always close the browser to free up resources
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`✅ FDA proxy running at http://localhost:${PORT}`);
});