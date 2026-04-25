/* ==========================================================
   SCADA SILOS - app.js
   Compatible con index.html actual
   ========================================================== */

const socket = io();

const SILOS = 8;

const PRODUCTOS = {
  "DL-5": { densidad: 1300, color: "#2f80ed", maxTon: 420 },
  "VE-03": { densidad: 1370, color: "#9b51e0", maxTon: 60 },
  "ASE": { densidad: 800, color: "#27ae60", maxTon: 40 }
};

const ALTURA_CONO = 1.67;
const ALTURA_CILINDRO = 4.25;
const ALTURA_TOTAL = ALTURA_CONO + ALTURA_CILINDRO;
const VOLUMEN_TOTAL = 46.168;

let modo = "real";
let estadoSilos = {};
let productosSilos = {};
let charts = {};
let demoInterval = null;
let fechaSeleccionada = fechaHoy();

/* ==========================================================
   INICIO
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  inicializarProductos();
  crearPanelSuperior();
  crearTarjetasYGraficos();
  inicializarEventos();
  inicializarGraficos();
  cargarFechasGraficos();

  socket.emit("request-current-state");
  socket.emit("request-product-assignments");
  cargarHistoricoFecha(fechaSeleccionada);
});

/* ==========================================================
   CREACIÓN HTML DINÁMICA
   ========================================================== */

function crearPanelSuperior() {
  const topPanel = document.getElementById("topPanel");
  if (!topPanel) return;

  topPanel.innerHTML = "";

  Object.keys(PRODUCTOS).forEach(producto => {
    const div = document.createElement("div");
    div.className = "summary-card";
    div.id = `summaryCard-${idProducto(producto)}`;

    div.innerHTML = `
      <h3>${producto}</h3>
      <div class="summary-line" id="total-${idProducto(producto)}">
        Totalizador: 0.0 ton
      </div>
      <div class="summary-line" id="turno-${idProducto(producto)}">
        Registro turno: 0.0 ton
      </div>
    `;

    topPanel.appendChild(div);
  });
}

function crearTarjetasYGraficos() {
  const grid = document.getElementById("grid");
  if (!grid) return;

  grid.innerHTML = "";

  for (let i = 1; i <= SILOS; i++) {
    const producto = productosSilos[i] || "DL-5";

    const card = document.createElement("div");
    card.className = "silo-card";
    card.id = `siloCard-${i}`;

    card.innerHTML = `
      <div class="silo-header">
        <h2>Silo ${i}</h2>

        <select class="product-select" id="productoSilo-${i}">
          <option value="DL-5">DL-5</option>
          <option value="VE-03">VE-03</option>
          <option value="ASE">ASE</option>
        </select>
      </div>

      <div class="silo-body">
        <div class="silo">
          <div class="silo-fill" id="fill-${i}"></div>
          <div class="silo-percent" id="percent-${i}">0%</div>
        </div>

        <div class="silo-info">
          <p><strong>Producto:</strong> <span id="productoLabel-${i}">${producto}</span></p>
          <p><strong>Densidad:</strong> <span id="densidad-${i}">${PRODUCTOS[producto].densidad}</span> kg/m³</p>
          <p><strong>Toneladas:</strong> <span id="tons-${i}">0.0</span> ton</p>
          <p><strong>Nivel:</strong> <span id="nivel-${i}">0.00</span> m</p>
        </div>
      </div>
    `;

    grid.appendChild(card);

    const select = document.getElementById(`productoSilo-${i}`);
    if (select) select.value = producto;
  }

  Object.keys(PRODUCTOS).forEach(producto => {
    const chartBox = document.createElement("div");
    chartBox.className = "chart-box";
    chartBox.id = `chartBox-${idProducto(producto)}`;

    chartBox.innerHTML = `
      <h2>Tendencia ${producto}</h2>
      <div class="chart-container">
        <canvas id="chart-${idProducto(producto)}"></canvas>
      </div>
    `;

    grid.appendChild(chartBox);
  });
}

/* ==========================================================
   EVENTOS
   ========================================================== */

function inicializarEventos() {
  document.querySelectorAll("input[name='mode']").forEach(radio => {
    radio.addEventListener("change", e => {
      modo = e.target.value;

      if (modo === "demo") {
        iniciarDemo();
      } else {
        detenerDemo();
        socket.emit("request-current-state");
      }
    });
  });

  for (let i = 1; i <= SILOS; i++) {
    const select = document.getElementById(`productoSilo-${i}`);

    if (select) {
      select.addEventListener("change", () => {
        productosSilos[i] = select.value;
        actualizarSilo(i);
        actualizarResumenActual();
        actualizarVisibilidadProductos();

        socket.emit("save-product-assignments", productosSilos);
      });
    }
  }

  const chartDateSelect = document.getElementById("chartDateSelect");

  if (chartDateSelect) {
    chartDateSelect.addEventListener("change", () => {
      fechaSeleccionada = chartDateSelect.value;
      cargarHistoricoFecha(fechaSeleccionada);
    });
  }

  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      window.location.href = `/download-data?date=${fechaSeleccionada}`;
    });
  }

  const exportTrendBtn = document.getElementById("exportTrendBtn");
  if (exportTrendBtn) {
    exportTrendBtn.addEventListener("click", () => {
      window.location.href = `/download-trend`;
    });
  }
}

/* ==========================================================
   SOCKET
   ========================================================== */

socket.on("connect", () => {
  socket.emit("request-current-state");
  socket.emit("request-product-assignments");
});

socket.on("product-assignments", data => {
  if (!data) return;

  productosSilos = { ...productosSilos, ...data };

  for (let i = 1; i <= SILOS; i++) {
    const select = document.getElementById(`productoSilo-${i}`);
    if (select) select.value = productosSilos[i] || "DL-5";

    actualizarSilo(i);
  }

  actualizarResumenActual();
  actualizarVisibilidadProductos();
});

socket.on("current-state", data => {
  if (!data) return;

  estadoSilos = data.silos || data;

  actualizarTodosLosSilos();
  actualizarResumenActual();

  if (data.lastMqttUpdate) {
    actualizarEstadoMqtt(data.lastMqttUpdate, true);
  }
});

socket.on("mqtt-update", data => {
  if (modo !== "real") return;
  if (!data) return;

  estadoSilos = { ...estadoSilos, ...data };

  actualizarTodosLosSilos();
  actualizarResumenActual();
  actualizarEstadoMqtt(new Date(), true);
});

socket.on("trend-update", data => {
  if (!data) return;

  if (data.date === fechaSeleccionada || !data.date) {
    cargarHistoricoFecha(fechaSeleccionada);
  }
});

/* ==========================================================
   SILOS
   ========================================================== */

function actualizarTodosLosSilos() {
  for (let i = 1; i <= SILOS; i++) {
    actualizarSilo(i);
  }
}

function actualizarSilo(i) {
  const producto = productosSilos[i] || "DL-5";
  const infoProducto = PRODUCTOS[producto];

  const data = estadoSilos[i] || estadoSilos[`silo${i}`] || {};
  const distancia = Number(data.distance ?? data.distancia ?? data.valor ?? 0);

  const nivel = calcularNivel(distancia);
  const porcentaje = limitar((nivel / ALTURA_TOTAL) * 100, 0, 100);
  const toneladas = calcularToneladas(nivel, producto);

  setText(`productoLabel-${i}`, producto);
  setText(`densidad-${i}`, infoProducto.densidad);
  setText(`tons-${i}`, toneladas.toFixed(1));
  setText(`nivel-${i}`, nivel.toFixed(2));
  setText(`percent-${i}`, `${porcentaje.toFixed(0)}%`);

  const fill = document.getElementById(`fill-${i}`);
  if (fill) {
    fill.style.height = `${porcentaje}%`;
    fill.style.background = infoProducto.color;
  }

  const percent = document.getElementById(`percent-${i}`);
  if (percent) {
    percent.style.color = infoProducto.color;
  }

  const card = document.getElementById(`siloCard-${i}`);
  if (card) {
    card.classList.remove("alarm-yellow", "alarm-red");

    if (porcentaje >= 90) {
      card.classList.add("alarm-red");
    } else if (porcentaje >= 85) {
      card.classList.add("alarm-yellow");
    }
  }
}

/* ==========================================================
   RESÚMENES
   ========================================================== */

function actualizarResumenActual() {
  const totales = calcularTotalesActuales();
  pintarResumen(totales);
}

function calcularTotalesActuales() {
  const totales = crearTotalesVacios();

  for (let i = 1; i <= SILOS; i++) {
    const producto = productosSilos[i] || "DL-5";
    const data = estadoSilos[i] || estadoSilos[`silo${i}`] || {};
    const distancia = Number(data.distance ?? data.distancia ?? data.valor ?? 0);

    const nivel = calcularNivel(distancia);
    const toneladas = calcularToneladas(nivel, producto);

    totales[producto] += toneladas;
  }

  return totales;
}

function actualizarResumenDesdeHistorico(historial) {
  const totales = crearTotalesVacios();

  if (!historial || historial.length === 0) {
    pintarResumen(totales);
    return;
  }

  const ultimo = historial[historial.length - 1];

  Object.keys(PRODUCTOS).forEach(producto => {
    totales[producto] = obtenerTotalProductoDesdePunto(ultimo, producto);
  });

  pintarResumen(totales);
}

function pintarResumen(totales) {
  Object.keys(PRODUCTOS).forEach(producto => {
    setText(
      `total-${idProducto(producto)}`,
      `Totalizador: ${(totales[producto] || 0).toFixed(1)} ton`
    );
  });

  actualizarVisibilidadProductos();
}

function crearTotalesVacios() {
  return {
    "DL-5": 0,
    "VE-03": 0,
    "ASE": 0
  };
}

/* ==========================================================
   GRÁFICOS
   ========================================================== */

function inicializarGraficos() {
  Object.keys(PRODUCTOS).forEach(producto => {
    const canvas = document.getElementById(`chart-${idProducto(producto)}`);
    if (!canvas) return;

    charts[producto] = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: producto,
          data: [],
          borderColor: "#000",
          backgroundColor: colorSuave(PRODUCTOS[producto].color),
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: [],
          pointStyle: []
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true },
          zoom: {
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "x"
            },
            pan: {
              enabled: true,
              mode: "x"
            }
          }
        },
        scales: {
          x: {
            grid: { display: true }
          },
          y: {
            min: 0,
            max: PRODUCTOS[producto].maxTon,
            ticks: {
              callback: value => `${value} t`
            }
          }
        }
      }
    });
  });

  actualizarVisibilidadProductos();
}

async function cargarHistoricoFecha(fecha) {
  try {
    const res = await fetch(`/api/trend?date=${fecha}`);

    if (!res.ok) throw new Error("No se pudo cargar tendencia");

    const data = await res.json();
    const historial = Array.isArray(data) ? data : (data.history || data.trend || []);

    pintarGraficos(historial);
    actualizarResumenDesdeHistorico(historial);
  } catch (error) {
    console.error("Error cargando histórico:", error);

    pintarGraficos([]);
    actualizarResumenDesdeHistorico([]);
  }
}

function pintarGraficos(historial) {
  const labels = [];
  const series = crearTotalesVacios();

  Object.keys(series).forEach(producto => {
    series[producto] = [];
  });

  historial.forEach(punto => {
    const hora = punto.time || punto.hora || obtenerHora(punto.timestamp);

    labels.push(hora);

    Object.keys(PRODUCTOS).forEach(producto => {
      series[producto].push(obtenerTotalProductoDesdePunto(punto, producto));
    });
  });

  Object.keys(PRODUCTOS).forEach(producto => {
    const chart = charts[producto];
    if (!chart) return;

    chart.data.labels = labels;
    chart.data.datasets[0].data = series[producto];
    chart.data.datasets[0].pointBackgroundColor = coloresPuntos(series[producto]);
    chart.data.datasets[0].pointStyle = estilosPuntos(series[producto]);

    chart.update();
  });

  actualizarVisibilidadProductos();
}

function obtenerTotalProductoDesdePunto(punto, producto) {
  if (!punto) return 0;

  if (punto.products && punto.products[producto] !== undefined) {
    return Number(punto.products[producto]) || 0;
  }

  if (punto.totals && punto.totals[producto] !== undefined) {
    return Number(punto.totals[producto]) || 0;
  }

  if (punto[producto] !== undefined) {
    return Number(punto[producto]) || 0;
  }

  if (punto.silos) {
    let total = 0;

    for (let i = 1; i <= SILOS; i++) {
      const silo = punto.silos[i] || punto.silos[`silo${i}`];
      if (!silo) continue;

      const prod = silo.product || silo.producto || productosSilos[i] || "DL-5";

      if (prod !== producto) continue;

      total += Number(silo.tons ?? silo.toneladas ?? silo.total ?? 0);
    }

    return total;
  }

  return 0;
}

/* ==========================================================
   FECHAS GRÁFICOS
   ========================================================== */

async function cargarFechasGraficos() {
  const select = document.getElementById("chartDateSelect");
  if (!select) return;

  try {
    const res = await fetch("/api/trend-dates");

    let fechas = [];

    if (res.ok) {
      const data = await res.json();
      fechas = Array.isArray(data) ? data : (data.dates || []);
    }

    if (!fechas.includes(fechaSeleccionada)) {
      fechas.unshift(fechaSeleccionada);
    }

    select.innerHTML = "";

    fechas.forEach(fecha => {
      const option = document.createElement("option");
      option.value = fecha;
      option.textContent = fecha;
      select.appendChild(option);
    });

    select.value = fechaSeleccionada;
  } catch {
    select.innerHTML = `<option value="${fechaSeleccionada}">${fechaSeleccionada}</option>`;
  }
}

/* ==========================================================
   VARIACIONES DIARIAS
   ========================================================== */

function calcularVariacionesDiarias(historial) {
  const variaciones = {
    "DL-5": { positiva: 0, negativa: 0 },
    "VE-03": { positiva: 0, negativa: 0 },
    "ASE": { positiva: 0, negativa: 0 }
  };

  if (!historial || historial.length < 2) return variaciones;

  Object.keys(PRODUCTOS).forEach(producto => {
    for (let i = 1; i < historial.length; i++) {
      const anterior = obtenerTotalProductoDesdePunto(historial[i - 1], producto);
      const actual = obtenerTotalProductoDesdePunto(historial[i], producto);
      const diff = actual - anterior;

      if (diff > 0) variaciones[producto].positiva += diff;
      if (diff < 0) variaciones[producto].negativa += Math.abs(diff);
    }
  });

  return variaciones;
}

/* ==========================================================
   MODO DEMO
   ========================================================== */

function iniciarDemo() {
  detenerDemo();
  generarDemo();

  demoInterval = setInterval(generarDemo, 4000);
}

function detenerDemo() {
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }
}

function generarDemo() {
  for (let i = 1; i <= SILOS; i++) {
    const actual = estadoSilos[i]?.distance ?? random(1, 5);
    estadoSilos[i] = {
      distance: limitar(actual + random(-0.15, 0.15), 0.2, ALTURA_TOTAL)
    };
  }

  actualizarTodosLosSilos();
  actualizarResumenActual();
  actualizarEstadoMqtt(new Date(), true);
}

/* ==========================================================
   CÁLCULOS VOLUMEN / TON
   ========================================================== */

function calcularNivel(distancia) {
  if (!distancia || isNaN(distancia)) return 0;

  return limitar(ALTURA_TOTAL - distancia, 0, ALTURA_TOTAL);
}

function calcularVolumen(nivel) {
  nivel = limitar(nivel, 0, ALTURA_TOTAL);

  const volumenCono = VOLUMEN_TOTAL * (ALTURA_CONO / ALTURA_TOTAL);
  const volumenCilindro = VOLUMEN_TOTAL - volumenCono;

  if (nivel <= ALTURA_CONO) {
    const r = nivel / ALTURA_CONO;
    return volumenCono * Math.pow(r, 3);
  }

  const nivelCilindro = nivel - ALTURA_CONO;
  const r = nivelCilindro / ALTURA_CILINDRO;

  return volumenCono + volumenCilindro * r;
}

function calcularToneladas(nivel, producto) {
  const volumen = calcularVolumen(nivel);
  const densidad = PRODUCTOS[producto]?.densidad || 1300;

  return volumen * densidad / 1000;
}

/* ==========================================================
   VISIBILIDAD PRODUCTOS
   ========================================================== */

function actualizarVisibilidadProductos() {
  Object.keys(PRODUCTOS).forEach(producto => {
    const visible = existeProductoAsignado(producto);

    const card = document.getElementById(`summaryCard-${idProducto(producto)}`);
    const chart = document.getElementById(`chartBox-${idProducto(producto)}`);

    if (card) card.style.display = visible ? "" : "none";
    if (chart) chart.style.display = visible ? "" : "none";
  });
}

function existeProductoAsignado(producto) {
  for (let i = 1; i <= SILOS; i++) {
    if ((productosSilos[i] || "DL-5") === producto) return true;
  }

  return false;
}

/* ==========================================================
   UTILIDADES
   ========================================================== */

function inicializarProductos() {
  for (let i = 1; i <= SILOS; i++) {
    productosSilos[i] = i === 6 ? "ASE" : "DL-5";
  }
}

function actualizarEstadoMqtt(fecha, conectado) {
  const el = document.getElementById("mqttStatus");
  if (!el) return;

  const d = fecha instanceof Date ? fecha : new Date(fecha);

  const hora = d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  el.textContent = conectado
    ? `🟢 Señal MQTT (${hora})`
    : `🔴 Sin señal (--:--:--)`;
}

function idProducto(producto) {
  return producto.toLowerCase().replaceAll("-", "").replaceAll(" ", "");
}

function fechaHoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function obtenerHora(timestamp) {
  if (!timestamp) return "";

  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";

  return d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function colorSuave(hex) {
  const limpio = hex.replace("#", "");
  const r = parseInt(limpio.substring(0, 2), 16);
  const g = parseInt(limpio.substring(2, 4), 16);
  const b = parseInt(limpio.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}

function coloresPuntos(valores) {
  return valores.map((v, i) => {
    if (i === 0) return "#000";

    if (v > valores[i - 1]) return "#27ae60";
    if (v < valores[i - 1]) return "#e74c3c";

    return "#000";
  });
}

function estilosPuntos(valores) {
  return valores.map((v, i) => {
    if (i === 0) return "circle";

    if (v > valores[i - 1]) return "triangle";
    if (v < valores[i - 1]) return "rectRot";

    return "circle";
  });
}

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

function limitar(valor, min, max) {
  return Math.max(min, Math.min(max, valor));
}

function random(min, max) {
  return Math.random() * (max - min) + min;
}
