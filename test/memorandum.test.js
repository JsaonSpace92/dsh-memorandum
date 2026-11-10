import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MemorandumStore, isValidDateString, parseSelectionToMemo, shiftDateString } from '../core.js';
import { apply as applyPlugin } from '../index.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const TEST_TMP_ROOT = join(ROOT_DIR, '.test-runtime');

test('日期工具函数校验与偏移计算', () => {
  assert.equal(isValidDateString('2026-11-10'), true);
  assert.equal(isValidDateString('2026-02-29'), false);
  assert.equal(isValidDateString('invalid'), false);
  assert.equal(shiftDateString('2026-11-10', -1), '2026-11-09');
  assert.equal(shiftDateString('2026-11-10', 1), '2026-11-11');
});

test('MemorandumStore 完整生命周期：每日记录、常驻记录、完成状态切换、跨日顺延与持久化', async () => {
  const dataDir = join(TEST_TMP_ROOT, `case-${Date.now()}`);
  try {
    const fixedNow = () => new Date('2026-11-10T12:00:00.000Z');
    const store = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now: fixedNow });
    await store.init();

    // 1. 初始快照
    const initial = await store.snapshot();
    assert.equal(initial.today, '2026-11-10');
    assert.equal(initial.stats.totalItems, 0);

    // 2. 新增每日重要事件与常驻备忘
    const addedDaily = await store.addItem({
      scope: 'daily',
      date: '2026-11-10',
      title: '完成备忘录插件开发与左侧栏挂载',
      note: '放置在会话清理下方（order: 50）',
      priority: 'high',
      category: '研发',
      pinned: true,
    });
    assert.equal(addedDaily.item.scope, 'daily');
    assert.equal(addedDaily.item.completed, false);
    assert.equal(addedDaily.stats.dailyPending, 1);

    const addedEvergreen = await store.addItem({
      scope: 'evergreen',
      title: '所有产物必须落盘在当前工作区指定目录',
      priority: 'high',
      category: '重要',
      pinned: true,
    });
    assert.equal(addedEvergreen.item.scope, 'evergreen');
    assert.equal(addedEvergreen.item.date, '');
    assert.equal(addedEvergreen.stats.evergreenPending, 1);

    // 3. 新增往日未完成事项并测试跨日顺延
    const pastItem = await store.addItem({
      scope: 'daily',
      date: '2026-11-09',
      title: '整理 DSH 插件主题变量清单',
      priority: 'normal',
      category: '工作',
    });
    assert.equal(pastItem.overdueItems.length, 1);
    assert.equal(pastItem.overdueItems[0].id, pastItem.item.id);

    const carried = await store.carryOverOverdue({ targetDate: '2026-11-10' });
    assert.equal(carried.movedCount, 1);
    assert.equal(carried.overdueItems.length, 0);
    assert.equal(carried.stats.dailyPending, 2);
    const movedItem = carried.dailyItems.find(entry => entry.id === pastItem.item.id);
    assert.equal(movedItem.carriedFrom, '2026-11-09');
    assert.equal(movedItem.date, '2026-11-10');

    // 4. 切换完成/未完成状态
    const toggledDone = await store.toggleItem(addedDaily.item.id);
    assert.equal(toggledDone.item.completed, true);
    assert.ok(toggledDone.item.completedAt);
    assert.equal(toggledDone.stats.dailyCompleted, 1);
    assert.equal(toggledDone.stats.dailyPending, 1);

    const toggledUndone = await store.toggleItem(addedDaily.item.id);
    assert.equal(toggledUndone.item.completed, false);
    assert.equal(toggledUndone.item.completedAt, null);

    // 5. 每日与常驻互转、设置当日焦点提要
    const converted = await store.updateItem(movedItem.id, { scope: 'evergreen' });
    assert.equal(converted.item.scope, 'evergreen');
    assert.equal(converted.stats.evergreenPending, 2);

    const withFocus = await store.setDailyNote('2026-11-10', '今日聚焦：高质量交付备忘录插件');
    assert.equal(withFocus.dailyNote, '今日聚焦：高质量交付备忘录插件');

    // 6. 重新加载验证持久化
    const reloaded = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now: fixedNow });
    await reloaded.init();
    const snapAfterReload = await reloaded.snapshot();
    assert.equal(snapAfterReload.stats.totalItems, 3);
    assert.equal(snapAfterReload.dailyNote, '今日聚焦：高质量交付备忘录插件');
  } finally {
    await rm(TEST_TMP_ROOT, { recursive: true, force: true });
  }
});

test('Host 插件路由与 Agent 工具注册联调测试', async () => {
  const dataDir = join(TEST_TMP_ROOT, `plugin-${Date.now()}`);
  try {
    const routes = new Map();
    const tools = new Map();
    const mockCtx = {
      effect(fn) {
        return fn();
      },
      connection: {
        admit() {
          return {
            peer: {
              principal: { kind: 'owner' },
              interactions: 'answer',
            },
          };
        },
      },
      webServer: {
        register(entry) {
          routes.set(entry.path, entry);
          return () => routes.delete(entry.path);
        },
      },
      tools: {
        register(def) {
          tools.set(def.name, def);
          return () => tools.delete(def.name);
        },
      },
    };

    await applyPlugin(mockCtx, { dataDir, timeZone: 'Asia/Shanghai' });
    assert.equal(routes.has('/memorandum/v1'), true);
    assert.equal(routes.has('/memorandum/v1/action'), true);
    assert.equal(tools.has('memorandum'), true);

    const getRoute = routes.get('/memorandum/v1');
    const getRes = await getRoute.resource(
      new Request('http://127.0.0.1/memorandum/v1', {
        headers: { 'x-dsh-memorandum-panel': '1' },
      })
    );
    assert.equal(getRes.status, 200);
    const body = await getRes.json();
    assert.ok(body.nonce);
    assert.equal(body.version, '0.2.0');

    // 使用 Agent 工具新增一条记录
    const memoTool = tools.get('memorandum');
    const toolAdd = await memoTool.execute({
      action: 'add',
      scope: 'daily',
      title: '通过 Agent 工具写入的重要事件',
      priority: 'high',
      category: '重要',
    });
    assert.equal(toolAdd.stats.dailyPending, 1);
  } finally {
    await rm(TEST_TMP_ROOT, { recursive: true, force: true });
  }
});

test('选中文本右击添加备忘录：1. 当日清单 与 2. 全取清单 解析及入库测试', async () => {
  const dataDir = join(TEST_TMP_ROOT, `selection-${Date.now()}`);
  try {
    const fixedNow = () => new Date('2026-11-10T12:00:00.000Z');
    const store = new MemorandumStore({ dataDir, timeZone: 'Asia/Shanghai', now: fixedNow });
    await store.init();

    const shortParsed = parseSelectionToMemo('修复左侧栏备忘录名称显示为中文');
    assert.equal(shortParsed.title, '修复左侧栏备忘录名称显示为中文');
    assert.equal(shortParsed.note, '');

    const multiLineText = '1. 当日清单用于记录当天重要事件\n2. 全取清单用于保存全局常驻事项\n3. 支持在对话中选中文字直接右键入库';
    const longParsed = parseSelectionToMemo(multiLineText);
    assert.equal(longParsed.title, '当日清单用于记录当天重要事件');
    assert.equal(longParsed.note, multiLineText);

    const dailyRes = await store.addFromSelection({
      text: multiLineText,
      scope: 'daily',
    });
    assert.equal(dailyRes.item.scope, 'daily');
    assert.equal(dailyRes.item.date, '2026-11-10');
    assert.equal(dailyRes.item.category, '摘录');
    assert.equal(dailyRes.item.note, multiLineText);

    const evergreenRes = await store.addFromSelection({
      text: '全局规范：所有生成物统一存放在工作区指定目录内',
      scope: 'evergreen',
    });
    assert.equal(evergreenRes.item.scope, 'evergreen');
    assert.equal(evergreenRes.item.date, '');
    assert.equal(evergreenRes.stats.dailyPending, 1);
    assert.equal(evergreenRes.stats.evergreenPending, 1);
  } finally {
    await rm(TEST_TMP_ROOT, { recursive: true, force: true });
  }
});


