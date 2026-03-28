const express = require("express");
const http = require("http");
const mqtt = require("mqtt");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ===============================
// CONFIGURACIÓN MQTT (CLOUD READY)
// ===============================

const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";

const client = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined
});

// ===============================
// CONEXIÓN MQTT
// ===============================

client.on("connect", () => {
  console.log("✅ Conectado a MQTT:", MQTT_URL);
  client.subscribe("estanques/#");
});

client.on("error", (err) => {
  console.error("❌ Error MQTT:", err);
});

client.on("message", (topic, message) => {
  const tanque = topic.split("/")[1];

  io.emit("nivel", {
    tanque,
    nivel: message.toString()
  });
});

// ===============================
// SERVIDOR WEB
// ===============================

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 SCADA corriendo en puerto", PORT);
});