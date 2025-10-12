document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.querySelector('#resultsTable tbody');

    async function fetchData() {
        try {
            tbody.innerHTML = `<tr><td colspan="6">Loading FairRX data...</td></tr>`;
            // Fetch data from our new public endpoint
            const response = await fetch(`/api/get-table-data?ts=${Date.now()}`);
            if (!response.ok) throw new Error('Network response was not ok');

            const allData = await response.json();
            renderTable(allData);
        } catch (error) {
            console.error("Failed to fetch FairRX data:", error);
            tbody.innerHTML = `<tr><td colspan="6">Error: Could not load data. The data cache may need to be refreshed.</td></tr>`;
        }
    }

    function renderTable(data) {
        tbody.innerHTML = '';
        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">No data found.</td></tr>`;
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.rank || 'N/A'}</td>
                <td>${item.drugName || 'N/A'}</td>
                <td>${item.ndc11 || 'N/A'}</td>
                <td>${typeof item.fss_price === 'number' ? '$' + item.fss_price.toFixed(2) : item.fss_price}</td>
                <td>${typeof item.big4_price === 'number' ? '$' + item.big4_price.toFixed(2) : item.big4_price}</td>
                <td>${item.listing_expiration_date || 'N/A'}</td>
            `;
            tbody.appendChild(row);
        });
    }

    fetchData();
});