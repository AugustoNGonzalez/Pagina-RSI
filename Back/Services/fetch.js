// importar Yahoo Finance API
import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance();

// función para obtener los datos de 30 cierres de un símbolo
async function fetch(symbol) {
    const result = await yf.chart(symbol, {
    period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    period2: new Date(),
    interval: '1d',
    });
const closes = result.quotes.map(q => q.close);
return closes;
}

// función para cortar los últimos 14 cierres
export async function getLast14(symbol) {
const closes = await fetch(symbol);
const last14 = closes.slice(-14);
return last14;
}

// funcion para cortar el último cierre
export async function getLastClose(symbol) {
const closes = await fetch(symbol);
const lastclose = closes.slice(-1)[0];
return lastclose;
}
