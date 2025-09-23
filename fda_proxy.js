const express = require('express');
const path = require('path');
const fs = require('fs'); // <-- NEW: To read files
const app = express();

// --- Code to serve your website ---
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ndc.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'ndc.html'));
});

// --- NEW code to serve the downloaded data ---
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
});