import { getLast14, WilderGetLast15 } from "./fetch.js";

async function calculateRSI(symbol) {
    const last14 = await getLast14(symbol);
    const changes = [];

    for (let i = 1; i < last14.length; i++) {
        changes.push(last14[i] - last14[i - 1]);
    }
    const gains = changes.map(c => (c > 0 ? c : 0));
    const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));
    const averageGain = gains.reduce((a, b) => a + b, 0) / gains.length;
    const averageLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
    const rs = averageGain / averageLoss;
    const rsiClassic = 100 - (100 / (1 + rs));
    return rsiClassic;
}

calculateRSI('AAPL').then(r => console.log(r));

async function calculateWilderRSI(symbol) {
    const last15 = await WilderGetLast15(symbol);
    const changes = [];

    for (let i = 1; i < last15.length; i++) {
        changes.push(last15[i] - last15[i - 1]);
    }
    const gains = changes.map(c => (c > 0 ? c : 0));
    const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));
    let averageGain = gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    let averageLoss = losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    averageGain = (averageGain * 13 + gains[13]) / 14;
    averageLoss = (averageLoss * 13 + losses[13]) / 14;
    const rs = averageGain / averageLoss;
    const rsiWilder = 100 - (100 / (1 + rs));
    return rsiWilder;
}

calculateRSI('AAPL').then(r => console.log('RSI clásico:', r.toFixed(2)));
calculateWilderRSI('AAPL').then(r => console.log('RSI de Wilder:', r.toFixed(2)));
