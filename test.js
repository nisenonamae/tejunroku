// 手順録のテスト:node test.js
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');
const assert = require('assert');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const DATA = 'roadmap/apps/tejunroku/data.json';
const CORE = fs.readFileSync(path.join(__dirname, 'core.js'));
const Core = require('./core.js');
// 古い core.js(版3まで:時間の幅・区切りの計算が無い)。端末に残っていたときの再現に使う
const OLD_CORE = Buffer.from(CORE.toString().replace(/fmtStep, stepTime, sectionSpan,/, ''));
class Loader extends ResourceLoader {
  constructor(old) { super(); this.old = old; this.asked = []; }
  fetch(url, opts) {
    this.asked.push(url);
    if (!new URL(url).pathname.endsWith('/core.js')) return null;
    // 古いものが残っている場合:ふつうに読むと古いもの、取り直すと新しいもの
    return Promise.resolve(this.old && !url.includes('fresh=') ? OLD_CORE : CORE);
  }
}

/* GitHub のにせもの */
function makeGH() {
  const files = {}; let shaN = 0;
  const gh = { files, puts: 0, gets: 0, onGet: null, alwaysConflict: false };
  gh.set = (p, obj) => { files[p] = { text: JSON.stringify(obj), sha: 'sha' + (++shaN) }; };
  gh.json = p => JSON.parse(files[p].text);
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  gh.fetch = async (url, opts = {}) => {
    const m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/);
    if (!m) return res(400, {});
    if (opts.headers.Authorization !== 'Bearer tok') return res(401, {});
    if (m[1] !== 'me/notion-daily') return res(404, {});
    if (!m[2]) return res(200, {});
    const p = decodeURIComponent(m[2]);
    if (!opts.method || opts.method === 'GET') {
      gh.gets++;
      const f = files[p];
      const inDir = Object.keys(files).filter(k => k.startsWith(p + '/'));
      if (!f && inDir.length) return res(200, inDir.map(k => ({ name: k.slice(p.length + 1), path: k, type: 'file' })));
      const r = f ? res(200, { content: Buffer.from(f.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n'), sha: f.sha }) : res(404, {});
      if (gh.onGet) gh.onGet(gh.gets);
      return r;
    }
    gh.puts++;
    const body = JSON.parse(opts.body);
    const f = files[p];
    if (gh.alwaysConflict) return res(409, {});
    if (f && body.sha !== f.sha) return res(409, {});
    if (!f && body.sha) return res(422, {});
    files[p] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha' + (++shaN) };
    return res(200, { content: { sha: files[p].sha } });
  };
  return gh;
}

async function open(gh, storage, noConn, oldCore) {
  const loader = new Loader(oldCore);
  const dom = new JSDOM(HTML, {
    url: 'https://nisenonamae.github.io/tejunroku/', runScripts: 'dangerously', pretendToBeVisual: true, resources: loader,
    beforeParse(w) {
      w.fetch = gh.fetch; w.confirm = () => true; w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      if (!noConn) w.localStorage.setItem('tejunroku.conn', JSON.stringify({ repo: 'me/notion-daily', token: 'tok' }));
      for (const [k, v] of Object.entries(storage || {})) w.localStorage.setItem(k, v);
    }
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await settle(dom); await wait(dom, 50); await settle(dom);
  dom.loader = loader;
  return dom;
}
const settle = async dom => { for (let i = 0; i < 8; i++) await new Promise(r => dom.window.setTimeout(r, 0)); };
const wait = (dom, ms) => new Promise(r => dom.window.setTimeout(r, ms));
const $ = (dom, s) => dom.window.document.querySelector(s);
const $$ = (dom, s) => [...dom.window.document.querySelectorAll(s)];
const click = (dom, el) => { assert(el, '押すものが見つからない'); el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); };
const type = (dom, el, v) => { assert(el, '入力欄が見つからない'); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const status = dom => $(dom, '#status').textContent;
const lastAdd = (dom, key, t) => $(dom, `[data-act="add"][data-key="${key}"][data-type="${t}"]`);
const optIds = (dom, branchIndex = 0) => $$(dom, '.st.br')[branchIndex].querySelectorAll(':scope > .opt');

// 仕様書の例「長文の日」を画面の操作で作る
async function buildExample(dom) {
  click(dom, $(dom, '[data-act="newitem"]'));
  type(dom, $(dom, '.edhead .name'), '長文の日');
  const ta = () => $$(dom, '#ed textarea[data-f="text"]');
  type(dom, ta()[0], '時間を計って解く');
  type(dom, $$(dom, '#ed input[data-f="min"]')[0], '20');
  click(dom, lastAdd(dom, 'root', 'branch'));
  type(dom, $(dom, '.st.br input[data-f="question"]'), '全問正解だった?');
  const [yes, no] = [...optIds(dom)].map(o => o.dataset.opt);
  click(dom, lastAdd(dom, yes, 'do'));
  type(dom, $(dom, `.opt[data-opt="${yes}"] textarea`), '次の難しさの長文を1題');
  type(dom, $(dom, `.opt[data-opt="${yes}"] input[data-f="min"]`), '15');
  click(dom, lastAdd(dom, no, 'do'));
  click(dom, lastAdd(dom, no, 'do'));
  const noTa = $$(dom, `.opt[data-opt="${no}"] textarea`);
  type(dom, noTa[0], '間違えた設問の理由を書く');
  type(dom, noTa[1], '該当段落を音読3回');
  click(dom, lastAdd(dom, 'root', 'do'));
  const t = ta(); type(dom, t[t.length - 1], '知らなかった単語をAnkiへ({単語帳})');
  await wait(dom, 200);
  return { yes, no };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('版が出て、データが無いときは最初の保存で作ると出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  assert.match($(dom, '#ver').textContent, /今開いている版:6/);
  assert.match(status(dom), /最初に保存したときに作ります/);
  assert.match($(dom, '.empty').textContent, /手順書がまだありません/);
  assert.strictEqual($(dom, '#bar').hidden, true);
});

test('つないでいないと接続の欄が開く', async () => {
  const gh = makeGH();
  const dom = await open(gh, {}, true);
  assert.strictEqual($(dom, '#conn').hidden, false);
  assert.match(status(dom), /まだつないでいません/);
  assert.strictEqual($(dom, '#cRepo').value, 'nisenonamae/notion-daily');
});

test('トークンが違うと分かる言葉で出る', async () => {
  const gh = makeGH();
  const dom = await open(gh, { 'tejunroku.conn': JSON.stringify({ repo: 'me/notion-daily', token: 'bad' }) });
  assert.match(status(dom), /トークンが正しくありません/);
});

test('仕様書の例を作ると番号が 1・2・2-a・2-b・2-c・3 になる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  assert.deepStrictEqual($$(dom, '#ed .st-num').map(e => e.textContent), ['1', '2', '2-a', '2-b', '2-c', '3']);
  assert.strictEqual($(dom, '#bar').hidden, false);
});

test('見本:選ぶ前は先が出ず、選ぶとその道だけが出る。合計時間も出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  const { no } = await buildExample(dom);
  const pvNums = () => $$(dom, '#pv .pv-num').map(e => e.textContent);
  assert.deepStrictEqual(pvNums(), ['1', '2', '3']);
  assert.match($(dom, '#pv').textContent, /選ぶと、その先の手順が出ます/);
  assert.match($(dom, '#pv .pvTotal').textContent, /合計 20〜35分/);
  click(dom, $(dom, `#pv [data-pv="pick"][data-opt="${no}"]`));
  assert.deepStrictEqual(pvNums(), ['1', '2', '2-b', '2-c', '3']);
  assert.match($(dom, '#pv .pvTotal').textContent, /選んだ道では 20分/);
  // もう一度押すと選ぶ前に戻る
  click(dom, $(dom, `#pv [data-pv="pick"][data-opt="${no}"]`));
  assert.deepStrictEqual(pvNums(), ['1', '2', '3']);
});

test('見本:{範囲の名前} は範囲の印になり、文の中の記号はそのまま文字として出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  assert.strictEqual($(dom, '#pv .rng').textContent, '単語帳');
  assert($(dom, '#pv .rng').classList.contains('missing'));
  type(dom, $$(dom, '#ed textarea')[0], '<b>太字</b>にしない');
  await wait(dom, 200);
  assert.strictEqual($$(dom, '#pv .pv-text b').length, 0);
  assert.match($$(dom, '#pv .pv-text')[0].textContent, /<b>太字<\/b>にしない/);
});

test('見本の丸で済みの印が付き、文を押すと編集の手順が光る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  click(dom, $(dom, '#pv .pv-check'));
  assert($(dom, '#pv .pv-step.done'));
  const id = $(dom, '#pv .pv-step.do').dataset.id;
  click(dom, $(dom, '#pv .pv-step.do .pv-body'));
  assert($(dom, '#ed-' + id).classList.contains('flash'));
});

test('上へ・下へ・複製・消す', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  const texts = () => $$(dom, '#ed .ed-list[data-key="root"] > .st').map(e => e.querySelector('textarea, input[data-f="question"]').value);
  // 3 を上へ
  const last = $$(dom, '#ed .ed-list[data-key="root"] > .st')[2];
  click(dom, last.querySelector('[data-act="up"]'));
  assert.deepStrictEqual(texts(), ['時間を計って解く', '知らなかった単語をAnkiへ({単語帳})', '全問正解だった?']);
  // 一番上の「上へ」は押せない
  assert.strictEqual($$(dom, '#ed [data-act="up"]')[0].disabled, true);
  // 分かれ道を複製すると、中身ごと別のidで増える
  const br = $(dom, '#ed .st.br');
  click(dom, br.querySelector(':scope > .st-head [data-act="dup"]'));
  const brs = $$(dom, '#ed .st.br');
  assert.strictEqual(brs.length, 2);
  assert.notStrictEqual(brs[0].dataset.id, brs[1].dataset.id);
  assert.notStrictEqual(brs[0].querySelector('.opt').dataset.opt, brs[1].querySelector('.opt').dataset.opt);
  assert.strictEqual(brs[1].querySelectorAll('.st.do').length, 3);
  // 複製した分かれ道を消す
  click(dom, brs[1].querySelector(':scope > .st-head [data-act="del"]'));
  assert.strictEqual($$(dom, '#ed .st.br').length, 1);
  assert.strictEqual($$(dom, '#ed .st').length, 6);
});

test('分かれ道の中の分かれ道は 2-b-1 のように続き、選択肢は足したり消したりできる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  const { no } = await buildExample(dom);
  click(dom, lastAdd(dom, no, 'branch'));
  const inner = $$(dom, '#ed .st.br')[1];
  const innerYes = inner.querySelector('.opt').dataset.opt;
  click(dom, lastAdd(dom, innerYes, 'do'));
  click(dom, lastAdd(dom, innerYes, 'do'));
  assert.deepStrictEqual($$(dom, '#ed .st-num').map(e => e.textContent), ['1', '2', '2-a', '2-b', '2-c', '2-d', '2-d-1', '2-d-2', '3']);
  // 選択肢を足す・消す
  const outer = $$(dom, '#ed .st.br')[0];
  click(dom, outer.querySelector(':scope > [data-act="addopt"]'));
  assert.strictEqual($$(dom, '#ed .st.br')[0].querySelectorAll(':scope > .opt').length, 3);
  const newOpt = $$(dom, '#ed .st.br')[0].querySelectorAll(':scope > .opt')[2];
  type(dom, newOpt.querySelector('input[data-f="label"]'), 'ほぼ正解');
  click(dom, newOpt.querySelector('[data-act="delopt"]'));
  assert.strictEqual($$(dom, '#ed .st.br')[0].querySelectorAll(':scope > .opt').length, 2);
});

test('保存すると data.json に仕様の形で書かれる(日本語もそのまま)', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  click(dom, $(dom, '#saveBtn'));
  await settle(dom);
  assert.match(status(dom), /保存しました/);
  assert.strictEqual($(dom, '#bar').hidden, true);
  const d = gh.json(DATA);
  for (const k of ['procs', 'ranges', 'parts', 'cycles']) assert(Array.isArray(d[k]), k);
  assert.deepStrictEqual(d.links, {});
  const p = d.procs[0];
  assert.strictEqual(p.name, '長文の日');
  assert.deepStrictEqual(p.steps.map(s => s.type), ['do', 'branch', 'do']);
  assert.strictEqual(p.steps[0].min, 20);
  assert.strictEqual(p.steps[1].question, '全問正解だった?');
  assert.deepStrictEqual(p.steps[1].options.map(o => [o.label, o.steps.length]), [['はい', 1], ['いいえ', 2]]);
  assert.strictEqual(p.steps[2].text, '知らなかった単語をAnkiへ({単語帳})');
  assert.strictEqual(p.steps[2].min, null);
});

test('保存の途中で他の端末が書いても、読み直して両方残る', async () => {
  const gh = makeGH();
  gh.set(DATA, { version: 1, procs: [], ranges: [], parts: [], cycles: [], links: {} });
  const dom = await open(gh);
  await buildExample(dom);
  const getsBefore = gh.gets;
  gh.onGet = n => { if (n === getsBefore + 1) {
    gh.set(DATA, { version: 1, procs: [{ id: 'p_other', name: '他の端末の手順書', steps: [] }], ranges: [], parts: [], cycles: [], links: {} });
  } };
  click(dom, $(dom, '#saveBtn'));
  await settle(dom);
  assert.match(status(dom), /保存しました/);
  const names = gh.json(DATA).procs.map(p => p.name).sort();
  assert.deepStrictEqual(names, ['他の端末の手順書', '長文の日'].sort());
  assert.strictEqual(gh.puts, 2);
  // 一覧にも両方出る
  click(dom, $(dom, '[data-act="back"]'));
  assert.strictEqual($$(dom, '.pcard').length, 2);
});

test('3回続けてぶつかったら止まり、変更は残る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  gh.alwaysConflict = true;
  click(dom, $(dom, '#saveBtn'));
  await settle(dom);
  assert.strictEqual(gh.puts, 3);
  assert.match(status(dom), /3回続けてぶつかりました/);
  assert.strictEqual($(dom, '#bar').hidden, false);
});

test('保存前に閉じても、開き直すと直した中身が残り、GitHubの中身と合わさる', async () => {
  const gh = makeGH();
  gh.set(DATA, { version: 1, procs: [{ id: 'p_a', name: '数学の日', steps: [{ id: 's1', type: 'do', text: '例題', min: 10 }] }], ranges: [], parts: [], cycles: [], links: {} });
  const dom = await open(gh);
  await buildExample(dom);
  await wait(dom, 500); // 下書きが残るのを待つ
  const store = {}; const ls = dom.window.localStorage;
  for (let i = 0; i < ls.length; i++) store[ls.key(i)] = ls.getItem(ls.key(i));
  dom.window.close();
  const dom2 = await open(gh, store);
  assert.strictEqual($(dom2, '#bar').hidden, false);
  const names = $$(dom2, '.pcard b').map(e => e.textContent);
  assert.deepStrictEqual(names, ['数学の日', '長文の日']);
  assert($$(dom2, '.pcard')[1].querySelector('.unsaved'));
});

test('手順書の複製と、消して保存', async () => {
  const gh = makeGH();
  gh.set(DATA, { version: 1, procs: [{ id: 'p_a', name: '数学の日', steps: [{ id: 's1', type: 'do', text: '例題', min: 10 }] }], ranges: [], parts: [], cycles: [], links: { t1: 'p_a' } });
  const dom = await open(gh);
  click(dom, $(dom, '[data-act="open"]'));
  click(dom, $(dom, '[data-act="dupitem"]'));
  assert.strictEqual($(dom, '.edhead .name').value, '数学の日のコピー');
  click(dom, $(dom, '[data-act="back"]'));
  click(dom, $$(dom, '[data-act="open"]')[0]);
  click(dom, $(dom, '[data-act="delitem"]'));
  click(dom, $(dom, '#saveBtn'));
  await settle(dom);
  const d = gh.json(DATA);
  assert.deepStrictEqual(d.procs.map(p => p.name), ['数学の日のコピー']);
  assert.notStrictEqual(d.procs[0].steps[0].id, 's1');
  assert.deepStrictEqual(d.links, {}); // 消した手順書への結びつきは外れる
});

test('計算:合計時間の幅と、壊れたデータの手当て', async () => {
  const gh = makeGH(); const dom = await open(gh);
  const { span, fmtSpan, normalize } = dom.window.TJ.C;
  const steps = [{ type: 'do', min: 30 }, { type: 'branch', options: [{ steps: [{ type: 'do', min: 45 }] }, { steps: [] }] }];
  assert.strictEqual(fmtSpan(span(steps)), '30分〜1時間15分');
  assert.strictEqual(fmtSpan({ lo: 10, hi: 15 }), '10〜15分');
  const d = normalize({ procs: [{ name: 'x', steps: [{ text: 'a', min: '5' }, { type: 'branch', options: [{}] }] }], links: [] });
  assert.strictEqual(d.procs[0].steps[0].type, 'do');
  assert.strictEqual(d.procs[0].steps[0].min, 5);
  assert(d.procs[0].steps[1].options[0].id);
  assert.strictEqual(JSON.stringify(d.links), '{}'); // 画面側の物なので文字で比べる
});

/* ---------- 段階2 ---------- */
const change = (dom, el, v) => { assert(el, '選ぶものが見つからない'); el.value = v; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
const tabTo = (dom, t) => click(dom, $(dom, `[data-tab="${t}"]`));
const empty = () => ({ version: 1, procs: [], ranges: [], parts: [], cycles: [], links: {} });
const TODAY = Core.taskDay();
function withTasks(gh) {
  gh.set('roadmap/tasks/defs.json', { version: 1, tasks: [
    { id: 't1', name: '英語長文', ministries: ['英語'] },
    { id: 't2', name: 'Anki英単語', ministries: ['英語'], cycle: { items: ['過去の語彙', '未来の語彙', '長文'], anchorDate: '2026-09-30', anchorIndex: 1 } }] });
  gh.set('roadmap/tasks/overlay.json', { version: 1, tasks: { t1: { edits: { name: '英語の長文' } } },
    newTasks: [{ id: 't3', name: '数学演習', ministries: ['数学'] }] });
}

test('範囲:作って区切り方を決めると、見本と手順の中に今日の範囲が出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  tabTo(dom, 'ranges');
  click(dom, $(dom, '[data-act="rg-new"]'));
  type(dom, $(dom, '[data-rf="name"]'), '単語帳');
  change(dom, $(dom, '[data-rf="name"]'), '単語帳');
  type(dom, $(dom, '[data-rf="unit"]'), '語');
  type(dom, $(dom, '[data-rf="start"]'), '1');
  type(dom, $(dom, '[data-rf="end"]'), '2000');
  type(dom, $(dom, '[data-rf="step"]'), '100');
  await wait(dom, 200);
  assert.strictEqual($(dom, '#pv .big').textContent, '1〜100語');
  assert.match($(dom, '#pv').textContent, /あと20回/);
  assert.match($(dom, '.box').parentNode.textContent, /長文の日/); // 使っている手順
  // 位置を直す
  $(dom, '#rgPos').value = '401';
  click(dom, $(dom, '[data-act="rg-set"]'));
  assert.strictEqual($(dom, '#pv .big').textContent, '401〜500語');
  // 手順書の見本に出る
  tabTo(dom, 'procs'); // 開いていた手順書のまま戻る
  assert.strictEqual($(dom, '#pv .rng').textContent, '単語帳 401〜500語');
  assert(!$(dom, '#pv .rng').classList.contains('missing'));
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const r = gh.json(DATA).ranges[0];
  assert.strictEqual(r.name, '単語帳'); assert.strictEqual(r.step, 100); assert.strictEqual(r.set.pos, 401);
  assert.strictEqual(r.created, TODAY);
});

test('範囲:行軍表の記録で進めた分が足される(位置を直す前の記録・古い月は数えない)', async () => {
  const gh = makeGH();
  const d = empty();
  d.ranges.push({ id: 'r1', name: '単語帳', unit: '語', start: 1, end: 300, step: 100, atEnd: 'stop', created: '2026-09-01', set: null });
  d.ranges.push({ id: 'r2', name: '過去問', unit: '年', start: 2000, end: 2020, step: 1, atEnd: 'stop', created: '2026-09-01', set: { pos: 2010, at: '2026-10-05T00:00:00.000Z' } });
  gh.set(DATA, d);
  gh.set('roadmap/apps/tejunroku/runs/2026-08.json', { '2026-08-30': { t: { advanced: ['r1'], at: '2026-08-30T10:00:00Z' } } });
  gh.set('roadmap/apps/tejunroku/runs/2026-10.json', {
    '2026-10-01': { t: { advanced: ['r1', 'r2'], at: '2026-10-01T10:00:00Z' } },
    '2026-10-06': { t: { advanced: ['r1', 'r2'], at: '2026-10-06T10:00:00Z' }, u: { advanced: ['r2'], at: '2026-10-06T11:00:00Z' } } });
  const dom = await open(gh);
  tabTo(dom, 'ranges');
  const cards = $$(dom, '.pcard').map(e => e.textContent);
  assert.match(cards[0], /今日:201〜300語/);
  assert.match(cards[1], /今日:2012年/);
  click(dom, $$(dom, '[data-act="rg-open"]')[1]);
  assert.match($(dom, '#pv').textContent, /進めた回数:2回\(位置を直したあと\)/);
});

test('範囲の計算:終わりまで来たら止まる/最初に戻る', async () => {
  const runs = { '2026-10': { '2026-10-01': { a: { advanced: ['r'], at: '2026-10-01T01:00:00Z' } }, '2026-10-02': { a: { advanced: ['r'], at: '2026-10-02T01:00:00Z' } }, '2026-10-03': { a: { advanced: ['r'], at: '2026-10-03T01:00:00Z' } } } };
  const r = { id: 'r', unit: '題', start: 1, end: 25, step: 10, atEnd: 'stop', set: null };
  let st = Core.rangeState(r, runs);
  assert.strictEqual(Core.rangeText(r, st), '最後まで終わりました');
  r.atEnd = 'loop'; st = Core.rangeState(r, runs);
  assert.strictEqual(Core.rangeText(r, st), '6〜15題'); assert.strictEqual(st.laps, 1);
  r.end = 30; r.atEnd = 'stop'; st = Core.rangeState(r, { '2026-10': { '2026-10-01': runs['2026-10']['2026-10-01'], '2026-10-02': runs['2026-10']['2026-10-02'] } });
  assert.strictEqual(Core.rangeText(r, st), '21〜30題'); assert.strictEqual(st.left, 1);
});

test('範囲の名前を変えると、手順の中の {名前} も書き換えられる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  tabTo(dom, 'ranges');
  click(dom, $(dom, '[data-act="rg-new"]'));
  const n = $(dom, '[data-rf="name"]');
  type(dom, n, '単語帳'); change(dom, n, '単語帳');
  const n2 = $(dom, '[data-rf="name"]');
  assert.strictEqual(n2.dataset.old, '単語帳');
  type(dom, n2, '英単語帳'); change(dom, n2, '英単語帳');
  tabTo(dom, 'procs'); // 開いていた手順書のまま戻る
  const t = $$(dom, '#ed textarea[data-f="text"]');
  assert.strictEqual(t[t.length - 1].value, '知らなかった単語をAnkiへ({英単語帳})');
  assert.strictEqual($(dom, '#pv .rng').textContent, '英単語帳 1〜10');
});

test('部品:作って手順書に差し込むと見本で展開され、時間も足される。消すと外れる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  tabTo(dom, 'parts');
  click(dom, $(dom, '[data-act="newitem"]'));
  type(dom, $(dom, '.edhead .name'), 'Ankiに追加');
  type(dom, $(dom, '#ed textarea'), 'カードを作る');
  type(dom, $(dom, '#ed input[data-f="min"]'), '3');
  click(dom, lastAdd(dom, 'root', 'do'));
  type(dom, $$(dom, '#ed textarea')[1], '音声を付ける');
  assert.strictEqual($(dom, '[data-sel="addpart"]'), null); // 部品の中に部品は入れない
  tabTo(dom, 'procs'); // 開いていた手順書のまま戻る
  const partId = $(dom, '[data-sel="addpart"] option:nth-child(2)').value;
  change(dom, $(dom, '[data-sel="addpart"][data-key="root"]'), partId);
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3', '4', '4-a', '4-b']);
  assert.match($(dom, '#pv .pvTotal').textContent, /合計 23〜38分/);
  assert.match($(dom, '#ed .st.pt').textContent, /Ankiに追加/);
  // 部品を直すと手順書にも出る
  click(dom, $(dom, '#ed [data-act="openpart"]'));
  assert.strictEqual($(dom, '.edhead .name').value, 'Ankiに追加');
  assert.match($(dom, '.info').textContent, /長文の日/);
  // 消すと手順書から外れる
  click(dom, $(dom, '[data-act="delitem"]'));
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const d = gh.json(DATA);
  assert.strictEqual(d.parts.length, 0);
  assert.deepStrictEqual(d.procs[0].steps.map(s => s.type), ['do', 'branch', 'do']);
});

test('サイクル:タスクの定義(取り込み・アプリで足したもの・名前の変更)から選んで作る', async () => {
  const gh = makeGH(); withTasks(gh); const dom = await open(gh);
  await buildExample(dom);
  const pid = dom.window.TJ.S.data.procs[0].id;
  tabTo(dom, 'cycles');
  const items = () => $$(dom, '#tpl-cy .tp-item').map(b => b.querySelector('b').textContent + '/' + b.querySelector('span').textContent);
  assert.deepStrictEqual(items(), ['Anki英単語/英語', '英語の長文/英語', '数学演習/数学']);
  click(dom, $(dom, '#tpl-cy [data-tid="t1"]'));
  assert.match($(dom, '.edhead h2').textContent, /英語の長文のサイクル/);
  for (const n of ['過去の語彙', '未来の語彙', '長文']) {
    click(dom, $(dom, '[data-act="cy-add"]'));
    type(dom, $$(dom, '[data-cf="iname"]').pop(), n);
  }
  change(dom, $$(dom, '[data-cf="iproc"]')[2], pid);
  click(dom, $(dom, '[data-act="rule-add"]')); type(dom, $$(dom, '[data-cf="rule"]')[0], '未実行が3日以上続いたとき');
  click(dom, $(dom, '[data-act="rule-add"]')); type(dom, $$(dom, '[data-cf="rule"]')[1], '試験前の週');
  await wait(dom, 200);
  assert.deepStrictEqual($$(dom, '#pv .ring button').map(b => b.textContent), ['過去の語彙', '未来の語彙', '長文']);
  assert.match($(dom, '#pv').textContent, /手順書がありません/);
  click(dom, $$(dom, '#pv .ring button')[2]);
  assert.match($(dom, '#pv .sub-title, #pv .sh-title').textContent, /「長文」の日:長文の日/);
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3']);
  // 始まりは作った日だけ選べる。中身の並べ替えでも始まりの中身はついていく
  change(dom, $(dom, '[data-cf="start"]'), '1');
  click(dom, $$(dom, '[data-act="cy-up"]')[1]); // 未来の語彙 を一番上へ
  assert.strictEqual($(dom, '[data-cf="start"]').selectedOptions[0].textContent, '未来の語彙');
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const c = gh.json(DATA).cycles[0];
  assert.strictEqual(c.taskId, 't1');
  assert.deepStrictEqual(c.items.map(i => [i.name, i.procId]), [['未来の語彙', null], ['過去の語彙', null], ['長文', pid]]);
  assert.deepStrictEqual(c.rules, ['未実行が3日以上続いたとき', '試験前の週']);
  assert.strictEqual(c.anchorDate, TODAY); assert.strictEqual(c.anchorIndex, 0);
  // 作ったタスクは「作る」の選択肢から消える
  click(dom, $(dom, '[data-act="back"]'));
  assert(!$(dom, '#tpl-cy [data-tid="t1"]'));
});

test('サイクル:行軍表で作ったサイクルの中身を写せる(始まりもそのまま)', async () => {
  const gh = makeGH(); withTasks(gh); const dom = await open(gh);
  tabTo(dom, 'cycles');
  click(dom, $(dom, '#tpl-cy [data-tid="t2"]'));
  assert.match($(dom, '#ed').textContent, /行軍表で作ったサイクルがあります\(過去の語彙 → 未来の語彙 → 長文\)/);
  click(dom, $(dom, '[data-act="cy-copyold"]'));
  assert.deepStrictEqual($$(dom, '[data-cf="iname"]').map(i => i.value), ['過去の語彙', '未来の語彙', '長文']);
  assert.strictEqual($(dom, '[data-cf="start"]'), null);
  assert.match($(dom, '#ed').textContent, /9月30日に「未来の語彙」から始まりました/);
});

test('結びつき:タスクに手順書を結びつけ、手順書を消すと結びつきとサイクルの中身からも外れる', async () => {
  const gh = makeGH(); withTasks(gh); const dom = await open(gh);
  await buildExample(dom);
  const pid = dom.window.TJ.S.data.procs[0].id;
  tabTo(dom, 'links');
  assert.match($(dom, '.empty').textContent, /まだ結びつきがありません/);
  click(dom, $(dom, '#tpl-ln [data-tid="t3"]'));
  assert.match($(dom, '#status').textContent, /「数学演習」を足しました/);
  change(dom, $(dom, '[data-sel="link"][data-tid="t3"]'), pid);
  assert.match($(dom, '.lrow').textContent, /数学演習/);
  // サイクルも作って中身に結びつける
  click(dom, $(dom, '.lrow [data-act="cy-new-for"]'));
  click(dom, $(dom, '[data-act="cy-add"]')); type(dom, $(dom, '[data-cf="iname"]'), '例題');
  change(dom, $(dom, '[data-cf="iproc"]'), pid);
  tabTo(dom, 'procs');
  assert.match($(dom, '.info').textContent, /数学演習、数学演習の「例題」/);
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  assert.strictEqual(gh.json(DATA).links.t3, pid);
  // 消す
  click(dom, $(dom, '[data-act="delitem"]'));
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const d = gh.json(DATA);
  assert.deepStrictEqual(d.links, {});
  assert.strictEqual(d.cycles[0].items[0].procId, null);
  tabTo(dom, 'links');
  assert.match($(dom, '.lrow').textContent, /サイクル:例題\(手順書あり 0\/1\)/);
});

test('版1の下書きを読み込める', async () => {
  const gh = makeGH();
  const cache = { data: { procs: [{ id: 'p_x', name: '版1の下書き', steps: [{ id: 's', type: 'do', text: 'a' }] }] }, sha: null, dirty: ['p_x'], removed: [] };
  const dom = await open(gh, { 'tejunroku.cache': JSON.stringify(cache) });
  assert.strictEqual($(dom, '#bar').hidden, false);
  assert.match($(dom, '.pcard').textContent, /版1の下書き/);
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  assert.strictEqual(gh.json(DATA).procs[0].name, '版1の下書き');
});

test('1日の区切りは日本時間の朝5時', async () => {
  assert.strictEqual(Core.taskDay(new Date('2026-10-09T19:59:00Z')), '2026-10-09'); // 10日 4:59
  assert.strictEqual(Core.taskDay(new Date('2026-10-09T20:00:00Z')), '2026-10-10'); // 10日 5:00
});


/* ---------- 版3:絞り込み・例・効果音 ---------- */
test('タスクを選ぶところ:名前(ひらがな・カタカナを区別しない)と省で絞り込める', async () => {
  const gh = makeGH(); withTasks(gh); const dom = await open(gh);
  tabTo(dom, 'cycles');
  const names = () => $$(dom, '#tpl-cy .tp-item b').map(e => e.textContent);
  type(dom, $(dom, '[data-tq="cy"]'), '英');
  assert.deepStrictEqual(names(), ['Anki英単語', '英語の長文']);
  type(dom, $(dom, '[data-tq="cy"]'), '英 長');
  assert.deepStrictEqual(names(), ['英語の長文']);
  type(dom, $(dom, '[data-tq="cy"]'), 'なにもない');
  assert.match($(dom, '#tpl-cy').textContent, /当てはまるタスクがありません/);
  type(dom, $(dom, '[data-tq="cy"]'), '');
  change(dom, $(dom, '[data-tmin="cy"]'), '数学');
  assert.deepStrictEqual(names(), ['数学演習']);
  // 絞り込みは描き直しても残る
  tabTo(dom, 'procs'); tabTo(dom, 'cycles');
  assert.strictEqual($(dom, '[data-tmin="cy"]').value, '数学');
  assert.deepStrictEqual(names(), ['数学演習']);
});

test('カタカナで探してもひらがなの名前に当たる', async () => {
  const gh = makeGH();
  gh.set('roadmap/tasks/defs.json', { version: 1, tasks: [{ id: 'a', name: 'えいたんご', ministries: ['英語'] }, { id: 'b', name: 'スクワット', ministries: ['健康'] }] });
  const dom = await open(gh);
  tabTo(dom, 'links');
  type(dom, $(dom, '[data-tq="ln"]'), 'エイ');
  assert.deepStrictEqual($$(dom, '#tpl-ln .tp-item b').map(e => e.textContent), ['えいたんご']);
  type(dom, $(dom, '[data-tq="ln"]'), 'すく');
  assert.deepStrictEqual($$(dom, '#tpl-ln .tp-item b').map(e => e.textContent), ['スクワット']);
});

test('タスクが多いときは30件までにして、絞り込むよう知らせる', async () => {
  const gh = makeGH();
  gh.set('roadmap/tasks/defs.json', { version: 1, tasks: Array.from({ length: 45 }, (_, i) => ({ id: 'x' + i, name: 'タスク' + String(i).padStart(2, '0'), ministries: ['英語'] })) });
  const dom = await open(gh);
  tabTo(dom, 'cycles');
  assert.strictEqual($$(dom, '#tpl-cy .tp-item').length, 30);
  assert.match($(dom, '#tpl-cy').textContent, /ほかに 15件あります/);
});

test('例:手順書の例を入れると、範囲と部品の例も一緒に入り、見本で動きが分かる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  assert($(dom, '.guide').open, 'はじめは使い方が開いている');
  click(dom, $(dom, '[data-act="example"]'));
  assert.strictEqual($(dom, '.edhead .name').value, '例:長文の日');
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3', '4', '4-a', '4-b']);
  assert.strictEqual($(dom, '#pv .rng').textContent, '例の単語帳 401〜500番');
  assert.deepStrictEqual($$(dom, '#pv .pv-sec-t').map(e => e.textContent), ['長文', '解く', '直す', '単語']);
  assert.deepStrictEqual($$(dom, '#pv .pv-sec-m').map(e => e.textContent), ['35〜45分', '20〜25分', '15〜20分', '15〜20分']);
  assert.match($(dom, '#pv .pvTotal').textContent, /合計 50分〜1時間5分/);
  click(dom, $$(dom, '#pv [data-pv="pick"]')[1]);
  assert.match($(dom, '#pv').textContent, /間違えた設問の理由を書く/);
  // もう一度押しても増えない
  click(dom, $(dom, '[data-act="back"]'));
  assert(!$(dom, '.guide').open, '手順書があれば使い方は閉じている');
  click(dom, $(dom, '[data-act="example"]'));
  assert.match($(dom, '#status').textContent, /例はもう入っています/);
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const d = gh.json(DATA);
  assert.deepStrictEqual([d.procs.length, d.parts.length, d.ranges.length], [1, 1, 1]);
  assert.strictEqual(d.procs[0].steps.find(x => x.type === 'part').partId, d.parts[0].id);
  assert.deepStrictEqual(d.procs[0].steps.filter(x => x.type === 'section').map(x => x.title + x.level), ['長文1', '解く2', '直す2', '単語1']);
});

test('例:範囲・部品のタブだけで入れることもでき、サイクルは空のときだけ例を入れられる', async () => {
  const gh = makeGH(); withTasks(gh); const dom = await open(gh);
  tabTo(dom, 'parts'); click(dom, $(dom, '[data-act="example"]'));
  assert.strictEqual($(dom, '.edhead .name').value, '例:Ankiに追加');
  tabTo(dom, 'ranges'); click(dom, $(dom, '[data-act="example"]'));
  assert.strictEqual($(dom, '#pv .big').textContent, '401〜500番');
  tabTo(dom, 'cycles'); click(dom, $(dom, '#tpl-cy [data-tid="t1"]'));
  click(dom, $(dom, '[data-act="cy-example"]'));
  assert.deepStrictEqual($$(dom, '[data-cf="iname"]').map(i => i.value), ['過去の語彙', '未来の語彙', '長文']);
  assert.deepStrictEqual($$(dom, '[data-cf="rule"]').map(i => i.value), ['未実行が3日以上続いたとき', '試験前の週']);
  assert.strictEqual($(dom, '[data-act="cy-example"]'), null, '中身があれば例のボタンは出ない');
});

test('効果音:行軍表と同じ仕組みで、入/切と音量は接続の欄にある(音が出せない所でも止まらない)', async () => {
  const gh = makeGH(); const dom = await open(gh);
  assert(dom.window.document.getElementById('se-row'), '入/切の欄がある');
  assert(dom.window.document.querySelector('#conn #se-row'));
  const SE = dom.window.eval('SE');
  assert.strictEqual(SE.soundFor($(dom, '[data-act="example"]')), 'levelup');
  assert.strictEqual(SE.soundFor($(dom, '[data-act="newitem"]')), 'open');
  assert.strictEqual(SE.soundFor($(dom, '[data-tab="cycles"]')), 'tab');
  click(dom, $(dom, '[data-act="newitem"]'));
  assert.strictEqual(SE.soundFor($(dom, '[data-act="add"][data-type="do"]')), 'pluck');
  assert.strictEqual(SE.soundFor($(dom, '[data-act="add"][data-type="branch"]')), 'link');
  assert.strictEqual(SE.soundFor($(dom, '[data-act="del"]')), 'remove');
  assert.strictEqual(SE.soundFor($(dom, '#saveBtn')), 'send');
  const ck = $(dom, '#pv [data-pv="check"]');
  assert.strictEqual(SE.soundFor(ck), 'done');
  click(dom, ck);
  assert.strictEqual(SE.soundFor($(dom, '#pv [data-pv="check"]')), 'down');
  // 切にすると覚える(行軍表・省・思案と同じ鍵)
  click(dom, $(dom, '#se-on'));
  assert.strictEqual(dom.window.localStorage.getItem('se-on'), '0');
});


/* ---------- 版4:区切り・時間の幅・見やすさ ---------- */
test('区切り:足して名前を付けると、見本で次の区切りまでがまとまり、その時間も出る。番号は続き番号のまま', async () => {
  const gh = makeGH(); const dom = await open(gh);
  click(dom, $(dom, '[data-act="newitem"]'));
  type(dom, $(dom, '.edhead .name'), '英語の日');
  // 区切り「英解釈」→ やること → やること → 区切り「英文法」→ やること
  click(dom, lastAdd(dom, 'root', 'section'));          // 1つ目のやることの後ろに足される
  click(dom, $$(dom, '#ed .st.sec [data-act="up"]')[0]); // 一番上へ
  type(dom, $(dom, '#ed .st.sec input[data-f="title"]'), '英解釈');
  type(dom, $$(dom, '#ed textarea')[0], '構文を取る');
  type(dom, $$(dom, '#ed input[data-f="min"]')[0], '10');
  type(dom, $$(dom, '#ed input[data-f="max"]')[0], '15');
  click(dom, lastAdd(dom, 'root', 'do'));
  type(dom, $$(dom, '#ed textarea')[1], '訳を書く');
  type(dom, $$(dom, '#ed input[data-f="max"]')[1], '20');      // 長いときだけ
  click(dom, lastAdd(dom, 'root', 'section'));
  type(dom, $$(dom, '#ed .st.sec input[data-f="title"]')[1], '英文法');
  click(dom, lastAdd(dom, 'root', 'do'));
  type(dom, $$(dom, '#ed textarea')[2], '問題集を2ページ');
  type(dom, $$(dom, '#ed input[data-f="min"]')[2], '30');
  await wait(dom, 200);
  assert.deepStrictEqual($$(dom, '#ed .st-num').map(e => e.textContent).filter(Boolean), ['1', '2', '3']);
  assert.deepStrictEqual($$(dom, '#pv .pv-sec-t').map(e => e.textContent), ['英解釈', '英文法']);
  assert.deepStrictEqual($$(dom, '#pv .pv-sec-m').map(e => e.textContent), ['30〜35分', '30分']);
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3']);
  assert.deepStrictEqual($$(dom, '#pv .pv-min').map(e => e.textContent), ['10〜15分', '20分', '30分']);
  assert.match($(dom, '#pv .pvTotal').textContent, /合計 1時間〜1時間5分/);
  // 区切りを押すと、編集のその区切りが光る
  click(dom, $(dom, '#pv .pv-sec'));
  assert($(dom, '#ed .st.sec').classList.contains('flash'));
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  const st = gh.json(DATA).procs[0].steps;
  assert.deepStrictEqual(st.map(x => x.type), ['section', 'do', 'do', 'section', 'do']);
  assert.deepStrictEqual(st.filter(x => x.type === 'section').map(x => x.level), [1, 1]);
  assert.deepStrictEqual([st[0].title, st[1].min, st[1].max, st[2].min, st[2].max], ['英解釈', 10, 15, null, 20]);
});

test('区切りは分かれ道の中や部品の中にも置ける', async () => {
  const gh = makeGH(); const dom = await open(gh);
  const { yes } = await buildExample(dom);
  click(dom, lastAdd(dom, yes, 'section'));
  type(dom, $(dom, `.opt[data-opt="${yes}"] .st.sec input`), '発展');
  click(dom, $(dom, `#pv [data-pv="pick"][data-opt="${yes}"]`));
  await wait(dom, 200);
  assert.strictEqual($(dom, '#pv .pv-list.inner .pv-sec-t').textContent, '発展');
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '2-a', '3']);
  // 部品の中の区切りは、手順書の部品の欄にも見出しで出る
  tabTo(dom, 'parts'); click(dom, $(dom, '[data-act="newitem"]'));
  type(dom, $(dom, '.edhead .name'), '復習');
  click(dom, lastAdd(dom, 'root', 'section')); type(dom, $(dom, '#ed .st.sec input'), '確認');
  const partId = dom.window.TJ.S.open.parts;
  tabTo(dom, 'procs');
  change(dom, $(dom, '[data-sel="addpart"][data-key="root"]'), partId);
  assert.strictEqual($(dom, '#ed .st.pt .pt-sec').textContent, '確認');
});

test('やることの文の改行は、見本でもそのまま出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  click(dom, $(dom, '[data-act="newitem"]'));
  type(dom, $(dom, '#ed textarea'), '1行目\n2行目');
  await wait(dom, 200);
  assert.strictEqual($(dom, '#pv .pv-text').textContent, '1行目\n2行目');
  const ws = dom.window.getComputedStyle($(dom, '#pv .pv-text')).whiteSpace;
  assert.strictEqual(ws, 'pre-wrap');
});

test('計算:時間の幅と区切りの時間', async () => {
  const st = [{ id: 'a', type: 'section', title: 'x' }, { id: 'b', type: 'do', min: 15, max: 10 }, { id: 'c', type: 'do', max: 5 },
              { id: 'd', type: 'section', title: 'y' }, { id: 'e', type: 'do' }];
  assert.deepStrictEqual(Core.stepTime(st[1]), { lo: 10, hi: 15 });     // 逆に書いても直す
  assert.strictEqual(Core.fmtStep(st[2]), '5分');
  assert.strictEqual(Core.fmtStep(st[4]), '');
  assert.strictEqual(Core.fmtSpan(Core.sectionSpan(st, 0)), '15〜20分');
  assert.strictEqual(Core.fmtSpan(Core.sectionSpan(st, 3)), '');
  assert.deepStrictEqual(Core.numbering(st), { b: '1', c: '2', e: '3' });
});


/* ---------- 版5:古い core.js が端末に残っていても見本が出る ---------- */
test('core.js は版を付けて読み込む(古いものを拾わない)', async () => {
  const gh = makeGH(); const dom = await open(gh);
  assert(dom.loader.asked.some(u => /core\.js\?v=\d+$/.test(u)));
  assert(!dom.loader.asked.some(u => u.includes('fresh=')), '新しいものなら取り直さない');
});

test('古い core.js が残っていたら、新しいものを取り直して見本を出す', async () => {
  assert(!OLD_CORE.toString().includes('fmtStep, stepTime'), '古い core の再現ができている');
  const gh = makeGH(); const dom = await open(gh, {}, false, true);
  assert(dom.loader.asked.some(u => u.includes('fresh=')), '取り直した');
  assert.strictEqual(typeof dom.window.TJ.C.fmtStep, 'function');
  await buildExample(dom);
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3']);
  assert.match($(dom, '#pv .pvTotal').textContent, /合計 20〜35分/);
  assert.strictEqual($(dom, '#status').classList.contains('err'), false);
});

test('見本でつまずいても、空にせず知らせる', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  dom.window.TJ.C.fmtStep = () => { throw new Error('こわれた'); };
  type(dom, $$(dom, '#ed textarea')[0], 'もう一度描く');
  await wait(dom, 200);
  assert.match($(dom, '#pv').textContent, /見本を出せませんでした/);
  assert(!$(dom, '#ed').textContent.includes('見本を出せませんでした'), '右の編集はそのまま');
  assert.strictEqual($$(dom, '#ed .st').length, 6);
});


/* ---------- 版6:区切りの中の区切り ---------- */
test('区切りの中に小さい区切り:英解釈(大)の中に例題・類題(中)。大きい区切りの時間は中の分も入る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  click(dom, $(dom, '[data-act="newitem"]'));
  click(dom, $(dom, '#ed .st.do [data-act="del"]'));          // 最初の空のやることは消す
  const addSec = (title, lv) => {
    click(dom, lastAdd(dom, 'root', 'section'));
    const sec = $$(dom, '#ed .st.sec').pop();
    type(dom, sec.querySelector('input[data-f="title"]'), title);
    if (lv > 1) change(dom, sec.querySelector('select[data-f="level"]'), String(lv));
  };
  const addDo = (text, a, b) => {
    click(dom, lastAdd(dom, 'root', 'do'));
    const st = $$(dom, '#ed .st.do').pop();
    type(dom, st.querySelector('textarea'), text);
    if (a != null) type(dom, st.querySelector('input[data-f="min"]'), String(a));
    if (b != null) type(dom, st.querySelector('input[data-f="max"]'), String(b));
  };
  addSec('英解釈', 1);
  addSec('例題', 2); addDo('例題を解く', 10, 15); addDo('解説を読む', 5);
  addSec('類題', 2); addDo('類題を解く', 15, 20);
  addSec('英文法', 1); addDo('問題集を2ページ', 30);
  await wait(dom, 200);
  assert.deepStrictEqual($$(dom, '#pv .pv-sec').map(e => e.className.replace('pv-sec ', '') + ':' + e.textContent),
    ['lv1:英解釈30〜40分', 'lv2:例題15〜20分', 'lv2:類題15〜20分', 'lv1:英文法30分']);
  assert.deepStrictEqual($$(dom, '#pv .pv-num').map(e => e.textContent), ['1', '2', '3', '4']);
  // 編集でも、小さい区切りは一段下げて出る
  assert.deepStrictEqual($$(dom, '#ed .st.sec').map(e => e.className.match(/lv\d/)[0]), ['lv1', 'lv2', 'lv2', 'lv1']);
  assert.strictEqual($$(dom, '#ed .st.sec select')[1].value, '2');
  // 大きさを戻すと、まとまり方も変わる
  change(dom, $$(dom, '#ed .st.sec select')[2], '1');          // 類題を大に
  assert.deepStrictEqual($$(dom, '#pv .pv-sec-m').map(e => e.textContent), ['15〜20分', '15〜20分', '15〜20分', '30分']);
  click(dom, $(dom, '#saveBtn')); await settle(dom);
  assert.deepStrictEqual(gh.json(DATA).procs[0].steps.filter(x => x.type === 'section').map(x => x.title + x.level), ['英解釈1', '例題2', '類題1', '英文法1']);
});

test('計算:区切りの大きさ(前の版の区切りは大として扱う)', async () => {
  const st = Core.normalize({ procs: [{ steps: [
    { type: 'section', title: 'A' }, { type: 'section', title: 'a1', level: 2 }, { type: 'do', min: 1 }, { type: 'section', title: 'x', level: 3 }, { type: 'do', min: 2 },
    { type: 'section', title: 'a2', level: 2 }, { type: 'do', min: 4 }, { type: 'section', title: 'B', level: 9 }, { type: 'do', min: 8 }] }] }).procs[0].steps;
  assert.deepStrictEqual(st.filter(x => x.type === 'section').map(x => x.level), [1, 2, 3, 2, 3]);
  const sp = i => Core.fmtSpan(Core.sectionSpan(st, i));
  assert.deepStrictEqual([sp(0), sp(1), sp(3), sp(5), sp(7)], ['15分', '3分', '2分', '12分', '8分']);
});

(async () => {
  let ok = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; console.log('○ ' + name); }
    catch (e) { console.log('× ' + name + '\n   ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n   ')); }
  }
  console.log(`\n${ok}/${tests.length} 通過`);
  process.exit(ok === tests.length ? 0 : 1);
})();
