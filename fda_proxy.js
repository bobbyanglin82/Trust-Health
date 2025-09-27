const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

const app = express();

// A comprehensive list of all known text-bearing sections in the drug/label API
const TEXT_BEARING_SECTIONS = [
  'principal_display_panel',
  'package_label_principal_display_panel',
  'how_supplied',
  'how_supplied_table',
  'description',
  'spl_unclassified_section',
  'title' // sometimes has “Marketed by …”
];


const knownEntities = [
  "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", 
  "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
];

function parseManufacturingInfo(fullText) {
  const info = {
    manufactured_by: null,
    manufactured_for: null,
    distributed_by: null,
    marketed_by: null,
    product_of: null,
    raw_snippet: null
  };

  const patterns = {
    manufactured_by: /\b(?:Manufactured|Mfd\.?|Mfr\.)\s+by[:\s]*([\s\S]{1,200}?)\s*(?=[;.\n]|$)/i,
    manufactured_for: /\b(?:Manufactured|Mfd\.?|Mfr\.)\s+for[:\s]*([\s\S]{1,200}?)\s*(?=[;.\n]|$)/i,
    distributed_by: /\bDistributed\s+by[:\s]*([\s\S]{1,200}?)\s*(?=[;.\n]|$)/i,
    marketed_by: /\bMarketed\s+by[:\s]*([\s\S]{1,200}?)\s*(?=[;.\n]|$)/i,
    product_of: /\bProduct\s+of[:\s]*([\s\S]{1,200}?)\s*(?=[;.\n]|$)/i
  };

  // Normalize special characters (smart quotes, em dashes, non-breaking spaces)
  const normalizeUnicode = (s) =>
    s.replace(/\u00a0/g, ' ')
     .replace(/[“”]/g, '"')
     .replace(/[‘’]/g, "'")
     .replace(/[‐‑‒–—―]/g, '-')
     .replace(/\s{2,}/g, ' ')
     .trim();

  const textLines = fullText
    .split(/\r?\n/)
    .map(s => normalizeUnicode(s));

  function startsNewBlock(s) {
    return /^(Manufactured|Mfd\.?|Mfr\.|Distributed|Marketed|Product)\s+(by|for)\b/i.test(s);
  }

  function captureWithFollowing(lines, idx, initial) {
    const out = [initial];
    for (let i = idx + 1; i < Math.min(lines.length, idx + 4); i++) {
      const s = lines[i].trim();
      if (!s) break;
      if (startsNewBlock(s)) break;
      out.push(s);
    }
    return out.join(' ');
  }

  function cleanOrg(s) {
    return s.replace(/\s*(,|;|\.)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  }

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    if (!line) continue;

    for (const [key, rx] of Object.entries(patterns)) {
      if (info[key]) continue;
      const m = line.match(rx);
      if (m) {
        const captured = captureWithFollowing(textLines, i, m[1].trim());
        info[key] = cleanOrg(captured);
        if (!info.raw_snippet) info.raw_snippet = line;
      }
    }
  }

  return info;
}

async function fetchAndParseLabelFromAPI(splSetId) {
  if (!splSetId) {
    return { final_manufacturer: null, final_manufactured_for: null, raw_snippet: null };
  }

  // Ask openFDA for the newest effective label and only the fields we care about
  const fields = [
    'id', 'set_id', 'effective_time',
    'openfda.product_ndc', 'openfda.package_ndc',
    'title',
    'principal_display_panel', 'package_label_principal_display_panel',
    'how_supplied', 'how_supplied_table',
    'description', 'spl_unclassified_section'
  ].join(',');

  const labelApiUrl =
    `https://api.fda.gov/drug/label.json?search=spl_set_id:"${splSetId}"&order=effective_time:desc&limit=1`;

  try {
    const response = await axios.get(labelApiUrl);
    const labelData = response?.data?.results?.[0];

    if (!labelData) {
      return {
        final_manufacturer: 'N/A (Label Not Found in API)',
        final_manufactured_for: null,
        raw_snippet: null
      };
    }

    // Preferred openFDA text-bearing sections
    const TEXT_BEARING_SECTIONS = [
      'principal_display_panel',
      'package_label_principal_display_panel',
      'how_supplied',
      'how_supplied_table',
      'description',
      'spl_unclassified_section',
      'title',
      'information_for_patients',
      'instructions_for_use'
    ];

    // Build a robust text corpus (dedup, flatten, include odd sponsor mappings)
    const textCorpus = (() => {
      const seen = new Set();
      const chunks = [];

      const pushChunk = (val) => {
        if (!val) return;
        if (Array.isArray(val)) {
          val.flat(Infinity).forEach(pushChunk);
          return;
        }
        if (typeof val === 'string') {
          const s = val.replace(/\u0000/g, '').trim();
          if (s && !seen.has(s)) {
            seen.add(s);
            chunks.push(s);
          }
        }
      };

      // 1) High-yield sections first
      for (const key of TEXT_BEARING_SECTIONS) {
        if (Object.prototype.hasOwnProperty.call(labelData, key)) {
          pushChunk(labelData[key]);
        }
      }

      // 2) Catch-all sweep for any other string-ish fields (rare sponsor mappings)
      for (const [k, v] of Object.entries(labelData)) {
        if (TEXT_BEARING_SECTIONS.includes(k)) continue;
        if (typeof v === 'string') pushChunk(v);
        else if (Array.isArray(v) && v.every(x => typeof x === 'string' || Array.isArray(x))) pushChunk(v);
      }

      return chunks.join('\n\n');
    })();

    const manufacturingInfo = parseManufacturingInfo(textCorpus);

    return {
      final_manufacturer: manufacturingInfo.manufactured_by || null,
      // Do not silently substitute distributed_by/marketed_by — surface null if absent
      final_manufactured_for: manufacturingInfo.manufactured_for || null,
      raw_snippet: manufacturingInfo.raw_snippet || null
    };
  } catch (error) {
    console.error(`Error fetching label for SPL Set ID ${splSetId}:`, error?.message || error);
    return {
      final_manufacturer: `API Error: ${error?.message || String(error)}`,
      final_manufactured_for: null,
      raw_snippet: null
    };
  }
}

async function downloadData() {
  console.log('--- Starting data download at', new Date().toLocaleTimeString(), '---');
  
  const searchQuery = knownEntities.map(entity => `labeler_name:"${entity}"`).join('+OR+');
  const apiUrl = `https://api.fda.gov/drug/ndc.json?search=${searchQuery}&limit=1000`;
  const outputPath = path.join(__dirname, 'data.json');
  
  try {
    const initialResponse = await axios.get(apiUrl);
    const initialResults = initialResponse.data.results;

    if (!initialResults || initialResults.length === 0) {
      console.log('✅ No records found.');
      fs.writeFileSync(outputPath, '[]');
      return;
    }
    
    console.log(`👍 Found ${initialResults.length} records. Enriching via Label API...`);

    const enrichmentPromises = initialResults.map(async (product) => {
      const splSetId = product.spl_set_id?.[0] || product.spl_set_id;
      const parsedInfo = await fetchAndParseLabelFromAPI(splSetId);

      return {
          product_ndc: product.product_ndc,
          labeler_name: product.labeler_name,
          brand_name: product.brand_name,
          generic_name: product.generic_name,
          marketing_start_date: product.marketing_start_date,
          marketing_end_date: product.marketing_end_date,
          manufacturer_name: parsedInfo.final_manufacturer || 'N/A (Not Found on Label)',
          manufactured_for: parsedInfo.final_manufactured_for || product.labeler_name,
          raw_manufacturing_snippet: parsedInfo.raw_snippet,
          source_spl_url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${splSetId}`
      };
    });

    const enrichedResults = await Promise.all(enrichmentPromises);
    fs.writeFileSync(outputPath, JSON.stringify(enrichedResults, null, 2));
    console.log(`✅ File write to data.json complete.`);

  } catch (error) {
    console.error('❌ Error during data download:', error.message);
  }
}

// --- Server Routes & Startup (No changes) ---
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