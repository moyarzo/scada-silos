const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// CONFIG BACKEND
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;
const V_TOTAL = 46.168;

const ratio = (1 / 3) * (CONE_HEIGHT / CYL_HEIGHT);
const V_CYL = V_TOTAL / (1 + ratio);
const V_CONE = V_TOTAL - V_CYL;

const DEFAULT_SILO_PRODUCTS = {
  tanque1: "DL-5",
  tanque2: "DL-5",
  tanque3: "DL-5",
  tanque4: "DL-5",
  tanque5: "DL-5",
  tanque6: "ASE",
  tanque7: "DL-5",
  tanque8: "DL-5"
};

const PRODUCTS = {
  "DL-5": { density: 1300 },
  "VE-03": { density: 1370 },
  "ASE": { density: 800 }
};

const EMAIL_RECIPIENTS = ["marco.oyarzo@enaex.com"];
const EMAIL_SUBJECT = "Stock diario de MM.PP";
const EMAIL_BODY = 'Se envía registro diario de almacenamiento en silos y stock total en planta. Por favor no responder, ya que este correo fue creado automáticamente por el "Sistema Monitoreo Planta Los Bronces".';

const latestSilos = {
  tanque1: { levelMeters: 0, volume: 0, percent: 0 },
  tanque2: { levelMeters: 0, volume: 0, percent: 0 },
  tanque3: { levelMeters: 0, volume: 0, percent: 0 },
  tanque4: { levelMeters: 0, volume: 0, percent: 0 },
  tanque5: { levelMeters: 0, volume: 0, percent: 0 },
  tanque6: { levelMeters: 0, volume: 0, percent: 0 },
  tanque7: { levelMeters: 0, volume: 0, percent: 0 },
  tanque8: { levelMeters: 0, volume: 0, percent: 0 }
};

const TURN_FILE = path.join(__dirname, "turnData.json");
const CONFIG_FILE = path.join(__dirname, "siloConfig.json");
const HISTORY_FILE = path.join(__dirname, "historyData.json");
const TEMPLATE_FILE = path.join(__dirname, "template.xlsx");
const EXPORTS_DIR = path.join(__dirname, "exports");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    ensureJsonFile(filePath, fallback);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getSiloProducts() {
  const cfg = readJson(CONFIG_FILE, DEFAULT_SILO_PRODUCTS);
  const merged = { ...DEFAULT_SILO_PRODUCTS };

  Object.keys(cfg).forEach((tanque) => {
    if (merged[tanque] && PRODUCTS[cfg[tanque]]) {
      merged[tanque] = cfg[tanque];
    }
  });

  return merged;
}

function setSiloProduct(tanque, product) {
  if (!DEFAULT_SILO_PRODUCTS[tanque]) return;
  if (!PRODUCTS[product]) return;

  const cfg = getSiloProducts();
  cfg[tanque] = product;
  writeJson(CONFIG_FILE, cfg);
}

function calculateVolume(level) {
  const safeLevel = Math.max(0, Math.min(MAX_HEIGHT, level));

  if (safeLevel <= CONE_HEIGHT) {
    return V_CONE * Math.pow(safeLevel / CONE_HEIGHT, 3);
  }

  return V_CONE + V_CYL * ((safeLevel - CONE_HEIGHT) / CYL_HEIGHT);
}

function getCurrentTotalsFromBackend() {
  const totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };
  const siloProducts = getSiloProducts();

  Object.keys(latestSilos).forEach((tanque) => {
    const product = siloProducts[tanque];
    const volume = latestSilos[tanque].volume || 0;
    const density = PRODUCTS[product].density;
    const ton = (volume * density) / 1000;
    totals[product] += ton;
  });

  return totals;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function formatDateYYYYMMDD(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function getRounded5MinLabel() {
  const now = new Date();
  const minutes = now.getMinutes();
  const rounded = Math.floor(minutes / 5) * 5;
  return `${String(now.getHours()).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
}

function getDefaultHistoryDay() {
  return {
    "DL-5": [],
    "VE-03": [],
    "ASE": []
  };
}

function updatePersistentHistory() {
  const allHistory = readJson(HISTORY_FILE, {});
  const day = today();
  const label = getRounded5MinLabel();
  const totals = getCurrentTotalsFromBackend();

  if (!allHistory[day]) {
    allHistory[day] = getDefaultHistoryDay();
  }

  Object.keys(totals).forEach((product) => {
    const arr = allHistory[day][product] || [];
    const lastEntry = arr[arr.length - 1];

    if (!lastEntry) {
      arr.push({ time: label, value: totals[product] });
    } else if (lastEntry.time !== label) {
      arr.push({ time: label, value: totals[product] });
    } else {
      lastEntry.value = totals[product];
    }

    allHistory[day][product] = arr;
  });

  writeJson(HISTORY_FILE, allHistory);
  io.emit("historyData", getTodayHistory());
}

function getTodayHistory() {
  const allHistory = readJson(HISTORY_FILE, {});
  return allHistory[today()] || getDefaultHistoryDay();
}

function checkShift() {
  const h = new Date().getHours();
  const d = readJson(TURN_FILE, {});
  const t = today();
  const totals = getCurrentTotalsFromBackend();

  if (!d[t]) d[t] = {};

  if (h >= 7 && !d[t].start) d[t].start = totals;
  if (h >= 19 && !d[t].end) d[t].end = totals;

  writeJson(TURN_FILE, d);
  io.emit("turnData", d[t] || {});
}

function getTodayTurnData() {
  const data = readJson(TURN_FILE, {});
  return data[today()] || {};
}

function createMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Faltan variables de entorno GMAIL_USER o GMAIL_APP_PASSWORD");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass
    }
  });
}

async function buildExportExcel() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error("No se encontró template.xlsx en la carpeta del proyecto");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_FILE);

  const sheet = workbook.getWorksheet("Hoja1");
  if (!sheet) {
    throw new Error('No se encontró la hoja "Hoja1" en template.xlsx');
  }

  const totals = getCurrentTotalsFromBackend();
  const turn = getTodayTurnData();
  const siloProducts = getSiloProducts();

  // Totalizador
  sheet.getCell("C4").value = Number(totals["DL-5"].toFixed(1));
  sheet.getCell("D4").value = Number(totals["ASE"].toFixed(1));
  sheet.getCell("E4").value = Number(totals["VE-03"].toFixed(1));

  // Registro turno
  sheet.getCell("C9").value = turn.start?.["DL-5"] != null ? Number(turn.start["DL-5"].toFixed(1)) : "";
  sheet.getCell("D9").value = turn.start?.["ASE"] != null ? Number(turn.start["ASE"].toFixed(1)) : "";
  sheet.getCell("E9").value = turn.start?.["VE-03"] != null ? Number(turn.start["VE-03"].toFixed(1)) : "";

  sheet.getCell("C10").value = turn.end?.["DL-5"] != null ? Number(turn.end["DL-5"].toFixed(1)) : "";
  sheet.getCell("D10").value = turn.end?.["ASE"] != null ? Number(turn.end["ASE"].toFixed(1)) : "";
  sheet.getCell("E10").value = turn.end?.["VE-03"] != null ? Number(turn.end["VE-03"].toFixed(1)) : "";

  // Almacenamiento por silo
  for (let i = 1; i <= 8; i++) {
    const row = 14 + i; // 15..22
    const tanque = `tanque${i}`;
    const product = siloProducts[tanque];
    const volume = latestSilos[tanque]?.volume || 0;
    const massTon = (volume * PRODUCTS[product].density) / 1000;

    sheet.getCell(`C${row}`).value = product;
    sheet.getCell(`D${row}`).value = Number(massTon.toFixed(2));
  }

  const fileName = `stock_diario_${formatDateYYYYMMDD()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  await workbook.xlsx.writeFile(filePath);

  return { fileName, filePath };
}

async function sendExportEmail() {
  const transporter = createMailTransporter();
  const { fileName, filePath } = await buildExportExcel();

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: EMAIL_RECIPIENTS.join(", "),
    subject: EMAIL_SUBJECT,
    text: EMAIL_BODY,
    attachments: [
      {
        filename: fileName,
        path: filePath
      }
    ]
  });

  return { fileName };
}

// MQTT
const client = mqtt.connect("mqtt://localhost:1883");

client.on("connect", () => {
  console.log("MQTT conectado");
  client.subscribe("silos/nivel/#");
});

client.on("message", (topic, message) => {
  try {
    const parts = topic.split("/");
    const tanque = parts[2];
    const distance = parseFloat(message.toString());

    if (!latestSilos[tanque] || Number.isNaN(distance)) return;

    const level = Math.max(0, Math.min(MAX_HEIGHT, MAX_HEIGHT - distance));
    const volume = calculateVolume(level);
    const percent = (level / MAX_HEIGHT) * 100;

    latestSilos[tanque] = {
      levelMeters: level,
      volume,
      percent
    };

    io.emit("nivel", {
      tanque,
      nivel: message.toString()
    });
  } catch (error) {
    console.error("Error procesando mensaje MQTT:", error);
  }
});

// tareas backend 24/7
setInterval(checkShift, 60000);
setInterval(updatePersistentHistory, 60000);

// SOCKET
io.on("connection", (socket) => {
  socket.on("getTurnData", () => {
    const data = readJson(TURN_FILE, {});
    socket.emit("turnData", data[today()] || {});
  });

  socket.on("getSiloConfig", () => {
    socket.emit("siloConfig", getSiloProducts());
  });

  socket.on("setSiloProduct", ({ tanque, product }) => {
    setSiloProduct(tanque, product);
    io.emit("siloConfig", getSiloProducts());
  });

  socket.on("getHistoryData", () => {
    socket.emit("historyData", getTodayHistory());
  });

  socket.on("getSiloState", () => {
    socket.emit("siloState", latestSilos);
  });

  socket.on("exportData", async () => {
    try {
      await sendExportEmail();
      socket.emit("exportResult", { ok: true });
    } catch (error) {
      console.error("Error exportando y enviando correo:", error);
      socket.emit("exportResult", {
        ok: false,
        error: error.message || "No fue posible enviar el correo"
      });
    }
  });
});

app.use(express.static(__dirname));

server.listen(3000, () => {
  console.log("Servidor 3000");
});
