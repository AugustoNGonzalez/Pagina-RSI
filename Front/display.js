const mainTable = document.getElementById("mainTbl");
const mainTableBody = document.getElementById("mainTblBody");
const resetBtn = document.getElementById("resetBtn");
const addBtn = document.getElementById("addBtn");
const addGroupBtn = document.getElementById("addGroupBtn");
const mostUsedTable = document.getElementById("mostUsed");
const mostUsedBody = document.getElementById("mostUsedBody");

addEventListenerToButton(resetBtn, resetTable);
addEventListenerToButton(addBtn, addStock);
addEventListenerToButton(addGroupBtn, addGroupStocks);

// Añade una accion
function addStock() {
    
}

// Anade un grupo de acciones
function addGroupStocks() {
}

// Resetea la tabla principal
function resetTable() {
    mainTableBody.innerHTML = "";
}