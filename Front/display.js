// DOM
const mainTable = document.getElementById("mainTbl");
const mainTableBody = document.getElementById("mainTblBody");
const resetBtn = document.getElementById("resetBtn");
const addBtn = document.getElementById("addBtn");
const addGroupBtn = document.getElementById("addGroupBtn");
const mostUsedTable = document.getElementById("mostUsed");
const mostUsedBody = document.getElementById("mostUsedBody");
const symbolInput = document.getElementById("symbolInput");
const updateBtn = document.getElementById("updateBtn");

// Añadir event listener los botones
updateBtn.addEventListener("click", updateTable);
resetBtn.addEventListener("click", resetTable);
addBtn.addEventListener("click", addStock);
addGroupBtn.addEventListener("click", addGroupStocks);

// Añade una accion
async function addStock() {
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;

    const existingSymbols = Array.from(mainTableBody.getElementsByTagName("tr")).map(row => row.cells[0].innerText);
    if (existingSymbols.includes(symbol)) {
        alert("El símbolo ya ha sido agregado a la tabla.");
        symbolInput.value = "";
        return;
    }

    try {    
        const response = await fetch(`http://localhost:3000/api/stock/${symbol}`);
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }

        // Crear nueva fila en la tabla principal
        const newRow = document.createElement("tr");
        newRow.innerHTML = `
            <td>${data.symbol}</td>
            <td>${data.lastClose.toFixed(2)}</td>
            <td>${data.rsi.toFixed(2)}</td>
            <td><button class="removeButton">Eliminar</button></td>
        `;
        mainTableBody.appendChild(newRow);

        // Añadir funcionalidad al botón de eliminar
        newRow.querySelector(".removeButton").addEventListener("click", () => {
            newRow.remove();
        });

        symbolInput.value = "";

    } catch (error) {
        alert("Error al obtener datos para el símbolo proporcionado. Por favor, verifique el símbolo e intente nuevamente.");
    }
}

// Anade un grupo de acciones
function addGroupStocks() {
}

// Resetea la tabla principal
function resetTable() {
    mainTableBody.innerHTML = "";
}

async function updateTable() {
    const rows = Array.from(mainTableBody.getElementsByTagName("tr"));
    for (const row of rows) {
        const symbol = row.cells[0].innerText;
        try {
            const response = await fetch(`http://localhost:3000/api/stock/${symbol}`);
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            row.cells[1].innerText = data.lastClose.toFixed(2);
            row.cells[2].innerText = data.rsi.toFixed(2);
        } catch (error) {
            console.error(`Error al actualizar datos para ${symbol}:`, error);
        }
    }
}