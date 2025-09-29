// FINAL SCRIPT v2: build_tariff_list.js (Corrected NDC Parsing)
//
// This definitive version includes a robust, multi-step helper function
// to correctly identify and extract the Product NDC, solving the alphanumeric issue.
//
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const JSONStream = require('JSONStream');
const unzipper = require('unzipper');

// --- START: New, Definitive NDC Finder ---
// This helper function checks multiple locations and validates the format is numeric.
function findBestNdc(labelData) {
    const openfda = labelData.openfda || {};
    // This helper function validates that a string looks like an NDC (only digits and hyphens).
    const isNdcFormat = (str) => /^\d[\d-]*\d$/.test(str) && str.includes('-');

    // Priority 1: The clean, harmonized NDC from the openfda section.
    const ndc1 = openfda.product_ndc?.[0];
    if (ndc1 && isNdcFormat(ndc1)) {
        return ndc1;
    }

    // Priority 2: A top-level product_ndc field.
    const ndc2 = labelData.product_ndc?.[0];
    if (ndc2 && isNdcFormat(ndc2)) {
        return ndc2;
    }

    // Priority 3: Extract from the end of the top-level 'id' field.
    if (labelData.id) {
        const potentialNdc = labelData.id.split('_').pop();
        if (potentialNdc && isNdcFormat(potentialNdc)) {
            return potentialNdc;
        }
    }

    // Priority 4: Search for "NDC XXXXX-XXX-XX" in the how_supplied text field.
    const howSuppliedText = (labelData.how_supplied || []).join(' ');
    const match = howSuppliedText.match(/NDC\s*:*\s*([\d-]+)/i);
    if (match && match[1] && isNdcFormat(match[1])) {
        return match[1];
    }

    // Fallback if no valid NDC is found.
    return 'N/A';
}
// --- END: New, Definitive NDC Finder ---


// --- START: Reused "Unpacker" and "Text Analyzer" Logic ---
function parseManufacturingInfo(labelData) {
    const info = {
        manufactured_by: null,
        manufactured_by_country: null,
        manufactured_for: null,
        manufactured_for_country: null,
    };
    const searchSections = [
        'spl_unclassified_section', 'spl_medguide', 'information_for_patients',
        'spl_patient_package_insert', 'how_supplied', 'package_label_principal_display_panel'
    ];
    let textCorpus = '';
    const seen = new Set();
    for (const key of searchSections) {
        if (Object.prototype.hasOwnProperty.call(labelData, key) && labelData[key]) {
            const sectionText = Array.isArray(labelData[key]) ? labelData[key].join('\n') : String(labelData[key]);
            const cleanedText = sectionText.replace(/\u00a0/g, ' ').replace(/\s{2,}/g, ' ').trim();
            if (cleanedText && !seen.has(cleanedText)) { textCorpus += cleanedText + '\n\n'; }
        }
    }
    if (!textCorpus) return info;
    const extractEntityInfo = (textBlock) => {
        if (!textBlock) return { name: null, country: null };
        const firstLine = textBlock.split('\n')[0].trim();
        let name = firstLine;
        let country = null;
        const upperText = firstLine.toUpperCase();
        if (/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}/.test(upperText) || upperText.includes('USA') || upperText.includes('U.S.A')) {
            country = 'USA';
        } else {
            const commonCountries = ['INDIA', 'IRELAND', 'GERMANY', 'SWITZERLAND', 'JAPAN', 'CHINA', 'KOREA', 'ITALY', 'FRANCE', 'CANADA', 'SPAIN', 'CAYMAN ISLANDS'];
            for (const c of commonCountries) {
                if (upperText.includes(c)) { country = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase().replace(/_/g, ' '); }
            }
        }
        if (country) {
            const countryIndex = upperText.lastIndexOf(country.toUpperCase());
            name = firstLine.substring(0, countryIndex).trim();
        }
        name = name.replace(/\s+[\w\s]+\s*-\s*\d+.*$/, '').trim();
        name = name.split(',')[0].trim();
        name = name.replace(/[.,;:]\s*$/, '').trim();
        return { name: name.length > 2 ? name : null, country: country };
    };
    const forPrefixes = ['Manufactured for', 'Mfd\\. for', 'Mfr\\. for'];
    const byPrefixes = ['Manufactured by', 'Mfd\\. by', 'Mfr\\. by', 'Distributed by', 'Marketed by', 'By'];
    const allPrefixes = [...forPrefixes, ...byPrefixes];
    const pattern = new RegExp(`\\b(${allPrefixes.join('|')})[:\\s]*([\\s\\S]+?)(?=\\b(?:${allPrefixes.join('|')})|\\n\\s*\\n|$)`, 'gi');
    const matches = [...textCorpus.matchAll(pattern)];
    for (const match of matches) {
        const keyRaw = match[1];
        const valueRaw = match[2];
        if (keyRaw.toLowerCase() === 'by' && !/by:/i.test(match[0]) && valueRaw.trim().split(' ').length > 5) continue;
        const entityInfo = extractEntityInfo(valueRaw);
        if (!entityInfo.name) continue;
        if (forPrefixes.some(p => new RegExp(p, 'i').test(keyRaw))) {
            if (!info.manufactured_for) { info.manufactured_for = entityInfo.name; info.manufactured_for_country = entityInfo.country; }
        } else {
            if (!info.manufactured_by) { info.manufactured_by = entityInfo.name; info.manufactured_by_country = entityInfo.country; }
        }
    }
    return info;
}
// --- END: Reused Logic ---

async function buildFromAllPartitions() {
    console.log('--- Starting COMPLETE Bulk Build Process (All Partitions) ---');
    const outputPath = path.join(__dirname, 'public', 'tariff-data.json');
    const finalResults = [];
    let totalProcessedCount = 0;

    try {
        console.log('Phase 1: Fetching download manifest from api.fda.gov...');
        const manifestUrl = 'https://api.fda.gov/download.json';
        const manifestResponse = await axios.get(manifestUrl);
        const partitions = manifestResponse.data.results.drug.label.partitions;
        console.log(`✅ Found ${partitions.length} data partitions to process.`);

        let partitionCount = 0;
        for (const partition of partitions) {
            partitionCount++;
            console.log(`\n--- Processing Partition ${partitionCount} of ${partitions.length}: ${partition.file} ---`);
            let partitionProcessedCount = 0;
            const response = await axios({ method: 'get', url: partition.file, responseType: 'stream' });
            
            const streamProcessing = new Promise((resolve, reject) => {
                response.data
                    .pipe(unzipper.ParseOne())
                    .pipe(JSONStream.parse('results.*'))
                    .on('data', (labelData) => {
                        partitionProcessedCount++;
                        if (partitionProcessedCount % 5000 === 0) {
                            process.stdout.write(`   - Processed ${partitionProcessedCount} records in this partition...\r`);
                        }
                        const manufacturingInfo = parseManufacturingInfo(labelData);
                        if (manufacturingInfo.manufactured_by_country && manufacturingInfo.manufactured_by_country.toUpperCase() !== 'USA') {
                            const openfda = labelData.openfda || {};
                            const product_ndc = findBestNdc(labelData); // Use the new helper function
                            
                            let genericName = openfda.generic_name?.[0];
                            if (!genericName || genericName.split(' ').length > 5) {
                                genericName = openfda.brand_name?.[0] || 'N/A';
                            }

                            finalResults.push({
                                product_ndc: product_ndc,
                                labeler_name: openfda.manufacturer_name?.[0] || 'N/A',
                                brand_name: openfda.brand_name?.[0] || 'N/A',
                                generic_name: genericName,
                                marketing_start_date: labelData.effective_time || 'N/A',
                                listing_expiration_date: 'N/A',
                                manufacturer_name: manufacturingInfo.manufactured_by || 'N/A (Not Found)',
                                manufacturer_by_country: manufacturingInfo.manufactured_by_country,
                                manufactured_for: manufacturingInfo.manufactured_for || openfda.manufacturer_name?.[0] || 'N/A'
                            });
                        }
                    })
                    .on('end', () => {
                        totalProcessedCount += partitionProcessedCount;
                        console.log(`\nStream for partition ${partitionCount} finished. Processed ${partitionProcessedCount} records.`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`\n❌ Error processing partition ${partitionCount}:`, err);
                        reject(err);
                    });
            });
            await streamProcessing;
        }
        console.log(`\n✅ Phase 2 Complete. Total records processed across all partitions: ${totalProcessedCount}.`);
        console.log(`Found a grand total of ${finalResults.length} non-USA manufactured products.`);
        console.log(`Phase 3: Writing final combined data to ${outputPath}...`);
        fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2));
        console.log('✅ --- COMPLETE Bulk Build Process Finished Successfully! ---');
    } catch (error) {
        console.error(`\n❌ An error occurred during the build process: ${error.message}`);
    }
}

// Execute the main function
buildFromAllPartitions();