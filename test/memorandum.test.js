import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compactItem, MemorandumStore, isValidDateString, parseSelectionToMemo, shiftDateString } from '../core.js';
import { apply as applyPlugin, defaultDataDir, renderToolResult } from '../index.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const TEST_TMP_ROOT = join(ROOT_DIR, '.test-runtime');
const PKG = JSON.parse(await readFile(join(ROOT_DIR, 'package.json'), 'utf8'));

let clock = new Date('2026-11-10T04:00:00.000Z');
const now = () => clock;
let caseNo = 0;

async function freshStore(extra = {}) {
  const dataDir = join(TEST_TMP_ROOT, 'case-' + process.pid + '-' + ++caseNo);
  const store = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now, ...extra });
  await store.init();
  return { store, dataDir };
}

test.after(() => rm(TEST_TMP_ROOT, { recursive: true, force: true }));
test.beforeEach(() => {
  clock = new Date('2026-11-10T04:00:00.000Z');
});

test('日期工具：校验与偏移', () => {
  assert.equal(isValidDateString('2026-11-10'), true);
  assert.equal(isValidDateString('2026-02-29'), false);
  assert.equal(isValidDateString('invalid'), false);
  assert.equal(shiftDateString('2026-11-10', -1), '2026-11-09');
  assert.equal(shiftDateString('2026-12-31', 1), '2027-01-01');
});

test('Store 生命周期：新增、完成、顺延、互转、焦点、持久化', async () => {
  const { store, dataDir } = await freshStore();
  const initial = await store.snapshot();
  assert.equal(initial.today, '2026-11-10');
  assert.equal(initial.stats.totalItems, 0);
  assert.equal(initial.searchResults, null);
  assert.equal(initial.weekStrip.length, 7);
  assert.equal('items' in initial, false, '快照不应再回传全量 items');

  const daily = await store.addItem({ scope: 'daily', title: '  完成重构  ', priority: 'high', category: '研发', pinned: true });
  assert.equal(daily.item.title, '完成重构');
  assert.equal(daily.item.date, '2026-11-10');
  assert.equal(daily.stats.dailyTotal, 1);

  const evergreen = await store.addItem({ scope: 'evergreen', title: '产物落项目目录' });
  assert.equal(evergreen.item.date, '');
  assert.equal(evergreen.stats.evergreenTotal, 1);

  const past = await store.addItem({ scope: 'daily', date: '2026-11-08', title: '往日事项' });
  assert.equal(past.overdueItems.length, 1);
  const carried = await store.carryOverOverdue({ targetDate: '2026-11-10' });
  assert.equal(carried.movedCount, 1);
  const moved = carried.dailyItems.find(item => item.id === past.item.id);
  assert.equal(moved.carriedFrom, '2026-11-08');
  assert.equal(moved.date, '2026-11-10');

  const done = await store.toggleItem(daily.item.id);
  assert.equal(done.item.completed, true);
  assert.ok(done.item.completedAt);
  const undone = await store.toggleItem(daily.item.id, false);
  assert.equal(undone.item.completedAt, null);

  const converted = await store.updateItem(moved.id, { scope: 'evergreen' });
  assert.equal(converted.item.scope, 'evergreen');
  assert.equal(converted.item.date, '');
  const back = await store.updateItem(moved.id, { scope: 'daily', date: '2026-11-12' });
  assert.equal(back.item.date, '2026-11-12');

  await assert.rejects(store.updateItem(moved.id, { title: '   ' }), /标题/);

  const focus = await store.setDailyNote('2026-11-10', '今日聚焦');
  assert.equal(focus.dailyNote, '今日聚焦');

  const reloaded = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now });
  await reloaded.init();
  const snap = await reloaded.snapshot();
  assert.equal(snap.stats.totalItems, 3);
  assert.equal(snap.dailyNote, '今日聚焦');
});

test('排序：未完成优先、置顶、优先级，已完成按完成时间倒序', async () => {
  const { store } = await freshStore();
  const a = await store.addItem({ scope: 'daily', title: 'A 常规' });
  clock = new Date('2026-11-10T04:01:00.000Z');
  const b = await store.addItem({ scope: 'daily', title: 'B 重要', priority: 'high' });
  clock = new Date('2026-11-10T04:02:00.000Z');
  const c = await store.addItem({ scope: 'daily', title: 'C 置顶随手', priority: 'low', pinned: true });
  await store.toggleItem(a.item.id, true);
  clock = new Date('2026-11-10T04:05:00.000Z');
  const last = await store.toggleItem(b.item.id, true);
  assert.deepEqual(last.dailyItems.map(item => item.title), ['C 置顶随手', 'B 重要', 'A 常规']);
  assert.equal(c.item.pinned, true);
});

test('删除可撤销：restore 恢复原条目，ID 冲突时拒绝', async () => {
  const { store } = await freshStore();
  const added = await store.addItem({ scope: 'evergreen', title: '要删的', note: '备注' });
  const deleted = await store.deleteItem(added.item.id);
  assert.equal(deleted.deletedId, added.item.id);
  assert.equal(deleted.stats.totalItems, 0);
  const restored = await store.restoreItem(deleted.deletedItem);
  assert.equal(restored.item.id, added.item.id);
  assert.equal(restored.item.note, '备注');
  assert.equal(restored.stats.totalItems, 1);
  await assert.rejects(store.restoreItem(deleted.deletedItem));
});

test('清理已完成与搜索、历史', async () => {
  const { store } = await freshStore();
  const one = await store.addItem({ scope: 'daily', title: '买咖啡豆', category: '日常' });
  await store.addItem({ scope: 'daily', title: '写周报' });
  await store.addItem({ scope: 'daily', date: '2026-11-03', title: '旧的咖啡记录' });
  await store.setDailyNote('2026-11-05', '只有焦点的一天');
  await store.toggleItem(one.item.id, true);

  const searched = await store.snapshot({ query: '咖啡' });
  assert.equal(searched.searchResults.length, 2);

  const cleared = await store.clearCompleted({ scope: 'daily', date: '2026-11-10' });
  assert.equal(cleared.removedCount, 1);
  assert.equal(cleared.dailyItems.length, 1);

  const { history } = await store.snapshot();
  assert.deepEqual(history.map(day => day.date), ['2026-11-10', '2026-11-05', '2026-11-03']);
  assert.equal(history[1].note, '只有焦点的一天');
});

test('选区解析与入库：短文本作标题，长文本首行作标题、全文入备注，并记录来源', async () => {
  const { store } = await freshStore();
  assert.deepEqual(parseSelectionToMemo('修复左侧栏名称'), { title: '修复左侧栏名称', note: '' });
  const multi = '1. 第一行要点\n2. 第二行\n3. 第三行';
  const parsed = parseSelectionToMemo(multi);
  assert.equal(parsed.title, '第一行要点');
  assert.equal(parsed.note, multi);

  const res = await store.addFromSelection({ text: multi, scope: 'daily', source: { kind: 'conversation', sessionId: 's-1' } });
  assert.equal(res.item.category, '摘录');
  assert.equal(res.item.date, '2026-11-10');
  assert.deepEqual(res.item.source, { kind: 'conversation', sessionId: 's-1' });
  await assert.rejects(store.addFromSelection({ text: '   ' }));
});

test('旧数据迁移与每日备份：复制旧文件、保留原件、写入前备份', async () => {
  const legacyDir = join(TEST_TMP_ROOT, 'legacy-' + process.pid);
  await mkdir(legacyDir, { recursive: true });
  const legacyFile = join(legacyDir, 'memorandum-data.json');
  const legacy = {
    version: 1,
    updatedAt: '2026-11-09T00:00:00.000Z',
    dailyNotes: { '2026-11-09': '旧焦点' },
    items: [{ id: 'memo-old', scope: 'daily', date: '2026-11-09', title: '旧事项', priority: 'weird', completed: false, createdAt: '2026-11-09T00:00:00.000Z' }],
  };
  await writeFile(legacyFile, JSON.stringify(legacy));
  const { store, dataDir } = await freshStore({ legacyFiles: [legacyFile] });
  const snap = await store.snapshot({ date: '2026-11-09' });
  assert.equal(snap.dailyItems[0].title, '旧事项');
  assert.equal(snap.dailyItems[0].priority, 'normal', '非法字段应被清洗');
  assert.equal(snap.dailyNote, '旧焦点');
  assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).items.length, 1, '旧文件必须保留');

  await store.addItem({ scope: 'evergreen', title: '触发写入' });
  const backups = await readdir(join(dataDir, 'backups'));
  assert.ok(backups.some(name => name.startsWith('memorandum-2026-11-10')), '首次写入前应生成当日备份');
});

test('数据版本不兼容时拒绝加载，避免覆盖用户数据', async () => {
  const dataDir = join(TEST_TMP_ROOT, 'bad-version-' + process.pid);
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'memorandum-data.json'), JSON.stringify({ version: 99, items: [] }));
  const store = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now });
  await assert.rejects(store.init(), /版本/);
});

function mockHost(peer = { principal: { kind: 'owner' }, interactions: 'answer' }) {
  const routes = new Map();
  const tools = new Map();
  const ctx = {
    effect: fn => fn(),
    connection: { admit: () => (peer ? { peer } : { rejection: 401 }) },
    webServer: { register: entry => (routes.set(entry.path, entry), () => routes.delete(entry.path)) },
    tools: { register: def => (tools.set(def.name, def), () => tools.delete(def.name)) },
  };
  return { ctx, routes, tools };
}

async function callAction(route, nonce, payload) {
  const chunks = [Buffer.from(JSON.stringify(payload))];
  const req = {
    method: 'POST',
    headers: { 'x-dsh-memorandum': nonce },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
  const out = {};
  const res = {
    writeHead(status) {
      out.status = status;
    },
    end(body) {
      out.body = JSON.parse(body);
    },
  };
  await route.handler(req, res);
  return out;
}

test('Host：路由鉴权、nonce、动作分发与 Agent 工具', async () => {
  const dataDir = join(TEST_TMP_ROOT, 'host-' + process.pid);
  const { ctx, routes, tools } = mockHost();
  await applyPlugin(ctx, { dataDir, timeZone: 'Asia/Shanghai' });
  const getRoute = routes.get('/memorandum/v1');
  const postRoute = routes.get('/memorandum/v1/action');
  assert.ok(getRoute && postRoute && tools.has('memorandum'));

  const forbidden = await getRoute.resource(new Request('http://127.0.0.1/memorandum/v1'));
  assert.equal(forbidden.status, 403);

  const res = await getRoute.resource(new Request('http://127.0.0.1/memorandum/v1', { headers: { 'x-dsh-memorandum-panel': '1' } }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, PKG.version);
  assert.equal(body.dataDir, dataDir);
  assert.ok(body.nonce);

  const rev = await getRoute.resource(new Request('http://127.0.0.1/memorandum/v1?revision=1', { headers: { 'x-dsh-memorandum-panel': '1' } }));
  assert.ok((await rev.json()).updatedAt);

  const expired = await callAction(postRoute, 'wrong', { action: 'snapshot' });
  assert.equal(expired.status, 409);
  assert.equal(expired.body.code, 'PANEL_EXPIRED');

  const added = await callAction(postRoute, body.nonce, { action: 'add-from-selection', text: '对话里选中的一句话', scope: 'evergreen' });
  assert.equal(added.status, 200);
  assert.equal(added.body.item.scope, 'evergreen');
  const updated = await callAction(postRoute, body.nonce, { action: 'update', id: added.body.item.id, patch: { pinned: true } });
  assert.equal(updated.body.item.pinned, true);
  const unknown = await callAction(postRoute, body.nonce, { action: 'nope' });
  assert.equal(unknown.status, 400);

  const tool = tools.get('memorandum');
  const toolAdd = await tool.execute({ action: 'add', scope: 'daily', title: 'Agent 写入', priority: 'high' });
  assert.equal(toolAdd.item.priority, 'high');
  assert.equal('dailyItems' in toolAdd, false, '工具结果应精简');
  const listed = await tool.execute({ action: 'list' });
  assert.equal(listed.total, 2);
  const text = renderToolResult(listed);
  assert.match(text, /Agent 写入/);
  assert.match(text, /常驻/);
  assert.ok(!text.trim().startsWith('{'), '渲染应为可读文本而非 JSON');
  const all = await tool.execute({ action: 'list', scope: 'all' });
  assert.equal(all.total, 2);
  await assert.rejects(tool.execute({ action: 'add', scope: 'overdue', title: 'x' }));
});

test('Host：非本人或登录失效时拒绝', async () => {
  const guest = mockHost({ principal: { kind: 'guest' }, interactions: 'answer' });
  await applyPlugin(guest.ctx, { dataDir: join(TEST_TMP_ROOT, 'guest-' + process.pid) });
  const r1 = await guest.routes.get('/memorandum/v1').resource(new Request('http://127.0.0.1/memorandum/v1', { headers: { 'x-dsh-memorandum-panel': '1' } }));
  assert.equal(r1.status, 403);
  const anon = mockHost(null);
  await applyPlugin(anon.ctx, { dataDir: join(TEST_TMP_ROOT, 'anon-' + process.pid) });
  const r2 = await anon.routes.get('/memorandum/v1').resource(new Request('http://127.0.0.1/memorandum/v1', { headers: { 'x-dsh-memorandum-panel': '1' } }));
  assert.equal(r2.status, 401);
});

test('默认数据目录跟随 DSH_HOME，脱离插件包目录', () => {
  assert.equal(defaultDataDir({ DSH_HOME: '/x/.dsh' }), '/x/.dsh/dsh-memorandum');
  assert.match(defaultDataDir({}), /\.dsh[\\/]dsh-memorandum$/);
});

test('compactItem 截断长备注并去掉内部字段', () => {
  const item = compactItem({ id: 'memo-1', scope: 'daily', date: '2026-11-10', title: 't', note: 'x'.repeat(1000), priority: 'normal', category: '', pinned: false, completed: false, createdAt: 'a', updatedAt: 'b' });
  assert.ok(item.note.length <= 300);
  assert.equal('updatedAt' in item, false);
});

test('客户端不再全局拦截右键：不监听 window contextmenu，走官方 text-interaction', async () => {
  const source = await readFile(join(ROOT_DIR, 'client.js'), 'utf8');
  assert.equal(/addEventListener\(\s*['"]contextmenu['"]/.test(source), false);
  assert.match(source, /interactions\.register\(/);
  assert.match(source, /request\.trigger !== 'contextmenu'/);
  assert.match(source, /conversation\.chat\.text-interaction/);
  assert.equal(/shell\.overlay/.test(source), false);
});
