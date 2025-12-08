import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance();

async function fetch(symbol) {
    const result = await yf.chart(symbol, {
    period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    period2: new Date(),
    interval: '1d',
    });
const closes = result.quotes.map(q => q.close);
return closes;
}

export async function WilderGetLast15(symbol) {
const closes = await fetch(symbol);
const last15 = closes.slice(-15);
return last15;
}

export async function getLast14(symbol) {
const closes = await fetch(symbol);
const last14 = closes.slice(-14);
return last14;
}

export async function getLastClose(symbol) {
const closes = await fetch(symbol);
const lastclose = closes.slice(-1)[0];
return lastclose;
}