const express = require("express");
const http = require("http");
const Server = require("socket.io").Server;
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const ExcelJS = require("exceljs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// CONFIG
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
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getSiloProducts() {
  var cfg = readJson(CONFIG_FILE, DEFAULT_SILO_PRODUCTS);
  var merged = {};
  var tanque;

  for (tanque in DEFAULT_SILO_PRODUCTS) {
    merged[tanque] = DEFAULT_SILO_PRODUCTS[tanque];
  }

  for (tanque in cfg) {
    if (merged[tanque] && PRODUCTS[cfg[tanque]]) {
      merged[tanque] = cfg[tanque];
    }
  }

  return merged;
}

function setSiloProduct(tanque, product) {
  if (!DEFAULT_SILO_PRODUCTS[tanque]) return;
  if (!PRODUCTS[product]) return;

  var cfg = getSiloProducts();
  cfg[tanque] = product;
  writeJson(CONFIG_FILE, cfg);
}

function calculateVolume(level) {
  var safeLevel = Math.max(0, Math.min(MAX_HEIGHT, level));

  if (safeLevel <= CONE_HEIGHT) {
    return V_CONE * Math.pow(safeLevel / CONE_HEIGHT, 3);
  }

  return V_CONE + V_CYL * ((safeLevel - CONE_HEIGHT) / CYL_HEIGHT);
}

function getCurrentTotalsFromBackend() {
  var totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };
  var siloProducts = getSiloProducts();
  var tanque, product, volume, density, ton;

  for (tanque in latestSilos) {
    product = siloProducts[tanque];
    volume = latestSilos[tanque].volume || 0;
    density = PRODUCTS[product].density;
    ton = (volume * density) / 1000;
    totals[product] += ton;
  }

  return totals;
}

// ===== TIEMPO LOCAL DE LA VM =====

function pad2(n) {
  return String(n).padStart(2, "0");
}

function today() {
  var now = new Date();
  return (
    now.getFullYear() +
    "-" +
    pad2(now.getMonth() + 1) +
    "-" +
    pad2(now.getDate())
  );
}

function formatDateYYYYMMDD(dateObj) {
  var date = dateObj || new Date();
  return (
    date.getFullYear() +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate())
  );
}

function getDateKeyDaysAgo(daysAgo) {
  var date = new Date();
  date.setDate(date.getDate() - daysAgo);

  return (
    date.getFullYear() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate())
  );
}

function getCurrentHour() {
  return new Date().getHours();
}

function getRounded5MinLabel() {
  var now = new Date();
  var minutes = now.getMinutes();
  var rounded = Math.floor(minutes / 5) * 5;

  return pad2(now.getHours()) + ":" + pad2(rounded);
}

// ===== HISTORIAL =====

function getDefaultHistoryDay() {
  return {
    "DL-5": [],
    "VE-03": [],
    "ASE": []
  };
}

function updatePersistentHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  var day = today();
  var label = getRounded5MinLabel();
  var totals = getCurrentTotalsFromBackend();
  var product, arr, lastEntry;

  if (!allHistory[day]) {
    allHistory[day] = getDefaultHistoryDay();
  }

  for (product in totals) {
    arr = allHistory[day][product] || [];
    lastEntry = arr[arr.length - 1];

    if (!lastEntry) {
      arr.push({ time: label, value: totals[product] });
    } else if (lastEntry.time !== label) {
      arr.push({ time: label, value: totals[product] });
    } else {
      lastEntry.value = totals[product];
    }

    allHistory[day][product] = arr;
  }

  writeJson(HISTORY_FILE, allHistory);
  io.emit("historyData", getTodayHistory());
}

function getTodayHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  return allHistory[today()] || getDefaultHistoryDay();
}

function getWeeklyHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  var result = {};
  var i, key;

  for (i = 6; i >= 0; i--) {
    key = getDateKeyDaysAgo(i);
    result[key] = allHistory[key] || getDefaultHistoryDay();
  }

  return result;
}

// ===== EXPORTACIÓN CONTINUA 24H X 5 MIN =====

function getFullDay5MinLabels() {
  var labels = [];
  var h, m;

  for (h = 0; h < 24; h++) {
    for (m = 0; m < 60; m += 5) {
      labels.push(pad2(h) + ":" + pad2(m));
    }
  }

  return labels;
}

function buildContinuousDaySeries(dayData, carryValues) {
  var labels = getFullDay5MinLabels();
  var result = [];
  var map = { "DL-5": {}, "VE-03": {}, "ASE": {} };
  var product, i, time, row;

  for (product in dayData) {
    dayData[product].forEach(function (item) {
      map[product][item.time] = Number(item.value);
    });
  }

  for (i = 0; i < labels.length; i++) {
    time = labels[i];
    row = { time: time, values: {} };

    ["DL-5", "VE-03", "ASE"].forEach(function (p) {
      if (Object.prototype.hasOwnProperty.call(map[p], time)) {
        carryValues[p] = map[p][time];
      }
      row.values[p] = carryValues[p];
    });

    result.push(row);
  }

  return result;
}

function buildTrendCsv() {
  var weekly = getWeeklyHistory();
  var dayKeys = Object.keys(weekly).sort();
  var csv = "Fecha,Hora,DL-5,VE-03,ASE\n";
  var carryValues = {
    "DL-5": 0,
    "VE-03": 0,
    "ASE": 0
  };

  dayKeys.forEach(function (dayKey) {
    var dayData = weekly[dayKey] || getDefaultHistoryDay();
    var continuousRows = buildContinuousDaySeries(dayData, carryValues);

    continuousRows.forEach(function (row) {
      csv += [
        dayKey,
        row.time,
        Number(row.values["DL-5"]).toFixed(2),
        Number(row.values["VE-03"]).toFixed(2),
        Number(row.values["ASE"]).toFixed(2)
      ].join(",") + "\n";
    });
  });

  return csv;
}

// ===== TURNOS =====

function checkShift() {
  var h = getCurrentHour();
  var d = readJson(TURN_FILE, {});
  var t = today();
  var totals = getCurrentTotalsFromBackend();

  if (!d[t]) d[t] = {};

  if (h >= 7 && !d[t].start) d[t].start = totals;
  if (h >= 19 && !d[t].end) d[t].end = totals;

  writeJson(TURN_FILE, d);
  io.emit("turnData", d[t] || {});
}

function getTodayTurnData() {
  var data = readJson(TURN_FILE, {});
  return data[today()] || {};
}

// ===== EXCEL =====

async function buildExportExcel() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error("No se encontró template.xlsx en la carpeta del proyecto");
  }

  var workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_FILE);

  var sheet = workbook.getWorksheet("Hoja1");
  if (!sheet) {
    throw new Error('No se encontró la hoja "Hoja1" en template.xlsx');
  }

  var totals = getCurrentTotalsFromBackend();
  var turn = getTodayTurnData();
  var siloProducts = getSiloProducts();
  var i, row, tanque, product, volume, massTon;

  sheet.getCell("C4").value = Number(totals["DL-5"].toFixed(1));
  sheet.getCell("D4").value = Number(totals["ASE"].toFixed(1));
  sheet.getCell("E4").value = Number(totals["VE-03"].toFixed(1));

  sheet.getCell("C9").value = (turn.start && turn.start["DL-5"] != null) ? Number(turn.start["DL-5"].toFixed(1)) : "";
  sheet.getCell("D9").value = (turn.start && turn.start["ASE"] != null) ? Number(turn.start["ASE"].toFixed(1)) : "";
  sheet.getCell("E9").value = (turn.start && turn.start["VE-03"] != null) ? Number(turn.start["VE-03"].toFixed(1)) : "";

  sheet.getCell("C10").value = (turn.end && turn.end["DL-5"] != null) ? Number(turn.end["DL-5"].toFixed(1)) : "";
  sheet.getCell("D10").value = (turn.end && turn.end["ASE"] != null) ? Number(turn.end["ASE"].toFixed(1)) : "";
  sheet.getCell("E10").value = (turn.end && turn.end["VE-03"] != null) ? Number(turn.end["VE-03"].toFixed(1)) : "";

  for (i = 1; i <= 8; i++) {
    row = 14 + i;
    tanque = "tanque" + i;
    product = siloProducts[tanque];
    volume = latestSilos[tanque] ? latestSilos[tanque].volume || 0 : 0;
    massTon = (volume * PRODUCTS[product].density) / 1000;

    sheet.getCell("C" + row).value = product;
    sheet.getCell("D" + row).value = Number(massTon.toFixed(2));
  }

  var fileName = "stock_diario_" + formatDateYYYYMMDD() + ".xlsx";
  var filePath = path.join(EXPORTS_DIR, fileName);

  await workbook.xlsx.writeFile(filePath);

  return { fileName: fileName, filePath: filePath };
}

// ===== MQTT =====

var client = mqtt.connect("mqtt://localhost:1883");

client.on("connect", function () {
  console.log("MQTT conectado");
  client.subscribe("planta/losbronces/silos/#");
});

client.on("message", function (topic, message) {
  try {
    var parts = topic.split("/");
    var tanque = parts[parts.length - 1];
    var level = parseFloat(message.toString());

    if (!latestSilos[tanque]) return;
    if (Number.isNaN(level)) return;

    level = Math.max(0, Math.min(MAX_HEIGHT, level));

    var volume = calculateVolume(level);
    var percent = (level / MAX_HEIGHT) * 100;

    latestSilos[tanque] = {
      levelMeters: level,
      volume: volume,
      percent: percent
    };

    io.emit("siloState", latestSilos);

    console.log("MQTT nivel recibido:", topic, level);

  } catch (error) {
    console.error("Error procesando MQTT nivel:", error, message.toString());
  }
});

// ===== TAREAS =====

setInterval(checkShift, 60000);
setInterval(updatePersistentHistory, 60000);

// ===== RUTAS =====

app.get("/export-data", async function (req, res) {
  try {
    var exportFile = await buildExportExcel();
    return res.download(exportFile.filePath, exportFile.fileName);
  } catch (error) {
    console.error("Error generando Excel:", error);
    return res.status(500).send("No fue posible generar el archivo Excel");
  }
});

app.get("/export-trend", function (req, res) {
  try {
    var csv = buildTrendCsv();
    var fileName = "tendencia_semanal_" + formatDateYYYYMMDD() + ".csv";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=" + fileName);
    return res.send(csv);
  } catch (error) {
    console.error("Error generando CSV:", error);
    return res.status(500).send("No fue posible generar el archivo CSV");
  }
});

// ===== SOCKET =====

io.on("connection", function (socket) {
  socket.on("getTurnData", function () {
    var data = readJson(TURN_FILE, {});
    socket.emit("turnData", data[today()] || {});
  });

  socket.on("getSiloConfig", function () {
    socket.emit("siloConfig", getSiloProducts());
  });

  socket.on("setSiloProduct", function (payload) {
    if (!payload) return;
    setSiloProduct(payload.tanque, payload.product);
    io.emit("siloConfig", getSiloProducts());
  });

  socket.on("getHistoryData", function () {
    socket.emit("historyData", getTodayHistory());
  });

  socket.on("getSiloState", function () {
    socket.emit("siloState", latestSilos);
  });
});

app.use(express.static(__dirname));

server.listen(3000, "0.0.0.0", function () {
  console.log("Servidor 3000");
});
