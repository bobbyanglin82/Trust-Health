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

function renderTable(data) {
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">No results found.</td></tr>`;
    return;
  }

  const formatDate = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return 'N/A';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  };

  data.forEach(item => {
    const row = document.createElement('tr');
    
    // Extract data from the root of the item object
    const productNdc = item.product_ndc || 'N/A';
    const proprietaryName = item.proprietary_name || 'N/A';
    const nonProprietaryName = item.nonproprietary_name || 'N/A';
    const startDate = formatDate(item.start_marketing_date);
    const endDate = formatDate(item.end_marketing_date);
    const labeler = item.labeler_name || 'N/A';

    [productNdc, proprietaryName, nonProprietaryName, startDate, endDate, labeler].forEach(text => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
}

fetchData();