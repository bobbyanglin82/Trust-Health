document.addEventListener('DOMContentLoaded', () => {
  // --- REMOVED THE fileInput VARIABLE ---
  const searchBox = document.getElementById('searchBox');
  const tbody = document.querySelector('#resultsTable tbody');

  const knownEntities = [
    "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", "ASCENT PHARMACEUTICALS",
    "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
  ];

  // --- NEW FUNCTION TO FETCH DATA FROM THE SERVER ---
  async function fetchData() {
    try {
      tbody.innerHTML = `<tr><td colspan="6">Loading latest data from server...</td></tr>`;
      // This is the new part that gets the data from your server
      const response = await fetch('/data');
      if (!response.ok) {
        throw new Error(`Server returned an error: ${response.statusText}`);
      }
      const text = await response.text();
      processData(text);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      tbody.innerHTML = `<tr><td colspan="6">Error: Could not load data from the server.</td></tr>`;
    }
  }

  // --- REMOVED THE fileInput.addEventListener BLOCK ---

  function processData(text) {
    const rows = text.trim().split(/\r?\n/).filter(line => line.length > 0);
    // NOTE: The labeler.txt file does not have a header, so we process all rows.
    // const dataRows = rows.slice(1); <-- This line is no longer needed for labeler.txt

    const data = rows.map(line => {
        const fields = line.split('\t');
        return fields.map(field => field.trim().replace(/^"|"$/g, ''));
    });

    // The data structure for labeler.txt is simpler. We check index 1 for the name.
    const filteredData = data.filter(fields => {
      if (fields.length < 2) return false; 
      const nameFromDb = fields[1].toUpperCase().trim(); 

      if (!nameFromDb) return false;
      return knownEntities.some(entity => nameFromDb.toUpperCase().includes(entity));
    });

    renderTable(filteredData);

    searchBox.addEventListener('input', () => {
      const query = searchBox.value.toLowerCase();
      const searchResults = filteredData.filter(fields => {
        if (fields.length < 2) return false;
        const name = fields[1].toLowerCase();
        return name.includes(query);
      });
      renderTable(searchResults);
    });
  }

  function renderTable(rows) {
    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2">No results found for the specified entities.</td></tr>`;
        return;
    }
    
    // labeler.txt has no date to sort by, so we sort alphabetically by name (index 1)
    const sortedRows = rows.sort((a, b) => a[1].localeCompare(b[1]));

    sortedRows.forEach(fields => {
        const row = document.createElement('tr');
      
        // The columns for labeler.txt are just the Labeler Code (0) and Labeler Name (1)
        const columnsToShow = [0, 1]; 
      
        columnsToShow.forEach(index => {
            const cell = document.createElement('td');
            cell.textContent = fields[index] || '';
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
  }

  // --- This now starts the process when the page loads ---
  fetchData();
});