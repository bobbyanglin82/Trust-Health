// NEW FILE: build_tariff_list.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * This is the same successful parser from your fda_proxy.js file.
 * It's included here to make this script fully self-contained.
 */
function parseManufacturingInfo(labelData) {
    const info = { manufactured_by: null, manufactured_by_country: null, manufactured_for: null, manufactured_for_country: null };
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
            if (cleanedText && !seen.has(cleanedText)) {
                textCorpus += cleanedText + '\n\n';
            }
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
                if (upperText.includes(c)) {
                    country = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase().replace(/_/g, ' ');
                }
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

/**
 * The main function to build the tariff data file.
 */
async function buildTariffList() {
    console.log('--- Starting Tariff Scope Build Process ---');
    
    // Define the output path for the final JSON file. It will be saved in the `public` directory.
    const outputPath = path.join(__dirname, 'public', 'tariff-data.json');
    
    // --- Phase 1: Fetch all drug labels from the API with pagination ---
    const allLabelResults = [];
    let skip = 0;
    const limit = 1000;
    const maxPages = 26; // OpenFDA's practical limit is ~26,000 records via 'skip'
    const searchQuery = '_exists_:openfda.brand_name+OR+_exists_:openfda.generic_name';

    console.log('Phase 1: Fetching all drug labels...');
    for (let page = 0; page < maxPages; page++) {
        process.stdout.write(`   - Fetching page ${page + 1}/${maxPages}...\r`);
        try {
            const labelApiUrl = `https://api.fda.gov/drug/label.json?search=${searchQuery}&limit=${limit}&skip=${skip}`;
            const labelResponse = await axios.get(labelApiUrl);
            
            if (!labelResponse.data.results || labelResponse.data.results.length === 0) {
                console.log('\n   No more results found. Ending fetch loop.');
                break;
            }
            
            allLabelResults.push(...labelResponse.data.results);
            
            if (labelResponse.data.results.length < limit) {
                console.log('\n   Last page reached. Ending fetch loop.');
                break;
            }
            
            skip += limit;
        } catch (error) {
            console.error(`\n❌ Error on page ${page + 1}: ${error.message}. Stopping.`);
            break;
        }
    }
    console.log(`\n✅ Phase 1 Complete. Total records fetched: ${allLabelResults.length}.`);

    if (allLabelResults.length === 0) {
        console.log('No records found. Exiting.');
        return;
    }

    // --- Phase 2: Enrich the data with details from the NDC API ---
    // This part is memory intensive. For very large datasets, a streaming approach would be better.
    console.log('Phase 2: Enriching with NDC data...');
    const ndcDataMap = new Map();
    const allNdcs = allLabelResults.map(l => l.openfda?.product_ndc?.[0]).filter(Boolean);
    
    // The NDC API query can also be long, so we do it in batches.
    const batchSize = 250; // A safe batch size to avoid overly long URLs
    for (let i = 0; i < allNdcs.length; i += batchSize) {
        const batch = allNdcs.slice(i, i + batchSize);
        process.stdout.write(`   - Enriching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allNdcs.length/batchSize)}...\r`);
        const ndcSearchQuery = batch.map(ndc => `product_ndc:"${ndc}"`).join('+OR+');
        const ndcApiUrl = `https://api.fda.gov/drug/ndc.json?search=${ndcSearchQuery}&limit=${batch.length}`;
        try {
            const ndcResponse = await axios.get(ndcApiUrl);
            if (ndcResponse.data.results) {
                ndcResponse.data.results.forEach(product => {
                    ndcDataMap.set(product.product_ndc, {
                        marketing_start_date: product.marketing_start_date,
                        listing_expiration_date: product.listing_expiration_date,
                        labeler_name: product.labeler_name,
                        brand_name: product.brand_name,
                        generic_name: product.generic_name
                    });
                });
            }
        } catch (error) {
             console.error(`\n❌ Error enriching NDC batch: ${error.message}`);
        }
    }
    console.log(`\n✅ Phase 2 Complete. Enriched ${ndcDataMap.size} unique NDCs.`);

    // --- Phase 3: Parse, Filter, and Assemble the Final Results ---
    console.log('Phase 3: Parsing manufacturing info and filtering for non-USA products...');
    const finalResults = [];
    for (const labelData of allLabelResults) {
        if (!labelData) continue;
        const manufacturingInfo = parseManufacturingInfo(labelData);

        // This is our key filter: only include products manufactured outside the USA.
        if (manufacturingInfo.manufactured_by_country && manufacturingInfo.manufactured_by_country.toUpperCase() !== 'USA') {
            const product_ndc = labelData.openfda?.product_ndc?.[0] || 'N/A';
            const ndcData = ndcDataMap.get(product_ndc) || {};
            finalResults.push({
                product_ndc: product_ndc,
                labeler_name: ndcData.labeler_name || 'N/A',
                brand_name: ndcData.brand_name || 'N/A',
                generic_name: ndcData.generic_name || 'N/A',
                marketing_start_date: ndcData.marketing_start_date || labelData.effective_time || 'N/A',
                listing_expiration_date: ndcData.listing_expiration_date || 'N/A',
                manufacturer_name: manufacturingInfo.manufactured_by || 'N/A (Not Found)',
                manufacturer_by_country: manufacturingInfo.manufactured_by_country,
                manufactured_for: manufacturingInfo.manufactured_for || ndcData.labeler_name || 'N/A'
            });
        }
    }
    console.log(`✅ Phase 3 Complete. Found ${finalResults.length} non-USA manufactured products.`);

    // --- Phase 4: Write the Final File ---
    console.log(`Phase 4: Writing final data to ${outputPath}...`);
    try {
        // Ensure the 'public' directory exists
        fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2));
        console.log('✅ --- Build Process Finished Successfully! ---');
    } catch (error) {
        console.error(`❌ Error writing final file: ${error.message}`);
    }
}

// Execute the main function
buildTariffList();