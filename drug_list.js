// This file exports the augmented list of top 50 drugs for the Fair Price Index.
// It now includes both the 11-digit billing NDC and the converted 10-digit FDA NDC.

/**
 * ===================================================================================
 * NDC CONVERSION LOGIC
 * ===================================================================================
 * Converts a standard 11-digit HIPAA NDC (typically 5-4-2 format) into the
 * common 10-digit FDA format by removing the padding zero. The 11-digit format
 * is created by padding one of the three segments of a 10-digit code.
 *
 * This function correctly identifies which segment was padded and removes the
 * leading zero to restore the original 10-digit code.
 *
 * @param {string | null} ndc11 The 11-digit NDC string (e.g., "00006-3083-01").
 * @returns {string | null} The converted 10-digit NDC string, or null if the input is invalid.
 */
function convertNdcTo10(ndc11) {
    // Return null for invalid or missing input (e.g., for vaccines without a listed NDC).
    if (!ndc11 || typeof ndc11 !== 'string' || !ndc11.includes('-')) {
        return null;
    }

    const parts = ndc11.split('-');
    if (parts.length !== 3) {
        return ndc11; // Return original if format is unexpected
    }

    let [labeler, product, packageCode] = parts;

    // The 11-digit code is created by padding one of the segments of the 10-digit code.
    // We check in the most common order of padding.

    // Case 1: Original format was 4-4-2. Padded to 5-4-2.
    if (labeler.length === 5 && labeler.startsWith('0')) {
        labeler = labeler.substring(1);
    }
    // Case 2: Original format was 5-3-2. Padded to 5-4-2.
    else if (product.length === 4 && product.startsWith('0')) {
        product = product.substring(1);
    }
    // Case 3: Original format was 5-4-1. Padded to 5-4-2.
    else if (packageCode.length === 2 && packageCode.startsWith('0')) {
        packageCode = packageCode.substring(1);
    }

    return `${labeler}-${product}-${packageCode}`;
}


/**
 * ===================================================================================
 * RAW DRUG DATA
 * ===================================================================================
 * This is the master list containing the original data provided.
 */
const TOP_50_DRUGS_RAW = [
    { rank: 1, drugName: "Keytruda", form: "Intravenous Infusion", strength: "100mg/4mL", quantity: "1", ndc11: "00006-3026-02" },
    { rank: 2, drugName: "Ozempic", form: "Prefilled Pen", strength: "1mg", quantity: "1", ndc11: "00169-4130-13" },
    { rank: 3, drugName: "Dupixent", form: "Prefilled Pen/Syringe", strength: "300mg/2mL", quantity: "2", ndc11: "00024-5915-02" },
    { rank: 4, drugName: "Eliquis", form: "Tablet", strength: "5mg", quantity: "60", ndc11: "00003-0894-21" },
    { rank: 5, drugName: "Mounjaro", form: "Prefilled Pen", strength: "5mg/0.5mL", quantity: "4", ndc11: "00002-1495-80" },
    { rank: 6, drugName: "Skyrizi", form: "Prefilled Pen/Syringe", strength: "150mg/mL", quantity: "1", ndc11: "00074-2100-01" },
    { rank: 7, drugName: "Biktarvy", form: "Tablet", strength: "50mg/200mg/25mg", quantity: "30", ndc11: "61958-2501-03" },
    { rank: 8, drugName: "Zepbound", form: "Prefilled Pen", strength: "5mg/0.5mL", quantity: "4", ndc11: "00002-2495-80" },
    { rank: 9, drugName: "Opdivo", form: "Intravenous Infusion", strength: "100mg/10mL", quantity: "1", ndc11: "00003-3774-12" },
    { rank: 10, drugName: "Jardiance", form: "Tablet", strength: "10mg", quantity: "30", ndc11: "00597-0152-30" },
    { rank: 11, drugName: "Humira", form: "Prefilled Pen/Syringe", strength: "40mg/0.8mL", quantity: "2", ndc11: "00074-4339-02" },
    { rank: 12, drugName: "Wegovy", form: "Prefilled Pen", strength: "2.4mg", quantity: "4", ndc11: "00169-4524-14" },
    { rank: 13, drugName: "Stelara", form: "Prefilled Syringe", strength: "45mg/0.5mL", quantity: "1", ndc11: "57894-0060-03" },
    { rank: 14, drugName: "Eylea", form: "Intravitreal Injection", strength: "2mg/0.05mL", quantity: "1", ndc11: "61755-0005-01" },
    { rank: 15, drugName: "Comirnaty", form: "Intramuscular Injection", strength: "30mcg/0.3mL", quantity: "1", ndc11: null },
    { rank: 16, drugName: "Xarelto", form: "Tablet", strength: "20mg", quantity: "30", ndc11: "50458-0579-30" },
    { rank: 17, drugName: "Trikafta", form: "Tablet", strength: "100mg/50mg/75mg", quantity: "84", ndc11: "51167-0331-01" },
    { rank: 18, drugName: "Darzalex", form: "Intravenous Infusion", strength: "400mg/20mL", quantity: "1", ndc11: "57894-0505-20" },
    { rank: 19, drugName: "Rinvoq", form: "Extended-Release Tablet", strength: "15mg", quantity: "30", ndc11: "00074-2306-30" },
    { rank: 20, drugName: "Imbruvica", form: "Capsule", strength: "140mg", quantity: "90", ndc11: "57962-0014-28" },
    { rank: 21, drugName: "Entresto", form: "Tablet", strength: "97mg/103mg", quantity: "60", ndc11: "00078-0696-20" },
    { rank: 22, drugName: "Gardasil 9", form: "Intramuscular Injection", strength: "0.5mL", quantity: "1", ndc11: "00006-4119-03" },
    { rank: 23, drugName: "Farxiga", form: "Tablet", strength: "10mg", quantity: "30", ndc11: "00310-6210-39" },
    { rank: 24, drugName: "Tagrisso", form: "Tablet", strength: "80mg", quantity: "30", ndc11: "00310-1350-30" },
    { rank: 25, drugName: "Spikevax", form: "Intramuscular Injection", strength: "100mcg/0.5mL", quantity: "1", ndc11: null },
    { rank: 26, drugName: "Ibrance", form: "Capsule", strength: "125mg", quantity: "21", ndc11: "00069-0189-21" },
    { rank: 27, drugName: "Cosentyx", form: "Prefilled Pen", strength: "150mg", quantity: "2", ndc11: "00078-0639-41" },
    { rank: 28, drugName: "Verzenio", form: "Tablet", strength: "150mg", quantity: "60", ndc11: "00002-5337-54" },
    { rank: 29, drugName: "Ocrevus", form: "Intravenous Infusion", strength: "300mg/10mL", quantity: "1", ndc11: "50242-0150-01" },
    { rank: 30, drugName: "Tecentriq", form: "Intravenous Infusion", strength: "1200mg/20mL", quantity: "1", ndc11: "50242-0917-01" },
    { rank: 31, drugName: "Paxlovid", form: "Tablet", strength: "150mg/100mg", quantity: "30", ndc11: "00069-5434-20" },
    { rank: 32, drugName: "Shingrix", form: "Intramuscular Injection", strength: "0.5mL", quantity: "1", ndc11: "58160-0823-11" },
    { rank: 33, drugName: "Vyvanse", form: "Capsule", strength: "70mg", quantity: "30", ndc11: "59417-0107-10" },
    { rank: 34, drugName: "Trulicity", form: "Prefilled Pen", strength: "1.5mg/0.5mL", quantity: "4", ndc11: "00002-1434-80" },
    { rank: 35, drugName: "Botox Cosmetic", form: "Intramuscular Injection", strength: "100 units", quantity: "1", ndc11: "00023-1145-01" },
    { rank: 36, drugName: "Prolia", form: "Prefilled Syringe", strength: "60mg", quantity: "1", ndc11: "55513-0710-01" },
    { rank: 37, drugName: "Enbrel", form: "Prefilled Pen", strength: "50mg", quantity: "4", ndc11: "58406-0032-04" },
    { rank: 38, drugName: "Januvia", form: "Tablet", strength: "100mg", quantity: "30", ndc11: "00006-0277-31" },
    { rank: 39, drugName: "Xtandi", form: "Capsule", strength: "40mg", quantity: "120", ndc11: "00469-0125-99" },
    { rank: 40, drugName: "Hemlibra", form: "Subcutaneous Injection", strength: "150mg/mL", quantity: "1", ndc11: "50242-0923-01" },
    { rank: 41, drugName: "Vraylar", form: "Capsule", strength: "1.5mg", quantity: "30", ndc11: "61874-0115-30" },
    { rank: 42, drugName: "Symbicort", form: "Inhaler", strength: "160mcg/4.5mcg", quantity: "1", ndc11: "00186-0370-20" },
    { rank: 43, drugName: "Lyrica", form: "Capsule", strength: "100mg", quantity: "60", ndc11: "58151-0239-77" },
    { rank: 44, drugName: "Taltz", form: "Prefilled Pen", strength: "80mg", quantity: "1", ndc11: "00002-1445-11" },
    { rank: 45, drugName: "Rybelsus", form: "Tablet", strength: "14mg", quantity: "30", ndc11: "00169-4314-30" },
    { rank: 46, drugName: "Adcetris", form: "Intravenous Infusion", strength: "50mg", quantity: "1", ndc11: "51144-0050-01" },
    { rank: 47, drugName: "Invega Sustenna", form: "Prefilled Syringe", strength: "234mg", quantity: "1", ndc11: "50458-0564-01" },
    { rank: 48, drugName: "Pomalyst", form: "Capsule", strength: "4mg", quantity: "21", ndc11: "59572-0504-21" },
    { rank: 49, drugName: "Lynparza", form: "Tablet", strength: "150mg", quantity: "120", ndc11: "00310-0679-12" },
    { rank: 50, drugName: "Entyvio", form: "Intravenous Infusion", strength: "300mg", quantity: "1", ndc11: "64764-0300-20" }
];


/**
 * ===================================================================================
 * FINAL EXPORT
 * ===================================================================================
 * Augment the original list with the converted 10-digit NDC for use in the application.
 */
const TOP_50_DRUGS = TOP_50_DRUGS_RAW.map(drug => ({
    ...drug,
    ndc10: convertNdcTo10(drug.ndc11)
}));


// This is now the primary export that your server.js file should use.
module.exports = { TOP_50_DRUGS };