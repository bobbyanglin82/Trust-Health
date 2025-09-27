const searchBox = document.getElementById('searchBox');
const tbody = document.querySelector('#resultsTable tbody');
let allData = [];

async function fetchData() {
  try {
    tbody.innerHTML = `<tr><td colspan="8">Loading latest data from server...</td></tr>`;
    const response = await fetch(`/data?ts=${Date.now()}`);
    if (!response.ok) throw new Error('Network response was not ok');
    
    allData = await response.json();
    allData.sort((a, b) => {
      // Ensure dates exist before comparing
      const dateA = a.marketing_start_date || '0';
      const dateB = b.marketing_start_date || '0';
      return dateB.localeCompare(dateA);
    });
    
    renderTable(allData);

  } catch (error) {
    console.error("Failed to fetch data:", error);
    tbody.innerHTML = `<tr><td colspan="8">Error: Could not load data.</td></tr>`;
  }
}

function renderTable(data) {
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">No results found for the specified labelers.</td></tr>`;
    return;
  }

  // Helper function to format date from YYYYMMDD to YYYY-MM-DD
  const formatDate = (dateStr) => {
    if (dateStr && dateStr.length === 8) {
      return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return dateStr || 'N/A';
  };

  data.forEach(item => {
    const row = document.createElement('tr');
    
    // Define the data for each cell using the API field names
    const cells = [
      item.product_ndc || 'N/A',
      item.labeler_name || 'N/A',
      item.brand_name || 'N/A',
      item.generic_name || 'N/A',
      formatDate(item.marketing_start_date),
      formatDate(item.marketing_end_date),
      item.manufacturer_name || 'N/A',  // CORRECTED: Reads dynamically
      item.manufactured_for || 'N/A'    // CORRECTED: Reads dynamically
    ];

    // Create a <td> for each cell and append it to the row
    cells.forEach(text => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
}

if (searchBox) {
  searchBox.addEventListener('input', () => {
    const query = searchBox.value.toLowerCase();
    if (!allData) return;
    
    const searchResults = allData.filter(item => {
      // Get all the values we want to search against
      const brandName = (item.brand_name || '').toLowerCase();
      const genericName = (item.generic_name || '').toLowerCase();
      const labeler = (item.labeler_name || '').toLowerCase();
      const productNdc = (item.product_ndc || '').toLowerCase();
      
      // Return true if the query is found in ANY of the fields
      return brandName.includes(query) || 
             genericName.includes(query) || 
             labeler.includes(query) ||
             productNdc.includes(query);
    });
    renderTable(searchResults);
  });
}

// Initial data fetch
fetchData();