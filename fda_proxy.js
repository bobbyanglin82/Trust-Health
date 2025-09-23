const express = require("express");
const puppeteer = require("puppeteer");
const path = require('path'); // <-- NEW: Needed for file paths
const app = express();

// --- NEW CODE TO SERVE YOUR WEBSITE ---
// This tells Express to serve static files from your main project folder
app.use(express.static(path.join(__dirname)));

// This tells Express to send the index.html file for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// This tells Express what to do for the ndc.html page
app.get('/ndc.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'ndc.html'));
});
// --- END OF NEW CODE ---


// --- YOUR EXISTING FDA PROXY CODE ---
const fdaUrl = "https://download.open.fda.gov/drug/ndc/labeler/labeler.txt";

app.get("/fda", async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  let browser = null;
  try {
    console.log("🚀 Launching browser to fetch FDA data...");
    // Add arguments for Render's environment
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    const page = await browser.newPage();
    
    await page.goto(fdaUrl, { waitUntil: 'networkidle0' });
    const data = await page.evaluate(() => document.querySelector('body').innerText);
    
    console.log("✅ Successfully fetched data.");
    res.send(data);

  } catch (error) {
    console.error("❌ Error fetching FDA data with Puppeteer:", error.message);
    res.status(500).send("Failed to fetch FDA labeler data with Puppeteer.");
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});


// --- MODIFIED CODE TO START THE SERVER ---
// This uses the port Render provides, which is required.
const PORT = process.env.PORT || 3001; 
app.listen(PORT, () => {
  console.log(`✅ FDA proxy running on port ${PORT}`);
});