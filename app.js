/* =========================================================
   포트폴리오 복리 계산기
   - 예금 + 주식/ETF 항목별 복리 계산
   - 목표 역산, 시나리오 비교
   - 모든 값은 만원 단위, 브라우저에만 저장
   ========================================================= */
(function () {
  'use strict';

  /* ------------------ 상수 ------------------ */
  var STORAGE_KEY = 'compoundCalc.v1';
  var BASE_YEAR = 2026;
  var TAX_GENERAL = 0.154;
  var MAX_ITEMS = 12;
  var MAX_SCEN = 5;
  var MAX_YEARS = 50;
  var EXT_YEARS = 70;

  var PALETTE = ['#2f6bf6', '#12a875', '#e79a00', '#8b5cf6', '#0891b2',
    '#e0447f', '#65a30d', '#ea6a1f', '#6366f1', '#0d9488', '#a16207', '#be123c'];

  var KIND = { deposit: '예금', stock: '주식', other: '기타' };
  var TAXL = { exempt: '비과세', deferred: '과세이연', general: '일반과세' };
  var COMPL = { monthly: '월복리', annual: '연복리' };

  /* ------------------ 유틸 ------------------ */
  function uid() {
    return 'it' + Math.random().toString(36).slice(2, 9) + (Date.now() % 1000).toString(36);
  }
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function nfmt(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function f(n) { return Math.round(n * 10) / 10; }

  function manStr(v) {
    v = Math.round(num(v));
    var neg = v < 0;
    v = Math.abs(v);
    var eok = Math.floor(v / 10000);
    var man = v % 10000;
    var out = '';
    if (eok > 0) out += nfmt(eok) + '억';
    if (man > 0) out += (out ? ' ' : '') + nfmt(man) + '만';
    if (!out) out = '0';
    return (neg ? '-' : '') + out;
  }
  function wonStr(v) { return manStr(v) + '원'; }

  /* 표·차트용 축약 표기: 12.3억 / 3,456만 */
  function compact(v) {
    v = num(v);
    if (v >= 10000) {
      var e = v / 10000;
      var s = e >= 100 ? String(Math.round(e)) : (Math.round(e * 10) / 10).toFixed(1).replace(/\.0$/, '');
      return s + '억';
    }
    if (v >= 1) return nfmt(v) + '만';
    return '0';
  }

  /* 숫자에 천단위 쉼표 (입력 중 커서 위치 유지) */
  function groupDigits(str) {
    var d = String(str == null ? '' : str).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function ungroup(str) { return num(String(str == null ? '' : str).replace(/,/g, '')); }

  function pct(v) { return (Math.round(num(v) * 10) / 10).toFixed(1) + '%'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  /* ------------------ 상태 ------------------ */
  function defaultItems() {
    return [
      { id: uid(), name: '예금 / 적금', kind: 'deposit', principal: 1000, monthly: 50, rate: 3.2, comp: 'monthly', tax: 'general', on: true },
      { id: uid(), name: '나스닥 100', kind: 'stock', principal: 1000, monthly: 30, rate: 11.0, comp: 'monthly', tax: 'exempt', on: true },
      { id: uid(), name: 'S&P 500', kind: 'stock', principal: 700, monthly: 30, rate: 9.5, comp: 'monthly', tax: 'exempt', on: true },
      { id: uid(), name: '미국 배당 다우존스', kind: 'stock', principal: 300, monthly: 20, rate: 8.0, comp: 'monthly', tax: 'exempt', on: true }
    ];
  }

  function defaults() {
    return {
      items: defaultItems(),
      years: 20,
      inflationOn: true,
      inflation: 2.5,
      chartMode: 'split',
      theme: 'auto',
      goals: [10000, 50000, 100000, 300000, 600000],
      scenarios: [],
      reverse: { target: 100000, years: 20, rate: 9, includeNow: true },
      tableFilter: 'all',
      selectedYear: null
    };
  }

  function normItem(it) {
    if (!it || typeof it !== 'object') return null;
    return {
      id: typeof it.id === 'string' && it.id ? it.id : uid(),
      name: typeof it.name === 'string' ? it.name : '새 항목',
      kind: KIND[it.kind] ? it.kind : 'stock',
      principal: Math.max(0, num(it.principal)),
      monthly: Math.max(0, num(it.monthly)),
      rate: num(it.rate),
      comp: it.comp === 'annual' ? 'annual' : 'monthly',
      tax: TAXL[it.tax] ? it.tax : 'exempt',
      on: it.on !== false
    };
  }

  function loadState() {
    var base = defaults();
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return base;
      if (Array.isArray(s.items)) {
        base.items = s.items.map(normItem).filter(Boolean);
      }
      if (typeof s.years === 'number') base.years = clamp(Math.round(s.years), 1, MAX_YEARS);
      if (typeof s.inflation === 'number') base.inflation = clamp(s.inflation, 0, 20);
      if (typeof s.inflationOn === 'boolean') base.inflationOn = s.inflationOn;
      if (s.chartMode === 'stack' || s.chartMode === 'split') base.chartMode = s.chartMode;
      if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto') base.theme = s.theme;
      if (Array.isArray(s.goals)) {
        base.goals = s.goals.map(num).filter(function (g) { return g > 0; }).slice(0, 8);
      }
      if (Array.isArray(s.scenarios)) {
        base.scenarios = s.scenarios.slice(0, MAX_SCEN).map(function (sc) {
          if (!sc || typeof sc !== 'object') return null;
          return {
            id: typeof sc.id === 'string' ? sc.id : uid(),
            name: typeof sc.name === 'string' && sc.name ? sc.name : '시나리오',
            years: clamp(Math.round(num(sc.years)) || 20, 1, MAX_YEARS),
            inflationOn: sc.inflationOn !== false,
            inflation: num(sc.inflation),
            items: Array.isArray(sc.items) ? sc.items.map(normItem).filter(Boolean) : [],
            savedAt: num(sc.savedAt)
          };
        }).filter(Boolean);
      }
      if (s.reverse && typeof s.reverse === 'object') {
        base.reverse = {
          target: Math.max(0, num(s.reverse.target)) || 100000,
          years: clamp(Math.round(num(s.reverse.years)) || 20, 1, MAX_YEARS),
          rate: clamp(num(s.reverse.rate), 0, 30),
          includeNow: s.reverse.includeNow !== false
        };
      }
      if (typeof s.tableFilter === 'string') base.tableFilter = s.tableFilter;
      if (typeof s.selectedYear === 'number') base.selectedYear = s.selectedYear;
    } catch (e) { /* 저장값이 깨졌으면 기본값 */ }
    return base;
  }

  var state = loadState();
  var expandedId = null;
  var cmpSel = [];
  var toastTimer = null;

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* 저장 불가(사생활 모드 등) */ }
  }

  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* ------------------ 계산 ------------------ */
  function applyTax(item, bal, princ) {
    var gain = bal - princ;
    if (gain <= 0) return bal;
    if (item.tax === 'general') return princ + gain * (1 - TAX_GENERAL);
    return bal; /* 비과세 · 과세이연(인출 시 과세)은 세전 금액 */
  }

  function simulateItem(item, years) {
    var rows = [];
    var bal = num(item.principal);
    var princ = num(item.principal);
    var m = num(item.monthly);
    var r = num(item.rate) / 100;
    rows.push({ year: 0, principal: princ, pre: bal, post: applyTax(item, bal, princ) });
    for (var y = 1; y <= years; y++) {
      if (item.comp === 'annual') {
        bal = bal * (1 + r) + m * 12;
        princ += m * 12;
      } else {
        var rm = r / 12;
        for (var i = 0; i < 12; i++) {
          bal = bal * (1 + rm) + m;
          princ += m;
        }
      }
      rows.push({ year: y, principal: princ, pre: bal, post: applyTax(item, bal, princ) });
    }
    return rows;
  }

  function activeItems(items) {
    return (items || []).filter(function (it) {
      return it && it.on !== false && (num(it.principal) > 0 || num(it.monthly) > 0);
    });
  }

  function build(items, years) {
    var active = activeItems(items);
    var per = active.map(function (it) {
      var rows = simulateItem(it, Math.max(0, Math.round(years)));
      var last = rows[rows.length - 1];
      return {
        item: it,
        rows: rows,
        principal: last.principal,
        pre: last.pre,
        post: last.post,
        gain: last.post - last.principal
      };
    });
    var totals = [];
    for (var y = 0; y <= years; y++) {
      var t = { year: y, principal: 0, pre: 0, post: 0, gain: 0 };
      for (var i = 0; i < per.length; i++) {
        var row = per[i].rows[y];
        t.principal += row.principal;
        t.pre += row.pre;
        t.post += row.post;
      }
      t.gain = t.post - t.principal;
      totals.push(t);
    }
    return { active: active, per: per, totals: totals };
  }

  function compute() {
    var years = clamp(Math.round(state.years), 1, MAX_YEARS);
    var b = build(state.items, years);
    var last = b.totals[years];
    var contrib = b.per.reduce(function (s, p) { return s + p.principal; }, 0);
    var wRate = contrib > 0
      ? b.per.reduce(function (s, p) { return s + num(p.item.rate) * p.principal; }, 0) / contrib
      : 0;
    var multiple = last.principal > 0 ? last.post / last.principal : 0;
    var realV = state.inflationOn
      ? last.post / Math.pow(1 + num(state.inflation) / 100, years)
      : null;
    var ext = build(state.items, EXT_YEARS).totals;
    return {
      years: years, b: b, totals: b.totals, last: last, contrib: contrib,
      wRate: wRate, multiple: multiple, realV: realV, ext: ext
    };
  }

  function colorIndex(item) {
    var i = state.items.indexOf(item);
    return i < 0 ? 0 : i % PALETTE.length;
  }

  /* ------------------ 항목 카드 ------------------ */
  function metaText(it) {
    return '연 ' + pct(it.rate) + ' · 월 ' + manStr(it.monthly) + '원 · 보유 ' + manStr(it.principal) + '원';
  }

  function seg(field, current, opts) {
    var html = '<div class="seg' + (field === 'tax' ? ' tax' : '') + '" data-seg="' + field + '">';
    opts.forEach(function (o) {
      html += '<button type="button" data-seg-val="' + o[0] + '"' +
        (current === o[0] ? ' class="on"' : '') + ' aria-pressed="' + (current === o[0]) + '">' + o[1] + '</button>';
    });
    return html + '</div>';
  }

  function editorHTML(it) {
    return '' +
      '<div class="editor">' +
        '<label class="field"><span>항목 이름</span>' +
          '<input type="text" data-f="name" maxlength="24" value="' + esc(it.name) + '" aria-label="항목 이름" autocomplete="off">' +
        '</label>' +
        '<div class="field"><span>구분</span>' +
          seg('kind', it.kind, [['deposit', '예금'], ['stock', '주식'], ['other', '기타']]) +
        '</div>' +
        '<label class="field"><span>현재 보유금</span>' +
          '<div class="input-unit"><input type="number" data-f="principal" inputmode="numeric" min="0" step="10" value="' + num(it.principal) + '" aria-label="현재 보유금 만원"><em>만원</em></div>' +
        '</label>' +
        '<div class="chips" data-qf="principal" data-step="100">' +
          '<button type="button" data-qadd="100">+100만</button>' +
          '<button type="button" data-qadd="1000">+1,000만</button>' +
          '<button type="button" data-qadd="10000">+1억</button>' +
          '<button type="button" data-qset="0" class="set">지우기</button>' +
        '</div>' +
        '<label class="field"><span>월 적립금</span>' +
          '<div class="input-unit"><input type="number" data-f="monthly" inputmode="numeric" min="0" step="5" value="' + num(it.monthly) + '" aria-label="월 적립금 만원"><em>만원</em></div>' +
        '</label>' +
        '<div class="chips" data-qf="monthly">' +
          '<button type="button" data-qadd="10">+10만</button>' +
          '<button type="button" data-qadd="50">+50만</button>' +
          '<button type="button" data-qadd="100">+100만</button>' +
          '<button type="button" data-qset="0" class="set">지우기</button>' +
        '</div>' +
        '<label class="field"><span>예상 연 수익률</span>' +
          '<div class="input-unit"><input type="number" data-f="rate" inputmode="decimal" min="0" max="30" step="0.1" value="' + num(it.rate) + '" aria-label="예상 연 수익률 퍼센트"><em>%</em></div>' +
        '</label>' +
        '<input type="range" class="range" data-fr="rate" min="0" max="25" step="0.1" value="' + clamp(num(it.rate), 0, 25) + '" aria-label="수익률 슬라이더">' +
        '<div class="field"><span>복리 방식</span>' +
          seg('comp', it.comp, [['monthly', '월복리'], ['annual', '연복리']]) +
        '</div>' +
        '<div class="field"><span>과세 방식</span>' +
          seg('tax', it.tax, [['exempt', '비과세'], ['deferred', '과세이연'], ['general', '일반과세<br><small>15.4%</small>']]) +
        '</div>' +
        '<p class="hint">일반과세는 수익금에 15.4%를 만기 일시로 적용합니다. 과세이연은 인출할 때 과세되는 것으로 보고 세전 금액을 보여줍니다.</p>' +
        '<div class="foot">' +
          '<button type="button" class="btn danger" data-act="del">삭제</button>' +
          '<button type="button" class="btn ghost" data-act="done">완료</button>' +
        '</div>' +
      '</div>';
  }

  function itemHTML(it, idx) {
    var color = PALETTE[idx % PALETTE.length];
    var open = expandedId === it.id;
    var off = it.on === false;
    return '' +
      '<div class="item' + (open ? ' open' : '') + (off ? ' off' : '') + '" data-id="' + it.id + '">' +
        '<div class="item-top" role="button" tabindex="0" aria-expanded="' + open + '">' +
          '<span class="dot" style="background:' + color + '"></span>' +
          '<div class="item-main">' +
            '<div class="item-nm"><span class="txt">' + esc(it.name || '이름 없음') + '</span>' +
              '<span class="badge ' + it.kind + '">' + KIND[it.kind] + '</span></div>' +
            '<div class="item-meta">' + metaText(it) + '</div>' +
          '</div>' +
          '<div class="item-val"><b>—</b><span>최종 예상</span></div>' +
          '<label class="switch"><input type="checkbox" data-act="on"' + (off ? '' : ' checked') +
            ' aria-label="' + esc(it.name || '항목') + ' 계산에 포함"><i></i></label>' +
        '</div>' +
        (open ? editorHTML(it) : '') +
      '</div>';
  }

  function renderPortfolio() {
    var host = $('#itemList');
    if (!host) return;
    host.innerHTML = state.items.length
      ? state.items.map(itemHTML).join('')
      : '<div class="empty">항목이 없습니다.<br>아래 버튼으로 예금이나 종목을 추가해 보세요.</div>';
    updatePortfolioSum();
    var open = $$('.item.open', host).length > 0;
    $('#collapseAllBtn').hidden = !open;
  }

  function updatePortfolioSum() {
    var on = state.items.filter(function (it) { return it.on !== false; });
    var principal = on.reduce(function (s, it) { return s + num(it.principal); }, 0);
    var monthly = on.reduce(function (s, it) { return s + num(it.monthly); }, 0);
    $('#portfolioSum').textContent = state.items.length
      ? on.length + '개 항목 · 보유 ' + manStr(principal) + '원 · 월 ' + manStr(monthly) + '원'
      : '아직 항목이 없습니다';
    $('#appSub').textContent = state.items.length
      ? on.length + '개 항목 · ' + state.years + '년 기준'
      : '예금·주식을 항목별로 나누어 계산';
  }

  function updateRowValues(res) {
    $$('#itemList .item').forEach(function (row) {
      var it = getItem(row.dataset.id);
      if (!it) return;
      var b = row.querySelector('.item-val b');
      if (!b) return;
      if (it.on === false) { b.textContent = '제외'; return; }
      var rows = simulateItem(it, res.years);
      var last = rows[rows.length - 1];
      b.textContent = manStr(last.post);
    });
  }

  function getItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  /* ------------------ 요약 ------------------ */
  function stat(label, value, cls) {
    return '<div class="stat"><span>' + label + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</b></div>';
  }

  function renderSummary(res) {
    if (!res.b.per.length) {
      $('#summaryCard').innerHTML =
        '<div class="hero"><div class="hero-label">최종 예상 자산</div>' +
        '<div class="hero-value">0<span class="unit">원</span></div>' +
        '<div class="hero-note">계산할 항목을 추가하거나 보유금·월 적립금을 입력하세요.</div></div>';
      return;
    }
    var last = res.last;
    var html = '<div class="hero">' +
      '<div class="hero-label">' + res.years + '년 후 최종 예상 자산</div>' +
      '<div class="hero-value">' + manStr(last.post) + '<span class="unit">원</span></div>' +
      '<div class="hero-note">' + (BASE_YEAR + res.years) + '년 · ' +
      (res.realV != null
        ? '물가 반영 실질 <b>' + manStr(res.realV) + '원</b>'
        : '물가 반영 꺼짐') +
      '</div></div>' +
      '<div class="stat-grid">' +
        stat('총 투자 원금', wonStr(last.principal)) +
        stat('순수 복리 수익', '+' + wonStr(last.gain), 'good') +
        stat('원금 대비 배수', res.multiple.toFixed(2) + '배', 'accent') +
        stat('가중평균 연 수익률', pct(res.wRate)) +
      '</div>' +
      '<div class="summary-foot">항목별 결과를 합산했습니다. 일반과세는 수익금의 15.4%를 뺀 금액, 과세이연은 세전 금액이며 가중평균 수익률은 총 납입 원금 비중 기준입니다.</div>';
    $('#summaryCard').innerHTML = html;
  }

  /* ------------------ 비중 ------------------ */
  function renderAlloc(res) {
    var bar = $('#allocBar'), sum = $('#allocSum'), list = $('#allocList');
    if (!res.b.per.length) {
      bar.innerHTML = '';
      sum.innerHTML = '';
      list.innerHTML = '<div class="empty">표시할 항목이 없습니다.</div>';
      $('#allocPill').textContent = '항목 0개';
      return;
    }
    var total = res.last.post;
    var kindSum = { deposit: 0, stock: 0, other: 0 };
    var bars = '', rows = '';
    res.b.per.forEach(function (p) {
      var share = total > 0 ? (p.post / total) * 100 : 0;
      var color = PALETTE[colorIndex(p.item)];
      kindSum[p.item.kind] += p.post;
      bars += '<i style="width:' + share.toFixed(2) + '%;background:' + color + '"></i>';
      rows += '<div class="alloc-row">' +
        '<span class="dot" style="background:' + color + '"></span>' +
        '<div class="nm">' + esc(p.item.name || '이름 없음') +
          '<span class="tiny">' + KIND[p.item.kind] + ' · 연 ' + pct(p.item.rate) + ' · ' + TAXL[p.item.tax] + '</span></div>' +
        '<div class="v"><b>' + manStr(p.post) + '</b>' +
          '<span class="up">+' + manStr(p.gain) + ' · ' + share.toFixed(1) + '%</span></div>' +
        '</div>';
    });
    bar.innerHTML = bars;
    var parts = [];
    ['deposit', 'stock', 'other'].forEach(function (k) {
      if (kindSum[k] > 0 && total > 0) {
        parts.push(KIND[k] + ' <b>' + ((kindSum[k] / total) * 100).toFixed(1) + '%</b>');
      }
    });
    parts.push('최종 <b>' + wonStr(total) + '</b>');
    sum.innerHTML = parts.join('');
    list.innerHTML = rows;
    $('#allocPill').textContent = '항목 ' + res.b.per.length + '개';
  }

  /* ------------------ 차트 ------------------ */
  function renderChart(res) {
    var host = $('#chartHost');
    if (!host) return;
    var years = res.years;
    var totals = res.totals;
    var W = 364, H = 208, padL = 40, padR = 10, padT = 14, padB = 22;
    var pw = W - padL - padR, ph = H - padT - padB;

    var maxV = 0;
    for (var i = 0; i <= years; i++) maxV = Math.max(maxV, totals[i].post);
    if (!(maxV > 0)) maxV = 1;
    var yMax = niceMax(maxV * 1.04);
    function y(v) { return padT + ph - (v / yMax) * ph; }

    var gw = pw / years;
    var bw = Math.max(2.2, Math.min(gw * 0.58, 26));
    var sel = state.selectedYear;
    if (sel != null && (sel < 1 || sel > years)) sel = null;
    var s = [];

    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="연도별 자산 성장 차트">');

    if (sel != null) {
      s.push('<rect class="selbox" x="' + f(padL + (sel - 1) * gw) + '" y="' + padT +
        '" width="' + f(gw) + '" height="' + ph + '" rx="3"/>');
    }

    for (var g = 0; g <= 4; g++) {
      var gv = yMax * g / 4;
      var gy = y(gv);
      s.push('<line class="grid" x1="' + padL + '" y1="' + f(gy) + '" x2="' + (W - padR) + '" y2="' + f(gy) + '"/>');
      s.push('<text class="ax" x="' + (padL - 6) + '" y="' + f(gy + 3) + '" text-anchor="end">' + compact(gv) + '</text>');
    }

    for (var yr = 1; yr <= years; yr++) {
      var cx = padL + (yr - 0.5) * gw;
      var t = totals[yr];
      var top = y(0);
      if (state.chartMode === 'stack') {
        var acc = 0;
        for (var k = 0; k < res.b.per.length; k++) {
          var p = res.b.per[k];
          var v = p.rows[yr].post;
          if (v <= 0) continue;
          var yTop = y(acc + v);
          var hgt = y(acc) - yTop;
          if (hgt > 0.2) {
            s.push('<rect x="' + f(cx - bw / 2) + '" y="' + f(yTop) + '" width="' + f(bw) +
              '" height="' + f(hgt) + '" fill="' + PALETTE[colorIndex(p.item)] + '" opacity="' +
              (sel === yr ? 1 : 0.9) + '" rx="' + (bw > 6 ? 1.4 : 0) + '"/>');
          }
          acc += v;
        }
      } else {
        var pv = Math.min(t.principal, t.post);
        var yp = y(pv);
        s.push('<rect class="bar-principal" x="' + f(cx - bw / 2) + '" y="' + f(yp) +
          '" width="' + f(bw) + '" height="' + f(Math.max(0, top - yp)) + '" rx="' + (bw > 6 ? 1.4 : 0) + '"/>');
        var gain = Math.max(0, t.post - pv);
        if (gain > 0) {
          s.push('<rect class="bar-gain" x="' + f(cx - bw / 2) + '" y="' + f(y(pv + gain)) +
            '" width="' + f(bw) + '" height="' + f(Math.max(0, yp - y(pv + gain))) +
            '" rx="' + (bw > 6 ? 1.4 : 0) + '"/>');
        }
      }
    }

    for (var hy = 1; hy <= years; hy++) {
      s.push('<rect class="hit" data-year="' + hy + '" x="' + f(padL + (hy - 1) * gw) + '" y="' + padT +
        '" width="' + f(gw) + '" height="' + ph + '" aria-label="' + hy + '년차 금액 보기"/>');
    }

    var step = years <= 10 ? 1 : years <= 20 ? 4 : years <= 30 ? 5 : 10;
    var labels = [];
    for (var ly = 0; ly <= years; ly += step) labels.push(ly);
    if (labels[labels.length - 1] !== years) labels.push(years);
    labels.forEach(function (l) {
      var x = l === 0 ? padL + 1 : padL + (l - 0.5) * gw;
      s.push('<text class="yrlbl' + (sel === l ? ' on' : '') + '" x="' + f(x) + '" y="' + (H - 6) +
        '" text-anchor="middle">' + l + '</text>');
    });

    s.push('</svg>');
    host.innerHTML = s.join('');

    var legend = $('#chartLegend');
    if (state.chartMode === 'stack') {
      legend.innerHTML = res.b.per.map(function (p) {
        return '<span><i style="background:' + PALETTE[colorIndex(p.item)] + '"></i>' + esc(p.item.name || '이름 없음') + '</span>';
      }).join('') || '';
    } else {
      legend.innerHTML = '<span><i style="background:var(--muted);opacity:.55"></i>투자 원금</span>' +
        '<span><i style="background:var(--accent)"></i>복리 수익</span>';
    }

    renderChartDetail(res);
  }

  function renderChartDetail(res) {
    var el = $('#chartDetail');
    if (!el) return;
    var years = res.years;
    var yr = state.selectedYear;
    if (yr == null || yr < 1 || yr > years) yr = years;
    var t = res.totals[yr];
    var html = '<div class="hd">' + yr + '년차 · ' + (BASE_YEAR + yr) + '년' + (state.selectedYear == null ? ' <span style="font-weight:500;color:var(--muted)">(최종)</span>' : '') + '</div>' +
      '<div class="ln"><span>총자산</span><b>' + wonStr(t.post) + '</b></div>' +
      '<div class="ln"><span>투자 원금</span><b>' + wonStr(t.principal) + '</b></div>' +
      '<div class="ln"><span>복리 수익</span><b>' + wonStr(t.gain) + '</b></div>';
    if (state.chartMode === 'stack') {
      res.b.per.forEach(function (p) {
        html += '<div class="ln"><span>' + esc(p.item.name || '이름 없음') + '</span><b>' + wonStr(p.rows[yr].post) + '</b></div>';
      });
    }
    el.innerHTML = html;
  }

  /* ------------------ 마일스톤 ------------------ */
  function renderGoals(res) {
    var host = $('#goalList');
    if (!host) return;
    var goals = (state.goals || []).slice().sort(function (a, b) { return a - b; });
    if (!goals.length) {
      host.innerHTML = '<div class="empty">목표 금액을 추가하면<br>몇 년 차에 도달하는지 알려드립니다.</div>';
      return;
    }
    var ext = res.ext;
    var html = '';
    goals.forEach(function (g, idx) {
      var hit = null;
      for (var y = 1; y < ext.length; y++) {
        if (ext[y].post >= g) { hit = y; break; }
      }
      var done = hit != null && hit <= res.years;
      var out = hit != null && hit > res.years;
      html += '<div class="goal' + (done ? ' done' : '') + (out ? ' out' : '') + '">' +
        '<span class="flag">' + (done ? '✓' : (idx + 1)) + '</span>' +
        '<div class="t">' + manStr(g) + '원' +
          '<small>' + (done ? '달성' : out ? '계산 기간 이후' : '70년 내 미달') + '</small></div>' +
        '<div class="when">' + (hit != null
          ? hit + '년차<small>' + (BASE_YEAR + hit) + '년' + (out ? ' · 기간 외' : '') + '</small>'
          : '—<small>수익률·납입액을 조정</small>') +
        '</div>' +
        '<button class="x" type="button" data-goal-del="' + g + '" aria-label="' + manStr(g) + '원 목표 삭제">×</button>' +
        '</div>';
    });
    host.innerHTML = html;
  }

  /* ------------------ 연도별 표 ------------------ */
  function renderTable(res) {
    var sel = $('#tableFilter');
    if (!sel) return;
    var cur = state.tableFilter || 'all';
    var opts = '<option value="all">전체 합산</option>';
    state.items.forEach(function (it) {
      if (it.on === false) return;
      opts += '<option value="' + it.id + '">' + esc(it.name || '이름 없음') + '</option>';
    });
    sel.innerHTML = opts;
    var exists = Array.prototype.some.call(sel.options, function (o) { return o.value === cur; });
    if (!exists) { cur = 'all'; state.tableFilter = 'all'; }
    sel.value = cur;

    var data, label;
    if (cur === 'all') {
      data = res.totals;
      label = '전체 합산';
    } else {
      var p = null;
      res.b.per.forEach(function (x) { if (x.item.id === cur) p = x; });
      if (!p) {
        data = res.totals; label = '전체 합산'; cur = 'all'; state.tableFilter = 'all'; sel.value = 'all';
      } else {
        data = p.rows; label = p.item.name || '이름 없음';
      }
    }
    var rows = '';
    for (var y = 1; y <= res.years; y++) {
      var r = data[y];
      if (!r) continue;
      rows += '<tr><td>' + y + '년</td><td class="yr">' + (BASE_YEAR + y) + '</td>' +
        '<td>' + compact(r.principal) + '</td>' +
        '<td class="pos">' + (r.post - r.principal > 0 ? '+' : '') + compact(r.post - r.principal) + '</td>' +
        '<td>' + compact(r.post) + '</td></tr>';
    }
    $('#tableBody').innerHTML = rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">표시할 데이터가 없습니다</td></tr>';
    $('#tableCount').textContent = res.years + '년 · ' + label + ' · 단위 억/만원';
  }

  /* ------------------ 목표 역산 ------------------ */
  function renderReverse() {
    var rv = state.reverse || (state.reverse = { target: 100000, years: 20, rate: 9, includeNow: true });
    var target = Math.max(0, num(rv.target));
    var years = clamp(Math.round(num(rv.years) || 20), 1, MAX_YEARS);
    var rate = clamp(num(rv.rate), 0, 30);
    var includeNow = rv.includeNow !== false;

    var b = build(state.items, years);
    var startAssets = b.totals[0].principal;
    var start = includeNow ? startAssets : 0;
    var R = rate / 100;
    var months = years * 12;
    var rm = R === 0 ? 0 : Math.pow(1 + R, 1 / 12) - 1;
    var growthStart = start * Math.pow(1 + R, years);
    var need = target - growthStart;
    var pmt = 0;
    if (need > 0) {
      var af = rm === 0 ? months : (Math.pow(1 + rm, months) - 1) / rm;
      pmt = af > 0 ? need / af : 0;
    }
    var totalPaid = pmt * months;
    var profit = target - start - totalPaid;

    var el = $('#rvResult');
    var hint = $('#rvTargetHint');
    if (hint) hint.textContent = '목표 ' + wonStr(target) + (target >= 10000 ? '' : '') + ' · 단위는 만원입니다';
    var html = '<div class="lead">' + manStr(target) + '원까지 ' + years + '년</div>';
    if (need <= 0) {
      html += '<div class="big">이미 달성<span class="unit"> 가능</span></div>' +
        '<div class="muted small" style="margin-top:6px">현재 보유금 ' + wonStr(startAssets) +
        '만으로 연 ' + pct(rate) + ' 성장 시 ' + wonStr(growthStart) + '이 되어 목표를 넘습니다.</div>';
    } else {
      html += '<div class="big">월 ' + manStr(pmt) + '<span class="unit">원</span></div>' +
        '<div class="muted small" style="margin-top:6px">예상 연 ' + pct(rate) + ' 복리 · 매월 말 납입 기준</div>';
    }
    html += '<div class="kv">' +
      '<div class="r"><span>목표 금액</span><b>' + wonStr(target) + '</b></div>' +
      '<div class="r"><span>기간 · 수익률</span><b>' + years + '년 · 연 ' + pct(rate) + '</b></div>' +
      '<div class="r"><span>현재 보유금의 성장분</span><b>' + wonStr(growthStart) + '</b></div>' +
      '<div class="r"><span>총 납입 원금</span><b>' + wonStr(totalPaid) + '</b></div>' +
      '<div class="r"><span>목표 중 투자 수익</span><b style="color:var(--good)">+' + wonStr(Math.max(0, profit)) + '</b></div>' +
      '</div>';
    el.innerHTML = html;

    /* 항목별 배분 */
    var on = state.items.filter(function (it) { return it.on !== false; });
    var host = $('#rvAlloc');
    if (!on.length || pmt <= 0) {
      host.innerHTML = '<div class="empty">' + (!on.length
        ? '계산에 포함된 항목이 없습니다.'
        : '현재 보유금만으로 목표를 달성해 추가 납입이 필요하지 않습니다.') + '</div>';
    } else {
      var base = on.reduce(function (s, it) { return s + num(it.principal); }, 0);
      var rows = '', sumPost = 0;
      on.forEach(function (it) {
        var w = base > 0 ? num(it.principal) / base : 1 / on.length;
        var m = pmt * w;
        var rowsI = simulateItem({ principal: num(it.principal), monthly: m, rate: num(it.rate), comp: it.comp, tax: it.tax }, years);
        var post = rowsI[rowsI.length - 1].post;
        sumPost += post;
        rows += '<tr><td>' + esc(it.name || '이름 없음') + '</td>' +
          '<td>' + (w * 100).toFixed(1) + '%</td>' +
          '<td>' + manStr(m) + '만</td>' +
          '<td>' + manStr(post) + '</td></tr>';
      });
      rows += '<tr><td style="color:var(--text);font-weight:800">합계</td><td>100%</td>' +
        '<td>' + manStr(pmt) + '만</td><td>' + manStr(sumPost) + '</td></tr>';
      host.innerHTML = '<table class="cmp-table"><thead><tr><th>항목</th><th>비중</th><th>월 납입</th><th>예상 최종</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<p class="note">배분은 현재 보유금 비중 기준입니다. 항목별 수익률·과세를 각각 적용했기 때문에 합계가 위 목표와 조금 다를 수 있습니다(현재 ' + manStr(sumPost) + '원).</p>';
    }

    $('#rvNote').innerHTML =
      '월복리·기말 납입, 세전 기준입니다. 역산은 단일 수익률로 계산하고, 배분표는 각 항목의 수익률을 따로 적용합니다.' +
      '물가상승률은 반영하지 않았습니다.' +
      (includeNow ? ' 시작 금액은 현재 보유금 합계 ' + wonStr(startAssets) + '입니다.' : ' 현재 보유금은 제외했습니다.');
  }

  /* ------------------ 시나리오 ------------------ */
  function scenarioResult(sc) {
    var b = build(sc.items, sc.years);
    var last = b.totals[sc.years];
    var contrib = b.per.reduce(function (s, p) { return s + p.principal; }, 0);
    var wRate = contrib > 0
      ? b.per.reduce(function (s, p) { return s + num(p.item.rate) * p.principal; }, 0) / contrib
      : 0;
    var monthly = sc.items.filter(function (it) { return it.on !== false; })
      .reduce(function (s, it) { return s + num(it.monthly); }, 0);
    return {
      b: b, last: last, wRate: wRate, monthly: monthly,
      mult: last.principal > 0 ? last.post / last.principal : 0
    };
  }

  function renderScenarios() {
    var host = $('#scList');
    if (!host) return;
    $('#scCount').textContent = state.scenarios.length + ' / ' + MAX_SCEN;
    var btn = $('#scSave');
    if (btn) btn.disabled = state.scenarios.length >= MAX_SCEN;
    var hint = $('#scHint');
    if (hint) {
      hint.textContent = state.scenarios.length >= MAX_SCEN
        ? '5개를 모두 채웠습니다. 하나를 지우면 더 저장할 수 있습니다.'
        : '현재 항목·기간·물가 설정이 그대로 저장됩니다.';
    }

    if (!state.scenarios.length) {
      host.innerHTML = '<div class="empty">저장한 시나리오가 없습니다.<br>“안정형”, “공격형”처럼 구성을 저장해 비교해 보세요.</div>';
    } else {
      host.innerHTML = state.scenarios.map(function (sc) {
        var r = scenarioResult(sc);
        var sel = cmpSel.indexOf(sc.id) >= 0;
        return '<div class="sc' + (sel ? ' sel' : '') + '" data-id="' + sc.id + '">' +
          '<label class="cb"><input type="checkbox" data-cmp="1"' + (sel ? ' checked' : '') +
            ' aria-label="' + esc(sc.name) + ' 비교에 넣기"></label>' +
          '<div class="body">' +
            '<div class="nm">' + esc(sc.name) + '</div>' +
            '<div class="meta">' + sc.years + '년 · 월 ' + manStr(r.monthly) + '원 · 항목 ' +
              sc.items.filter(function (it) { return it.on !== false; }).length + '개</div>' +
            '<div class="amt">' + wonStr(r.last.post) +
              '<small>원금 ' + manStr(r.last.principal) + ' · ' + r.mult.toFixed(2) + '배</small></div>' +
          '</div>' +
          '<div class="acts">' +
            '<button type="button" data-load="1">불러오기</button>' +
            '<button type="button" class="del" data-del="1">삭제</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    $('#scCmpCount').textContent = '비교 ' + cmpSel.length + ' / 2';
    renderCompare();
  }

  function renderCompare() {
    var card = $('#scCompareCard');
    var host = $('#scCompare');
    if (!card || !host) return;
    var picked = state.scenarios.filter(function (sc) { return cmpSel.indexOf(sc.id) >= 0; });
    if (picked.length < 2) {
      card.hidden = true;
      host.innerHTML = '';
      return;
    }
    card.hidden = false;
    var a = picked[0], b = picked[1];
    var ra = scenarioResult(a), rb = scenarioResult(b);
    var rows = [
      ['기간', a.years + '년', b.years + '년', null],
      ['총 투자 원금', manStr(ra.last.principal), manStr(rb.last.principal), null],
      ['최종 예상 자산', manStr(ra.last.post), manStr(rb.last.post), ra.last.post >= rb.last.post ? 'a' : 'b'],
      ['복리 수익', manStr(ra.last.gain), manStr(rb.last.gain), ra.last.gain >= rb.last.gain ? 'a' : 'b'],
      ['원금 대비 배수', ra.mult.toFixed(2) + '배', rb.mult.toFixed(2) + '배', ra.mult >= rb.mult ? 'a' : 'b'],
      ['가중평균 수익률', pct(ra.wRate), pct(rb.wRate), null]
    ];
    var html = '<table class="cmp-table"><thead><tr><th></th><th>' + esc(a.name) + '</th><th>' + esc(b.name) + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + r[0] + '</td>' +
        '<td class="' + (r[3] === 'a' ? 'win' : '') + '">' + r[1] + '</td>' +
        '<td class="' + (r[3] === 'b' ? 'win' : '') + '">' + r[2] + '</td></tr>';
    });

    /* 항목별 비교 */
    var names = [];
    function pushNames(sc) {
      sc.items.forEach(function (it) {
        if (it.on === false) return;
        var n = it.name || '이름 없음';
        if (names.indexOf(n) < 0) names.push(n);
      });
    }
    pushNames(a); pushNames(b);
    if (names.length) {
      html += '<tr class="sect"><td colspan="3">항목별 최종 금액</td></tr>';
      names.forEach(function (n) {
        var va = 0, vb = 0;
        ra.b.per.forEach(function (p) { if ((p.item.name || '이름 없음') === n) va += p.post; });
        rb.b.per.forEach(function (p) { if ((p.item.name || '이름 없음') === n) vb += p.post; });
        html += '<tr><td>' + esc(n) + '</td><td>' + (va > 0 ? manStr(va) : '—') + '</td>' +
          '<td>' + (vb > 0 ? manStr(vb) : '—') + '</td></tr>';
      });
    }
    html += '</tbody></table>';

    var maxPost = Math.max(ra.last.post, rb.last.post, 1);
    html += '<div class="cmp-bars">' +
      '<div class="cmp-bar"><div class="t"><span>' + esc(a.name) + '</span><b>' + wonStr(ra.last.post) + '</b></div>' +
        '<div class="track"><i style="width:' + Math.max(2, (ra.last.post / maxPost) * 100).toFixed(1) + '%"></i></div></div>' +
      '<div class="cmp-bar"><div class="t"><span>' + esc(b.name) + '</span><b>' + wonStr(rb.last.post) + '</b></div>' +
        '<div class="track"><i style="width:' + Math.max(2, (rb.last.post / maxPost) * 100).toFixed(1) + '%"></i></div></div>' +
      '</div>';
    html += '<p class="hint">차액: ' + (ra.last.post >= rb.last.post
      ? esc(a.name) + '이 ' + wonStr(ra.last.post - rb.last.post)
      : esc(b.name) + '이 ' + wonStr(rb.last.post - ra.last.post)) + ' 더 많습니다.</p>';
    host.innerHTML = html;
    $('#cmpPill').textContent = Math.abs(100 * (ra.last.post - rb.last.post) / Math.max(rb.last.post, 1)).toFixed(0) + '% 차이';
  }

  /* ------------------ 전체 갱신 ------------------ */
  function updateResults() {
    var res = compute();
    renderSummary(res);
    renderAlloc(res);
    renderChart(res);
    renderGoals(res);
    renderTable(res);
    updateRowValues(res);
    updatePortfolioSum();
    renderReverse();
  }

  /* ------------------ 테마 ------------------ */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    var btn = $('#themeBtn'), icon = $('#themeIcon');
    if (!btn || !icon) return;
    var label = state.theme === 'auto' ? '자동' : state.theme === 'light' ? '라이트' : '다크';
    btn.title = '테마: ' + label;
    btn.setAttribute('aria-label', '화면 테마 바꾸기 (현재 ' + label + ')');
    if (state.theme === 'light') {
      icon.innerHTML = '<circle cx="12" cy="12" r="4.2"></circle>' +
        '<path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"></path>';
    } else if (state.theme === 'dark') {
      icon.innerHTML = '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"></path>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 3.5v17"></path>';
    }
  }

  /* ------------------ 이벤트 ------------------ */
  function setYears(v, src) {
    var years = clamp(Math.round(num(v) || 1), 1, MAX_YEARS);
    state.years = years;
    if (src !== 'range') { var r = $('#yearsRange'); if (r) r.value = years; }
    if (src !== 'num') { var n = $('#yearsNum'); if (n && document.activeElement !== n) n.value = years; }
    $('#yearsPill').textContent = years + '년';
    if (state.selectedYear != null && state.selectedYear > years) state.selectedYear = years;
    save();
    updateResults();
  }

  function onFieldInput(inp) {
    var row = inp.closest('.item');
    if (!row) return;
    var it = getItem(row.dataset.id);
    if (!it) return;
    var field = inp.dataset.f;
    if (field === 'name') {
      it.name = inp.value;
      var txt = row.querySelector('.item-nm .txt');
      if (txt) txt.textContent = inp.value || '이름 없음';
    } else if (field === 'principal' || field === 'monthly') {
      it[field] = Math.max(0, num(inp.value));
      row.querySelector('.item-meta').textContent = metaText(it);
    } else if (field === 'rate') {
      it.rate = clamp(num(inp.value), 0, 30);
      var rng = row.querySelector('input[data-fr="rate"]');
      if (rng) rng.value = clamp(it.rate, 0, 25);
      row.querySelector('.item-meta').textContent = metaText(it);
    }
    save();
    updateResults();
  }

  function bind() {
    /* 탭 */
    $$('.tabbar button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.tabbar button').forEach(function (b) {
          b.classList.toggle('on', b === btn);
          if (b === btn) b.setAttribute('aria-current', 'page');
          else b.removeAttribute('aria-current');
        });
        $$('.tabpanel').forEach(function (p) {
          p.classList.toggle('on', p.id === 'panel-' + btn.dataset.tab);
        });
        window.scrollTo({ top: 0, behavior: 'auto' });
      });
    });

    /* 기간 · 물가 */
    $('#yearsRange').addEventListener('input', function () { setYears(this.value, 'range'); });
    $('#yearsNum').addEventListener('input', function () { setYears(this.value, 'num'); });
    $('#yearsNum').addEventListener('blur', function () { this.value = state.years; });
    $('#inflationNum').addEventListener('input', function () {
      state.inflation = clamp(num(this.value), 0, 20);
      save(); updateResults();
    });
    $('#inflationOn').addEventListener('change', function () {
      state.inflationOn = this.checked;
      save(); updateResults();
    });

    /* 항목 목록 */
    var list = $('#itemList');

    list.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.f) { onFieldInput(t); return; }
      if (t.dataset && t.dataset.fr === 'rate') {
        var row = t.closest('.item');
        var it = getItem(row.dataset.id);
        if (!it) return;
        it.rate = clamp(num(t.value), 0, 30);
        var nInp = row.querySelector('input[data-f="rate"]');
        if (nInp) nInp.value = it.rate;
        row.querySelector('.item-meta').textContent = metaText(it);
        save(); updateResults();
      }
    });

    list.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('input[data-act="on"]')) {
        var row = t.closest('.item');
        var it = getItem(row.dataset.id);
        if (!it) return;
        it.on = t.checked;
        row.classList.toggle('off', !it.on);
        save(); updateResults();
      }
    });

    list.addEventListener('click', function (e) {
      var row = e.target.closest('.item');
      if (!row) return;
      var it = getItem(row.dataset.id);
      if (!it) return;

      if (e.target.closest('.switch')) return;

      var segBtn = e.target.closest('[data-seg-val]');
      if (segBtn) {
        var field = segBtn.closest('[data-seg]').dataset.seg;
        it[field] = segBtn.dataset.segVal;
        $$('[data-seg-val]', segBtn.closest('[data-seg]')).forEach(function (b) {
          b.classList.toggle('on', b === segBtn);
          b.setAttribute('aria-pressed', b === segBtn ? 'true' : 'false');
        });
        if (field === 'kind') {
          var badge = row.querySelector('.badge');
          if (badge) { badge.className = 'badge ' + it.kind; badge.textContent = KIND[it.kind]; }
        }
        save(); updateResults();
        return;
      }

      var q = e.target.closest('[data-qadd],[data-qset]');
      if (q) {
        var chips = q.closest('.chips');
        var qf = chips && chips.dataset.qf;
        if (qf) {
          if (q.hasAttribute('data-qadd')) it[qf] = Math.max(0, num(it[qf]) + num(q.dataset.qadd));
          else it[qf] = num(q.dataset.qset);
          var inp = row.querySelector('input[data-f="' + qf + '"]');
          if (inp) inp.value = it[qf];
          row.querySelector('.item-meta').textContent = metaText(it);
          save(); updateResults();
        }
        return;
      }

      if (e.target.closest('[data-act="done"]')) {
        expandedId = null;
        renderPortfolio();
        updateResults();
        return;
      }

      if (e.target.closest('[data-act="del"]')) {
        var nm = it.name || '이 항목';
        if (!window.confirm('“' + nm + '” 항목을 삭제할까요?\n삭제한 항목은 되돌릴 수 없습니다.')) return;
        state.items = state.items.filter(function (x) { return x.id !== it.id; });
        if (expandedId === it.id) expandedId = null;
        save(); renderPortfolio(); updateResults();
        toast('항목을 삭제했습니다');
        return;
      }

      if (e.target.closest('.item-top')) {
        expandedId = expandedId === it.id ? null : it.id;
        renderPortfolio();
        updateResults();
        if (expandedId) {
          var openRow = $('.item[data-id="' + expandedId + '"]');
          if (openRow) {
            setTimeout(function () { openRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
          }
        }
      }
    });

    list.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var top = e.target.closest('.item-top');
      if (!top || e.target !== top) return;
      e.preventDefault();
      var row = top.closest('.item');
      var it = getItem(row.dataset.id);
      if (!it) return;
      expandedId = expandedId === it.id ? null : it.id;
      renderPortfolio();
      updateResults();
    });

    $('#addItemBtn').addEventListener('click', addItem);

    $('#collapseAllBtn').addEventListener('click', function () {
      expandedId = null;
      renderPortfolio();
      updateResults();
    });

    /* 차트 */
    $('#chartHost').addEventListener('click', function (e) {
      var hit = e.target.closest('[data-year]');
      if (!hit) return;
      var y = parseInt(hit.getAttribute('data-year'), 10);
      state.selectedYear = state.selectedYear === y ? null : y;
      save();
      var res = compute();
      renderChart(res);
    });

    $('#modeSplit').addEventListener('click', function () {
      state.chartMode = 'split';
      $('#modeSplit').classList.add('on');
      $('#modeStack').classList.remove('on');
      save();
      renderChart(compute());
    });
    $('#modeStack').addEventListener('click', function () {
      state.chartMode = 'stack';
      $('#modeStack').classList.add('on');
      $('#modeSplit').classList.remove('on');
      save();
      renderChart(compute());
    });

    /* 목표 */
    $('#goalAddBtn').addEventListener('click', function () {
      var form = $('#goalForm');
      form.classList.toggle('show');
      if (form.classList.contains('show')) $('#goalInput').focus();
    });
    $('#goalCancel').addEventListener('click', function () {
      $('#goalForm').classList.remove('show');
      $('#goalInput').value = '';
    });
    $('#goalSave').addEventListener('click', addGoal);
    $('#goalInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addGoal(); }
    });
    $('#goalList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-goal-del]');
      if (!btn) return;
      var g = num(btn.getAttribute('data-goal-del'));
      state.goals = state.goals.filter(function (x) { return x !== g; });
      save();
      renderGoals(compute());
      toast('목표를 삭제했습니다');
    });

    /* 표 필터 */
    $('#tableFilter').addEventListener('change', function () {
      state.tableFilter = this.value;
      save();
      renderTable(compute());
    });

    /* 역산 입력 */
    $('#rvTarget').addEventListener('input', function () {
      var caretDigits = this.value.slice(0, this.selectionStart || 0).replace(/[^\d]/g, '').length;
      var formatted = groupDigits(this.value);
      this.value = formatted;
      var pos = 0, seen = 0;
      while (pos < formatted.length && seen < caretDigits) {
        if (/\d/.test(formatted.charAt(pos))) seen++;
        pos++;
      }
      try { this.setSelectionRange(pos, pos); } catch (err) {}
      state.reverse.target = Math.max(0, ungroup(formatted));
      save();
      renderReverse();
    });
    ['years', 'rate'].forEach(function (k) {
      var id = k === 'years' ? '#rvYears' : '#rvRate';
      $(id).addEventListener('input', function () {
        state.reverse[k] = num(this.value);
        save();
        renderReverse();
      });
    });
    $('#rvInclude').addEventListener('change', function () {
      state.reverse.includeNow = this.checked;
      save();
      renderReverse();
    });
    $('#rvChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rv-set]');
      if (!b) return;
      state.reverse.target = num(b.getAttribute('data-rv-set'));
      $('#rvTarget').value = groupDigits(state.reverse.target);
      save();
      renderReverse();
    });

    /* 시나리오 */
    $('#scSave').addEventListener('click', saveScenario);
    $('#scName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveScenario(); }
    });
    $('#scList').addEventListener('click', function (e) {
      var card = e.target.closest('.sc');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var sc = null;
      state.scenarios.forEach(function (s) { if (s.id === id) sc = s; });
      if (!sc) return;

      if (e.target.closest('[data-load]')) {
        state.items = JSON.parse(JSON.stringify(sc.items));
        state.years = sc.years;
        state.inflationOn = sc.inflationOn;
        state.inflation = sc.inflation;
        expandedId = null;
        save();
        syncInputs();
        renderPortfolio();
        updateResults();
        toast('“' + sc.name + '” 구성을 불러왔습니다');
        switchTab('calc');
        return;
      }
      if (e.target.closest('[data-del]')) {
        if (!window.confirm('“' + sc.name + '” 시나리오를 삭제할까요?')) return;
        state.scenarios = state.scenarios.filter(function (s) { return s.id !== id; });
        cmpSel = cmpSel.filter(function (x) { return x !== id; });
        save();
        renderScenarios();
        toast('시나리오를 삭제했습니다');
      }
    });
    $('#scList').addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-cmp]');
      if (!cb) return;
      var id = cb.closest('.sc').getAttribute('data-id');
      if (cb.checked) {
        if (cmpSel.indexOf(id) < 0) cmpSel.push(id);
        if (cmpSel.length > 2) cmpSel.shift();
      } else {
        cmpSel = cmpSel.filter(function (x) { return x !== id; });
      }
      renderScenarios();
    });

    /* 초기화 · 테마 */
    $('#resetBtn').addEventListener('click', function () {
      if (!window.confirm('모든 항목·시나리오·설정을 처음 상태로 되돌릴까요?')) return;
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) {}
      state = defaults();
      expandedId = null;
      cmpSel = [];
      syncInputs();
      renderPortfolio();
      renderScenarios();
      applyTheme();
      updateResults();
      toast('처음 상태로 되돌렸습니다');
    });

    $('#themeBtn').addEventListener('click', function () {
      state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
      save();
      applyTheme();
      toast('테마: ' + (state.theme === 'auto' ? '자동' : state.theme === 'light' ? '라이트' : '다크'));
    });
  }

  function switchTab(name) {
    $$('.tabbar button').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $$('.tabpanel').forEach(function (p) {
      p.classList.toggle('on', p.id === 'panel-' + name);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function addItem() {
    if (state.items.length >= MAX_ITEMS) {
      toast('항목은 ' + MAX_ITEMS + '개까지 추가할 수 있습니다');
      return;
    }
    var it = {
      id: uid(), name: '새 항목', kind: 'other',
      principal: 0, monthly: 0, rate: 5, comp: 'monthly', tax: 'exempt', on: true
    };
    state.items.push(it);
    expandedId = it.id;
    save();
    renderPortfolio();
    updateResults();
    var row = $('.item[data-id="' + it.id + '"]');
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var inp = row.querySelector('input[data-f="name"]');
      if (inp) { try { inp.focus(); inp.select(); } catch (err) {} }
    }
    toast('새 항목을 추가했습니다');
  }

  function addGoal() {
    var v = Math.max(0, Math.round(num($('#goalInput').value)));
    if (v <= 0) { toast('목표 금액을 입력하세요'); return; }
    if (state.goals.indexOf(v) >= 0) { toast('이미 있는 목표입니다'); return; }
    if (state.goals.length >= 8) { toast('목표는 8개까지 추가할 수 있습니다'); return; }
    state.goals.push(v);
    state.goals.sort(function (a, b) { return a - b; });
    $('#goalInput').value = '';
    $('#goalForm').classList.remove('show');
    save();
    renderGoals(compute());
    toast(manStr(v) + '원 목표를 추가했습니다');
  }

  function saveScenario() {
    if (state.scenarios.length >= MAX_SCEN) {
      toast('시나리오는 ' + MAX_SCEN + '개까지 저장됩니다');
      return;
    }
    var nameInput = $('#scName');
    var name = (nameInput.value || '').trim();
    if (!name) name = '시나리오 ' + (state.scenarios.length + 1);
    state.scenarios.push({
      id: uid(),
      name: name.slice(0, 20),
      years: state.years,
      inflationOn: state.inflationOn,
      inflation: state.inflation,
      items: JSON.parse(JSON.stringify(state.items)),
      savedAt: Date.now()
    });
    nameInput.value = '';
    save();
    renderScenarios();
    toast('“' + name.slice(0, 20) + '” 저장했습니다');
  }

  function syncInputs() {
    var yrs = clamp(Math.round(state.years), 1, MAX_YEARS);
    $('#yearsRange').value = yrs;
    $('#yearsNum').value = yrs;
    $('#yearsPill').textContent = yrs + '년';
    $('#inflationNum').value = state.inflation;
    $('#inflationOn').checked = state.inflationOn !== false;
    $('#modeSplit').classList.toggle('on', state.chartMode !== 'stack');
    $('#modeStack').classList.toggle('on', state.chartMode === 'stack');

    var rv = state.reverse;
    $('#rvTarget').value = groupDigits(rv.target);
    $('#rvYears').value = rv.years;
    $('#rvRate').value = rv.rate;
    $('#rvInclude').checked = rv.includeNow !== false;
  }

  function registerSW() {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  /* ------------------ 시작 ------------------ */
  function init() {
    state = loadState();
    applyTheme();
    syncInputs();
    bind();
    renderPortfolio();
    renderScenarios();
    updateResults();
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
