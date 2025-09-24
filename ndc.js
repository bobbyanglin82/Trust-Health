document.addEventListener('DOMContentLoaded', () => {
  const searchBox = document.getElementById('searchBox');
  const tbody = document.querySelector('#resultsTable tbody');
  let allData = []; // Store the master list of data

  async function fetchData() {
    try {
      tbody.innerHTML = `<tr><td colspan="4">Loading latest data from server...</td></tr>`;
      const response = await fetch('/data');
      if (!response.ok) throw new Error('Network response was not ok');
      
      // Data is now JSON, not text
      allData = await response.json();
      renderTable(allData);

    } catch (error) {
      console.error("Failed to fetch data:", error);
      tbody.innerHTML = `<tr><td colspan="4">Error: Could not load data.</td></tr>`;
    }
  }

  // Search function now filters the local JSON data
  searchBox.addEventListener('input', () => {
    const query = searchBox.value.toLowerCase();
    const searchResults = allData.filter(item => {
      const brandName = (item.openfda.brand_name || []).join(', ').toLowerCase();
      const manufacturer = (item.openfda.manufacturer_name || []).join(', ').toLowerCase();
      return brandName.includes(query) || manufacturer.includes(query);
    });
    renderTable(searchResults);
  });

  function renderTable(data) {
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">No results found.</td></tr>`;
      return;
    }

    data.forEach(item => {
      const row = document.createElement('tr');
      
      // Accessing properties from the JSON object
      const manufacturer = (item.openfda.manufacturer_name || ['N/A']).join(', ');
      const brandName = (item.openfda.brand_name || ['N/A']).join(', ');
      const genericName = (item.openfda.generic_name || ['N/A']).join(', ');
      const productNdc = (item.openfda.product_ndc || ['N/A']).join(', ');

      // Create cells in order: Manufacturer, Brand Name, Generic Name, NDC
      [manufacturer, brandName, genericName, productNdc].forEach(text => {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  }

  fetchData();
});