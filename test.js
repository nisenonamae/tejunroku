// 手順録のテスト:node test.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const assert = require('assert');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const DATA = 'roadmap/apps/tejunroku/data.json';

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

async function open(gh, storage) {
  const dom = new JSDOM(HTML, {
    url: 'https://nisenonamae.github.io/tejunroku/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = gh.fetch; w.confirm = () => true; w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.localStorage.setItem('tejunroku.conn', JSON.stringify({ repo: 'me/notion-daily', token: 'tok' }));
      for (const [k, v] of Object.entries(storage || {})) w.localStorage.setItem(k, v);
    }
  });
  await settle(dom);
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
  click(dom, $(dom, '[data-act="newproc"]'));
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
  assert.match($(dom, '#ver').textContent, /今開いている版:1/);
  assert.match(status(dom), /最初に保存したときに作ります/);
  assert.match($(dom, '.empty').textContent, /手順書がまだありません/);
  assert.strictEqual($(dom, '#bar').hidden, true);
});

test('つないでいないと接続の欄が開く', async () => {
  const gh = makeGH();
  const dom = new JSDOM(HTML, { url: 'https://nisenonamae.github.io/tejunroku/', runScripts: 'dangerously',
    beforeParse(w) { w.fetch = gh.fetch; w.scrollTo = () => {}; } });
  await settle(dom);
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
  assert.match($(dom, '#pvTotal').textContent, /合計 20分〜35分/);
  click(dom, $(dom, `#pv [data-pv="pick"][data-opt="${no}"]`));
  assert.deepStrictEqual(pvNums(), ['1', '2', '2-b', '2-c', '3']);
  assert.match($(dom, '#pvTotal').textContent, /選んだ道では 20分/);
  // もう一度押すと選ぶ前に戻る
  click(dom, $(dom, `#pv [data-pv="pick"][data-opt="${no}"]`));
  assert.deepStrictEqual(pvNums(), ['1', '2', '3']);
});

test('見本:{範囲の名前} は範囲の印になり、文の中の記号はそのまま文字として出る', async () => {
  const gh = makeGH(); const dom = await open(gh);
  await buildExample(dom);
  assert.strictEqual($(dom, '#pv .rng').textContent, '単語帳');
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
  click(dom, $(dom, '[data-act="dupproc"]'));
  assert.strictEqual($(dom, '.edhead .name').value, '数学の日のコピー');
  click(dom, $(dom, '[data-act="back"]'));
  click(dom, $$(dom, '[data-act="open"]')[0]);
  click(dom, $(dom, '[data-act="delproc"]'));
  click(dom, $(dom, '#saveBtn'));
  await settle(dom);
  const d = gh.json(DATA);
  assert.deepStrictEqual(d.procs.map(p => p.name), ['数学の日のコピー']);
  assert.notStrictEqual(d.procs[0].steps[0].id, 's1');
  assert.deepStrictEqual(d.links, { t1: 'p_a' }); // 他の欄は触らない
});

test('計算:合計時間の幅と、壊れたデータの手当て', async () => {
  const gh = makeGH(); const dom = await open(gh);
  const { span, fmtSpan, normalize } = dom.window.TJ;
  const steps = [{ type: 'do', min: 30 }, { type: 'branch', options: [{ steps: [{ type: 'do', min: 45 }] }, { steps: [] }] }];
  assert.strictEqual(fmtSpan(span(steps)), '30分〜1時間15分');
  const d = normalize({ procs: [{ name: 'x', steps: [{ text: 'a', min: '5' }, { type: 'branch', options: [{}] }] }], links: [] });
  assert.strictEqual(d.procs[0].steps[0].type, 'do');
  assert.strictEqual(d.procs[0].steps[0].min, 5);
  assert(d.procs[0].steps[1].options[0].id);
  assert.strictEqual(JSON.stringify(d.links), '{}'); // 画面側の物なので文字で比べる
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
