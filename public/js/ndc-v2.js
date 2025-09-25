const searchBox = document.getElementById('searchBox');
const tbody = document.querySelector('#resultsTable tbody');
let allData = [];

async function fetchData() {
  try {
    tbody.innerHTML = `<tr><td colspan="6">Loading latest data from server...</td></tr>`;
    const response = await fetch('/data');
    if (!response.ok) throw new Error('Network response was not ok');
    
    allData = await response.json();
    renderTable(allData);

  } catch (error) {
    console.error("Failed to fetch data:", error);
    tbody.innerHTML = `<tr><td colspan="6">Error: Could not load data.</td></tr>`;
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
    
    // Define the data for each cell in the correct order
    const cells = [
      item.product_ndc || 'N/A',
      item.labeler_name || 'N/A',
      item.proprietary_name || 'N/A',
      item.nonproprietary_name || 'N/A',
      formatDate(item.start_marketing_date),
      formatDate(item.end_marketing_date),
      'N/A (SPL Data)', // Placeholder for Manufactured By
      'N/A (SPL Data)'  // Placeholder for Manufactured For
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
      const brandName = (item.proprietary_name || '').toLowerCase();
      const genericName = (item.nonproprietary_name || '').toLowerCase();
      const manufacturer = (item.labeler_name || '').toLowerCase();
      
      return brandName.includes(query) || genericName.includes(query) || manufacturer.includes(query);
    });
    renderTable(searchResults);
  });
}

// Initial data fetch
fetchData();