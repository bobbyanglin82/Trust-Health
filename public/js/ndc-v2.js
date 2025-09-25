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
    tbody.innerHTML = `<tr><td colspan="6">No results found for the specified labelers.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const row = document.createElement('tr');
    
    const productNdc = item.product_ndc || 'N/A';
    const proprietaryName = item.proprietary_name || 'N/A';
    const nonProprietaryName = item.nonproprietary_name || 'N/A';
    const marketingCategory = item.marketing_category || 'N/A';
    const dosageForm = item.dosage_form || 'N/A';
    const labeler = item.labeler_name || 'N/A';

    [productNdc, proprietaryName, nonProprietaryName, marketingCategory, dosageForm, labeler].forEach(text => {
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