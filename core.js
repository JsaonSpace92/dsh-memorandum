import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCOPES = ['daily', 'evergreen'];
export const PRIORITIES = ['high', 'normal', 'low'];
export const CATEGORIES = ['重要', '研发', '工作', '日常', '灵感'];

const PRIORITY_WEIGHT = {
  high: 0,
  normal: 1,
  low: 2,
};

export function localDateString(date = new Date(), timeZone = 'Asia/Shanghai') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function shiftDateString(dateStr, offsetDays) {
  if (!isValidDateString(dateStr)) throw new Error('日期格式无效，应为 YYYY-MM-DD。');
  const [year, month, day] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + Number(offsetDays || 0)));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function atomicWriteJson(filePath, data) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readOptionalJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

export function sortMemoItems(items) {
  return [...items].sort((left, right) => {
    if (Boolean(left.completed) !== Boolean(right.completed)) {
      return left.completed ? 1 : -1;
    }
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    const leftPriority = PRIORITY_WEIGHT[left.priority] ?? 1;
    const rightPriority = PRIORITY_WEIGHT[right.priority] ?? 1;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
  });
}

function normalizeTitle(title) {
  if (typeof title !== 'string') throw new Error('请输入备忘事项标题。');
  const trimmed = title.trim();
  if (!trimmed) throw new Error('备忘事项标题不能为空。');
  if (trimmed.length > 500) throw new Error('备忘事项标题不能超过 500 个字符。');
  return trimmed;
}

function normalizeNote(note) {
  if (note === undefined || note === null) return '';
  if (typeof note !== 'string') throw new Error('备注内容格式无效。');
  const trimmed = note.trim();
  if (trimmed.length > 50000) throw new Error('备注内容不能超过 50000 个字符。');
  return trimmed;
}

export function parseSelectionToMemo(rawText) {
  if (typeof rawText !== 'string') throw new Error('未检测到有效的选中文本。');
  const cleaned = rawText.replace(/\r\n/g, '\n').trim();
  if (!cleaned) throw new Error('选中文本为空，请先选择一段文字。');
  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const firstLine = (lines[0] || cleaned)
    .replace(/^[#>*\-•\d.)\s]+/, '')
    .trim() || lines[0] || cleaned;
  if (lines.length === 1 && firstLine.length <= 120) {
    return {
      title: firstLine,
      note: '',
    };
  }
  const title = firstLine.length > 96 ? `${firstLine.slice(0, 96)}…` : firstLine;
  const note = cleaned.length > 50000 ? `${cleaned.slice(0, 49990)}…` : cleaned;
  return {
    title,
    note,
  };
}

function normalizeCategory(category) {
  if (category === undefined || category === null) return '';
  if (typeof category !== 'string') throw new Error('分类标签格式无效。');
  const trimmed = category.trim();
  if (trimmed.length > 24) throw new Error('分类标签不能超过 24 个字符。');
  return trimmed;
}

function normalizePriority(priority) {
  if (!priority) return 'normal';
  if (!PRIORITIES.includes(priority)) throw new Error('重要度必须是 high、normal 或 low。');
  return priority;
}

function normalizeScope(scope) {
  if (!scope) return 'daily';
  if (!SCOPES.includes(scope)) throw new Error('备忘类型必须是 daily（每日）或 evergreen（常驻）。');
  return scope;
}

export class MemorandumStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir;
    this.timeZone = options.timeZone || 'Asia/Shanghai';
    this.now = options.now || (() => new Date());
    this.filePath = join(this.dataDir, 'memorandum-data.json');
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  todayString() {
    return localDateString(this.now(), this.timeZone);
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    const initial = {
      version: 1,
      updatedAt: this.now().toISOString(),
      dailyNotes: {},
      items: [],
    };
    const loaded = await readOptionalJson(this.filePath, initial);
    if (!loaded || typeof loaded !== 'object' || loaded.version !== 1) {
      throw new Error('备忘录数据版本不兼容。');
    }
    this.state = {
      version: 1,
      updatedAt: typeof loaded.updatedAt === 'string' ? loaded.updatedAt : this.now().toISOString(),
      dailyNotes: loaded.dailyNotes && typeof loaded.dailyNotes === 'object' ? { ...loaded.dailyNotes } : {},
      items: Array.isArray(loaded.items) ? loaded.items.map(item => ({ ...item })) : [],
    };
    return this;
  }

  async ensureReady() {
    if (!this.state) await this.init();
  }

  enqueueSave() {
    const snapshot = structuredClone(this.state);
    const task = this.writeQueue.then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = task.catch(() => {});
    return task;
  }

  buildWeekStrip(centerDate) {
    const days = [];
    for (let offset = -3; offset <= 3; offset++) {
      const date = shiftDateString(centerDate, offset);
      const dayItems = this.state.items.filter(item => item.scope === 'daily' && item.date === date);
      const completed = dayItems.filter(item => item.completed).length;
      const pending = dayItems.length - completed;
      const highPending = dayItems.filter(item => !item.completed && item.priority === 'high').length;
      days.push({
        date,
        total: dayItems.length,
        completed,
        pending,
        highPending,
        hasNote: Boolean(this.state.dailyNotes[date]),
      });
    }
    return days;
  }

  async snapshot(options = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const activeDate = options.date && isValidDateString(options.date) ? options.date : today;
    const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';

    const matchesQuery = item => {
      if (!query) return true;
      const haystack = `${item.title}\n${item.note || ''}\n${item.category || ''}\n${item.date || ''}`.toLowerCase();
      return haystack.includes(query);
    };

    const allSorted = sortMemoItems(this.state.items);
    const filtered = allSorted.filter(matchesQuery);
    const dailyItems = filtered.filter(item => item.scope === 'daily' && item.date === activeDate);
    const evergreenItems = filtered.filter(item => item.scope === 'evergreen');
    const overdueItems = allSorted
      .filter(item => item.scope === 'daily' && !item.completed && item.date && item.date < today)
      .sort((a, b) => {
        const dateDiff = b.date.localeCompare(a.date);
        if (dateDiff !== 0) return dateDiff;
        return sortMemoItems([a, b])[0] === a ? -1 : 1;
      });

    const rawDaily = this.state.items.filter(item => item.scope === 'daily' && item.date === activeDate);
    const rawEvergreen = this.state.items.filter(item => item.scope === 'evergreen');

    const datesWithRecords = [...new Set(
      this.state.items
        .filter(item => item.scope === 'daily' && item.date)
        .map(item => item.date)
        .concat(Object.keys(this.state.dailyNotes).filter(date => this.state.dailyNotes[date]))
    )].sort((a, b) => b.localeCompare(a));

    return {
      today,
      activeDate,
      dailyNote: this.state.dailyNotes[activeDate] || '',
      dailyNotes: { ...this.state.dailyNotes },
      items: allSorted,
      dailyItems,
      evergreenItems,
      overdueItems,
      weekStrip: this.buildWeekStrip(activeDate),
      datesWithRecords,
      categories: CATEGORIES,
      stats: {
        dailyTotal: rawDaily.length,
        dailyCompleted: rawDaily.filter(item => item.completed).length,
        dailyPending: rawDaily.filter(item => !item.completed).length,
        evergreenTotal: rawEvergreen.length,
        evergreenCompleted: rawEvergreen.filter(item => item.completed).length,
        evergreenPending: rawEvergreen.filter(item => !item.completed).length,
        overdueCount: overdueItems.length,
        totalItems: this.state.items.length,
      },
      updatedAt: this.state.updatedAt,
    };
  }

  async addItem(input = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const scope = normalizeScope(input.scope);
    const date = scope === 'daily'
      ? (input.date ? (isValidDateString(input.date) ? input.date : (() => { throw new Error('日期格式无效，应为 YYYY-MM-DD。'); })()) : today)
      : '';
    const title = normalizeTitle(input.title);
    const note = normalizeNote(input.note);
    const priority = normalizePriority(input.priority);
    const category = normalizeCategory(input.category);
    const pinned = Boolean(input.pinned);
    const completed = Boolean(input.completed);
    const nowIso = this.now().toISOString();

    const item = {
      id: `memo-${randomUUID()}`,
      scope,
      date,
      title,
      note,
      priority,
      category,
      pinned,
      completed,
      completedAt: completed ? nowIso : null,
      carriedFrom: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.state.items.unshift(item);
    this.state.updatedAt = nowIso;
    await this.enqueueSave();
    return {
      item,
      ...(await this.snapshot({ date: scope === 'daily' ? date : input.activeDate || today })),
    };
  }

  async addFromSelection(input = {}) {
    await this.ensureReady();
    const { title, note } = parseSelectionToMemo(input.text);
    const scope = normalizeScope(input.scope);
    const category = input.category !== undefined ? normalizeCategory(input.category) : '摘录';
    const priority = normalizePriority(input.priority || 'normal');
    return this.addItem({
      scope,
      date: input.date,
      activeDate: input.activeDate,
      title,
      note,
      category,
      priority,
      pinned: Boolean(input.pinned),
    });
  }

  async updateItem(id, patch = {}, activeDate) {
    await this.ensureReady();
    if (typeof id !== 'string' || !id) throw new Error('缺少备忘事项 ID。');
    const index = this.state.items.findIndex(entry => entry.id === id);
    if (index === -1) throw new Error('未找到对应的备忘事项，可能已被删除。');

    const current = this.state.items[index];
    const today = this.todayString();
    const nowIso = this.now().toISOString();

    const nextScope = patch.scope !== undefined ? normalizeScope(patch.scope) : current.scope;
    let nextDate = current.date;
    if (nextScope === 'evergreen') {
      nextDate = '';
    } else if (patch.date !== undefined) {
      if (!isValidDateString(patch.date)) throw new Error('日期格式无效，应为 YYYY-MM-DD。');
      nextDate = patch.date;
    } else if (!current.date || !isValidDateString(current.date)) {
      nextDate = activeDate && isValidDateString(activeDate) ? activeDate : today;
    }

    const nextCompleted = patch.completed !== undefined ? Boolean(patch.completed) : current.completed;
    const nextCompletedAt = nextCompleted
      ? (current.completed ? current.completedAt || nowIso : nowIso)
      : null;

    const updated = {
      ...current,
      scope: nextScope,
      date: nextDate,
      title: patch.title !== undefined ? normalizeTitle(patch.title) : current.title,
      note: patch.note !== undefined ? normalizeNote(patch.note) : current.note,
      priority: patch.priority !== undefined ? normalizePriority(patch.priority) : current.priority,
      category: patch.category !== undefined ? normalizeCategory(patch.category) : current.category,
      pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : current.pinned,
      completed: nextCompleted,
      completedAt: nextCompletedAt,
      updatedAt: nowIso,
    };

    this.state.items[index] = updated;
    this.state.updatedAt = nowIso;
    await this.enqueueSave();
    return {
      item: updated,
      ...(await this.snapshot({ date: activeDate || (nextScope === 'daily' ? nextDate : today) })),
    };
  }

  async toggleItem(id, completed, activeDate) {
    await this.ensureReady();
    const current = this.state.items.find(entry => entry.id === id);
    if (!current) throw new Error('未找到对应的备忘事项。');
    const targetCompleted = typeof completed === 'boolean' ? completed : !current.completed;
    return this.updateItem(id, { completed: targetCompleted }, activeDate);
  }

  async deleteItem(id, activeDate) {
    await this.ensureReady();
    if (typeof id !== 'string' || !id) throw new Error('缺少备忘事项 ID。');
    const index = this.state.items.findIndex(entry => entry.id === id);
    if (index === -1) throw new Error('未找到对应的备忘事项。');
    const [removed] = this.state.items.splice(index, 1);
    this.state.updatedAt = this.now().toISOString();
    await this.enqueueSave();
    return {
      deletedId: removed.id,
      ...(await this.snapshot({ date: activeDate })),
    };
  }

  async clearCompleted(options = {}) {
    await this.ensureReady();
    const scope = options.scope || 'daily';
    const today = this.todayString();
    const targetDate = options.date && isValidDateString(options.date) ? options.date : today;
    const beforeCount = this.state.items.length;

    this.state.items = this.state.items.filter(item => {
      if (!item.completed) return true;
      if (scope === 'all') return false;
      if (scope === 'evergreen') return item.scope !== 'evergreen';
      if (scope === 'daily') return !(item.scope === 'daily' && item.date === targetDate);
      return true;
    });

    const removedCount = beforeCount - this.state.items.length;
    if (removedCount > 0) {
      this.state.updatedAt = this.now().toISOString();
      await this.enqueueSave();
    }
    return {
      removedCount,
      ...(await this.snapshot({ date: targetDate })),
    };
  }

  async carryOverOverdue(options = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const targetDate = options.targetDate && isValidDateString(options.targetDate) ? options.targetDate : today;
    const idSet = Array.isArray(options.ids) && options.ids.length > 0 ? new Set(options.ids) : null;
    const nowIso = this.now().toISOString();
    let movedCount = 0;

    this.state.items = this.state.items.map(item => {
      if (item.scope !== 'daily' || item.completed || !item.date || item.date >= targetDate) {
        return item;
      }
      if (idSet && !idSet.has(item.id)) {
        return item;
      }
      movedCount += 1;
      return {
        ...item,
        carriedFrom: item.carriedFrom || item.date,
        date: targetDate,
        updatedAt: nowIso,
      };
    });

    if (movedCount > 0) {
      this.state.updatedAt = nowIso;
      await this.enqueueSave();
    }

    return {
      movedCount,
      ...(await this.snapshot({ date: targetDate })),
    };
  }

  async setDailyNote(date, note, activeDate) {
    await this.ensureReady();
    const targetDate = date && isValidDateString(date) ? date : this.todayString();
    const cleaned = normalizeNote(note);
    if (cleaned) {
      this.state.dailyNotes[targetDate] = cleaned;
    } else {
      delete this.state.dailyNotes[targetDate];
    }
    this.state.updatedAt = this.now().toISOString();
    await this.enqueueSave();
    return this.snapshot({ date: activeDate || targetDate });
  }
}
