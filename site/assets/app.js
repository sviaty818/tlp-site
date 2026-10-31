/* TLP · Контроль — логіка сайту. Без залежностей. */
(function () {
  'use strict';

  const CFG = Object.assign(
    { SCRIPT_URL: '', PASS_PERCENT: 80, SHOW_REVIEW_AFTER_ENTRY: false, SHOW_REVIEW_AFTER_EXIT: true },
    window.TLP_CONFIG || {}
  );
  CFG.SCRIPT_URL = String(CFG.SCRIPT_URL || '').trim();
  const STEPS = window.TLP_STEPS;
  const FORMS = window.TLP_FORMS;
  const QMAP = {};
  Object.keys(FORMS).forEach((t) => FORMS[t].questions.forEach((q) => { QMAP[q.id] = q; }));
  const PER_STEP = Math.max(1, Math.round(FORMS.entry.questions.length / STEPS.length));
  const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
  const TYPE = {
    entry: { label: 'Вхідний', full: 'Вхідний контроль', form: 'A' },
    exit: { label: 'Вихідний', full: 'Вихідний контроль', form: 'B' },
  };
  const KEYS = {
    records: 'tlp.records.v1',
    queue: 'tlp.queue.v1',
    session: 'tlp.session.v1',
    group: 'tlp.group.v1',
    unit: 'tlp.unit.v1',
    key: 'tlp.key.v1',
    jsrc: 'tlp.jsrc.v1',
  };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────── Утиліти ───────── */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); };
  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  const norm = (s) => String(s || '').toLowerCase().replace(/[’'ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
  const personKey = (r) => norm(r.name) + '|' + norm(r.group);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const stepLabel = (i) => pad2(i + 1) + ' ' + STEPS[i].ua;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const store = {
    get(area, k, d) {
      try { const v = window[area].getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(area, k, v) {
      try { window[area].setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del(area, k) { try { window[area].removeItem(k); } catch (e) { /* немає доступу до сховища */ } },
  };

  /* ───────── Записи і черга надсилання ───────── */
  const Records = {
    all() { return store.get('localStorage', KEYS.records, []); },
    add(rec) { const a = this.all(); a.push(rec); store.set('localStorage', KEYS.records, a); },
    mark(id, patch) {
      const a = this.all();
      const r = a.find((x) => x.id === id);
      if (r) { Object.assign(r, patch); store.set('localStorage', KEYS.records, a); }
    },
    clear() { store.del('localStorage', KEYS.records); store.del('localStorage', KEYS.queue); },
  };

  const Sender = {
    busy: null,
    queue() { return store.get('localStorage', KEYS.queue, []); },
    enqueue(rec) { const q = this.queue(); if (!q.some((r) => r.id === rec.id)) q.push(rec); store.set('localStorage', KEYS.queue, q); },
    remove(id) { store.set('localStorage', KEYS.queue, this.queue().filter((r) => r.id !== id)); },
    async post(rec) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), 15000);
      try {
        const res = await fetch(CFG.SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify(Object.assign({ action: 'add' }, rec)),
          redirect: 'follow',
          signal: ctrl ? ctrl.signal : undefined,
        });
        const j = await res.json().catch(() => null);
        return !!(j && j.ok);
      } catch (e) {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    /* Надсилає всі записи з черги. Повертає { sent: [...ids], left: n }. */
    flush() {
      if (!CFG.SCRIPT_URL) return Promise.resolve({ sent: [], left: this.queue().length });
      if (this.busy) return this.busy;
      this.busy = (async () => {
        const sent = [];
        for (const rec of this.queue()) {
          if (await this.post(rec)) {
            this.remove(rec.id);
            Records.mark(rec.id, { sent: true });
            sent.push(rec.id);
          }
        }
        return { sent, left: this.queue().length };
      })().finally(() => { this.busy = null; });
      return this.busy;
    },
  };

  /* ───────── Маршрутизація ───────── */
  const VIEWS = { home: 'view-home', test: 'view-test', journal: 'view-journal' };
  const HOME_ANCHORS = ['steps', 'how'];

  function route() {
    const h = (location.hash || '').slice(1);
    const view = VIEWS[h] ? h : 'home';
    Object.keys(VIEWS).forEach((name) => { document.getElementById(VIEWS[name]).hidden = name !== view; });
    const navKey = view === 'home' ? h : view;
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === navKey;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (view === 'home') {
      Maps.drawAll();
      if (HOME_ANCHORS.includes(h)) {
        const t = document.getElementById(h);
        if (t) requestAnimationFrame(() => t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));
      } else {
        window.scrollTo(0, 0);
      }
    } else {
      window.scrollTo(0, 0);
      if (view === 'test') Test.mount();
      if (view === 'journal') Journal.mount();
    }
    if (view !== 'test') Test.stopTimer();
  }

  /* ───────── Головна: заповнення ───────── */
  function fillHome() {
    const grid = $('#steps-grid');
    grid.innerHTML = STEPS.map((s, i) => `
      <li class="step">
        <span class="step__n">${pad2(i + 1)}</span>
        <h3 class="h3">${esc(s.ua)}</h3>
        <span class="step__en">${esc(s.en)}</span>
        <p class="step__text">${esc(s.text)}</p>
      </li>`).join('');
    $$('[data-fill="steps"]').forEach((el) => { el.textContent = STEPS.length; });
    $$('[data-fill="perTest"]').forEach((el) => { el.textContent = FORMS.entry.questions.length; });
    $$('[data-fill="pass"]').forEach((el) => { el.textContent = CFG.PASS_PERCENT; });
  }

  /* ───────── Тест ───────── */
  const Test = {
    st: null,
    preset: null,
    timerId: null,

    root() { return $('#test-root'); },
    save() { store.set('sessionStorage', KEYS.session, this.st); },

    mount() {
      if (!this.st) {
        const saved = store.get('sessionStorage', KEYS.session, null);
        if (saved && saved.phase && saved.items) this.st = saved;
      }
      if (this.preset && (!this.st || this.st.phase === 'brief' || this.st.phase === 'result')) {
        this.st = { phase: 'brief', type: this.preset };
      }
      this.preset = null;
      if (!this.st) this.st = { phase: 'brief', type: 'entry' };
      this.render();
    },

    render() {
      this.stopTimer();
      const p = this.st.phase;
      if (p === 'brief') this.renderBrief();
      else if (p === 'quiz') this.renderQuiz();
      else if (p === 'review') this.renderReview();
      else if (p === 'result') this.renderResult();
    },

    /* Інструктаж */
    renderBrief(err) {
      const st = this.st;
      const group = st.group != null ? st.group : store.get('localStorage', KEYS.group, '');
      const unit = st.unit != null ? st.unit : store.get('localStorage', KEYS.unit, '');
      const n = FORMS.entry.questions.length;
      this.root().innerHTML = `
        <div class="page__head">
          <p class="eyebrow">Інструктаж перед тестом</p>
          <h2 class="h2">Перевірка знань 8 кроків TLP</h2>
        </div>
        <div class="brief">
          <form class="panel panel--cut brief__form" id="brief-form" novalidate>
            <fieldset class="choice">
              <legend class="eyebrow">Вид контролю</legend>
              <label class="choice__item">
                <input type="radio" name="ttype" id="tt-entry" value="entry" ${st.type !== 'exit' ? 'checked' : ''}>
                <span class="choice__box">
                  <span class="choice__k">Форма A</span>
                  <b>Вхідний контроль</b>
                  <small>До початку навчання. Фіксує вихідний рівень.</small>
                </span>
              </label>
              <label class="choice__item">
                <input type="radio" name="ttype" id="tt-exit" value="exit" ${st.type === 'exit' ? 'checked' : ''}>
                <span class="choice__box">
                  <span class="choice__k">Форма B</span>
                  <b>Вихідний контроль</b>
                  <small>Після навчання. Інші питання того самого рівня.</small>
                </span>
              </label>
            </fieldset>
            <div class="fields">
              <label class="field field--wide">
                <span>Прізвище та ініціали або позивний</span>
                <input class="input" id="f-name" name="name" maxlength="60" autocomplete="off" autocapitalize="words" spellcheck="false" value="${esc(st.name || '')}" placeholder="Напр. Коваленко О. П.">
              </label>
              <label class="field">
                <span>Навчальна група</span>
                <input class="input" id="f-group" name="group" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(group)}" placeholder="Напр. Група 3">
              </label>
              <label class="field">
                <span>Підрозділ <i>(необов’язково)</i></span>
                <input class="input" id="f-unit" name="unit" maxlength="60" autocomplete="off" spellcheck="false" value="${esc(unit)}">
              </label>
            </div>
            <p class="form-err" id="brief-err" role="alert">${esc(err || '')}</p>
            <div class="form-actions">
              <button class="btn btn--accent" type="submit">Почати тест</button>
              <a class="btn btn--text" href="#home">Скасувати</a>
            </div>
          </form>
          <div class="panel">
            <p class="eyebrow" style="margin-bottom:16px">Порядок</p>
            <ul class="rules">
              <li><b>${pad2(n)}</b><span><strong>${n} питання</strong>, по ${PER_STEP} на кожен із 8 кроків.</span></li>
              <li><b>01</b><span>У кожному питанні <strong>один правильний</strong> варіант.</span></li>
              <li><b>↺</b><span>До завершення можна повертатися до будь-якого питання й змінювати відповідь.</span></li>
              <li><b>⏱</b><span>Час не обмежено, але він фіксується в результаті.</span></li>
              <li><b>%</b><span>Вихідний контроль зараховано від <strong>${CFG.PASS_PERCENT}%</strong>.</span></li>
            </ul>
            <p class="note">Вхідний і вихідний результати зіставляються за прізвищем і групою. Вводьте їх однаково обидва рази.</p>
          </div>
        </div>`;
      const form = $('#brief-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.start(form);
      });
      $$('input[name="ttype"]', form).forEach((r) => r.addEventListener('change', () => { this.st.type = r.value; }));
      const first = !st.name ? $('#f-name') : null;
      if (first && window.matchMedia('(min-width: 721px)').matches) first.focus({ preventScroll: true });
    },

    start(form) {
      const type = (form.querySelector('input[name="ttype"]:checked') || {}).value || 'entry';
      const name = form.name.value.replace(/\s+/g, ' ').trim();
      const group = form.group.value.replace(/\s+/g, ' ').trim();
      const unit = form.unit.value.replace(/\s+/g, ' ').trim();
      form.name.removeAttribute('aria-invalid');
      form.group.removeAttribute('aria-invalid');
      const errs = [];
      if (name.length < 2) { errs.push('прізвище або позивний'); form.name.setAttribute('aria-invalid', 'true'); }
      if (!group) { errs.push('навчальну групу'); form.group.setAttribute('aria-invalid', 'true'); }
      if (errs.length) {
        $('#brief-err').textContent = 'Вкажіть ' + errs.join(' і ') + '.';
        (name.length < 2 ? form.name : form.group).focus();
        return;
      }
      store.set('localStorage', KEYS.group, group);
      store.set('localStorage', KEYS.unit, unit);
      const qs = FORMS[type].questions;
      const items = [];
      STEPS.forEach((s) => {
        shuffle(qs.filter((q) => q.step === s.n)).forEach((q) => {
          items.push({ id: q.id, order: shuffle(q.options.map((_, i) => i)) });
        });
      });
      this.st = { phase: 'quiz', type, name, group, unit, items, answers: {}, idx: 0, startedAt: Date.now() };
      this.save();
      this.render();
      window.scrollTo(0, 0);
    },

    /* Питання */
    renderQuiz() {
      const st = this.st;
      const it = st.items[st.idx];
      const q = QMAP[it.id];
      const stepIdx = q.step - 1;
      const total = st.items.length;
      const ans = st.answers[it.id];
      const rail = STEPS.map((s, si) => {
        const pips = st.items.map((x, xi) => ({ x, xi })).filter((o) => QMAP[o.x.id].step === s.n).map((o) => {
          const cls = o.xi === st.idx ? 'is-cur' : (st.answers[o.x.id] != null ? 'is-done' : '');
          return `<button type="button" class="pip ${cls}" data-go="${o.xi}" aria-label="Питання ${o.xi + 1}${st.answers[o.x.id] != null ? ', є відповідь' : ''}"></button>`;
        }).join('');
        return `<div class="rail__step ${si === stepIdx ? 'is-cur' : ''}"><span class="rail__lbl">${pad2(si + 1)}</span><div class="rail__pips">${pips}</div></div>`;
      }).join('');
      const opts = it.order.map((oi, k) => `
        <label class="opt">
          <input type="radio" name="opt" id="opt-${k}" value="${oi}" ${ans === oi ? 'checked' : ''}>
          <span class="opt__box"><span class="opt__k">${LETTERS[k]}</span><span class="opt__t">${esc(q.options[oi])}</span></span>
        </label>`).join('');
      const last = st.idx === total - 1;
      this.root().innerHTML = `
        <div class="quiz">
          <nav class="rail" aria-label="Прогрес за кроками">${rail}</nav>
          <div class="qmeta">
            <div class="qmeta__step">
              <span class="eyebrow">${esc(TYPE[st.type].full)} · Крок ${pad2(q.step)} / ${pad2(STEPS.length)} · ${esc(STEPS[stepIdx].en)}</span>
              <b>${esc(STEPS[stepIdx].ua)}</b>
            </div>
            <div class="qmeta__nums">
              <span>Питання <strong>${pad2(st.idx + 1)}</strong> / ${total}</span>
              <span aria-label="Час проходження"><strong id="q-timer">${fmtDur((Date.now() - st.startedAt) / 1000)}</strong></span>
            </div>
          </div>
          <fieldset class="q">
            <legend class="q__text">${esc(q.q)}</legend>
            <div class="opts">${opts}</div>
          </fieldset>
          <div class="qnav">
            <button type="button" class="btn btn--text" data-act="abort">Перервати тест</button>
            <div class="qnav__btns">
              <button type="button" class="btn btn--ghost" data-act="prev" ${st.idx === 0 ? 'disabled' : ''}><span>Назад</span></button>
              <button type="button" class="btn btn--accent" data-act="next" ${ans == null ? 'disabled' : ''}><span>${last ? 'До завершення' : 'Далі'}</span></button>
            </div>
          </div>
          <p class="qnav__hint">Клавіші 1–${it.order.length} — вибір, Enter — далі</p>
        </div>`;
      const root = this.root();
      $$('input[name="opt"]', root).forEach((r) => r.addEventListener('change', () => this.answer(Number(r.value))));
      $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => this.go(Number(b.dataset.go))));
      $('[data-act="prev"]', root).addEventListener('click', () => this.go(st.idx - 1));
      $('[data-act="next"]', root).addEventListener('click', () => this.next());
      const ab = $('[data-act="abort"]', root);
      ab.addEventListener('click', () => {
        if (ab.dataset.armed) { this.abort(); return; }
        ab.dataset.armed = '1';
        ab.textContent = 'Натисніть ще раз: відповіді буде втрачено';
        clearTimeout(this._abt);
        this._abt = setTimeout(() => { if (ab.isConnected) { delete ab.dataset.armed; ab.textContent = 'Перервати тест'; } }, 4000);
      });
      this.startTimer();
    },

    abort() {
      const type = this.st.type;
      this.st = { phase: 'brief', type };
      store.del('sessionStorage', KEYS.session);
      this.render();
      window.scrollTo(0, 0);
    },

    answer(v) {
      const it = this.st.items[this.st.idx];
      this.st.answers[it.id] = v;
      this.save();
      const nextBtn = $('[data-act="next"]', this.root());
      if (nextBtn) nextBtn.disabled = false;
      const pip = $(`[data-go="${this.st.idx}"]`, this.root());
      if (pip) pip.setAttribute('aria-label', `Питання ${this.st.idx + 1}, є відповідь`);
    },

    go(i) {
      if (i < 0 || i >= this.st.items.length) return;
      this.st.phase = 'quiz';
      this.st.idx = i;
      this.save();
      this.render();
      const legend = $('.q__text', this.root());
      if (legend) legend.scrollIntoView({ block: 'nearest' });
    },

    next() {
      const st = this.st;
      if (st.answers[st.items[st.idx].id] == null) return;
      if (st.idx < st.items.length - 1) { this.go(st.idx + 1); return; }
      st.phase = 'review';
      this.save();
      this.render();
      window.scrollTo(0, 0);
    },

    onKey(e) {
      if (!this.st || this.st.phase !== 'quiz' || document.getElementById('view-test').hidden) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' && e.target.type !== 'radio') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      const it = this.st.items[this.st.idx];
      let k = -1;
      if (/^[1-9]$/.test(e.key)) k = Number(e.key) - 1;
      else {
        const li = LETTERS.indexOf(e.key.toUpperCase());
        if (li >= 0) k = li;
      }
      if (k >= 0 && k < it.order.length) {
        e.preventDefault();
        const r = document.getElementById('opt-' + k);
        if (r) { r.checked = true; r.focus({ preventScroll: true }); this.answer(Number(r.value)); }
        return;
      }
      if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        this.next();
      }
    },

    startTimer() {
      this.stopTimer();
      this.timerId = setInterval(() => {
        const el = document.getElementById('q-timer');
        if (el && this.st && this.st.startedAt) el.textContent = fmtDur((Date.now() - this.st.startedAt) / 1000);
      }, 1000);
    },
    stopTimer() { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } },

    /* Перевірка перед завершенням */
    renderReview() {
      const st = this.st;
      const total = st.items.length;
      const missing = st.items.map((it, i) => ({ it, i })).filter((o) => st.answers[o.it.id] == null);
      const done = total - missing.length;
      this.root().innerHTML = `
        <div class="review-sum">
          <p class="eyebrow">${esc(TYPE[st.type].full)} · ${esc(st.name)} · ${esc(st.group)}</p>
          <h2 class="h2">Завершити тест?</h2>
          <p class="review-sum__big">${done}<span> / ${total}</span></p>
          <p class="lede">${missing.length
            ? `Без відповіді: ${missing.length}. Питання без відповіді зараховуються як неправильні.`
            : 'Відповіді дано на всі питання. Після завершення змінити їх буде неможливо.'}</p>
          ${missing.length ? `<div class="chips">${missing.map((o) => `<button type="button" class="chip" data-go="${o.i}">Питання ${o.i + 1}</button>`).join('')}</div>` : ''}
          <div class="form-actions">
            <button type="button" class="btn btn--accent" data-act="finish"><span>Завершити тест</span></button>
            <button type="button" class="btn btn--ghost" data-act="back"><span>Повернутися до питань</span></button>
          </div>
        </div>`;
      const root = this.root();
      $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => this.go(Number(b.dataset.go))));
      $('[data-act="back"]', root).addEventListener('click', () => this.go(missing.length ? missing[0].i : total - 1));
      $('[data-act="finish"]', root).addEventListener('click', () => this.finish());
    },

    finish() {
      const st = this.st;
      const finishedAt = Date.now();
      const steps = STEPS.map(() => 0);
      const parts = [];
      let score = 0;
      st.items.forEach((it) => {
        const q = QMAP[it.id];
        const a = st.answers[it.id];
        if (a === q.correct) { score++; steps[q.step - 1]++; }
        parts.push(it.id + ':' + (a == null ? '-' : 'abcdef'[a]));
      });
      const total = st.items.length;
      const pct = Math.round((score / total) * 100);
      const rec = {
        id: uid(),
        ts: new Date(finishedAt).toISOString(),
        type: st.type,
        form: TYPE[st.type].form,
        name: st.name,
        unit: st.unit || '',
        group: st.group,
        score,
        total,
        pct,
        passed: st.type === 'exit' ? pct >= CFG.PASS_PERCENT : null,
        steps,
        duration: Math.round((finishedAt - st.startedAt) / 1000),
        answers: parts.join(' '),
        sent: false,
      };
      Records.add(rec);
      st.phase = 'result';
      st.record = rec;
      st.send = CFG.SCRIPT_URL ? 'sending' : 'local';
      this.save();
      this.render();
      window.scrollTo(0, 0);
      if (CFG.SCRIPT_URL) {
        Sender.enqueue(rec);
        this.sendNow();
      }
    },

    sendNow() {
      const st = this.st;
      if (!st || !st.record) return;
      st.send = 'sending';
      this.updateSend();
      Sender.flush().then((r) => {
        if (!this.st || !this.st.record) return;
        const ok = r.sent.includes(this.st.record.id) || !Sender.queue().some((x) => x.id === this.st.record.id);
        this.st.send = ok ? 'ok' : 'queued';
        this.save();
        this.updateSend();
      });
    },

    sendText(state) {
      return {
        sending: 'Надсилаємо результат у журнал інструктора…',
        ok: 'Результат записано в журнал інструктора.',
        queued: 'Немає зв’язку з журналом. Результат збережено на цьому пристрої й буде надіслано, щойно з’явиться зв’язок.',
        local: 'Результат збережено в журналі цього пристрою.',
      }[state] || '';
    },

    updateSend() {
      const box = $('#send-box', this.root());
      if (!box || !this.st) return;
      box.dataset.state = this.st.send;
      $('.send__state', box).textContent = this.sendText(this.st.send);
      const retry = $('[data-act="retry"]', box);
      if (retry) retry.hidden = this.st.send !== 'queued';
    },

    renderResult() {
      const st = this.st;
      const r = st.record;
      const isExit = r.type === 'exit';
      const weakMax = Math.floor(PER_STEP / 2);
      const pill = isExit
        ? (r.passed ? `<span class="pill pill--ok">Зараховано</span>` : `<span class="pill pill--bad">Не зараховано · поріг ${CFG.PASS_PERCENT}%</span>`)
        : `<span class="pill pill--neutral">Вихідний рівень зафіксовано</span>`;

      let gain = '';
      if (isExit) {
        const prev = Records.all()
          .filter((x) => x.type === 'entry' && personKey(x) === personKey(r))
          .sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
        if (prev) {
          const d = r.pct - prev.pct;
          gain = `
            <div class="gain" aria-label="Порівняння з вхідним контролем">
              <div><span class="eyebrow">Вхідний</span><b>${prev.pct}%</b></div>
              <div><span class="eyebrow">Вихідний</span><b>${r.pct}%</b></div>
              <div><span class="eyebrow">Приріст</span><b class="${d > 0 ? 'is-up' : d < 0 ? 'is-down' : ''}">${d > 0 ? '+' : ''}${d} п.п.</b></div>
            </div>`;
        }
      }

      const rows = STEPS.map((s, i) => {
        const v = r.steps[i];
        const cls = v <= weakMax ? 'is-weak' : (v === PER_STEP ? 'is-full' : '');
        const pips = Array.from({ length: PER_STEP }, (_, k) => `<i class="${k < v ? 'on' : ''}"></i>`).join('');
        return `<div class="bystep ${cls}">
            <span class="bystep__n">${pad2(i + 1)}</span>
            <span class="bystep__name">${esc(s.ua)}<small>${esc(s.en)}</small></span>
            <span class="bystep__pips" aria-hidden="true">${pips}</span>
            <span class="bystep__v" aria-label="${v} з ${PER_STEP}">${v}/${PER_STEP}</span>
          </div>`;
      }).join('');

      const showReview = isExit ? CFG.SHOW_REVIEW_AFTER_EXIT : CFG.SHOW_REVIEW_AFTER_ENTRY;
      let review = '';
      if (showReview) {
        const wrong = st.items.filter((it) => st.answers[it.id] !== QMAP[it.id].correct);
        review = wrong.length ? `
          <div>
            <div class="j-card__head"><h3 class="h3">Розбір помилок</h3><span class="eyebrow">${wrong.length} з ${r.total}</span></div>
            <div class="mistakes">${wrong.map((it) => {
              const q = QMAP[it.id];
              const a = st.answers[it.id];
              return `<article class="mistake">
                <span class="eyebrow">Крок ${pad2(q.step)} · ${esc(STEPS[q.step - 1].ua)}</span>
                <p class="mistake__q">${esc(q.q)}</p>
                <dl class="mistake__a">
                  <dt>Ваша</dt><dd class="bad">${a == null ? 'Без відповіді' : esc(q.options[a])}</dd>
                  <dt>Правильна</dt><dd class="ok">${esc(q.options[q.correct])}</dd>
                  ${q.why ? `<dt>Чому</dt><dd>${esc(q.why)}</dd>` : ''}
                </dl>
              </article>`;
            }).join('')}</div>
          </div>` : '';
      }

      this.root().innerHTML = `
        <div class="result">
          <div class="result__top">
            <div class="result__score">
              <p class="eyebrow">${esc(TYPE[r.type].full)} · Форма ${esc(r.form)}</p>
              <p class="result__pct">${r.pct}<sup>%</sup></p>
              <div class="result__line">
                <span><strong>${r.score}</strong> з ${r.total} правильних</span>
                <span>Час <strong>${fmtDur(r.duration)}</strong></span>
              </div>
              ${pill}
            </div>
            <div class="result__side">
              <div class="panel">
                <p class="eyebrow">Слухач</p>
                <p class="h3" style="margin-top:8px">${esc(r.name)}</p>
                <p class="result__line" style="margin-top:8px"><span>Група <strong>${esc(r.group)}</strong></span>${r.unit ? `<span>${esc(r.unit)}</span>` : ''}</p>
              </div>
              <div class="send" id="send-box" data-state="${esc(st.send)}">
                <p class="send__state">${esc(this.sendText(st.send))}</p>
                <div><button type="button" class="btn btn--ghost btn--sm" data-act="retry" ${st.send === 'queued' ? '' : 'hidden'}><span>Надіслати зараз</span></button></div>
              </div>
            </div>
          </div>
          ${gain}
          <div>
            <div class="j-card__head"><h3 class="h3">Результат за кроками</h3><span class="eyebrow">Правильних із ${PER_STEP}</span></div>
            <div class="bysteps">${rows}</div>
          </div>
          ${review}
          <div class="result__actions">
            <button type="button" class="btn btn--accent" data-act="nexttrainee"><span>Наступний слухач</span></button>
            <a class="btn btn--ghost" href="#home"><span>На головну</span></a>
          </div>
        </div>`;
      const root = this.root();
      $('[data-act="retry"]', root).addEventListener('click', () => this.sendNow());
      $('[data-act="nexttrainee"]', root).addEventListener('click', () => {
        const type = this.st.type;
        this.st = { phase: 'brief', type };
        store.del('sessionStorage', KEYS.session);
        this.render();
        window.scrollTo(0, 0);
      });
    },
  };

  /* ───────── Журнал ───────── */
  const Journal = {
    source: null,
    rows: null,
    loading: false,
    error: '',
    group: 'all',
    query: '',
    clearArmed: false,

    root() { return $('#journal-root'); },

    mount() {
      if (!this.source) {
        const saved = store.get('localStorage', KEYS.jsrc, null);
        this.source = (saved === 'sheet' && !CFG.SCRIPT_URL) ? null : saved;
        if (!this.source) this.source = CFG.SCRIPT_URL ? 'sheet' : 'device';
      }
      this.rows = null;
      this.error = '';
      this.render();
      if (this.source === 'sheet' && store.get('sessionStorage', KEYS.key, '')) this.load();
    },

    setSource(s) {
      this.source = s;
      store.set('localStorage', KEYS.jsrc, s);
      this.rows = null;
      this.error = '';
      this.group = 'all';
      this.render();
      if (s === 'sheet' && store.get('sessionStorage', KEYS.key, '')) this.load();
    },

    async load() {
      const key = store.get('sessionStorage', KEYS.key, '');
      if (!key || !CFG.SCRIPT_URL) return;
      this.loading = true;
      this.error = '';
      this.render();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctrl && ctrl.abort(), 20000);
      try {
        const url = CFG.SCRIPT_URL + (CFG.SCRIPT_URL.includes('?') ? '&' : '?') + 'action=list&key=' + encodeURIComponent(key);
        const res = await fetch(url, { redirect: 'follow', signal: ctrl ? ctrl.signal : undefined });
        const j = await res.json();
        if (!j || !j.ok) {
          this.error = (j && j.error) || 'Таблиця не відповіла.';
          if (j && j.code === 'key') store.del('sessionStorage', KEYS.key);
          this.rows = null;
        } else {
          this.rows = (j.rows || []).map(normalizeRow).filter(Boolean);
        }
      } catch (e) {
        this.error = 'Не вдалося завантажити дані з Google Таблиці. Перевірте зв’язок і URL у config.js.';
        this.rows = null;
      } finally {
        clearTimeout(timer);
        this.loading = false;
        this.render();
      }
    },

    currentRows() {
      if (this.source === 'demo') return demoRows();
      if (this.source === 'device') return Records.all().map(normalizeRow).filter(Boolean);
      return this.rows;
    },

    render() {
      const src = this.source;
      const tabs = [
        CFG.SCRIPT_URL ? ['sheet', 'Google Таблиця'] : null,
        ['device', 'Цей пристрій'],
        ['demo', 'Приклад'],
      ].filter(Boolean);
      const head = `
        <div class="page__head">
          <p class="eyebrow">Журнал інструктора</p>
          <h2 class="h2">Результати контролю${src === 'demo' ? '<span class="demo-flag">Приклад</span>' : ''}</h2>
        </div>
        <div class="j-bar">
          <div class="seg" role="group" aria-label="Джерело даних">
            ${tabs.map(([k, l]) => `<button type="button" data-src="${k}" aria-pressed="${src === k}">${l}</button>`).join('')}
          </div>
          ${src === 'sheet' && store.get('sessionStorage', KEYS.key, '') ? `<button type="button" class="btn btn--ghost btn--sm" data-act="reload"><span>Оновити</span></button>` : ''}
        </div>`;

      let note = '';
      if (src === 'sheet') note = 'Дані з <strong>Google Таблиці</strong>: результати всіх слухачів з усіх пристроїв.';
      if (src === 'device') {
        const q = Sender.queue().length;
        note = CFG.SCRIPT_URL
          ? `Записи, зроблені <strong>на цьому пристрої</strong>.${q ? ` Не надіслано в таблицю: <strong>${q}</strong>.` : ''}`
          : '<strong>Google Таблицю не підключено.</strong> Журнал показує тести, пройдені на цьому пристрої. Щоб збирати результати з усіх пристроїв, підключіть таблицю за інструкцією в README.';
      }
      if (src === 'demo') note = 'Вигадані дані, щоб показати, як виглядає журнал. Реальних слухачів тут немає.';

      let body = '';
      if (src === 'sheet' && !store.get('sessionStorage', KEYS.key, '')) {
        body = `
          <form class="panel panel--cut" id="key-form" style="max-width:560px" novalidate>
            <p class="eyebrow">Доступ</p>
            <p class="h3" style="margin:10px 0 18px">Код доступу до журналу</p>
            <label class="field"><span>Код (задано в скрипті таблиці)</span>
              <input class="input" id="j-key" type="password" autocomplete="off" required>
            </label>
            <p class="form-err" role="alert">${esc(this.error)}</p>
            <div class="form-actions"><button class="btn btn--accent" type="submit"><span>Відкрити журнал</span></button></div>
          </form>`;
      } else if (this.loading) {
        body = `<div class="empty"><p>Завантаження даних з Google Таблиці…</p></div>`;
      } else if (this.error) {
        body = `<div class="empty"><p>${esc(this.error)}</p><button type="button" class="btn btn--ghost btn--sm" data-act="reload"><span>Спробувати ще раз</span></button></div>`;
      } else {
        const rows = this.currentRows() || [];
        body = rows.length ? this.renderData(rows) : `
          <div class="empty">
            <p class="h3">Результатів ще немає</p>
            <p>Тут з’являться слухачі з вхідним і вихідним результатом, приріст і найслабші кроки групи. Перший запис додасться після першого пройденого тесту.</p>
            <div class="form-actions">
              <a class="btn btn--accent" href="#test" data-preset="entry"><span>Пройти вхідний контроль</span></a>
              <button type="button" class="btn btn--ghost" data-src="demo"><span>Показати приклад</span></button>
            </div>
          </div>`;
      }

      this.root().innerHTML = head + `<p class="j-src">${note}</p>` + body;
      this.bind();
    },

    renderData(rows) {
      const groups = Array.from(new Set(rows.map((r) => r.group).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'uk'));
      if (this.group !== 'all' && !groups.includes(this.group)) this.group = 'all';
      const q = norm(this.query);
      const people = aggregate(rows.filter((r) => this.group === 'all' || r.group === this.group))
        .filter((p) => !q || norm(p.name).includes(q) || norm(p.unit).includes(q));
      people.sort((a, b) => a.group.localeCompare(b.group, 'uk') || a.name.localeCompare(b.name, 'uk'));

      const withEntry = people.filter((p) => p.entry);
      const withExit = people.filter((p) => p.exit);
      const both = people.filter((p) => p.entry && p.exit);
      const avgIn = mean(withEntry.map((p) => p.entry.pct));
      const avgOut = mean(withExit.map((p) => p.exit.pct));
      const avgGain = mean(both.map((p) => p.exit.pct - p.entry.pct));
      const passed = withExit.filter((p) => p.exit.pct >= CFG.PASS_PERCENT).length;
      const f0 = (v) => (v == null ? '—' : Math.round(v));

      const tiles = `
        <div class="tiles">
          <div class="tile"><p class="eyebrow">Слухачів</p><p class="tile__v">${people.length}</p><p class="tile__sub">з вихідним: ${withExit.length}</p></div>
          <div class="tile"><p class="eyebrow">Вхідний, сер.</p><p class="tile__v">${f0(avgIn)}<small>${avgIn == null ? '' : '%'}</small></p><p class="tile__sub">${withEntry.length} результатів</p></div>
          <div class="tile"><p class="eyebrow">Вихідний, сер.</p><p class="tile__v">${f0(avgOut)}<small>${avgOut == null ? '' : '%'}</small></p><p class="tile__sub">${withExit.length} результатів</p></div>
          <div class="tile"><p class="eyebrow">Приріст, сер.</p><p class="tile__v ${avgGain > 0 ? 'is-up' : avgGain < 0 ? 'is-down' : ''}">${avgGain == null ? '—' : (avgGain > 0 ? '+' : '') + Math.round(avgGain)}<small>${avgGain == null ? '' : 'п.п.'}</small></p><p class="tile__sub">${both.length} з обома тестами</p></div>
          <div class="tile"><p class="eyebrow">Зараховано</p><p class="tile__v">${passed}<small>/${withExit.length}</small></p><p class="tile__sub">поріг ${CFG.PASS_PERCENT}%</p></div>
        </div>`;

      const stepIn = STEPS.map((_, i) => mean(withEntry.map((p) => (p.entry.steps[i] / PER_STEP) * 100)));
      const stepOut = STEPS.map((_, i) => mean(withExit.map((p) => (p.exit.steps[i] / PER_STEP) * 100)));
      const basis = withExit.length ? stepOut : stepIn;
      const valid = basis.filter((v) => v != null);
      const minV = valid.length ? Math.min.apply(null, valid) : null;
      const bars = STEPS.map((s, i) => {
        const vi = stepIn[i];
        const vo = stepOut[i];
        const weak = minV != null && basis[i] === minV && minV < CFG.PASS_PERCENT;
        return `<div class="sbar ${weak ? 'is-weak' : ''}">
          <span class="sbar__name"><span>${pad2(i + 1)}</span>${esc(s.ua)}</span>
          <span class="sbar__tracks" style="--pass:${CFG.PASS_PERCENT}%">
            <span class="sbar__track"><span class="sbar__fill in" style="width:${vi == null ? 0 : vi.toFixed(1)}%"></span></span>
            <span class="sbar__track"><span class="sbar__fill out" style="width:${vo == null ? 0 : vo.toFixed(1)}%"></span></span>
          </span>
          <span class="sbar__v">${vi == null ? '—' : Math.round(vi) + '%'} → <strong>${vo == null ? '—' : Math.round(vo) + '%'}</strong></span>
        </div>`;
      }).join('');

      const trs = people.map((p) => {
        const basisRec = p.exit || p.entry;
        let weakest = '—';
        if (basisRec) {
          let wi = 0;
          basisRec.steps.forEach((v, i) => { if (v < basisRec.steps[wi]) wi = i; });
          weakest = basisRec.steps[wi] < PER_STEP ? `${esc(stepLabel(wi))} · ${basisRec.steps[wi]}/${PER_STEP}` : 'Усі кроки без помилок';
        }
        const d = p.entry && p.exit ? p.exit.pct - p.entry.pct : null;
        const status = p.exit
          ? (p.exit.pct >= CFG.PASS_PERCENT ? '<span class="pill pill--ok">Зараховано</span>' : '<span class="pill pill--bad">Не зараховано</span>')
          : '<span class="pill pill--neutral">Очікує вихідного</span>';
        const heat = (rec) => rec ? `<span class="heat" aria-label="За кроками: ${rec.steps.join(', ')}">${rec.steps.map((v) => `<i data-v="${Math.min(3, Math.round((v / PER_STEP) * 3))}"></i>`).join('')}</span>` : '<span class="muted">—</span>';
        return `<tr>
          <td class="who"><strong>${esc(p.name)}</strong>${p.unit ? `<small>${esc(p.unit)}</small>` : ''}</td>
          <td>${esc(p.group)}</td>
          <td class="num">${p.entry ? p.entry.pct + '%' : '<span class="muted">—</span>'}</td>
          <td class="num">${p.exit ? p.exit.pct + '%' : '<span class="muted">—</span>'}</td>
          <td class="num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null ? '<span class="muted">—</span>' : (d > 0 ? '+' : '') + d}</td>
          <td>${heat(p.exit || p.entry)}</td>
          <td>${weakest}</td>
          <td>${status}</td>
        </tr>`;
      }).join('');

      return `
        <div class="j-filters">
          <label class="field"><span>Група</span>
            <select class="input" id="j-group">
              <option value="all">Усі групи</option>
              ${groups.map((g) => `<option value="${esc(g)}" ${g === this.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Пошук</span>
            <input class="input" id="j-q" type="search" value="${esc(this.query)}" placeholder="Прізвище або підрозділ" autocomplete="off">
          </label>
        </div>
        ${tiles}
        <div class="j-grid">
          <section class="j-card" aria-labelledby="j-steps-t">
            <div class="j-card__head">
              <h3 class="h3" id="j-steps-t">Засвоєння за кроками</h3>
              <span class="legend"><span><i class="l-in"></i>Вхідний</span><span><i class="l-out"></i>Вихідний</span><span>Риска — поріг ${CFG.PASS_PERCENT}%</span></span>
            </div>
            <div class="sbars">${bars}</div>
          </section>
          <section class="j-card" aria-labelledby="j-people-t">
            <div class="j-card__head">
              <h3 class="h3" id="j-people-t">Слухачі</h3>
              <span class="eyebrow">${people.length} осіб</span>
            </div>
            ${people.length ? `<div class="table-wrap"><table class="tbl">
              <thead><tr>
                <th>Слухач</th><th>Група</th><th class="num">Вхідний</th><th class="num">Вихідний</th><th class="num">Приріст, п.п.</th><th>Кроки</th><th>Найслабший крок</th><th>Статус</th>
              </tr></thead>
              <tbody>${trs}</tbody>
            </table></div>` : '<p class="lede">Нікого не знайдено за цим фільтром.</p>'}
            <div class="j-tools">
              <button type="button" class="btn btn--ghost btn--sm" data-act="csv"><span>Копіювати CSV</span></button>
              ${this.source === 'device' && CFG.SCRIPT_URL && Sender.queue().length ? `<button type="button" class="btn btn--ghost btn--sm" data-act="flush"><span>Надіслати в таблицю</span></button>` : ''}
              ${this.source === 'device' ? `<button type="button" class="btn btn--text" data-act="clear">${this.clearArmed ? 'Натисніть ще раз, щоб видалити всі записи пристрою' : 'Очистити записи пристрою'}</button>` : ''}
            </div>
            <div id="csv-out"></div>
          </section>
        </div>`;
    },

    bind() {
      const root = this.root();
      $$('[data-src]', root).forEach((b) => b.addEventListener('click', () => this.setSource(b.dataset.src)));
      $$('[data-act="reload"]', root).forEach((b) => b.addEventListener('click', () => this.load()));
      const kf = $('#key-form', root);
      if (kf) {
        kf.addEventListener('submit', (e) => {
          e.preventDefault();
          const v = $('#j-key', kf).value.trim();
          if (!v) { $('.form-err', kf).textContent = 'Введіть код доступу.'; return; }
          store.set('sessionStorage', KEYS.key, v);
          this.load();
        });
        const inp = $('#j-key', kf);
        if (inp) inp.focus({ preventScroll: true });
      }
      const g = $('#j-group', root);
      if (g) g.addEventListener('change', () => { this.group = g.value; this.render(); });
      const qi = $('#j-q', root);
      if (qi) {
        qi.addEventListener('input', () => {
          this.query = qi.value;
          clearTimeout(this._qt);
          this._qt = setTimeout(() => {
            const pos = qi.selectionStart;
            this.render();
            const n = $('#j-q', this.root());
            if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(pos, pos); } catch (e) { /* поле пошуку */ } }
          }, 220);
        });
      }
      const csv = $('[data-act="csv"]', root);
      if (csv) csv.addEventListener('click', () => this.copyCsv(csv));
      const fl = $('[data-act="flush"]', root);
      if (fl) fl.addEventListener('click', () => { fl.disabled = true; Sender.flush().then(() => this.render()); });
      const cl = $('[data-act="clear"]', root);
      if (cl) {
        cl.addEventListener('click', () => {
          if (!this.clearArmed) {
            this.clearArmed = true;
            this.render();
            clearTimeout(this._ct);
            this._ct = setTimeout(() => { this.clearArmed = false; if (!$('#view-journal').hidden) this.render(); }, 5000);
            return;
          }
          this.clearArmed = false;
          Records.clear();
          this.render();
        });
      }
    },

    copyCsv(btn) {
      const rows = this.currentRows() || [];
      const people = aggregate(rows.filter((r) => this.group === 'all' || r.group === this.group));
      people.sort((a, b) => a.group.localeCompare(b.group, 'uk') || a.name.localeCompare(b.name, 'uk'));
      const head = ['Слухач', 'Підрозділ', 'Група', 'Вхідний %', 'Вихідний %', 'Приріст п.п.', 'Статус']
        .concat(STEPS.map((_, i) => 'К' + (i + 1) + ' вх'))
        .concat(STEPS.map((_, i) => 'К' + (i + 1) + ' вих'));
      const cell = (v) => {
        const s = String(v == null ? '' : v);
        return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [head.join(';')].concat(people.map((p) => [
        p.name, p.unit, p.group,
        p.entry ? p.entry.pct : '', p.exit ? p.exit.pct : '',
        p.entry && p.exit ? p.exit.pct - p.entry.pct : '',
        p.exit ? (p.exit.pct >= CFG.PASS_PERCENT ? 'Зараховано' : 'Не зараховано') : 'Очікує вихідного',
      ].concat(STEPS.map((_, i) => (p.entry ? p.entry.steps[i] : '')))
        .concat(STEPS.map((_, i) => (p.exit ? p.exit.steps[i] : '')))
        .map(cell).join(';')));
      const text = lines.join('\n');
      const label = $('span', btn);
      const done = (msg) => { if (label) { label.textContent = msg; setTimeout(() => { label.textContent = 'Копіювати CSV'; }, 2200); } };
      const fallback = () => {
        const out = $('#csv-out', this.root());
        out.innerHTML = '<textarea class="copy-fallback" readonly aria-label="CSV для копіювання"></textarea>';
        const ta = $('textarea', out);
        ta.value = text;
        ta.focus();
        ta.select();
        done('Виділіть і скопіюйте');
      };
      try {
        navigator.clipboard.writeText(text).then(() => done('Скопійовано'), fallback);
      } catch (e) {
        fallback();
      }
    },
  };

  function normalizeRow(r) {
    if (!r) return null;
    const type = r.type === 'exit' || r.type === 'Вихідний' ? 'exit' : 'entry';
    let steps = Array.isArray(r.steps) ? r.steps : [];
    steps = STEPS.map((_, i) => Math.max(0, Math.min(PER_STEP, Number(steps[i]) || 0)));
    const pct = Number(r.pct);
    if (!r.name || isNaN(pct)) return null;
    return {
      id: String(r.id || ''),
      ts: String(r.ts || ''),
      type,
      name: String(r.name),
      unit: String(r.unit || ''),
      group: String(r.group || ''),
      pct: Math.round(pct),
      steps,
    };
  }

  /* Зводить записи в людей: останній вхідний і останній вихідний для кожного. */
  function aggregate(rows) {
    const map = new Map();
    rows.slice().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)).forEach((r) => {
      const k = personKey(r);
      let p = map.get(k);
      if (!p) { p = { key: k, name: r.name, unit: r.unit, group: r.group, entry: null, exit: null }; map.set(k, p); }
      p[r.type] = r;
      p.name = r.name;
      if (r.unit) p.unit = r.unit;
    });
    return Array.from(map.values());
  }

  /* Приклад для журналу: вигадані дані, чітко позначені на сторінці. */
  function demoRows() {
    let s = 20261031;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const base = [0.55, 0.45, 0.6, 0.7, 0.5, 0.65, 0.5, 0.4];
    const out = [];
    const groups = ['Приклад · група 1', 'Приклад · група 2'];
    for (let i = 0; i < 12; i++) {
      const g = groups[i < 7 ? 0 : 1];
      const name = 'Слухач ' + pad2(i + 1);
      const skill = 0.75 + rnd() * 0.5;
      const mk = (type, lift) => {
        const steps = base.map((b) => Math.max(0, Math.min(PER_STEP, Math.round((b * skill + lift + (rnd() - 0.5) * 0.35) * PER_STEP))));
        const score = steps.reduce((a, b) => a + b, 0);
        return { id: 'demo-' + type + i, ts: new Date(2026, 9, type === 'entry' ? 6 : 24, 9, i).toISOString(), type, name, unit: i % 3 ? '2 мпв' : '1 мпв', group: g, pct: Math.round((score / (PER_STEP * STEPS.length)) * 100), steps };
      };
      out.push(mk('entry', 0));
      if (i !== 4 && i !== 10) out.push(mk('exit', 0.32));
    }
    return out;
  }

  /* ───────── Карти в картках героя ───────── */
  const Maps = {
    drawn: new WeakMap(),

    drawAll(force) {
      if (document.getElementById('view-home').hidden) return;
      $$('.shot__map').forEach((c) => this.draw(c, force));
    },

    draw(canvas, force) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(rect.width * dpr);
      const H = Math.round(rect.height * dpr);
      const key = W + 'x' + H;
      if (!force && this.drawn.get(canvas) === key) return;
      this.drawn.set(canvas, key);
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const rnd = mulberry32(Number(canvas.dataset.seed) || 1);

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#2a2926');
      bg.addColorStop(1, '#171716');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const noise = makeNoise(rnd);
      const feature = 230 * dpr;
      const cell = Math.max(4, Math.round(7 * dpr));
      const cols = Math.ceil(W / cell) + 1;
      const rows = Math.ceil(H / cell) + 1;
      const f = new Float32Array(cols * rows);
      const ox = rnd() * 50;
      const oy = rnd() * 50;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const u = (x * cell) / feature + ox;
          const v = (y * cell) / feature + oy;
          f[y * cols + x] = noise(u, v) * 0.6 + noise(u * 2.1 + 5.2, v * 2.1 + 1.3) * 0.27 + noise(u * 4.3 + 9.1, v * 4.3 + 3.7) * 0.13;
        }
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
      const nLevels = 18;
      for (let li = 1; li < nLevels; li++) {
        const L = lo + ((hi - lo) * li) / nLevels;
        const index = li % 5 === 0;
        ctx.strokeStyle = index ? 'rgba(236,232,226,0.42)' : 'rgba(236,232,226,0.17)';
        ctx.lineWidth = (index ? 1.3 : 0.8) * dpr;
        ctx.beginPath();
        contour(ctx, f, cols, rows, cell, L);
        ctx.stroke();
      }

      // Кілометрова сітка з підписами.
      const gstep = Math.round(Math.max(W, H) / 3.2);
      ctx.strokeStyle = 'rgba(236,232,226,0.08)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (let x = gstep * 0.6; x < W; x += gstep) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); }
      for (let y = gstep * 0.45; y < H; y += gstep) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(236,232,226,0.45)';
      ctx.font = `500 ${Math.round(9 * dpr)}px 'IBM Plex Mono', monospace`;
      let gx = 37 + Math.floor(rnd() * 40);
      for (let x = gstep * 0.6; x < W; x += gstep) ctx.fillText(String(gx++), x + 4 * dpr, H - 6 * dpr);
      let gy = 51 + Math.floor(rnd() * 30);
      for (let y = gstep * 0.45; y < H; y += gstep) ctx.fillText(String(gy++), 5 * dpr, y - 4 * dpr);

      const ov = OVERLAYS[canvas.dataset.overlay];
      if (ov) ov(ctx, W, H, dpr, rnd);

      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    },
  };

  const ORANGE = '#ff5b1f';
  const LIGHT = 'rgba(236,232,226,0.9)';

  function label(ctx, text, x, y, dpr, color) {
    ctx.font = `600 ${Math.round(10 * dpr)}px 'IBM Plex Mono', monospace`;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(20,20,19,0.85)';
    ctx.fillRect(x - 3 * dpr, y - 11 * dpr, w + 6 * dpr, 15 * dpr);
    ctx.fillStyle = color || ORANGE;
    ctx.fillText(text, x, y);
  }

  function unitSymbol(ctx, x, y, dpr) {
    const w = 26 * dpr;
    const h = 17 * dpr;
    ctx.save();
    ctx.strokeStyle = LIGHT;
    ctx.lineWidth = 1.4 * dpr;
    ctx.fillStyle = 'rgba(20,20,19,0.75)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.fillStyle = LIGHT;
    ctx.fillRect(x + w / 2 - 1.5 * dpr, y - 6 * dpr, 3 * dpr, 3 * dpr);
    ctx.restore();
  }

  const OVERLAYS = {
    /* Вісь наступу від рубежу переходу в атаку до об’єкта. */
    axis(ctx, W, H, dpr) {
      ctx.save();
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(W * 0.2, H * 0.08);
      ctx.bezierCurveTo(W * 0.24, H * 0.4, W * 0.16, H * 0.6, W * 0.22, H * 0.98);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, 'LD', W * 0.2 + 6 * dpr, H * 0.24, dpr);

      const p0 = [W * 0.27, H * 0.78];
      const c1 = [W * 0.45, H * 0.82];
      const c2 = [W * 0.55, H * 0.42];
      const p1 = [W * 0.76, H * 0.36];
      const half = 9 * dpr;
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 2 * dpr;
      [-half, half].forEach((o) => {
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1] + o);
        ctx.bezierCurveTo(c1[0], c1[1] + o, c2[0], c2[1] + o, p1[0], p1[1] + o);
        ctx.stroke();
      });
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(p1[0] + 22 * dpr, p1[1] - 4 * dpr);
      ctx.lineTo(p1[0] - 2 * dpr, p1[1] - 19 * dpr);
      ctx.lineTo(p1[0] - 2 * dpr, p1[1] + 13 * dpr);
      ctx.closePath();
      ctx.fill();
      unitSymbol(ctx, W * 0.08, H * 0.66, dpr);
      ctx.restore();
    },

    /* Об’єкт атаки з прицільною міткою. */
    obj(ctx, W, H, dpr, rnd) {
      ctx.save();
      const cx = W * 0.56;
      const cy = H * 0.46;
      const r = Math.min(W, H) * 0.24;
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      const n = 9;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (0.8 + rnd() * 0.35);
        pts.push([cx + Math.cos(a) * rr * 1.25, cy + Math.sin(a) * rr]);
      }
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        const q = pts[(i + 1) % n];
        const mx = (p[0] + q[0]) / 2;
        const my = (p[1] + q[1]) / 2;
        if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p[0], p[1], mx, my);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,91,31,0.08)';
      ctx.fill();
      ctx.lineWidth = 1.2 * dpr;
      const t = 10 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - t * 2, cy); ctx.lineTo(cx - t * 0.6, cy);
      ctx.moveTo(cx + t * 0.6, cy); ctx.lineTo(cx + t * 2, cy);
      ctx.moveTo(cx, cy - t * 2); ctx.lineTo(cx, cy - t * 0.6);
      ctx.moveTo(cx, cy + t * 0.6); ctx.lineTo(cx, cy + t * 2);
      ctx.stroke();
      label(ctx, 'OBJ 1', cx + r * 0.6, cy - r * 0.85, dpr);
      unitSymbol(ctx, W * 0.1, H * 0.76, dpr);
      ctx.restore();
    },

    /* Рубежі регулювання (phase lines) і маршрут. */
    pl(ctx, W, H, dpr, rnd) {
      ctx.save();
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([10 * dpr, 6 * dpr]);
      const ys = [0.24, 0.5, 0.76];
      ys.forEach((fy, i) => {
        const y = H * fy;
        ctx.beginPath();
        ctx.moveTo(0, y);
        const segs = 5;
        for (let s = 1; s <= segs; s++) ctx.lineTo((W * s) / segs, y + (rnd() - 0.5) * 18 * dpr);
        ctx.stroke();
        label(ctx, 'PL ' + ['ALFA', 'BRAVO', 'CHARLIE'][i], W * 0.58, y - 7 * dpr, dpr);
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = LIGHT;
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      let x = W * 0.3;
      ctx.moveTo(x, H * 0.96);
      for (let y = H * 0.9; y > H * 0.08; y -= H * 0.12) { x += (rnd() - 0.45) * W * 0.12; ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.fillStyle = LIGHT;
      for (let i = 1; i <= 3; i++) {
        const yy = H * (1 - i * 0.26) + 4 * dpr;
        ctx.beginPath();
        ctx.arc(W * 0.3 + (i % 2 ? 6 : -4) * dpr, yy, 2.4 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(rnd) {
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const val = new Float32Array(256);
    for (let i = 0; i < 256; i++) val[i] = rnd();
    const h = (i, j) => val[perm[(perm[i & 255] + j) & 255]];
    return (x, y) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      const a = h(xi, yi);
      const b = h(xi + 1, yi);
      const c = h(xi, yi + 1);
      const d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }

  /* Marching squares: додає відрізки ізолінії рівня L до поточного шляху. */
  const SEG = {
    1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 1], [3, 2]], 6: [[0, 2]], 7: [[0, 3]],
    8: [[0, 3]], 9: [[0, 2]], 10: [[0, 3], [2, 1]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
  };
  function contour(ctx, f, cols, rows, cell, L) {
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = f[y * cols + x];
        const b = f[y * cols + x + 1];
        const c = f[(y + 1) * cols + x + 1];
        const d = f[(y + 1) * cols + x];
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        const segs = SEG[idx];
        if (!segs) continue;
        const px = x * cell;
        const py = y * cell;
        const edge = (e) => {
          if (e === 0) return [px + ((L - a) / (b - a)) * cell, py];
          if (e === 1) return [px + cell, py + ((L - b) / (c - b)) * cell];
          if (e === 2) return [px + ((L - d) / (c - d)) * cell, py + cell];
          return [px, py + ((L - a) / (d - a)) * cell];
        };
        for (const [e1, e2] of segs) {
          const p1 = edge(e1);
          const p2 = edge(e2);
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
        }
      }
    }
  }

  /* ───────── Старт ───────── */
  function init() {
    fillHome();
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-preset]');
      if (a) Test.preset = a.dataset.preset;
    });
    document.addEventListener('keydown', (e) => Test.onKey(e));
    window.addEventListener('hashchange', route);
    route();

    let rt;
    const redraw = () => { clearTimeout(rt); rt = setTimeout(() => Maps.drawAll(), 120); };
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(redraw);
      $$('.shot__map').forEach((c) => ro.observe(c));
    } else {
      window.addEventListener('resize', redraw);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Maps.drawAll(true));

    if (CFG.SCRIPT_URL && Sender.queue().length) Sender.flush();
    window.addEventListener('online', () => {
      if (CFG.SCRIPT_URL && Sender.queue().length) {
        Sender.flush().then(() => {
          if (Test.st && Test.st.phase === 'result' && Test.st.send === 'queued' && !Sender.queue().some((x) => x.id === Test.st.record.id)) {
            Test.st.send = 'ok';
            Test.save();
            Test.updateSend();
          }
        });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
