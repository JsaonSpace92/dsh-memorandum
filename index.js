import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactItem, MemorandumStore, PRIORITIES, SCOPES } from './core.js';

export const name = 'dsh-memorandum';
export const inject = ['webServer', 'connection', 'tools'];

const ROUTE = '/memorandum/v1';
const MAX_BODY = 250_000;
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** 数据默认放在 $DSH_HOME/dsh-memorandum，与插件包目录解耦，升级或重装插件不会丢数据。 */
export function defaultDataDir(env = process.env) {
  return join(env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-memorandum');
}

const LEGACY_FILE = fileURLToPath(new URL('./runtime/memorandum-data.json', import.meta.url));

const PRIORITY_LABEL = { high: '重要', normal: '常规', low: '随手' };

function describeItem(item) {
  const flags = [
    item.completed ? '[x]' : '[ ]',
    item.pinned ? '置顶' : '',
    item.priority && item.priority !== 'normal' ? PRIORITY_LABEL[item.priority] : '',
    item.category ? '#' + item.category : '',
    item.scope === 'daily' ? item.date : '常驻',
    item.carriedFrom ? '顺延自 ' + item.carriedFrom : '',
  ].filter(Boolean);
  const note = item.note ? '\n    备注：' + item.note.replace(/\n/g, ' ') : '';
  return '- ' + flags.join(' ') + ' ' + item.title + '  (id: ' + item.id + ')' + note;
}

/** 把工具结果渲染成紧凑的可读文本，避免把整份 JSON 灌进模型上下文。 */
export function renderToolResult(value) {
  if (!value || typeof value !== 'object') return String(value);
  const lines = [];
  if (value.message) lines.push(value.message);
  if (value.item) lines.push(describeItem(value.item));
  if (Array.isArray(value.items)) {
    const scopeLabel = value.date ? value.date + ' 的当日事项与常驻事项' : '匹配的事项';
    lines.push('今天：' + value.today + '；' + scopeLabel + '共 ' + value.total + ' 条' + (value.total > value.items.length ? '（仅列出前 ' + value.items.length + ' 条）' : '') + '。');
    if (value.dailyNote) lines.push('当日焦点：' + value.dailyNote);
    lines.push(...(value.items.length ? value.items.map(describeItem) : ['（没有符合条件的事项）']));
    if (value.overdueCount) lines.push('另有 ' + value.overdueCount + ' 条往日未完成事项，可用 carry_over 顺延到今天。');
  }
  return lines.join('\n') || JSON.stringify(value);
}

export async function apply(ctx, config = {}) {
  const dataDir = config?.dataDir || defaultDataDir();
  const store = new MemorandumStore({
    dataDir,
    timeZone: config?.timeZone || 'Asia/Shanghai',
    legacyFiles: config?.dataDir ? [] : [LEGACY_FILE],
  });
  await store.init();

  const nonce = randomUUID();
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });

  const authorize = (request, peer) => {
    const admission = peer ? { peer } : ctx.connection.admit({ headers: request.headers });
    if ('rejection' in admission) {
      return {
        status: admission.rejection,
        error: admission.rejection === 401 ? 'DSH 登录状态已变化，请刷新整个 DSH 页面。' : '请求来源未通过 DSH 校验。',
      };
    }
    if (admission.peer.principal.kind !== 'owner' || admission.peer.interactions !== 'answer') {
      return { status: 403, error: '请使用本人的 DSH 备忘录面板操作。' };
    }
    return null;
  };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      resource: async (request, peer) => {
        if (request.headers.get('x-dsh-memorandum-panel') !== '1') {
          return jsonResponse({ error: '请从 DSH 备忘录面板访问。' }, 403);
        }
        const rejection = authorize(request, peer);
        if (rejection) return jsonResponse({ error: rejection.error }, rejection.status);
        try {
          const url = new URL(request.url, 'http://127.0.0.1');
          if (url.searchParams.get('revision') === '1') {
            return jsonResponse({ ...(await store.revision()), version: VERSION });
          }
          const snapshot = await store.snapshot({
            date: url.searchParams.get('date') || undefined,
            query: url.searchParams.get('query') || undefined,
          });
          return jsonResponse({ ...snapshot, nonce, version: VERSION, dataDir });
        } catch (error) {
          return jsonResponse({ error: error.message || '读取备忘录失败。' }, 400);
        }
      },
    })
  );

  const actions = {
    snapshot: input => store.snapshot({ date: input.date, query: input.query }),
    add: input => store.addItem(input),
    'add-from-selection': input => store.addFromSelection(input),
    update: input => store.updateItem(input.id, input.patch || {}, input.activeDate),
    toggle: input => store.toggleItem(input.id, input.completed, input.activeDate),
    delete: input => store.deleteItem(input.id, input.activeDate),
    restore: input => store.restoreItem(input.item, input.activeDate),
    'clear-completed': input => store.clearCompleted({ scope: input.scope, date: input.date, activeDate: input.activeDate }),
    'carry-over': input => store.carryOverOverdue({ targetDate: input.targetDate, ids: input.ids, activeDate: input.activeDate }),
    'set-daily-note': input => store.setDailyNote(input.date, input.note, input.activeDate),
  };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE + '/action',
      handler: async (req, res) => {
        const respond = (value, status = 200) => {
          res.writeHead(status, headers);
          res.end(JSON.stringify(value));
        };
        if (req.method !== 'POST') return respond({ error: '此操作只接受 POST 请求。' }, 405);
        const rejection = authorize(req);
        if (rejection) return respond({ error: rejection.error }, rejection.status);
        const credential = req.headers['x-dsh-memorandum'];
        if (
          typeof credential !== 'string' ||
          Buffer.byteLength(credential) !== Buffer.byteLength(nonce) ||
          !timingSafeEqual(Buffer.from(credential), Buffer.from(nonce))
        ) {
          return respond({ error: '面板会话已更新，正在重新同步。', code: 'PANEL_EXPIRED' }, 409);
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > MAX_BODY) throw new Error('请求内容过大。');
          }
          const input = JSON.parse(body || '{}');
          const run = Object.hasOwn(actions, input.action) ? actions[input.action] : null;
          if (!run) return respond({ error: '不支持的备忘录操作。' }, 400);
          return respond({ ...(await run(input)), nonce, version: VERSION });
        } catch (error) {
          return respond({ error: error.message || '操作备忘录失败。' }, 400);
        }
      },
    })
  );

  const toolActions = {
    async list(args) {
      const result = await store.listItems(args);
      return { ...result, items: result.items.map(compactItem) };
    },
    async add(args) {
      if (args.scope && !SCOPES.includes(args.scope)) throw new Error('新增时 scope 只能是 daily 或 evergreen。');
      const { item } = await store.addItem(args);
      return { message: '已新增备忘事项。', item: compactItem(item) };
    },
    async toggle(args) {
      const { item } = await store.toggleItem(args.id, args.completed);
      return { message: item.completed ? '已标记完成。' : '已标记为未完成。', item: compactItem(item) };
    },
    async update(args) {
      const { id, action: _action, ...patch } = args;
      if (patch.scope && !SCOPES.includes(patch.scope)) throw new Error('修改时 scope 只能是 daily 或 evergreen。');
      const { item } = await store.updateItem(id, patch);
      return { message: '已更新备忘事项。', item: compactItem(item) };
    },
    async delete(args) {
      const { deletedItem } = await store.deleteItem(args.id);
      return { message: '已删除备忘事项：' + deletedItem.title };
    },
    async carry_over(args) {
      const { movedCount, activeDate } = await store.carryOverOverdue({ targetDate: args.date, ids: args.ids });
      return { message: '已把 ' + movedCount + ' 条往日未完成事项顺延到 ' + activeDate + '。' };
    },
    async clear_completed(args) {
      const scope = ['daily', 'evergreen', 'all'].includes(args.scope) ? args.scope : 'daily';
      const { removedCount } = await store.clearCompleted({ scope, date: args.date });
      return { message: '已清理 ' + removedCount + ' 条已完成事项。' };
    },
    async set_daily_note(args) {
      const { activeDate, dailyNote } = await store.setDailyNote(args.date, args.note || '');
      return { message: dailyNote ? activeDate + ' 的当日焦点已设为：' + dailyNote : '已清空 ' + activeDate + ' 的当日焦点。' };
    },
  };

  ctx.effect(() =>
    ctx.tools.register({
      name: 'memorandum',
      description:
        '查看或管理 DSH 左侧栏「备忘录」：每日事项（daily，绑定日期）与常驻事项（evergreen，长期保留）。' +
        '支持查询、新增、标记完成、编辑、删除、把往日未完成顺延到今天、清理已完成、设置当日焦点。' +
        '用户说“记一下 / 提醒我 / 加到备忘录”时用 add；问“今天要做什么”时用 list。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(toolActions),
            description: '操作类型，默认 list。',
          },
          id: { type: 'string', description: '目标事项 ID（toggle、update、delete 必填，可先用 list 查到）。' },
          ids: { type: 'array', items: { type: 'string' }, description: 'carry_over 时只顺延这些 ID；不传则顺延全部。' },
          scope: {
            type: 'string',
            enum: ['daily', 'evergreen', 'overdue', 'all'],
            description: 'add/update：daily 或 evergreen；list：daily、evergreen、overdue（往日未完成）；clear_completed：daily、evergreen 或 all。',
          },
          status: { type: 'string', enum: ['open', 'done', 'all'], description: 'list 时按完成状态过滤，默认 all。' },
          date: { type: 'string', description: '日期 YYYY-MM-DD，不传默认今天。' },
          title: { type: 'string', description: '事项标题。' },
          note: { type: 'string', description: '事项备注，或 set_daily_note 的当日焦点文本。' },
          priority: { type: 'string', enum: PRIORITIES, description: '重要度：high 重要、normal 常规、low 随手。' },
          category: { type: 'string', description: '分类标签，如 重要、研发、工作、日常、灵感、摘录。' },
          pinned: { type: 'boolean', description: '是否置顶。' },
          completed: { type: 'boolean', description: '是否已完成。' },
          query: { type: 'string', description: 'list 时按关键词跨日期搜索标题、备注、分类。' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'list 返回条数上限，默认 50。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: renderToolResult(value) }],
      },
      async execute(args = {}) {
        const action = args.action || 'list';
        if (!Object.hasOwn(toolActions, action)) throw new Error('未知操作：' + action);
        return toolActions[action](args);
      },
    })
  );
}
