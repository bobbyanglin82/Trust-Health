document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.querySelector('#resultsTable tbody');

    async function fetchData() {
        try {
            tbody.innerHTML = `<tr><td colspan="9">Loading FairRX data...</td></tr>`;
            const response = await fetch(`/api/get-table-data?ts=${Date.now()}`);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const allData = await response.json();
            renderTable(allData);
        } catch (error) {
            console.error("Failed to fetch FairRX data:", error);
            tbody.innerHTML = `<tr><td colspan="9">Error: Could not load data. The data cache may need to be refreshed.</td></tr>`;
        }
    }

    function renderTable(data) {
        tbody.innerHTML = '';
        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9">No data found.</td></tr>`;
            return;
        }

        // Sort data by rank before rendering
        data.sort((a, b) => a.rank - b.rank);

        // --- Price Formatting Function (moved outside the loop for efficiency) ---
        const formatPrice = (price) => {
            const num = parseFloat(price);
            if (!isNaN(num)) {
                return num.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD'
                });
            }
            return price;
        };
        // --- END: Price Formatting Function ---

        data.forEach(item => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${item.rank || 'N/A'}</td>
                <td>${item.drugName || 'N/A'}</td>
                <td>${item.form || 'N/A'}</td>
                <td>${item.strength || 'N/A'}</td>
                <td>${item.quantity || 'N/A'}</td>
                <td>${item.ndc11 || 'N/A'}</td>
                <td>${formatPrice(item.fss_price)}</td>
                <td>${formatPrice(item.big4_price)}</td>
                <td>${item.listing_expiration_date || 'N/A'}</td>
            `;
            tbody.appendChild(row);
        });
    }

    // --- FIX #1: This line was missing. It's needed to start fetching the data. ---
    fetchData();

// --- FIX #2: The closing parenthesis and semicolon for the addEventListener were missing. ---
});