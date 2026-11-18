'use strict';
/*
  Pruebas del service worker (sw.js) con un entorno simulado: sin navegador ni red.
  Todo dato es inventado.
*/
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* Cachés en memoria. Cada "respuesta" es un objeto con ok y clone(). */
function crearCaches(inicial = {}, { falloAlGuardar = false } = {}) {
  const almacen = new Map(Object.entries(inicial).map(([n, e]) => [n, new Map(Object.entries(e))]));
  return {
    almacen,
    open: async nombre => {
      if (!almacen.has(nombre)) almacen.set(nombre, new Map());
      const c = almacen.get(nombre);
      return { put: async (req, res) => { if (falloAlGuardar) throw new Error('QuotaExceededError'); c.set(req.url, res); } };
    },
    match: async req => {
      for (const c of almacen.values()) if (c.has(req.url)) return c.get(req.url);
      return undefined;
    },
    keys:   async () => [...almacen.keys()],
    delete: async nombre => almacen.delete(nombre),
  };
}

const respuesta = (etiqueta, ok = true) => ({ etiqueta, ok, clone() { return this; } });

/* Carga sw.js y devuelve los manejadores que registró. */
function cargarSW({ caches, fetch, consola = console }) {
  const manejadores = {};
  const self = {
    addEventListener: (tipo, f) => { manejadores[tipo] = f; },
    skipWaiting: () => {},
    registration: { scope: 'https://demo.example/' },
  };
  const entorno = {
    self, caches, fetch, console: consola,
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    Response: { error: () => respuesta('error', false) },
    Promise, Error,
    setTimeout: (...a) => globalThis.setTimeout(...a),   /* usa el reloj simulado si está activo */
    clearTimeout: (...a) => globalThis.clearTimeout(...a),
  };
  vm.runInNewContext(CODIGO, entorno, { filename: 'sw.js' });
  return { manejadores, constantes: vm.runInNewContext('({ CACHE, ESPERA_RED_MS })', entorno) };
}

function pedir(manejadores, { url = 'https://demo.example/index.html', method = 'GET' } = {}) {
  const e = { request: { url, method }, esperas: [], respondWith(p) { this.promesa = p; }, waitUntil(p) { this.esperas.push(p); } };
  manejadores.fetch(e);
  return e;
}

test('sw: la versión del caché cambió respecto de la anterior (pbc-v7)', () => {
  const { constantes } = cargarSW({ caches: crearCaches(), fetch: async () => respuesta('x') });
  assert.notEqual(constantes.CACHE, 'pbc-v7');
});

test('sw: con red, devuelve la versión nueva y guarda una copia', async () => {
  const caches = crearCaches({ 'pbc-v8': { 'https://demo.example/index.html': respuesta('vieja') } });
  const { manejadores } = cargarSW({ caches, fetch: async () => respuesta('nueva') });
  const e = pedir(manejadores);
  assert.equal((await e.promesa).etiqueta, 'nueva');
  await new Promise(r => setImmediate(r));
  assert.equal(caches.almacen.get('pbc-v8').get('https://demo.example/index.html').etiqueta, 'nueva');
});

test('sw: sin conexión, devuelve la última copia guardada', async () => {
  const caches = crearCaches({ 'pbc-v8': { 'https://demo.example/index.html': respuesta('guardada') } });
  const { manejadores } = cargarSW({ caches, fetch: async () => { throw new TypeError('sin red'); } });
  assert.equal((await pedir(manejadores).promesa).etiqueta, 'guardada');
});

test('sw: sin conexión y sin copia guardada, la consulta falla (no inventa nada)', async () => {
  const { manejadores } = cargarSW({ caches: crearCaches(), fetch: async () => { throw new TypeError('sin red'); } });
  await assert.rejects(pedir(manejadores).promesa, /sin red/);
});

test('sw: una respuesta con error del servidor no pisa la copia guardada', async () => {
  const caches = crearCaches({ 'pbc-v8': { 'https://demo.example/index.html': respuesta('buena') } });
  const { manejadores } = cargarSW({ caches, fetch: async () => respuesta('error 500', false) });
  await pedir(manejadores).promesa;
  await new Promise(r => setImmediate(r));
  assert.equal(caches.almacen.get('pbc-v8').get('https://demo.example/index.html').etiqueta, 'buena');
});

test('sw: con red muy lenta, después del límite muestra la copia guardada', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caches = crearCaches({ 'pbc-v8': { 'https://demo.example/index.html': respuesta('guardada') } });
  const { manejadores, constantes } = cargarSW({ caches, fetch: () => new Promise(() => {}) });
  const e = pedir(manejadores);
  t.mock.timers.tick(constantes.ESPERA_RED_MS);
  assert.equal((await e.promesa).etiqueta, 'guardada');
});

test('sw: las consultas que no son GET no se intervienen', () => {
  const { manejadores } = cargarSW({ caches: crearCaches(), fetch: async () => respuesta('x') });
  const e = pedir(manejadores, { method: 'POST' });
  assert.equal(e.promesa, undefined);
});

test('sw: al activarse borra los cachés de versiones anteriores y conserva el actual', async () => {
  const caches = crearCaches({ 'pbc-v7': {}, 'pbc-v6': {}, 'pbc-v8': {} });
  const { manejadores } = cargarSW({ caches, fetch: async () => respuesta('x') });
  let espera;
  manejadores.activate({ waitUntil: p => { espera = p; } });
  await espera;
  assert.deepEqual([...caches.almacen.keys()], ['pbc-v8']);
});

test('sw: ya no tiene temporizadores de avisos a una hora fija', () => {
  const { manejadores } = cargarSW({ caches: crearCaches(), fetch: async () => respuesta('x') });
  assert.equal(manejadores.message, undefined);
  assert.equal(typeof manejadores.notificationclick, 'function');
});

test('sw: la copia se guarda dentro de waitUntil (el navegador no apaga el service worker a mitad)', async () => {
  const caches = crearCaches();
  const { manejadores } = cargarSW({ caches, fetch: async () => respuesta('nueva') });
  const e = pedir(manejadores);
  await e.promesa;
  assert.equal(e.esperas.length, 1);
  await Promise.all(e.esperas);
  assert.equal(caches.almacen.get('pbc-v8').get('https://demo.example/index.html').etiqueta, 'nueva');
});

test('sw: si no se puede guardar la copia (sin espacio), igual responde con la versión de la red', async () => {
  const errores = [];
  const caches = crearCaches({}, { falloAlGuardar: true });
  const { manejadores } = cargarSW({ caches, fetch: async () => respuesta('nueva'), consola: { error: (...a) => errores.push(a.join(' ')) } });
  const e = pedir(manejadores);
  assert.equal((await e.promesa).etiqueta, 'nueva');
  await Promise.all(e.esperas);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /No se pudo guardar la copia/);
});

test('sw: sin conexión, waitUntil no rompe nada (no queda ninguna promesa rechazada)', async () => {
  const caches = crearCaches({ 'pbc-v8': { 'https://demo.example/index.html': respuesta('guardada') } });
  const { manejadores } = cargarSW({ caches, fetch: async () => { throw new TypeError('sin red'); } });
  const e = pedir(manejadores);
  await e.promesa;
  await assert.doesNotReject(Promise.all(e.esperas));
});
