const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

const app = express();

// A comprehensive list of all known text-bearing sections in the drug/label API
const TEXT_BEARING_SECTIONS = [
    'abuse_and_overdosage_text',
    'accessories_text',
    'active_ingredient_text',
    'adverse_reactions_text',
    'alarms_text',
    'animal_pharmacology_and_or_toxicology_text',
    'assembly_or_installation_instructions_text',
    'boxed_warning_text',
    'calibration_instructions_text',
    'cleaning_and_sterilization_text',
    'clinical_pharmacology_text',
    'clinical_studies_text',
    'compatible_accessories_text',
    'complaint_file_text',
    'contraindications_text',
    'controlled_substance_text',
    'dependence_text',
    'description_text',
    'disposal_and_waste_handling_text',
    'dosage_and_administration_text',
    'drug_abuse_and_dependence_text',
    'drug_and_or_laboratory_test_interactions_text',
    'drug_interactions_text',
    'environmental_warning_text',
    'geriatric_use_text',
    'guaranteed_analysis_of_feed_text',
    'health_claim_text',
    'how_supplied_section_text',
    'inactive_ingredient_text',
    'indications_and_usage_text',
    'information_for_owners_or_caregivers_text',
    'information_for_patients_text',
    'instructions_for_use_text',
    'intended_use_of_the_device_text',
    'laboratory_tests_text',
    'labor_and_delivery_text',
    'mechanism_of_action_text',
    'microbiology_text',
    'nonclinical_toxicology_text',
    'nursing_mothers_text',
    'other_safety_information_text',
    'overdosage_text',
    'package_label_principal_display_panel_text',
    'pediatric_use_text',
    'pharmacodynamics_text',
    'pharmacogenomics_text',
    'pharmacokinetics_text',
    'precautions_text',
    'pregnancy_text',
    'principal_display_panel_text',
    'purpose_text',
    'questions_text',
    'recent_major_changes_text',
    'references_text',
    'risks_text',
    'safe_handling_warning_text',
    'spl_medguide_text',
    'spl_patient_package_insert_text',
    'spl_product_data_elements_text',
    'spl_unclassified_section_text',
    'statement_of_identity_text',
    'storage_and_handling_text',
    'summary_of_safety_and_effectiveness_text',
    'teratogenic_effects_text',
    'troubleshooting_text',
    'use_in_specific_populations_text',
    'user_safety_warnings_text',
    'warnings_and_cautions_text',
    'warnings_text',
    'when_using_text'
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
        raw_snippet: null
    };
    const patterns = {
        manufactured_by: /Manufactured by[:\s](.*)/i,
        manufactured_for: /Manufactured for[:\s](.*)/i,
        distributed_by: /Distributed by[:\s](.*)/i
    };
    let longestSnippet = '';
    const textLines = fullText.split('\n');
    textLines.forEach(line => {
        for (const key in patterns) {
            const match = line.match(patterns[key]);
            if (match && match[1]) {
                const capturedText = match[1].trim();
                if (!info[key]) info[key] = capturedText;
                if (line.trim().length > longestSnippet.length) {
                    longestSnippet = line.trim();
                }
            }
        }
    });
    info.raw_snippet = longestSnippet || null;
    if (!info.manufactured_for && info.distributed_by) {
        info.manufactured_for = info.distributed_by;
    }
    return info;
}

async function fetchAndParseLabelFromAPI(splSetId) {
  if (!splSetId) {
    return { final_manufacturer: null, final_manufactured_for: null, raw_snippet: null };
  }
  
  const labelApiUrl = `https://api.fda.gov/drug/label.json?search=spl_set_id:"${splSetId}"&limit=1`;
  
  try {
    const response = await axios.get(labelApiUrl);
    const labelData = response.data.results?.[0];

    if (!labelData) {
      return { final_manufacturer: 'N/A (Label Not Found in API)', final_manufactured_for: null, raw_snippet: null };
    }
    
    let textCorpus = '';
    TEXT_BEARING_SECTIONS.forEach(section => {
      const value = labelData[section];
      
      // --- CRITICAL FIX ---
      // This new logic correctly handles cases where the API returns a single string
      // INSTEAD of an array of strings.
      if (Array.isArray(value)) {
        textCorpus += value.join('\n') + '\n\n';
      } else if (typeof value === 'string') {
        textCorpus += value + '\n\n';
      }
      // --- END FIX ---
    });

    const manufacturingInfo = parseManufacturingInfo(textCorpus);

    return {
      final_manufacturer: manufacturingInfo.manufactured_by,
      final_manufactured_for: manufacturingInfo.manufactured_for,
      raw_snippet: manufacturingInfo.raw_snippet
    };
  } catch (error) {
    console.error(`Error fetching label for SPL Set ID ${splSetId}:`, error.message);
    return { final_manufacturer: `API Error: ${error.message}`, final_manufactured_for: null, raw_snippet: null };
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