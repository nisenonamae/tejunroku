/* 手順録の計算部分。画面を持たない。
 * 手順録の index.html が読み込むほか、行軍表からも
 * https://nisenonamae.github.io/tejunroku/core.js を、手順を開いたときだけ読み込んで使える。
 *
 * 実行の記録 roadmap/apps/tejunroku/runs/YYYY-MM.json の形(行軍表が書く):
 * { "YYYY-MM-DD": { "<タスクのid>": {
 *     "proc": "p_…",                 開いた手順書
 *     "item": "i_…",                 サイクルの中身のid(サイクルのとき)
 *     "checks": ["s_…", "s_部品/s_…"], 済ませた手順
 *     "picks": { "s_分かれ道": "o_選択肢" },
 *     "advanced": ["r_…"],           進めた範囲(1回分ずつ)
 *     "note": "申し送り",
 *     "at": "済ませた時刻(ISO)",
 *     "switch": { "from": "i_…", "to": "i_…", "rule": "選んだ条件", "at": "ISO" }
 * } } }
 */
(function (root) {
  'use strict';
  const uid = p => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const num = (v, d) => (v === '' || v == null || isNaN(+v)) ? d : +v;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  /* ---------- データの形 ---------- */
  function emptyData() { return { version: 1, procs: [], ranges: [], parts: [], cycles: [], links: {} }; }
  function normSteps(steps, allowPart) {
    if (!Array.isArray(steps)) return [];
    return steps.filter(isObj).filter(s => allowPart !== false || s.type !== 'part').map(s => {
      s.id = s.id || uid('s');
      if (s.type === 'branch') {
        s.question = s.question || '';
        s.options = (Array.isArray(s.options) ? s.options : []).map(o => {
          o = isObj(o) ? o : {};
          o.id = o.id || uid('o'); o.label = o.label || ''; o.steps = normSteps(o.steps, allowPart);
          return o;
        });
      } else if (s.type === 'part') {
        s.partId = s.partId || '';
      } else if (s.type === 'section') {
        s.title = s.title || '';                      // 区切り:ここから次の区切りまでをひとまとまりとして見せる
      } else {
        s.type = 'do'; s.text = s.text || ''; s.min = num(s.min, null); s.max = num(s.max, null);   // 時間は 短いとき〜長いとき
      }
      return s;
    });
  }
  function normalize(d) {
    d = isObj(d) ? d : {};
    const e = emptyData();
    for (const k of Object.keys(e)) {
      if (Array.isArray(e[k]) ? !Array.isArray(d[k]) : !isObj(d[k])) d[k] = e[k];
    }
    d.procs = d.procs.filter(isObj).map(p => { p.id = p.id || uid('p'); p.name = p.name || ''; p.steps = normSteps(p.steps); return p; });
    d.parts = d.parts.filter(isObj).map(p => { p.id = p.id || uid('t'); p.name = p.name || ''; p.steps = normSteps(p.steps, false); return p; });
    d.ranges = d.ranges.filter(isObj).map(r => {
      r.id = r.id || uid('r'); r.name = r.name || ''; r.unit = r.unit || '';
      r.start = Math.round(num(r.start, 1)); r.end = Math.round(num(r.end, r.start));
      r.step = Math.max(1, Math.round(num(r.step, 1)));
      r.atEnd = r.atEnd === 'loop' ? 'loop' : 'stop';
      r.created = r.created || '';
      r.set = isObj(r.set) && !isNaN(+r.set.pos) ? { pos: Math.round(+r.set.pos), at: String(r.set.at || '') } : null;
      return r;
    });
    d.cycles = d.cycles.filter(isObj).map(c => {
      c.id = c.id || uid('c'); c.taskId = c.taskId || '';
      c.items = (Array.isArray(c.items) ? c.items : []).map(it => {
        if (typeof it === 'string') it = { name: it };
        it = isObj(it) ? it : {};
        it.id = it.id || uid('i'); it.name = it.name || ''; it.procId = it.procId || null;
        return it;
      });
      c.rules = (Array.isArray(c.rules) ? c.rules : []).map(x => String(x ?? ''));
      c.anchorDate = c.anchorDate || '';
      c.anchorIndex = Math.max(0, Math.round(num(c.anchorIndex, 0)));
      return c;
    });
    for (const k of Object.keys(d.links)) if (typeof d.links[k] !== 'string' || !d.links[k]) delete d.links[k];
    return d;
  }

  /* ---------- 手順の木 ---------- */
  function walk(steps, fn) {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (fn(s, steps, i) === false) return false;
      if (s.type === 'branch') for (const o of s.options) if (walk(o.steps, fn) === false) return false;
    }
  }
  // 部品の手順を、差し込んだ場所のidを頭に付けて展開する(同じ部品を2回使ってもぶつからない)
  function expandPart(step, data) {
    const p = data && (data.parts || []).find(x => x.id === step.partId);
    if (!p) return [];
    const pre = step.id + '/';
    const re = s => {
      const c = Object.assign({}, s, { id: pre + s.id });
      if (s.type === 'branch') c.options = s.options.map(o => Object.assign({}, o, { id: pre + o.id, steps: o.steps.filter(x => x.type !== 'part').map(re) }));
      return c;
    };
    return (p.steps || []).filter(x => x.type !== 'part').map(re);
  }
  function letter(c) { const a = 'abcdefghijklmnopqrstuvwxyz'; return c < 26 ? a[c] : String(c + 1); }
  // 1, 2, 2-a, 2-b(分かれ道・部品の中は続き番号), さらに中は 2-b-1…
  function numbering(steps, data) {
    const map = {};
    const sub = (lists, L, depth) => {
      let c = 0;
      for (const list of lists) for (const s of list) {
        if (s.type === 'section') continue;          // 区切りには番号を付けない
        const L2 = L + '-' + (depth % 2 === 1 ? letter(c) : String(c + 1));
        c++; map[s.id] = L2; kids(s, L2, depth + 1);
      }
    };
    const kids = (s, L, depth) => {
      if (s.type === 'branch') sub(s.options.map(o => o.steps), L, depth);
      else if (s.type === 'part') sub([expandPart(s, data)], L, depth);
    };
    let k = 0;
    steps.forEach(s => { if (s.type === 'section') return; const L = String(++k); map[s.id] = L; kids(s, L, 1); });
    return map;
  }
  // 合計時間の幅(分かれ道は一番短い道〜一番長い道)。pick を渡すと選んだ道で数える
  function span(steps, data, pick) {
    let lo = 0, hi = 0;
    for (const s of steps) {
      if (s.type === 'do') { const t = stepTime(s); lo += t.lo; hi += t.hi; }
      else if (s.type === 'branch') {
        const chosen = pick && s.options.find(o => o.id === pick[s.id]);
        const opts = chosen ? [chosen] : s.options;
        if (opts.length) {
          const rs = opts.map(o => span(o.steps, data, pick));
          lo += Math.min(...rs.map(r => r.lo)); hi += Math.max(...rs.map(r => r.hi));
        }
      } else if (s.type === 'part') {
        const r = span(expandPart(s, data), data, pick); lo += r.lo; hi += r.hi;
      }
    }
    return { lo, hi };
  }
  // やること1つの時間。片方だけ書いてあればその値、両方なら 短いとき〜長いとき
  function stepTime(s) {
    const a = s.min === '' || s.min == null || isNaN(+s.min) ? null : +s.min;
    const b = s.max === '' || s.max == null || isNaN(+s.max) ? null : +s.max;
    if (a == null && b == null) return { lo: 0, hi: 0 };
    const x = a == null ? b : a, y = b == null ? a : b;
    return { lo: Math.max(0, Math.min(x, y)), hi: Math.max(0, x, y) };
  }
  // 区切り(steps[i])から次の区切りまでの時間
  function sectionSpan(steps, i, data, pick) {
    const part = [];
    for (let j = i + 1; j < steps.length && steps[j].type !== 'section'; j++) part.push(steps[j]);
    return span(part, data, pick);
  }
  function allPicked(steps, pick, data) {
    for (const s of steps) {
      if (s.type === 'branch') {
        const o = s.options.find(o => o.id === pick[s.id]);
        if (!o || !allPicked(o.steps, pick, data)) return false;
      } else if (s.type === 'part' && !allPicked(expandPart(s, data), pick, data)) return false;
    }
    return true;
  }
  function hasBranch(steps, data) {
    let f = false;
    walk(steps, s => { if (s.type === 'branch' || (s.type === 'part' && hasBranch(expandPart(s, data), data))) { f = true; return false; } });
    return f;
  }
  function fmtMin(m) {
    m = Math.round(m * 10) / 10;
    if (m >= 60) { const h = Math.floor(m / 60), r = Math.round((m - h * 60) * 10) / 10; return h + '時間' + (r ? r + '分' : ''); }
    return m + '分';
  }
  // 10〜15分、50分〜1時間5分 のように出す
  function fmtSpan(r) {
    if (!r.hi) return '';
    if (r.lo === r.hi) return fmtMin(r.lo);
    if (r.hi < 60) return (Math.round(r.lo * 10) / 10) + '〜' + fmtMin(r.hi);
    return fmtMin(r.lo) + '〜' + fmtMin(r.hi);
  }
  const fmtStep = s => fmtSpan(stepTime(s));

  /* ---------- 日付 ---------- */
  // 1日の区切りは日本時間の朝5時(行軍表の taskDay と同じ)
  function taskDay(d) { const t = new Date((d ? d.getTime() : Date.now()) + 4 * 3600e3); return t.toISOString().slice(0, 10); }

  /* ---------- 範囲 ---------- */
  // runs: { "YYYY-MM": { "YYYY-MM-DD": { taskId: 記録 } } }
  function rangeAdvances(range, runs) {
    const since = range.set ? range.set.at : '';
    let n = 0;
    for (const m of Object.keys(runs || {})) {
      const month = runs[m]; if (!isObj(month)) continue;
      for (const day of Object.keys(month)) {
        const recs = month[day]; if (!isObj(recs)) continue;
        for (const tid of Object.keys(recs)) {
          const r = recs[tid];
          if (!isObj(r) || !Array.isArray(r.advanced)) continue;
          const cnt = r.advanced.filter(x => x === range.id).length;
          if (cnt && (!since || String(r.at || day) > since)) n += cnt;
        }
      }
    }
    return n;
  }
  function rangeState(range, runs) {
    const start = range.start, end = Math.max(range.end, range.start), step = Math.max(1, range.step);
    const total = end - start + 1;
    const n = rangeAdvances(range, runs);
    let off = (range.set ? range.set.pos : start) - start + n * step;
    if (off < 0) off = 0;
    let finished = false, laps = 0;
    if (range.atEnd === 'loop') { laps = Math.floor(off / total); off = off % total; }
    else if (off >= total) finished = true;
    const from = start + Math.min(off, total - 1), to = Math.min(from + step - 1, end);
    return { from, to, n, finished, laps, total, done: finished ? total : off, left: finished ? 0 : Math.ceil((end - from + 1) / step) };
  }
  function rangeText(range, st) {
    if (st.finished) return '最後まで終わりました';
    return (st.from === st.to ? st.from : st.from + '〜' + st.to) + range.unit;
  }
  // 範囲の計算に要る、一番古い月(YYYY-MM)。範囲が無ければ null
  function rangeSinceMonth(ranges) {
    let m = null;
    for (const r of ranges || []) {
      const x = (r.set && r.set.at ? r.set.at : r.created || '').slice(0, 7);
      if (!x) return '';
      if (m === null || x < m) m = x;
    }
    return m;
  }
  const RANGE_RE = /\{([^{}]+)\}/g;
  function rangeNamesIn(text) { const out = []; String(text || '').replace(RANGE_RE, (m, n) => { out.push(n); return m; }); return out; }

  /* ---------- タスク(行軍表・省と同じ定義を読むだけ) ---------- */
  function taskList(defs, overlay) {
    const ov = (overlay && isObj(overlay.tasks)) ? overlay.tasks : {};
    const base = Array.isArray(defs) ? defs : (defs && Array.isArray(defs.tasks) ? defs.tasks : []);
    const out = [], seen = new Set();
    const add = t => {
      if (!isObj(t) || !t.id || seen.has(t.id)) return;
      seen.add(t.id);
      const o = isObj(ov[t.id]) ? ov[t.id] : {}, e = isObj(o.edits) ? o.edits : {};
      const mins = Array.isArray(e.ministries) ? e.ministries : (Array.isArray(t.ministries) ? t.ministries : []);
      const oc = isObj(o.cycle) ? o.cycle : (isObj(t.cycle) ? t.cycle : null);
      out.push({ id: t.id, name: e.name || t.name || t.id, ministry: mins[0] || '', oldCycle: oc && Array.isArray(oc.items) && oc.items.length ? oc : null });
    };
    base.forEach(add);
    ((overlay && overlay.newTasks) || []).forEach(add);
    return out;
  }

  const api = { uid, clone, emptyData, normSteps, normalize, walk, expandPart, numbering, span, allPicked, hasBranch,
    fmtMin, fmtSpan, fmtStep, stepTime, sectionSpan, taskDay, rangeAdvances, rangeState, rangeText, rangeSinceMonth, rangeNamesIn, RANGE_RE, taskList };
  root.TJCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
