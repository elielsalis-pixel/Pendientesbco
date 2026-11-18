'use strict';
/*
  Carga el script REAL de index.html dentro de un entorno simulado (sin navegador),
  para probar sus funciones sin copiarlas ni modificar la app.

  - Se quita la llamada final init() (arranca la app y toca la pantalla).
  - La pantalla (document) es un simulador que acepta cualquier llamada.
  - La fecha y hora "de hoy" son fijas, para que las pruebas den siempre lo mismo.
  - Todo dato de prueba es inventado.
*/
const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');

/* La app usa la hora de Argentina; las pruebas también. */
process.env.TZ = 'America/Argentina/Buenos_Aires';

const RAIZ = path.join(__dirname, '..');

/* Hoy simulado: miércoles 2026-11-18 a las 10:30 (hora Argentina = 13:30 UTC). */
const AHORA_POR_DEFECTO = Date.UTC(2026, 10, 18, 13, 30, 0);

function leerScriptDeLaApp() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const ini  = html.indexOf('<script>');
  const fin  = html.lastIndexOf('</script>');
  if (ini === -1 || fin === -1 || fin < ini) {
    throw new Error('No encontré el script de la app en index.html');
  }
  const codigo  = html.slice(ini + '<script>'.length, fin);
  const sinInit = codigo.replace(/^init\(\);\s*$/m, '');
  if (sinInit === codigo) {
    throw new Error('No encontré la llamada init() al final del script de la app');
  }
  return sinInit;
}

/* Simulador de pantalla: cualquier propiedad o llamada devuelve otro simulador. */
function crearPantallaSimulada() {
  const base = function () {};
  const proxy = new Proxy(base, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator)    return function* () {};
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return proxy;
    },
    apply() { return proxy; },
    set()   { return true; },
  });
  return proxy;
}

function crearAlmacenamiento(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    getItem:    k => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    leer:       k => (m.has(k) ? JSON.parse(m.get(k)) : null),
  };
}

/* Date que, sin argumentos, devuelve siempre la hora simulada. */
function crearFecha(ahoraMs) {
  return class FechaFija extends Date {
    constructor(...args) { if (args.length === 0) super(ahoraMs); else super(...args); }
    static now() { return ahoraMs; }
  };
}

/*
  opciones:
    ahora    -> hora simulada en ms (por defecto 2026-11-18 10:30)
    tareas   -> lista guardada en pbc_tareas
    usuario  -> objeto guardado en pbc_usuario
    permiso  -> permiso de notificaciones: 'granted' (defecto), 'denied' o 'default'
  Devuelve { app, almacen, llamadas }
*/
function cargarApp(opciones = {}) {
  const ahora = opciones.ahora ?? AHORA_POR_DEFECTO;

  const almacen = crearAlmacenamiento({
    ...(opciones.tareas  ? { pbc_tareas:  opciones.tareas  } : {}),
    ...(opciones.usuario ? { pbc_usuario: opciones.usuario } : {}),
  });

  const llamadas = { notificaciones: [], mensajesSW: [] };
  const registro = {
    showNotification: async (titulo, op) => { llamadas.notificaciones.push({ titulo, ...op }); },
    active: { postMessage: m => { llamadas.mensajesSW.push(m); } },
  };

  const sinBloquear = (alta, f, ms) => { const t = alta(f, ms); if (t.unref) t.unref(); return t; };

  const entorno = {
    console,
    Date: crearFecha(ahora),
    document: crearPantallaSimulada(),
    localStorage: almacen,
    navigator: {
      serviceWorker: {
        ready: Promise.resolve(registro),
        controller: null,
        addEventListener() {},
        register: async () => registro,
      },
    },
    Notification: { permission: opciones.permiso ?? 'granted' },
    crypto: { randomUUID: () => 'id-de-prueba' },
    URL: { createObjectURL: () => 'blob:prueba' },
    Blob: class {},
    alert() {},
    confirm: () => true,
    setTimeout:   (f, ms) => sinBloquear(setTimeout, f, ms),
    setInterval:  (f, ms) => sinBloquear(setInterval, f, ms),
    clearTimeout,
    clearInterval,
  };
  entorno.window = entorno;

  const contexto = vm.createContext(entorno);
  vm.runInContext(leerScriptDeLaApp(), contexto, { filename: 'index.html (script de la app)' });

  return { app: contexto, almacen, llamadas };
}

/* Convierte lo que devuelve la app en datos comparables con assert.deepEqual. */
const plano = x => JSON.parse(JSON.stringify(x));

module.exports = { cargarApp, plano, AHORA_POR_DEFECTO };
