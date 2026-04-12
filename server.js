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

// -------- FILES --------
const HISTORY_FILE = path.join(__dirname, "historyData.json");
const TEMPLATE_FILE = path.join(__dirname, "template.xlsx");

function readJson(file, def) {
  if (!fs.existsSync(file)) return def;
  return JSON.parse(fs.readFileSync(file));
}

// -------- HISTORIAL SEMANAL --------
function getWeeklyHistory() {
  const all = readJson(HISTORY_FILE, {});
  const result = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    result[key] = all[key] || { "DL-5":[], "VE-03":[], "ASE":[] };
  }
  return result;
}

// -------- CSV --------
app.get("/export-trend", (req, res) => {
  const weekly = getWeeklyHistory();
  let csv = "Fecha,Hora,DL-5,VE-03,ASE\n";

  Object.keys(weekly).forEach(day => {
    const data = weekly[day];

    let times = {};
    Object.values(data).forEach(arr => {
      arr.forEach(x => times[x.time] = true);
    });

    Object.keys(times).sort().forEach(t => {
      let row = [day, t];

      ["DL-5","VE-03","ASE"].forEach(p => {
        const f = data[p].find(x => x.time === t);
        row.push(f ? f.value : "");
      });

      csv += row.join(",") + "\n";
    });
  });

  res.setHeader("Content-Disposition","attachment; filename=tendencia.csv");
  res.send(csv);
});

// -------- EXCEL --------
app.get("/export-data", async (req, res) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_FILE);

  const file = "stock.xlsx";
  await wb.xlsx.writeFile(file);

  res.download(file);
});

// -------- SOCKET --------
io.on("connection", (socket) => {
  socket.emit("historyData", readJson(HISTORY_FILE, {}));
});

// -------- SERVER --------
app.use(express.static(__dirname));
server.listen(3000, () => console.log("Servidor OK"));
