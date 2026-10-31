/**
 * TLP · Контроль — приймання результатів тестування в Google Таблицю.
 *
 * Встановлення (детально — у README.md репозиторію):
 *   1. Створіть порожню Google Таблицю.
 *   2. Розширення → Apps Script. Замініть увесь код цим файлом.
 *   3. Змініть INSTRUCTOR_KEY нижче на власний код доступу до журналу.
 *   4. Розгорнути → Нове розгортання → Тип «Веб-застосунок»:
 *        Виконувати від імені: Я
 *        Хто має доступ: Усі
 *   5. Скопіюйте URL веб-застосунку (закінчується на /exec) у site/config.js → SCRIPT_URL.
 *
 * Після будь-якої зміни коду: Розгорнути → Керувати розгортаннями → Редагувати → Версія: «Нова версія».
 */

const INSTRUCTOR_KEY = 'ЗМІНІТЬ-МЕНЕ';
const SHEET_NAME = 'Результати';
const STEP_COUNT = 8;

const HEADERS = [
  'Час', 'ID', 'Тест', 'Форма', 'Слухач', 'Підрозділ', 'Група',
  'Бали', 'Всього', '%', 'Результат',
  'К1', 'К2', 'К3', 'К4', 'К5', 'К6', 'К7', 'К8',
  'Тривалість, с', 'Відповіді',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!d.id || !d.name || (d.type !== 'entry' && d.type !== 'exit')) {
      return out_({ ok: false, error: 'Неповні дані результату' });
    }
    const sh = sheet_();
    const last = sh.getLastRow();
    if (last > 1) {
      const dup = sh.getRange(2, 2, last - 1, 1)
        .createTextFinder(String(d.id)).matchEntireCell(true).findNext();
      if (dup) return out_({ ok: true, duplicate: true });
    }
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const isExit = d.type === 'exit';
    sh.appendRow([
      new Date(),
      text_(d.id, 40),
      isExit ? 'Вихідний' : 'Вхідний',
      text_(d.form, 4),
      text_(d.name, 60),
      text_(d.unit, 60),
      text_(d.group, 40),
      num_(d.score),
      num_(d.total),
      num_(d.pct),
      isExit ? (d.passed ? 'Зараховано' : 'Не зараховано') : 'Вихідний рівень',
    ].concat(
      Array.from({ length: STEP_COUNT }, (_, i) => num_(steps[i])),
      [num_(d.duration), text_(d.answers, 600)]
    ));
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* блокування не було отримано */ }
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action !== 'list') {
    return out_({ ok: true, service: 'TLP Контроль', hint: 'Журнал відкривається на сайті.' });
  }
  if (INSTRUCTOR_KEY === 'ЗМІНІТЬ-МЕНЕ') {
    return out_({ ok: false, code: 'setup', error: 'У скрипті таблиці не змінено INSTRUCTOR_KEY. Змініть його й створіть нову версію розгортання.' });
  }
  if (String(p.key || '') !== INSTRUCTOR_KEY) {
    return out_({ ok: false, code: 'key', error: 'Невірний код доступу.' });
  }
  const values = sheet_().getDataRange().getValues();
  const rows = values.slice(1).filter(function (r) { return r[1]; }).map(function (r) {
    return {
      ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      id: String(r[1]),
      type: r[2] === 'Вихідний' ? 'exit' : 'entry',
      form: String(r[3]),
      name: String(r[4]),
      unit: String(r[5]),
      group: String(r[6]),
      score: Number(r[7]),
      total: Number(r[8]),
      pct: Number(r[9]),
      steps: r.slice(11, 11 + STEP_COUNT).map(Number),
      duration: Number(r[11 + STEP_COUNT]),
    };
  });
  return out_({ ok: true, rows: rows });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

/* Текст із сайту записується як текст, а не як формула. */
function text_(v, max) {
  let s = String(v == null ? '' : v).slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
