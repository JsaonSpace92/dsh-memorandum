import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MemorandumStore, PRIORITIES, SCOPES } from './core.js';

export const name = 'dsh-memorandum';
export const inject = ['webServer', 'connection', 'tools'];

const ROUTE = '/memorandum/v1';
const VERSION = '0.2.0';

export async function apply(ctx, config = {}) {
  const dataDir = config?.dataDir || fileURLToPath(new URL('./runtime', import.meta.url));
  const store = new MemorandumStore({ dataDir, timeZone: config?.timeZone || 'Asia/Shanghai' });
  await store.init();

  const nonce = randomUUID();
  const jsonResponse = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });

  const authorize = (request, peer) => {
    const admission = peer ? { peer } : ctx.connection.admit({ headers: request.headers });
    if ('rejection' in admission) {
      return {
        error: admission.rejection === 401
          ? 'DSH 登录状态已变化，请刷新整个 DSH 页面。'
          : '请求来源未通过 DSH 校验。',
        status: admission.rejection,
      };
    }
    if (admission.peer.principal.kind !== 'owner' || admission.peer.interactions !== 'answer') {
      return {
        error: '请使用本人的 DSH 备忘录面板操作。',
        status: 403,
      };
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
          const date = url.searchParams.get('date') || undefined;
          const query = url.searchParams.get('query') || undefined;
          const snapshot = await store.snapshot({ date, query });
          return jsonResponse({ ...snapshot, nonce, version: VERSION });
        } catch (error) {
          return jsonResponse({ error: error.message || '读取备忘录失败。' }, 400);
        }
      },
    })
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/action`,
      handler: async (req, res) => {
        const respond = (value, status = 200) => {
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify(value));
        };
        if (req.method !== 'POST') {
          return respond({ error: '此操作只接受 POST 请求。' }, 405);
        }
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
            if (body.length > 250_000) throw new Error('请求内容过大。');
          }
          const input = JSON.parse(body || '{}');
          const wrap = result => ({ ...result, nonce, version: VERSION });

          switch (input.action) {
            case 'snapshot':
              return respond(wrap(await store.snapshot({ date: input.date, query: input.query })));
            case 'add':
              return respond(wrap(await store.addItem(input)));
            case 'add-from-selection':
              return respond(wrap(await store.addFromSelection(input)));
            case 'update':
              return respond(wrap(await store.updateItem(input.id, input.patch || input, input.activeDate)));
            case 'toggle':
              return respond(wrap(await store.toggleItem(input.id, input.completed, input.activeDate)));
            case 'delete':
              return respond(wrap(await store.deleteItem(input.id, input.activeDate)));
            case 'clear-completed':
              return respond(wrap(await store.clearCompleted({ scope: input.scope, date: input.date })));
            case 'carry-over':
              return respond(wrap(await store.carryOverOverdue({ targetDate: input.targetDate, ids: input.ids })));
            case 'set-daily-note':
              return respond(wrap(await store.setDailyNote(input.date, input.note, input.activeDate)));
            default:
              return respond({ error: '不支持的备忘录操作。' }, 400);
          }
        } catch (error) {
          return respond({ error: error.message || '操作备忘录失败。' }, 400);
        }
      },
    })
  );

  ctx.effect(() =>
    ctx.tools.register({
      name: 'memorandum',
      description:
        '查看或管理 DSH 左侧栏「备忘录」中的每日重要事件（daily）与常驻记录（evergreen），支持查询、新增、标记已完成/未完成、编辑、删除、顺延遗留事项与设置当日焦点提要。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'add', 'toggle', 'update', 'delete', 'carry_over', 'clear_completed', 'set_daily_note'],
            description: '操作类型：默认 list 查看备忘录；add 新增；toggle 切换完成状态；update 修改；delete 删除；carry_over 将往日未完成顺延至指定日期；clear_completed 清理已完成；set_daily_note 设置当日提要。',
          },
          id: {
            type: 'string',
            description: '目标备忘事项 ID（toggle、update、delete 必填）。',
          },
          scope: {
            type: 'string',
            enum: SCOPES,
            description: '备忘类型：daily（每日记录，绑定具体日期）或 evergreen（常驻记录，长期保留）。',
          },
          date: {
            type: 'string',
            description: '日期（YYYY-MM-DD），不传则默认为今天。',
          },
          title: {
            type: 'string',
            description: '备忘事项标题。',
          },
          note: {
            type: 'string',
            description: '备忘补充详情或当日焦点提要文本。',
          },
          priority: {
            type: 'string',
            enum: PRIORITIES,
            description: '重要度：high（重要）、normal（常规）、low（随手记）。',
          },
          category: {
            type: 'string',
            description: '分类标签（如 重要、研发、工作、日常、灵感）。',
          },
          pinned: {
            type: 'boolean',
            description: '是否置顶。',
          },
          completed: {
            type: 'boolean',
            description: '是否已完成。',
          },
          query: {
            type: 'string',
            description: '按关键词过滤备忘事项。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args = {}) {
        const action = args.action || 'list';
        switch (action) {
          case 'list':
            return store.snapshot({ date: args.date, query: args.query });
          case 'add':
            return store.addItem(args);
          case 'toggle':
            return store.toggleItem(args.id, args.completed, args.date);
          case 'update':
            return store.updateItem(args.id, args, args.date);
          case 'delete':
            return store.deleteItem(args.id, args.date);
          case 'carry_over':
            return store.carryOverOverdue({ targetDate: args.date });
          case 'clear_completed':
            return store.clearCompleted({ scope: args.scope || 'daily', date: args.date });
          case 'set_daily_note':
            return store.setDailyNote(args.date, args.note || '');
          default:
            throw new Error(`未知操作: ${action}`);
        }
      },
    })
  );
}
