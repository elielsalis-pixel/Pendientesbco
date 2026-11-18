'use strict';
/*
  Pruebas de Pendientes BCO. Todo dato es inventado ("Cliente Demo SA").
  Hoy simulado: miércoles 2026-11-18, 10:30 (hora Argentina).
  Cómo correrlas: sh tests/verificar.sh
*/
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { cargarApp, plano, AHORA_POR_DEFECTO } = require('./cargar-app');

const DIA = 24 * 60 * 60 * 1000;
const ARG = (a, m, d, h = 0, mi = 0) => Date.UTC(a, m - 1, d, h + 3, mi); /* hora Argentina → ms */

function tarea(extra = {}) {
  return {
    id: 't1',
    empresa: 'Cliente Demo SA',
    descripcion: 'Preparar la carpeta de prueba',
    urgencia: 'media',
    estado: 'pendiente',
    nota: '',
    fechaVenc: '',
    horaVenc: '',
    fechaCreacion: AHORA_POR_DEFECTO - 5 * DIA,
    fechaFinalizado: null,
    ...extra,
  };
}

/* ───────────── Escape de texto ───────────── */
test('esc() neutraliza HTML y tolera valores vacíos', () => {
  const { app } = cargarApp();
  assert.equal(app.esc('<b>"Demo" & Co</b>'), '&lt;b&gt;&quot;Demo&quot; &amp; Co&lt;/b&gt;');
  assert.equal(app.esc(undefined), '');
  assert.equal(app.esc(null), '');
});

test('qa() deja comillas dobles escapadas para usar dentro de onclick', () => {
  const { app } = cargarApp();
  assert.equal(app.qa('a"b'), '&quot;a\\&quot;b&quot;');
});

/* ───────────── Chip de vencimiento ───────────── */
test('vencChip(): sin fecha no muestra nada', () => {
  const { app } = cargarApp();
  assert.equal(app.vencChip(tarea()), '');
});

test('vencChip(): colores según los días que faltan (hoy = 18/11)', () => {
  const { app } = cargarApp();
  const clase = fecha => /venc-(rojo|naranja|gris)/.exec(app.vencChip(tarea({ fechaVenc: fecha })))[0];
  assert.equal(clase('2026-11-17'), 'venc-rojo',    'ayer: vencida');
  assert.equal(clase('2026-11-18'), 'venc-naranja', 'hoy sin hora');
  assert.equal(clase('2026-11-21'), 'venc-naranja', 'en 3 días');
  assert.equal(clase('2026-11-22'), 'venc-gris',    'en 4 días');
});

test('vencChip(): hoy con hora cambia a rojo cuando la hora ya llegó (ahora son las 10:30)', () => {
  const { app } = cargarApp();
  const clase = hora => /venc-(rojo|naranja|gris)/.exec(
    app.vencChip(tarea({ fechaVenc: '2026-11-18', horaVenc: hora })))[0];
  assert.equal(clase('11:00'), 'venc-naranja');
  assert.equal(clase('10:31'), 'venc-naranja');
  assert.equal(clase('10:30'), 'venc-rojo', 'justo a la hora ya cuenta como vencida');
  assert.equal(clase('09:00'), 'venc-rojo');
});

test('vencChip(): etiqueta con día/mes y hora opcional', () => {
  const { app } = cargarApp();
  assert.match(app.vencChip(tarea({ fechaVenc: '2026-11-21' })), /Vence 21\/11</);
  assert.match(app.vencChip(tarea({ fechaVenc: '2026-12-05', horaVenc: '15:00' })), /Vence 05\/12 · 15:00</);
});

/* ───────────── Borrado automático a los 30 días ───────────── */
function tareasTrasPurgar(tareas) {
  const { app, almacen } = cargarApp({ tareas });
  app.purgarFinalizadas();
  return almacen.leer('pbc_tareas').map(t => t.id);
}

test('purgarFinalizadas(): borra las terminadas hace 30 días o más y conserva el resto', () => {
  const ahora = AHORA_POR_DEFECTO;
  const ids = tareasTrasPurgar([
    tarea({ id: 'hace-31', estado: 'listo', fechaFinalizado: ahora - 31 * DIA }),
    tarea({ id: 'hace-29', estado: 'listo', fechaFinalizado: ahora - 29 * DIA }),
    tarea({ id: 'activa-vieja', estado: 'pendiente', fechaCreacion: ahora - 400 * DIA }),
    tarea({ id: 'en-curso', estado: 'curso' }),
  ]);
  assert.deepEqual(ids, ['hace-29', 'activa-vieja', 'en-curso']);
});

test('purgarFinalizadas(): el límite es exacto (30 días justos se borra, un milisegundo menos se conserva)', () => {
  const ahora = AHORA_POR_DEFECTO;
  const ids = tareasTrasPurgar([
    tarea({ id: 'justo-30',  estado: 'listo', fechaFinalizado: ahora - 30 * DIA }),
    tarea({ id: 'casi-30',   estado: 'listo', fechaFinalizado: ahora - 30 * DIA + 1 }),
  ]);
  assert.deepEqual(ids, ['casi-30']);
});

test('purgarFinalizadas(): una tarea "listo" sin fecha NO se borra: empieza a contar desde hoy', () => {
  const { app, almacen } = cargarApp({ tareas: [
    tarea({ id: 'listo-sin-fecha', estado: 'listo', fechaFinalizado: null }),
    tarea({ id: 'activa' }),
  ] });
  app.purgarFinalizadas();
  const guardadas = almacen.leer('pbc_tareas');
  assert.deepEqual(guardadas.map(t => t.id), ['listo-sin-fecha', 'activa']);
  assert.equal(guardadas[0].fechaFinalizado, AHORA_POR_DEFECTO);
});

/* ───────────── Fechas del reporte ───────────── */
test('fechaLarga() y generarAsunto() usan la fecha de hoy en español', () => {
  const { app } = cargarApp();
  assert.equal(app.fechaLarga(), 'miércoles 18 de noviembre de 2026');
  assert.equal(app.generarAsunto(), 'Reporte de pendientes — miércoles 18 de noviembre de 2026');
});

test('fechaISO(): devuelve el día de hoy en hora Argentina', () => {
  const { app } = cargarApp();
  assert.equal(app.fechaISO(new Date(ARG(2026, 11, 18, 10, 30))), '2026-11-18');
});

test('fechaISO(): a las 22:30 de Argentina sigue siendo el mismo día (usa hora local, no UTC)', () => {
  const { app } = cargarApp();
  assert.equal(app.fechaISO(new Date(ARG(2026, 11, 18, 22, 30))), '2026-11-18');
  assert.equal(app.fechaISO(new Date(ARG(2026, 11, 18, 23, 59))), '2026-11-18');
  assert.equal(app.fechaISO(new Date(ARG(2026, 11, 19, 0, 1))),   '2026-11-19');
});

/* ───────────── Texto del mail ───────────── */
const USUARIO = { nombre: 'Usuario Demo', cargo: 'Oficial Demo' };

test('generarMailTexto(): sin tareas activas avisa que no hay', () => {
  const { app } = cargarApp();
  const txt = app.generarMailTexto([tarea({ estado: 'listo' })], USUARIO);
  assert.match(txt, /^REPORTE DE PENDIENTES — miércoles 18 de noviembre de 2026\nUsuario Demo · Oficial Demo\n/);
  assert.match(txt, /Sin tareas activas\./);
  assert.doesNotMatch(txt, /Cliente Demo SA/);
});

test('generarMailTexto(): agrupa por urgencia (alta, media, baja), cuenta y deja afuera las terminadas', () => {
  const { app } = cargarApp();
  const txt = app.generarMailTexto([
    tarea({ id: 'a', empresa: 'Baja Demo SRL',  urgencia: 'baja' }),
    tarea({ id: 'b', empresa: 'Alta Demo SA',    urgencia: 'alta' }),
    tarea({ id: 'c', empresa: 'Alta Demo Dos SA', urgencia: 'alta' }),
    tarea({ id: 'd', empresa: 'Media Demo SA',   urgencia: 'media' }),
    tarea({ id: 'e', empresa: 'Terminada Demo',  urgencia: 'alta', estado: 'listo' }),
  ], USUARIO);

  const pos = s => txt.indexOf(s);
  assert.ok(pos('URGENCIA ALTA (2)') > -1 && pos('URGENCIA MEDIA (1)') > -1 && pos('URGENCIA BAJA (1)') > -1);
  assert.ok(pos('URGENCIA ALTA (2)') < pos('URGENCIA MEDIA (1)'));
  assert.ok(pos('URGENCIA MEDIA (1)') < pos('URGENCIA BAJA (1)'));
  assert.doesNotMatch(txt, /Terminada Demo/);
  assert.doesNotMatch(txt, /Sin tareas activas/);
});

test('generarMailTexto(): la nota solo aparece en tareas "en curso"', () => {
  const { app } = cargarApp();
  const txt = app.generarMailTexto([
    tarea({ id: 'a', empresa: 'Curso Demo SA',     estado: 'curso',     nota: 'Esperando el sello' }),
    tarea({ id: 'b', empresa: 'Pendiente Demo SA', estado: 'pendiente', nota: 'Nota que no debe salir' }),
  ], USUARIO);
  assert.match(txt, /EN CURSO {2}Esperando el sello/);
  assert.match(txt, /\nPENDIENTE\n/);
  assert.doesNotMatch(txt, /Nota que no debe salir/);
});

test('generarMailTexto(): sin cargo no agrega el separador "·"', () => {
  const { app } = cargarApp();
  const txt = app.generarMailTexto([], { nombre: 'Usuario Demo' });
  assert.equal(txt.split('\n')[1], 'Usuario Demo');
});

/* ───────────── Avisos de vencimiento ───────────── */
async function correrAvisos({ tareas, usuario = { nombre: 'Usuario Demo', anticipacion: 0 }, permiso } = {}) {
  const { app, llamadas } = cargarApp({ tareas, usuario, permiso });
  await app.avisarVencimientos();
  return plano(llamadas);
}

test('avisos: sin permiso del celular no se programa ni se muestra nada', async () => {
  const r = await correrAvisos({ permiso: 'denied', tareas: [tarea({ fechaVenc: '2026-11-17' })] });
  assert.deepEqual(r, { notificaciones: [], mensajesSW: [] });
});

test('avisos: sin tareas con vencimiento (o terminadas) no hace nada', async () => {
  const r = await correrAvisos({ tareas: [
    tarea({ id: 'a' }),
    tarea({ id: 'b', estado: 'listo', fechaVenc: '2026-11-17' }),
  ] });
  assert.deepEqual(r, { notificaciones: [], mensajesSW: [] });
});

test('avisos: una vencida muestra un aviso inmediato en singular', async () => {
  const r = await correrAvisos({ tareas: [tarea({ fechaVenc: '2026-11-17' })] });
  assert.equal(r.notificaciones.length, 1);
  assert.equal(r.notificaciones[0].tag, 'pbc-apertura');
  assert.match(r.notificaciones[0].body, /^Tenés 1 tarea vencida o que vence hoy\.\n· Cliente Demo SA: /);
});

test('avisos: varias vencidas van en plural y la lista se corta en 3', async () => {
  const tareas = ['a', 'b', 'c', 'd'].map(id =>
    tarea({ id, empresa: `Demo ${id.toUpperCase()} SA`, fechaVenc: '2026-11-18' }));
  const r = await correrAvisos({ tareas });
  assert.match(r.notificaciones[0].body, /^Tenés 4 tareas vencidas o que vencen hoy\./);
  assert.equal(r.notificaciones[0].body.split('\n').filter(l => l.startsWith('·')).length, 3);
});

test('avisos: una tarea de hoy con hora igual avisa al abrir y NO programa nada en el service worker', async () => {
  const r = await correrAvisos({ tareas: [tarea({ fechaVenc: '2026-11-18', horaVenc: '15:00' })] });
  assert.equal(r.notificaciones.length, 1);
  assert.deepEqual(r.mensajesSW, []);
});

test('avisos: las tareas de días futuros no avisan todavía', async () => {
  const r = await correrAvisos({ tareas: [tarea({ fechaVenc: '2026-11-19', horaVenc: '15:00' })] });
  assert.deepEqual(r, { notificaciones: [], mensajesSW: [] });
});

/* ───────────── Guardado (#2) ───────────── */
const ev = (app, codigo) => vm.runInContext(codigo, app);
function conAvisos(opciones) {
  const c = cargarApp(opciones);
  const avisos = [];
  c.app.alert = m => { avisos.push(m); };
  return { ...c, avisos };
}

test('guardado: si el celular no deja guardar, devuelve false y avisa', () => {
  const { app, almacen, avisos } = conAvisos();
  almacen.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(ev(app, 'saveTareas([])'), false);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /No se pudo guardar/);
});

test('guardado: un fallo al guardar preferencias de pantalla (vista, secciones) no molesta con avisos', () => {
  const { app, almacen, avisos } = conAvisos();
  almacen.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(ev(app, 'saveSecciones({ a: true })'), false);
  assert.deepEqual(avisos, []);
});

test('guardado: si todo anda, devuelve true y guarda', () => {
  const { app, almacen, avisos } = conAvisos();
  assert.equal(ev(app, 'saveTareas([{ id: "a" }])'), true);
  assert.deepEqual(almacen.leer('pbc_tareas'), [{ id: 'a' }]);
  assert.deepEqual(avisos, []);
});

test('lectura: datos dañados se leen como lista vacía, se conserva una copia y se avisa una sola vez', () => {
  const { app, almacen, avisos } = conAvisos();
  almacen.setItem('pbc_tareas', '{esto-no-es-json');
  assert.deepEqual(plano(ev(app, 'getTareas()')), []);
  assert.deepEqual(plano(ev(app, 'getTareas()')), []);
  assert.equal(almacen.getItem('pbc_tareas__danado'), '{esto-no-es-json');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /dañados/);
  /* el próximo guardado pisa lo dañado, pero la copia queda */
  ev(app, 'saveTareas([{ id: "nueva" }])');
  assert.equal(almacen.getItem('pbc_tareas__danado'), '{esto-no-es-json');
});

/* ───────────── Importar respaldo (#1) ───────────── */
const respaldo = (tareas, usuario = { nombre: 'Usuario Demo', cargo: 'Oficial Demo' }) =>
  JSON.stringify({ v: 1, fecha: '2026-11-18', usuario, tareas });

function importar(contenido, opciones = {}) {
  const c = conAvisos(opciones);
  c.app.procesarRespaldo(contenido);
  return { ...c, guardadas: c.almacen.leer('pbc_tareas') };
}

test('importar: datos hostiles se limpian y no llegan a la pantalla', () => {
  const { app, guardadas } = importar(respaldo([
    tarea({ id: 'a', urgencia: 'alta" onmouseover="alert(1)', estado: 'x" onclick="y',
            fechaVenc: '2026-11-20', horaVenc: '<img src=x onerror=alert(1)>' }),
  ]));
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].urgencia, 'media');
  assert.equal(guardadas[0].estado, 'pendiente');
  assert.equal(guardadas[0].horaVenc, '');
  const html = app.cardHTML(guardadas[0]) + app.vencChip(guardadas[0]);
  assert.doesNotMatch(html, /onmouseover|onclick="y|<img/);
});

test('importar: descarta lo que no sirve (sin empresa, sin descripción, no es un objeto) y avisa cuántas', () => {
  let mensaje = '';
  const c = cargarApp();
  c.app.confirm = m => { mensaje = m; return true; };
  c.app.alert = () => {};
  c.app.procesarRespaldo(respaldo([
    tarea({ id: 'ok' }),
    tarea({ id: 'sin-empresa', empresa: '' }),
    tarea({ id: 'sin-desc', descripcion: '   ' }),
    null, 5, 'texto', { empresa: 5, descripcion: {} },
  ]));
  assert.deepEqual(c.almacen.leer('pbc_tareas').map(t => t.id), ['ok']);
  assert.match(mensaje, /1 tarea\./);
  assert.match(mensaje, /6 con datos inválidos/);
});

test('importar: normaliza fechas, horas y estados; completa lo que falta', () => {
  const { guardadas } = importar(respaldo([
    tarea({ id: 'a', fechaVenc: '2026-13-45', horaVenc: '15:00' }),
    tarea({ id: 'b', fechaVenc: '2026-12-05', horaVenc: '25:99' }),
    tarea({ id: 'c', fechaVenc: '2026-12-05', horaVenc: '15:00', estado: 'curso', nota: ' espera sello ' }),
    tarea({ id: 'd', estado: 'listo', fechaFinalizado: undefined, nota: 'se ignora' }),
    tarea({ id: 'e', estado: 'pendiente', nota: 'no corresponde' }),
  ]));
  const por = Object.fromEntries(guardadas.map(t => [t.id, t]));
  assert.deepEqual([por.a.fechaVenc, por.a.horaVenc], ['', ''], 'fecha inválida: sin fecha ni hora');
  assert.deepEqual([por.b.fechaVenc, por.b.horaVenc], ['2026-12-05', ''], 'hora inválida: se quita');
  assert.deepEqual([por.c.fechaVenc, por.c.horaVenc, por.c.nota], ['2026-12-05', '15:00', 'espera sello']);
  assert.equal(por.d.fechaFinalizado, AHORA_POR_DEFECTO);
  assert.equal(por.d.nota, '');
  assert.equal(por.e.nota, '');
});

test('importar: ids repetidos se regeneran y los tipos raros no rompen nada', () => {
  const { guardadas } = importar(respaldo([
    tarea({ id: 'igual' }), tarea({ id: 'igual' }), tarea({ id: 123 }),
    tarea({ id: 'f', fechaVenc: ['2026-12-05'], fechaCreacion: 'ayer' }),
  ]));
  assert.equal(guardadas.length, 4);
  assert.equal(new Set(guardadas.map(t => t.id)).size, 4);
  assert.equal(guardadas[3].fechaVenc, '');
  assert.equal(guardadas[3].fechaCreacion, AHORA_POR_DEFECTO);
});

test('importar: de los datos del usuario solo toma nombre y cargo; los mails actuales se conservan', () => {
  const actual = { nombre: 'Nombre Viejo', cargo: 'Cargo Viejo', mailCorporativo: 'actual@example.com', mailPersonal: 'mio@example.com' };
  const { almacen } = importar(
    respaldo([tarea()], { nombre: 'Usuario Demo', cargo: 'Oficial Demo', mailCorporativo: 'otro@example.com', mailGerente: 'g@example.com' }),
    { usuario: actual });
  assert.deepEqual(almacen.leer('pbc_usuario'), {
    nombre: 'Usuario Demo', cargo: 'Oficial Demo',
    mailCorporativo: 'actual@example.com', mailPersonal: 'mio@example.com',
  });
});

test('importar: en un celular sin configurar toma nombre y cargo y NO copia mails del archivo', () => {
  const { almacen } = importar(
    respaldo([tarea()], { nombre: 'Usuario Demo', cargo: 'Oficial Demo', mailPersonal: 'x@example.com' }));
  assert.deepEqual(almacen.leer('pbc_usuario'), { nombre: 'Usuario Demo', cargo: 'Oficial Demo' });
});

test('importar: un archivo que no es un respaldo da error y no toca lo guardado', () => {
  const c = conAvisos({ tareas: [tarea({ id: 'previa' })] });
  assert.throws(() => c.app.procesarRespaldo('esto no es json'));
  assert.throws(() => c.app.procesarRespaldo('{"tareas": 5}'));
  assert.deepEqual(c.almacen.leer('pbc_tareas').map(t => t.id), ['previa']);
});

test('importar: si no se puede guardar, no reemplaza el usuario ni avisa "importada correctamente"', () => {
  const c = conAvisos({ usuario: { nombre: 'Viejo', cargo: '' } });
  c.almacen.setItem = () => { throw new Error('QuotaExceededError'); };
  c.app.procesarRespaldo(respaldo([tarea()]));
  assert.equal(c.avisos.length, 1);
  assert.match(c.avisos[0], /No se pudo guardar/);
  assert.equal(c.almacen.leer('pbc_usuario').nombre, 'Viejo');
});

/* ───────────── Word (#3): el respaldo oculto no lleva mails ───────────── */
function jszipFalso() {
  const archivos = {};
  class Carpeta {
    constructor(prefijo) { this.prefijo = prefijo; }
    file(nombre, contenido) { archivos[this.prefijo + nombre] = contenido; return this; }
    folder(nombre) { return new Carpeta(this.prefijo + nombre + '/'); }
    async generateAsync() { return 'blob-falso'; }
  }
  return { archivos, JSZip: class extends Carpeta { constructor() { super(''); } } };
}

const USUARIO_CON_MAILS = {
  nombre: 'Usuario Demo', cargo: 'Oficial Demo',
  mailCorporativo: 'corp@example.com', mailPersonal: 'personal@example.com', mailGerente: 'gerente@example.com',
};

test('Word: el respaldo oculto lleva nombre y cargo, y ningún mail', async () => {
  const falso = jszipFalso();
  const { app } = cargarApp({ JSZip: falso.JSZip });
  await app.generarDOCX([tarea({ id: 'a' })], USUARIO_CON_MAILS);
  const custom = falso.archivos['docProps/custom.xml'];
  assert.ok(custom, 'se generó docProps/custom.xml');
  assert.doesNotMatch(custom, /example\.com|mail(Corporativo|Personal|Gerente)/);
  assert.match(custom, /Usuario Demo/);
  assert.match(custom, /PendientesBackup/);
});

test('Word: ida y vuelta — lo exportado se puede importar y los mails del celular siguen intactos', async () => {
  const falso = jszipFalso();
  const origen = cargarApp({ JSZip: falso.JSZip, usuario: USUARIO_CON_MAILS });
  await origen.app.generarDOCX([tarea({ id: 'a', empresa: 'Cliente Demo SA' })], USUARIO_CON_MAILS);
  const xml  = falso.archivos['docProps/custom.xml'];
  const json = /<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/.exec(xml)[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  const destino = conAvisos({ usuario: USUARIO_CON_MAILS });
  destino.app.procesarRespaldo(json);
  assert.deepEqual(destino.almacen.leer('pbc_tareas').map(t => t.empresa), ['Cliente Demo SA']);
  assert.deepEqual(destino.almacen.leer('pbc_usuario'), USUARIO_CON_MAILS);
});

test('Word: el nombre del archivo usa la fecha local (a las 22:30 sigue siendo el mismo día)', async () => {
  const falso = jszipFalso();
  const { app } = cargarApp({ JSZip: falso.JSZip, ahora: ARG(2026, 11, 18, 22, 30) });
  const descargas = [];
  app.document = { body: { appendChild() {}, removeChild() {} }, createElement: () => ({ click() { descargas.push(this.download); } }) };
  await app.generarDOCX([], USUARIO_CON_MAILS);
  assert.deepEqual(descargas, ['pendientes-2026-11-18.docx']);
});

/* ───────────── Vuelta 2: atributos HTML, escapado del Word, datos dañados ───────────── */
/* Lo que hace un navegador con un atributo HTML: decodifica las entidades UNA vez antes de usar el valor. */
const comoNavegador = s => s.replace(/&(quot|amp|lt|gt|#39);/g, (_, n) => ({ quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'" }[n]));

const TEXTOS_DIFICILES = [
  'Pérez & Hijos', 'Acme&quot;);window.__pwned=1;//', '&amp;quot;', '"comillas"', "O'Brien", '<b>x</b>',
  '&lt;b&gt; & &quot;monto&quot;', 'a\\b', 'línea1\nlínea2', '日本語 😀', '&', '&&&', '&#39;',
];

test('qa(): lo que recibe la función en el onclick es EXACTAMENTE el texto original (incluidas entidades)', () => {
  const { app } = cargarApp();
  for (const t of TEXTOS_DIFICILES) {
    assert.equal(JSON.parse(comoNavegador(app.qa(t))), t, `falló con: ${t}`);
  }
});

test('qa(): un texto con entidades no puede cerrar el atributo ni agregar código', () => {
  const { app } = cargarApp();
  const ejecutado = 'App.toggleSec(' + comoNavegador(app.qa('emp::Acme&quot;);window.__pwned=1;//')) + ')';
  assert.equal(ejecutado, 'App.toggleSec("emp::Acme&quot;);window.__pwned=1;//")');
});

test('vistas: cada onclick es exactamente UNA llamada con UNA cadena (empresas e ids con entidades)', () => {
  const { app } = cargarApp();
  const mala = 'X&quot;);window.__pwned=1;//';
  const tareas = [tarea({ id: mala, empresa: mala, fechaVenc: '2026-12-01' })];
  const sec = {};
  let revisados = 0;
  for (const html of [app.renderUrgencia(tareas, sec), app.renderEmpresa(tareas, sec), app.renderFecha(tareas, sec)]) {
    for (const m of html.matchAll(/onclick="([^"]*)"/g)) {
      const codigo = comoNavegador(m[1]);
      const llamada = /^App\.(\w+)\((.*)\)$/.exec(codigo);
      assert.ok(llamada, `no es una sola llamada: ${codigo}`);
      const argumento = JSON.parse(llamada[2]);          /* si hubiera código inyectado, esto fallaría */
      assert.equal(typeof argumento, 'string');
      revisados++;
    }
  }
  assert.ok(revisados >= 6, `se revisaron ${revisados} atributos`);
});

test('XML del Word: escapar y desescapar son inversos exactos con cualquier texto', () => {
  const { app } = cargarApp();
  for (const t of TEXTOS_DIFICILES) {
    assert.equal(app.desescaparXML(app.escaparXML(t)), t, `falló con: ${t}`);
  }
  assert.equal(app.escaparXML(undefined), '');
  assert.equal(app.desescaparXML('&amp;lt;'), '&lt;', 'no debe decodificar dos veces');
});

test('Word: una descripción con texto tipo "&quot;" o "&lt;" se exporta e importa sin alterarse', async () => {
  const falso = jszipFalso();
  falso.JSZip.loadAsync = async () => ({
    file: n => (falso.archivos[n] ? { async: async () => falso.archivos[n] } : null),
  });
  const difícil = 'revisar campo &quot;monto&quot; y &lt;b&gt; & "comillas" <tag>';
  const origen = cargarApp({ JSZip: falso.JSZip });
  await origen.app.generarDOCX([tarea({ id: 'a', empresa: 'Cliente Demo SA', descripcion: difícil })], USUARIO_CON_MAILS);

  const destino = conAvisos({ JSZip: falso.JSZip });
  await destino.app.procesarRespaldoDOCX({ name: 'r.docx', arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(destino.almacen.leer('pbc_tareas')[0].descripcion, difícil);
});

test('lectura: si lo guardado se daña OTRA VEZ con otro contenido, se avisa de nuevo y la copia se actualiza', () => {
  const { app, almacen, avisos } = conAvisos();
  almacen.setItem('pbc_tareas', '{primero');
  ev(app, 'getTareas()');
  almacen.setItem('pbc_tareas', JSON.stringify([tarea()]));
  assert.equal(ev(app, 'getTareas()').length, 1);
  almacen.setItem('pbc_tareas', '{segundo');
  ev(app, 'getTareas()');
  assert.equal(avisos.length, 2);
  assert.equal(almacen.getItem('pbc_tareas__danado'), '{segundo');
});

test('lectura: datos que son JSON válido pero con otra forma ("null", objeto, texto) no rompen la app', () => {
  for (const raro of ['null', '{}', '"hola"', '5']) {
    const { app, almacen, avisos } = conAvisos();
    almacen.setItem('pbc_tareas', raro);
    assert.deepEqual(plano(ev(app, 'getTareas()')), [], `tareas = ${raro}`);
    assert.equal(almacen.getItem('pbc_tareas__danado'), raro);
    assert.equal(avisos.length, 1);
  }
  const { app, almacen } = conAvisos();
  almacen.setItem('pbc_usuario', '[1,2]');
  almacen.setItem('pbc_vista', '"otra"');
  almacen.setItem('pbc_secciones', 'null');
  assert.equal(ev(app, 'getUsuario()'), null);
  assert.equal(ev(app, 'getVista()'), 'urgencia');
  assert.deepEqual(plano(ev(app, 'getSecciones()')), {});
});

test('lectura: con datos válidos no hay avisos ni copias', () => {
  const { app, almacen, avisos } = conAvisos({ tareas: [tarea()], usuario: { nombre: 'Usuario Demo' } });
  assert.equal(ev(app, 'getTareas()').length, 1);
  assert.equal(ev(app, 'getUsuario()').nombre, 'Usuario Demo');
  assert.deepEqual(avisos, []);
  assert.equal(almacen.getItem('pbc_tareas__danado'), null);
});

test('importar: antes de reemplazar se guarda una copia de las tareas que había', () => {
  const previas = [tarea({ id: 'previa-1' }), tarea({ id: 'previa-2' })];
  const c = conAvisos({ tareas: previas });
  const crudoAntes = c.almacen.getItem('pbc_tareas');
  c.app.procesarRespaldo(respaldo([tarea({ id: 'nueva' })]));
  assert.deepEqual(c.almacen.leer('pbc_tareas').map(t => t.id), ['nueva']);
  assert.equal(c.almacen.getItem('pbc_tareas__previo'), crudoAntes);
});

test('lectura: una tarea guardada con forma inválida ([null], urgencia desconocida) cuenta como dato dañado y no rompe la pantalla', () => {
  for (const raro of [[null], [tarea({ urgencia: 'urgente' })], [tarea({ estado: 'x' })], [tarea(), 5], [tarea({ empresa: 7 })]]) {
    const { app, almacen, avisos } = conAvisos();
    almacen.setItem('pbc_tareas', JSON.stringify(raro));
    assert.deepEqual(plano(ev(app, 'getTareas()')), [], JSON.stringify(raro));
    assert.equal(avisos.length, 1);
    assert.equal(almacen.getItem('pbc_tareas__danado'), JSON.stringify(raro));
  }
});

test('Word: los caracteres de control inválidos en XML (ej. U+000B al pegar de un PDF) se quitan; tab y salto de línea se conservan', () => {
  const { app } = conAvisos();
  assert.equal(app.escaparXML('texto\u000Bcon\u0000 y\u001F'), 'textocon y');
  assert.equal(app.escaparXML('a\tb\nc'), 'a\tb\nc');
});

test('dictado: "alta", "baja" o "media" dentro de la descripción no se confunden con la urgencia', () => {
  const { app } = conAvisos();
  const p = t => plano(ev(app, `parsearDictado(${JSON.stringify(t)})`));
  assert.deepEqual(p('Panadería Sol, dar de baja, la cuenta'),
    { urgencia: 'media', empresa: 'Panadería Sol', descripcion: 'dar de baja, la cuenta' });
  assert.deepEqual(p('Cliente Demo SA, revisar la falta'),
    { urgencia: 'media', empresa: 'Cliente Demo SA', descripcion: 'revisar la falta' });
  assert.deepEqual(p('Metalúrgica Sur, dar de alta cliente, alta'),
    { urgencia: 'alta', empresa: 'Metalúrgica Sur', descripcion: 'dar de alta cliente' });
});

test('dictado: la urgencia al final (sola, con "urgencia" o con punto) se reconoce y se saca de la descripción', () => {
  const { app } = conAvisos();
  const p = t => plano(ev(app, `parsearDictado(${JSON.stringify(t)})`));
  assert.deepEqual(p('Cliente Demo SA, llamar por la carpeta, urgencia baja'),
    { urgencia: 'baja', empresa: 'Cliente Demo SA', descripcion: 'llamar por la carpeta' });
  assert.deepEqual(p('Cliente Demo SA, llamar por la carpeta, Media.'),
    { urgencia: 'media', empresa: 'Cliente Demo SA', descripcion: 'llamar por la carpeta' });
  assert.deepEqual(p('Cliente Demo SA llamar por la carpeta urgencia alta'),
    { urgencia: 'alta', empresa: '', descripcion: 'Cliente Demo SA llamar por la carpeta' });
  assert.deepEqual(p('solo una frase sin comas'),
    { urgencia: 'media', empresa: '', descripcion: 'solo una frase sin comas' });
});
