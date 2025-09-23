document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const searchBox = document.getElementById('searchBox');
  const tbody = document.querySelector('#resultsTable tbody');

  const knownEntities = [
    "QUALLENT", "CORDAVIS", "OPTUM HEALTH SOLUTIONS", "ASCENT PHARMACEUTICALS",
    "ZINC HEALTH VENTURES", "ZINC HEALTH SERVICES", "EMISAR PHARMA SERVICES"
  ];

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) { return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      processData(text);
    };
    reader.readAsText(file, 'latin1');
  });

  function processData(text) {
    const rows = text.trim().split(/\r?\n/).filter(line => line.length > 0);
    const dataRows = rows.slice(1); 

    const data = dataRows.map(line => {
        const fields = line.split('\t');
        return fields.map(field => field.trim().replace(/^"|"$/g, ''));
    });

    const filteredData = data.filter(fields => {
      // *** FINAL CORRECTION: CHECKING INDEX 12 ***
      if (fields.length < 13) return false; 
      const nameFromDb = fields[12].toUpperCase().trim(); 

      if (!nameFromDb) return false;
      return knownEntities.some(entity => nameFromDb.toUpperCase().includes(entity));
    });

    renderTable(filteredData);

    searchBox.addEventListener('input', () => {
      const query = searchBox.value.toLowerCase();
      const searchResults = filteredData.filter(fields => {
        if (fields.length < 13) return false;
        const name = fields[12].toLowerCase(); // *** CHECKING INDEX 12 ***
        return name.includes(query);
      });
      renderTable(searchResults);
    });
  }

  function renderTable(rows) {
    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">No results found for the specified entities.</td></tr>`;
        return;
    }

    // Sort the rows in descending order based on the Start Marketing Date (index 8)
    const sortedRows = rows.sort((a, b) => {
        const dateA = a[8];
        const dateB = b[8];
        if (dateA > dateB) return -1;
        if (dateA < dateB) return 1;
        return 0;
    });

    sortedRows.forEach(fields => {
        const row = document.createElement('tr');
      
        // --- FINAL COLUMN ORDER AND INDICES ---
        // PRODUCTNDC: 1, PROPRIETARYNAMESUFFIX: 4, NONPROPRIETARYNAME: 5,
        // STARTMARKETINGDATE: 8, ENDMARKETINGDATE: 9, LABELERNAME: 12
        const columnsToShow = [1, 4, 5, 8, 9, 12]; 
      
        columnsToShow.forEach(index => {
            const cell = document.createElement('td');
            let content = fields[index] || '';
            // Format dates from YYYYMMDD to YYYY-MM-DD
            if ((index === 8 || index === 9) && content.length === 8) {
                content = `${content.substring(0, 4)}-${content.substring(4, 6)}-${content.substring(6, 8)}`;
            }
            cell.textContent = content;
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
  }
});