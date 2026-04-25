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

const PRODUCTS = {
  "DL-5": { density: 1300 },
  "VE-03": { density: 1370 },
  "ASE": { density: 800 }
};

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
const SILO_HISTORY_FILE = path.join(__dirname, "siloHistoryData.json");
const TEMPLATE_FILE = path.join(__dirname, "template.xlsx");
const EXPORTS_DIR = path.join(__dirname, "exports");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// ===== ARCHIVOS =====

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

// ===== TIEMPO LOCAL VM =====

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

function getRounded5MinLabel() {
  var now = new Date();
  var rounded = Math.floor(now.getMinutes() / 5) * 5;
  return pad2(now.getHours()) + ":" + pad2(rounded);
}

function getServerTime() {
  return new Date().toLocaleTimeString("es-CL", {
    hour12: false
  });
}

function getLast30DateKeys() {
  var dates = [];
  var i;

  for (i = 29; i >= 0; i--) {
    dates.push(getDateKeyDaysAgo(i));
  }

  return dates;
}

// ===== CONFIG PRODUCTOS =====

function getSiloProducts() {
  var cfg = readJson(CONFIG_FILE, DEFAULT_SILO_PRODUCTS);
  var merged = Object.assign({}, DEFAULT_SILO_PRODUCTS);

  Object.keys(cfg || {}).forEach(function (tanque) {
    if (merged[tanque] && PRODUCTS[cfg[tanque]]) {
      merged[tanque] = cfg[tanque];
    }
  });

  return merged;
}

function setSiloProduct(tanque, product) {
  if (!DEFAULT_SILO_PRODUCTS[tanque]) return;
  if (!PRODUCTS[product]) return;

  var cfg = getSiloProducts();
  cfg[tanque] = product;
  writeJson(CONFIG_FILE, cfg);
}

// ===== CÁLCULOS =====

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

  Object.keys(latestSilos).forEach(function (tanque) {
    var product = siloProducts[tanque];
    var volume = latestSilos[tanque].volume || 0;
    var ton = (volume * PRODUCTS[product].density) / 1000;
    totals[product] += ton;
  });

  return totals;
}

// ===== HISTORIAL PRODUCTOS =====

function getDefaultHistoryDay() {
  return {
    "DL-5": [],
    "VE-03": [],
    "ASE": []
  };
}

function getTodayHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  return allHistory[today()] || getDefaultHistoryDay();
}

function getProductHistoryByDate(dateKey) {
  var allHistory = readJson(HISTORY_FILE, {});
  return allHistory[dateKey] || getDefaultHistoryDay();
}

function getMonthlyHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  var result = {};
  var i;
  var key;

  for (i = 29; i >= 0; i--) {
    key = getDateKeyDaysAgo(i);
    result[key] = allHistory[key] || getDefaultHistoryDay();
  }

  return result;
}

// ===== HISTORIAL POR SILO (% LLENADO) =====

function getDefaultSiloHistoryDay() {
  return {
    tanque1: [],
    tanque2: [],
    tanque3: [],
    tanque4: [],
    tanque5: [],
    tanque6: [],
    tanque7: [],
    tanque8: []
  };
}

function getTodaySiloHistory() {
  var allHistory = readJson(SILO_HISTORY_FILE, {});
  return allHistory[today()] || getDefaultSiloHistoryDay();
}

function getSiloHistoryByDate(dateKey) {
  var allHistory = readJson(SILO_HISTORY_FILE, {});
  return allHistory[dateKey] || getDefaultSiloHistoryDay();
}

// ===== GUARDADO HISTÓRICO =====

function updatePersistentHistory() {
  var allHistory = readJson(HISTORY_FILE, {});
  var siloHistory = readJson(SILO_HISTORY_FILE, {});
  var day = today();
  var label = getRounded5MinLabel();
  var totals = getCurrentTotalsFromBackend();

  if (!allHistory[day]) {
    allHistory[day] = getDefaultHistoryDay();
  }

  Object.keys(totals).forEach(function (product) {
    var arr = allHistory[day][product] || [];
    var lastEntry = arr[arr.length - 1];

    if (!lastEntry) {
      arr.push({ time: label, value: totals[product] });
    } else if (lastEntry.time !== label) {
      arr.push({ time: label, value: totals[product] });
    } else {
      lastEntry.value = totals[product];
    }

    allHistory[day][product] = arr;
  });

  if (!siloHistory[day]) {
    siloHistory[day] = getDefaultSiloHistoryDay();
  }

  Object.keys(latestSilos).forEach(function (tanque) {
    var arr = siloHistory[day][tanque] || [];
    var lastEntry = arr[arr.length - 1];
    var percent = latestSilos[tanque].percent || 0;

    if (!lastEntry) {
      arr.push({ time: label, value: percent });
    } else if (lastEntry.time !== label) {
      arr.push({ time: label, value: percent });
    } else {
      lastEntry.value = percent;
    }

    siloHistory[day][tanque] = arr;
  });

  writeJson(HISTORY_FILE, allHistory);
  writeJson(SILO_HISTORY_FILE, siloHistory);

  io.emit("historyData", {
    date: day,
    history: getTodayHistory()
  });

  io.emit("siloTrendData", {
    date: day,
    history: getTodaySiloHistory()
  });
}

// ===== VARIACIONES DIARIAS =====

function calculateDailyVariations() {
  var history = getTodayHistory();
  var currentTotals = getCurrentTotalsFromBackend();

  var variations = {
    "DL-5": { positive: 0, negative: 0 },
    "VE-03": { positive: 0, negative: 0 },
    "ASE": { positive: 0, negative: 0 }
  };

  Object.keys(variations).forEach(function (product) {
    var arr = (history[product] || []).slice();

    arr.sort(function (a, b) {
      return String(a.time).localeCompare(String(b.time));
    });

    var current = Number(currentTotals[product] || 0);
    var last = arr.length > 0 ? Number(arr[arr.length - 1].value) : null;

    if (last == null || Number.isNaN(last)) {
      arr.push({
        time: getRounded5MinLabel(),
        value: current
      });
    } else if (last !== current) {
      arr.push({
        time: getRounded5MinLabel(),
        value: current
      });
    }

    for (var i = 1; i < arr.length; i++) {
      var prev = Number(arr[i - 1].value);
      var curr = Number(arr[i].value);

      if (Number.isNaN(prev) || Number.isNaN(curr)) continue;

      var diff = curr - prev;

      if (diff > 0) {
        variations[product].positive += diff;
      } else if (diff < 0) {
        variations[product].negative += Math.abs(diff);
      }
    }
  });

  return variations;
}

// ===== EXPORTACIÓN CONTINUA 30 DÍAS / 24H X 5 MIN =====

function getFullDay5MinLabels() {
  var labels = [];
  var h;
  var m;

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

  Object.keys(dayData || {}).forEach(function (product) {
    (dayData[product] || []).forEach(function (item) {
      map[product][item.time] = Number(item.value);
    });
  });

  labels.forEach(function (time) {
    var row = { time: time, values: {} };

    ["DL-5", "VE-03", "ASE"].forEach(function (product) {
      if (Object.prototype.hasOwnProperty.call(map[product], time)) {
        carryValues[product] = map[product][time];
      }

      row.values[product] = carryValues[product];
    });

    result.push(row);
  });

  return result;
}

function buildTrendCsv() {
  var monthly = getMonthlyHistory();
  var dayKeys = Object.keys(monthly).sort();
  var csv = "Fecha,Hora,DL-5,VE-03,ASE\n";
  var carryValues = {
    "DL-5": 0,
    "VE-03": 0,
    "ASE": 0
  };

  dayKeys.forEach(function (dayKey) {
    var dayData = monthly[dayKey] || getDefaultHistoryDay();
    var rows = buildContinuousDaySeries(dayData, carryValues);

    rows.forEach(function (row) {
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
  var h = new Date().getHours();
  var d = readJson(TURN_FILE, {});
  var t = today();
  var totals = getCurrentTotalsFromBackend();

  if (!d[t]) d[t] = {};

  if (h >= 7 && !d[t].start) {
    d[t].start = totals;
  }

  if (h >= 19 && !d[t].end) {
    d[t].end = totals;
  }

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
  var variations = calculateDailyVariations();
  var siloProducts = getSiloProducts();

  var i;
  var row;
  var tanque;
  var product;
  var volume;
  var massTon;

  // Totalizadores
  sheet.getCell("C4").value = Number(totals["DL-5"].toFixed(1));
  sheet.getCell("D4").value = Number(totals["ASE"].toFixed(1));
  sheet.getCell("E4").value = Number(totals["VE-03"].toFixed(1));

  // Registro turno inicial
  sheet.getCell("C9").value =
    turn.start && turn.start["DL-5"] != null
      ? Number(turn.start["DL-5"].toFixed(1))
      : "";

  sheet.getCell("D9").value =
    turn.start && turn.start["ASE"] != null
      ? Number(turn.start["ASE"].toFixed(1))
      : "";

  sheet.getCell("E9").value =
    turn.start && turn.start["VE-03"] != null
      ? Number(turn.start["VE-03"].toFixed(1))
      : "";

  // Registro turno final
  sheet.getCell("C10").value =
    turn.end && turn.end["DL-5"] != null
      ? Number(turn.end["DL-5"].toFixed(1))
      : "";

  sheet.getCell("D10").value =
    turn.end && turn.end["ASE"] != null
      ? Number(turn.end["ASE"].toFixed(1))
      : "";

  sheet.getCell("E10").value =
    turn.end && turn.end["VE-03"] != null
      ? Number(turn.end["VE-03"].toFixed(1))
      : "";

  // Variación positiva
  sheet.getCell("C11").value = Number(variations["DL-5"].positive.toFixed(1));
  sheet.getCell("D11").value = Number(variations["ASE"].positive.toFixed(1));
  sheet.getCell("E11").value = Number(variations["VE-03"].positive.toFixed(1));

  // Variación negativa
  sheet.getCell("C12").value = Number(variations["DL-5"].negative.toFixed(1));
  sheet.getCell("D12").value = Number(variations["ASE"].negative.toFixed(1));
  sheet.getCell("E12").value = Number(variations["VE-03"].negative.toFixed(1));

  // Toneladas por silo
  for (i = 1; i <= 8; i++) {
    row = 16 + i; // Silo 1 = fila 17, Silo 8 = fila 24
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

// ===== MQTT DELTA HMI =====

function uint32ToFloatWordSwap(uintValue) {
  var buffer = Buffer.allocUnsafe(4);

  buffer.writeUInt32BE(uintValue >>> 0, 0);

  var swapped = Buffer.from([
    buffer[2],
    buffer[3],
    buffer[0],
    buffer[1]
  ]);

  return swapped.readFloatBE(0);
}

function extractDeltaRawValue(payload) {
  var key;

  if (!payload || !payload.d) return null;

  for (key in payload.d) {
    if (key !== "type") {
      return payload.d[key];
    }
  }

  return null;
}

var client = mqtt.connect("mqtt://localhost:1883");

client.on("connect", function () {
  console.log("MQTT conectado");
  client.subscribe("planta/losbronces/silos/#");
});

client.on("message", function (topic, message) {
  try {
    var parts = topic.split("/");
    var tanque = parts[parts.length - 1];
    var payload;
    var rawValue;
    var rawUint32;
    var sensorDistance;
    var level;
    var volume;
    var percent;

    if (!latestSilos[tanque]) return;

    payload = JSON.parse(message.toString());
    rawValue = extractDeltaRawValue(payload);

    if (rawValue == null) return;

    rawUint32 = parseInt(rawValue, 10);
    if (Number.isNaN(rawUint32)) return;

    sensorDistance = uint32ToFloatWordSwap(rawUint32);

    if (Number.isNaN(sensorDistance)) return;
    if (!Number.isFinite(sensorDistance)) return;

    // Ajuste fino solicitado
    sensorDistance = sensorDistance * 0.98;

    // Radar montado arriba:
    // 0 = lleno, MAX_HEIGHT = vacío
    sensorDistance = Math.max(0, Math.min(MAX_HEIGHT, sensorDistance));

    level = MAX_HEIGHT - sensorDistance;
    level = Math.max(0, Math.min(MAX_HEIGHT, level));

    volume = calculateVolume(level);
    percent = (level / MAX_HEIGHT) * 100;

    latestSilos[tanque] = {
      levelMeters: level,
      volume: volume,
      percent: percent
    };

    io.emit("nivel", {
      tanque: tanque,
      nivel: String(sensorDistance),
      serverTime: getServerTime()
    });

    io.emit("siloState", latestSilos);

    console.log(
      "MQTT recibido:",
      tanque,
      "distance_m=" + sensorDistance.toFixed(3),
      "level_m=" + level.toFixed(3),
      "percent=" + percent.toFixed(2)
    );
  } catch (error) {
    console.error("Error procesando MQTT:", error, message.toString());
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
    var fileName = "tendencia_30_dias_" + formatDateYYYYMMDD() + ".csv";

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
  socket.on("getTurnData", function (payload) {
    var data = readJson(TURN_FILE, {});
    var dateKey = payload && payload.date ? payload.date : today();

    socket.emit("turnData", {
      date: dateKey,
      data: data[dateKey] || {}
    });
  });

  socket.on("getSiloConfig", function () {
    socket.emit("siloConfig", getSiloProducts());
  });

  socket.on("setSiloProduct", function (payload) {
    if (!payload) return;

    setSiloProduct(payload.tanque, payload.product);
    io.emit("siloConfig", getSiloProducts());
  });

  socket.on("getHistoryDates", function () {
    socket.emit("historyDates", getLast30DateKeys());
  });

  socket.on("getHistoryData", function (payload) {
    var dateKey = payload && payload.date ? payload.date : today();

    socket.emit("historyData", {
      date: dateKey,
      history: getProductHistoryByDate(dateKey)
    });
  });

  socket.on("getSiloTrendData", function (payload) {
    var dateKey = payload && payload.date ? payload.date : today();

    socket.emit("siloTrendData", {
      date: dateKey,
      history: getSiloHistoryByDate(dateKey)
    });
  });

  socket.on("getSiloState", function () {
    socket.emit("siloState", latestSilos);
  });
});

app.use(express.static(__dirname));

server.listen(3000, "0.0.0.0", function () {
  console.log("Servidor 3000");
});
