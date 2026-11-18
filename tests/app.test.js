'use strict';
/*
  Pruebas de Pendientes BCO. Todo dato es inventado ("Cliente Demo SA").
  Hoy simulado: miércoles 2026-11-18, 10:30 (hora Argentina).
  Cómo correrlas: sh tests/verificar.sh
*/
const test   = require('node:test');
const assert = require('node:assert/strict');
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

test('purgarFinalizadas(): una tarea "listo" sin fecha de finalización se borra (comportamiento actual, a revisar en la auditoría)', () => {
  const ids = tareasTrasPurgar([
    tarea({ id: 'listo-sin-fecha', estado: 'listo', fechaFinalizado: null }),
    tarea({ id: 'activa' }),
  ]);
  assert.deepEqual(ids, ['activa']);
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

test('fechaISO(): a las 22:30 de Argentina sigue siendo el mismo día', {
  todo: 'Falla conocida: usa hora UTC, así que después de las 21:00 da el día siguiente (afecta el nombre del Word y la fecha del respaldo). Se arregla en la auditoría con OK de Eliel.',
}, () => {
  const { app } = cargarApp();
  assert.equal(app.fechaISO(new Date(ARG(2026, 11, 18, 22, 30))), '2026-11-18');
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
  await app.programarNotificaciones();
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

test('avisos: tarea de hoy a las 15:00 con anticipación de 30 min programa dos avisos en el service worker', async () => {
  const r = await correrAvisos({
    usuario: { nombre: 'Usuario Demo', anticipacion: 30 },
    tareas: [tarea({ fechaVenc: '2026-11-18', horaVenc: '15:00' })],
  });
  assert.equal(r.mensajesSW.length, 1);
  assert.equal(r.mensajesSW[0].type, 'SCHEDULE_NOTIFS');
  const porTag = Object.fromEntries(r.mensajesSW[0].list.map(n => [n.tag, n]));
  assert.equal(porTag['pbc-venc-t1'].at, ARG(2026, 11, 18, 15, 0));
  assert.equal(porTag['pbc-venc-t1'].title, '⏰ Cliente Demo SA');
  assert.equal(porTag['pbc-ant-t1'].at, ARG(2026, 11, 18, 14, 30));
  assert.equal(porTag['pbc-ant-t1'].title, '⏰ Cliente Demo SA en 30 min');
  assert.equal(r.mensajesSW[0].list.length, 2);
});

test('avisos: la anticipación se escribe en horas cuando es de 60 min o más', async () => {
  const titulo = async min => (await correrAvisos({
    usuario: { nombre: 'Usuario Demo', anticipacion: min },
    tareas: [tarea({ fechaVenc: '2026-11-18', horaVenc: '15:00' })],
  })).mensajesSW[0].list.find(n => n.tag === 'pbc-ant-t1').title;
  assert.equal(await titulo(60),  '⏰ Cliente Demo SA en 1 hora');
  assert.equal(await titulo(120), '⏰ Cliente Demo SA en 2 horas');
});

test('avisos: si la anticipación ya pasó, solo queda el aviso de la hora del vencimiento', async () => {
  const r = await correrAvisos({
    usuario: { nombre: 'Usuario Demo', anticipacion: 30 },
    tareas: [tarea({ fechaVenc: '2026-11-18', horaVenc: '10:45' })],
  });
  assert.deepEqual(r.mensajesSW[0].list.map(n => n.tag), ['pbc-venc-t1']);
});

test('avisos: una hora de hoy que ya pasó no programa nada (solo el aviso inmediato)', async () => {
  const r = await correrAvisos({ tareas: [tarea({ fechaVenc: '2026-11-18', horaVenc: '09:00' })] });
  assert.equal(r.notificaciones.length, 1);
  assert.equal(r.mensajesSW.length, 0);
});

test('avisos: las horas de días futuros no se programan todavía', async () => {
  const r = await correrAvisos({ tareas: [tarea({ fechaVenc: '2026-11-19', horaVenc: '15:00' })] });
  assert.deepEqual(r, { notificaciones: [], mensajesSW: [] });
});
