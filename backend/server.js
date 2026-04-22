import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import upsRouter from "./routes/ups.js";
import invoicesRouter from "./routes/invoices.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/ups", upsRouter);
app.use("/api/invoices", invoicesRouter);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`UPS backend running on http://localhost:${PORT}`);
});