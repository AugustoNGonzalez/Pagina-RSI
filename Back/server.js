import express from "express";
import cors from "cors";
import { calculateRSI } from "./Services/rsi.js";
import { getLastClose } from "./Services/fetch.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/api/stock/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const rsi = await calculateRSI(symbol);
    const lastClose = await getLastClose(symbol);
    res.json({ symbol, rsi, lastClose });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});