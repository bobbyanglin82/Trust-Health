const searchBox = document.getElementById('searchBox');
const tbody = document.querySelector('#resultsTable tbody');
const downloadBtn = document.getElementById('downloadBtn');
let allData = [];

/**
 * Fetches the DTC pricing data from the server, sorts it, and renders the table.
 */
async function fetchData() {
  try {
    tbody.innerHTML = `<tr><td colspan="8">Loading latest data from server...</td></tr>`;
    // Fetch the new data file, using a timestamp to prevent caching issues
    const response = await fetch(`/dtc-data.json?ts=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
    
    allData = await response.json();
    
    // Sort data by the start date in descending order (newest first)
    allData.sort((a, b) => {
      // CORRECTED KEY: priceStartDate
      const dateA = a.priceStartDate || '0';
      const dateB = b.priceStartDate || '0';
      return dateB.localeCompare(dateA); // Newest dates will come first
    });
    
    renderTable(allData);

  } catch (error) {
    console.error("Failed to fetch data:", error);
    tbody.innerHTML = `<tr><td colspan="8">Error: Could not load data. See console for details.</td></tr>`;
  }
}

/**
 * Renders an array of data into the results table.
 * @param {Array<Object>} data The array of DTC drug data to render.
 */
function renderTable(data) {
  tbody.innerHTML = ''; // Clear existing table rows
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">No results found.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const row = document.createElement('tr');
    
    // Using innerHTML with a template literal for clean and readable cell creation.
    // The order matches the <thead> in dtc.html.
    // CORRECTED ALL KEYS to match dtc-data.json
    row.innerHTML = `
      <td>${item.drugName || 'N/A'}</td>
      <td>${item.price || 'N/A'}</td>
      <td>${item.uom || 'N/A'}</td>
      <td>${item.form || 'N/A'}</td>
      <td>${item.strengths || 'N/A'}</td>
      <td>${item.manufacturerProgram || 'N/A'}</td>
      <td>${item.priceStartDate || 'N/A'}</td>
      <td><a href="${item.websiteUrl || '#'}" target="_blank" rel="noopener noreferrer">${item.websiteName || 'Link'}</a></td>
    `;
    tbody.appendChild(row);
  });
}

// Event Listener for the search box to filter results in real-time.
if (searchBox) {
  searchBox.addEventListener('input', () => {
    const query = searchBox.value.toLowerCase().trim();
    if (!allData) return;
    
    const searchResults = allData.filter(item => {
      // Define the fields to search against
      // CORRECTED KEYS: drugName, manufacturerProgram
      const drugName = (item.drugName || '').toLowerCase();
      const manufacturer = (item.manufacturerProgram || '').toLowerCase();
      
      // Return true if the query is found in any of the fields
      return drugName.includes(query) || manufacturer.includes(query);
    });
    renderTable(searchResults);
  });
}

// Event Listener for the download button.
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const query = searchBox.value.toLowerCase().trim();
    let dataToExport = allData;

    // If there is an active search, export only the filtered data
    if (query && allData) {
      dataToExport = allData.filter(item => {
        // CORRECTED KEYS: drugName, manufacturerProgram
        const drugName = (item.drugName || '').toLowerCase();
        const manufacturer = (item.manufacturerProgram || '').toLowerCase();
        return drugName.includes(query) || manufacturer.includes(query);
      });
    }
    
    if (dataToExport.length === 0) {
      alert("No data available to download.");
      return;
    }

    // Define CSV headers
    const headers = [
      "Drug Name", "Cash Pay Price", "Unit of Measure", "Form", "Strength(s)",
      "Manufacturer / Program", "Price Start Date", "Website Name", "Website URL"
    ];

    // Helper to ensure data with commas or quotes is properly escaped for CSV format
    const escapeCsvCell = (cell) => {
      const cellStr = String(cell || '');
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    };

    const csvRows = [headers.join(',')]; // Start with the header row
    dataToExport.forEach(item => {
      // CORRECTED ALL KEYS to match dtc-data.json
      const row = [
        item.drugName,
        item.price,
        item.uom,
        item.form,
        item.strengths,
        item.manufacturerProgram,
        item.priceStartDate,
        item.websiteName,
        item.websiteUrl
      ].map(escapeCsvCell);
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'dtc_pricing_export.csv');
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

// Initial data fetch when the script loads
fetchData();