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
    // ... search logic remains the same ...
  });
}

function renderTable(data) {
  // THIS WILL PAUSE YOUR CODE SO WE CAN INSPECT THE 'data' VARIABLE
  debugger;

  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4">No results found.</td></tr>`;
    return;
  }

  data.forEach(item => {
    const row = document.createElement('tr');
    
    const openfda = item.openfda || {};
    const manufacturer = (openfda.manufacturer_name || ['N/A'])[0];
    const brandName = (item.brand_name || openfda.brand_name || ['N/A'])[0];
    const genericName = (item.generic_name || openfda.generic_name || ['N/A'])[0];
    const productNdc = (openfda.product_ndc || ['N/A'])[0];

    [manufacturer, brandName, genericName, productNdc].forEach(text => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
}

fetchData();