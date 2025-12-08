// importo la función para obtener los últimos 14 cierres
import { getLast14 } from "./fetch.js";

// función para calcular el RSI
export async function calculateRSI(symbol) {
    const last14 = await getLast14(symbol);
    const changes = [];

    for (let i = 1; i < last14.length; i++) {
        changes.push(last14[i] - last14[i - 1]);
    }
    const gains = changes.map(c => (c > 0 ? c : 0));
    const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));
    const averageGain = gains.reduce((a, b) => a + b, 0) / 14;
    const averageLoss = losses.reduce((a, b) => a + b, 0) / 14;
        if (averageLoss === 0) return 100;
    const rs = averageGain / averageLoss;
    const rsi = 100 - (100 / (1 + rs));
    return rsi;
}