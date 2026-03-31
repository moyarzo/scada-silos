const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MQTT
const client = mqtt.connect("mqtt://localhost:1883");

client.on("connect", () => {
  console.log("MQTT conectado");
  client.subscribe("silos/nivel/#");
});

client.on("message", (topic, message) => {
  const parts = topic.split("/");
  const tanque = parts[2];

  io.emit("nivel", {
    tanque,
    nivel: message.toString()
  });
});

// TURNOS
const FILE = path.join(__dirname, "turnData.json");

function read() {
  try { return JSON.parse(fs.readFileSync(FILE)); }
  catch { return {}; }
}

function write(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function checkShift(totals) {
  const h = new Date().getHours();
  let d = read();
  let t = today();

  if (!d[t]) d[t] = {};

  if (h >= 8 && !d[t].start) d[t].start = totals;
  if (h >= 18 && !d[t].end) d[t].end = totals;

  write(d);
}

io.on("connection", s => {
  s.on("totals", checkShift);
  s.on("getTurnData", () => {
    s.emit("turnData", read()[today()] || {});
  });
});

app.use(express.static(__dirname));

server.listen(3000, () => console.log("Servidor 3000"));
