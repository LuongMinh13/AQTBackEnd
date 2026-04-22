import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.join(BACKEND_ROOT, "data", "input");
const SCRIPTS_DIR = path.join(BACKEND_ROOT, "scripts");
const PROCESS_UPS = path.join(SCRIPTS_DIR, "process_ups.py");
const PROCESS_TNT = path.join(SCRIPTS_DIR, "process_tnt.py");

// Commande Python (overridable via env PYTHON_BIN)
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

// Multer : upload vers data/input/, taille max 30 Mo
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await mkdir(INPUT_DIR, { recursive: true });
      cb(null, INPUT_DIR);
    } catch (err) {
      cb(err, INPUT_DIR);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

// Upload UPS : seulement PDF
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Seuls les fichiers PDF sont acceptés."));
    }
  },
});

// Upload TNT : PDF + Excel HUB (2 champs distincts)
const uploadTnt = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname || "";
    if (file.fieldname === "pdf") {
      if (file.mimetype === "application/pdf" || /\.pdf$/i.test(name)) {
        return cb(null, true);
      }
      return cb(new Error("Le champ 'pdf' attend un fichier PDF."));
    }
    if (file.fieldname === "hub") {
      if (/\.(xlsx|xls)$/i.test(name)) {
        return cb(null, true);
      }
      return cb(new Error("Le champ 'hub' attend un fichier Excel (.xlsx ou .xls)."));
    }
    cb(new Error(`Champ inattendu: ${file.fieldname}`));
  },
});

/**
 * Spawn un script Python et retourne le JSON parsé de stdout.
 */
function runPythonScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [scriptPath, ...args], {
      cwd: BACKEND_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    proc.on("error", (err) => reject(err));

    proc.on("close", (code) => {
      const label = path.basename(scriptPath);
      if (code !== 0) {
        return reject(new Error(
          `${label} exited with code ${code}: ${stderr || stdout}`
        ));
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (err) {
        reject(new Error(
          `Invalid JSON from ${label}: ${err.message}\nSTDOUT: ${stdout.slice(0, 500)}\nSTDERR: ${stderr.slice(0, 500)}`
        ));
      }
    });
  });
}

/**
 * Lance process_ups.py avec 1..N PDF et retourne le JSON fusionné parsé.
 */
function runPythonExtractor(pdfPaths) {
  const paths = Array.isArray(pdfPaths) ? pdfPaths : [pdfPaths];
  return runPythonScript(PROCESS_UPS, paths);
}

const router = Router();

/**
 * POST /api/invoices/ups/process
 * multipart/form-data : champ "pdf" (1..N fichiers, même nom de champ)
 * Réponse : { audit, liv_particulier, residence, suppenlevement } fusionné
 */
router.post("/ups/process", upload.array("pdf", 20), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: "Champ 'pdf' manquant." });
  }

  const pdfPaths = files.map((f) => f.path);
  try {
    const data = await runPythonExtractor(pdfPaths);
    res.json(data);
  } catch (err) {
    console.error("[/ups/process] error:", err);
    res.status(500).json({ error: err.message || "Erreur lors du traitement." });
  } finally {
    // Nettoyage de tous les fichiers temporaires
    for (const p of pdfPaths) {
      unlink(p).catch(() => {});
    }
  }
});

/**
 * POST /api/invoices/ups/export
 * Body JSON : { audit: [...], liv_particulier: [...], residence: [...], suppenlevement: [...] }
 * Réponse : fichier .xlsx avec 4 feuilles
 */
router.post("/ups/export", async (req, res) => {
  const data = req.body || {};

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BackOffice MBE";
    workbook.created = new Date();

    const sheets = [
      {
        name: "Audit",
        rows: data.audit || [],
        columns: [
          { header: "DATE", key: "DATE", width: 14 },
          { header: "NUMERO SUIVI", key: "NUMERO SUIVI", width: 22 },
          { header: "Description (audited weight)", key: "Description (audited weight)", width: 32 },
          { header: "PRIX NET", key: "PRIX NET", width: 12 },
        ],
      },
      {
        name: "Liv. Particulier",
        rows: data.liv_particulier || [],
        columns: [
          { header: "REFERENCE", key: "REFERENCE", width: 32 },
          { header: "DATE", key: "DATE", width: 14 },
          { header: "NUMERO SUIVI", key: "NUMERO SUIVI", width: 22 },
          { header: "Description", key: "Description", width: 20 },
        ],
      },
      {
        name: "Résidence",
        rows: data.residence || [],
        columns: [
          { header: "REFERENCE", key: "REFERENCE", width: 32 },
          { header: "DATE", key: "DATE", width: 14 },
          { header: "NUMERO SUIVI", key: "NUMERO SUIVI", width: 22 },
          { header: "Description", key: "Description", width: 26 },
        ],
      },
      {
        name: "Supp. Enlèvement",
        rows: data.suppenlevement || [],
        columns: [
          { header: "CLIENT", key: "CLIENT", width: 36 },
          { header: "DATE DEMANDE", key: "DATE DEMANDE", width: 16 },
          { header: "NUMERO DEMANDE", key: "NUMERO DEMANDE", width: 18 },
          { header: "DESCRIPTION", key: "DESCRIPTION", width: 36 },
          { header: "PRIX NET", key: "PRIX NET", width: 12 },
          { header: "PRIX VENTE", key: "PRIX VENTE", width: 12 },
        ],
      },
    ];

    for (const s of sheets) {
      const ws = workbook.addWorksheet(s.name);
      ws.columns = s.columns;
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      for (const r of s.rows) {
        ws.addRow(r);
      }
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="facture_ups_${timestamp}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[/ups/export] error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de l'export." });
  }
});

/**
 * POST /api/invoices/tnt/process
 * multipart/form-data : champs "pdf" (1 PDF TNT) + "hub" (Excel HUB)
 * Réponse : { bt_non_identifiables, services_options, poids_differents }
 */
router.post(
  "/tnt/process",
  uploadTnt.fields([
    { name: "pdf", maxCount: 1 },
    { name: "hub", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files || {};
    const pdfFile = files.pdf?.[0];
    const hubFile = files.hub?.[0];

    if (!pdfFile) {
      return res.status(400).json({ error: "Champ 'pdf' manquant." });
    }
    if (!hubFile) {
      return res.status(400).json({ error: "Champ 'hub' manquant." });
    }

    const paths = [pdfFile.path, hubFile.path];
    try {
      const data = await runPythonScript(PROCESS_TNT, paths);
      res.json(data);
    } catch (err) {
      console.error("[/tnt/process] error:", err);
      res
        .status(500)
        .json({ error: err.message || "Erreur lors du traitement TNT." });
    } finally {
      for (const p of paths) {
        unlink(p).catch(() => {});
      }
    }
  }
);

/**
 * POST /api/invoices/tnt/export
 * Body JSON : { bt_non_identifiables, services_options, poids_differents }
 * Réponse : fichier .xlsx avec 3 feuilles
 */
router.post("/tnt/export", async (req, res) => {
  const data = req.body || {};

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "BackOffice MBE";
    workbook.created = new Date();

    const sheets = [
      {
        name: "BT non identifiables",
        rows: data.bt_non_identifiables || [],
        columns: [{ header: "Ligne_PDF", key: "Ligne_PDF", width: 80 }],
      },
      {
        name: "Services & Options",
        rows: data.services_options || [],
        columns: [
          { header: "CLIENT", key: "CLIENT", width: 80 },
          { header: "OPTION", key: "OPTION", width: 20 },
        ],
      },
      {
        name: "Poids différents",
        rows: data.poids_differents || [],
        columns: [
          { header: "CLIENT", key: "CLIENT", width: 80 },
          { header: "Saisie MBE OnLine", key: "Saisie MBE OnLine", width: 18 },
          { header: "Régularisation", key: "Régularisation", width: 16 },
          { header: "SC", key: "SC", width: 10 },
          { header: "TOTAL", key: "TOTAL", width: 12 },
        ],
      },
    ];

    for (const s of sheets) {
      const ws = workbook.addWorksheet(s.name);
      ws.columns = s.columns;
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
      };
      for (const r of s.rows) {
        ws.addRow(r);
      }
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="facture_tnt_${timestamp}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[/tnt/export] error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de l'export TNT." });
  }
});

export default router;
