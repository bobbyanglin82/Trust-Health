const searchBox = document.getElementById('searchBox');
const tbody = document.querySelector('#resultsTable tbody');
let allData = [];

async function fetchData() {
  try {
    tbody.innerHTML = `<tr><td colspan="4">Loading latest data from server...</td></tr>`;
    const response = await fetch('/data');
    if (!response.ok) throw new Error('Network response was not ok');
    
    allData = await response.json();
    renderTable(allData);

  } catch (error) {
    console.error("Failed to fetch data:", error);
    tbody.innerHTML = `<tr><td colspan="4">Error: Could not load data.</td></tr>`;
  }
}

if (searchBox) {
  searchBox.addEventListener('input', () => {
    const query = searchBox.value.toLowerCase();
    if (!allData) return;
    const searchResults = allData.filter(item => {
      const openfda = item.openfda || {};
      const brandName = (item.brand_name || openfda.brand_name || []).join(' ').toLowerCase();
      const genericName = (item.generic_name || openfda.generic_name || []).join(' ').toLowerCase();
      const manufacturer = (openfda.manufacturer_name || []).join(' ').toLowerCase();
      
      return brandName.includes(query) || genericName.includes(query) || manufacturer.includes(query);
    });
    renderTable(searchResults);
  });
}

function renderTable(data) {
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    // Update colspan to match the new number of columns
    tbody.innerHTML = `<tr><td colspan="6">No results found.</td></tr>`;
    return;
  }

  // Helper function to format YYYYMMDD date strings
  const formatDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return 'N/A';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  };

  data.forEach(item => {
    const row = document.createElement('tr');
    
    // Extract data using the validated field names
    const openfda = item.openfda || {};
    const productNdc = (openfda.product_ndc || ['N/A'])[0];
    const suffix = item.proprietary_name_suffix || 'N/A';
    const nonProprietaryName = (item.nonproprietary_name || ['N/A']).join(', ');
    const startDate = formatDate(item.start_marketing_date);
    const endDate = formatDate(item.end_marketing_date);
    const labeler = item.labeler_name || 'N/A';

    // Create cells in the correct order
    [productNdc, suffix, nonProprietaryName, startDate, endDate, labeler].forEach(text => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
}

fetchData();