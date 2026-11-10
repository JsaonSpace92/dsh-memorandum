import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCOPES = ['daily', 'evergreen'];
export const PRIORITIES = ['high', 'normal', 'low'];
export const CATEGORIES = ['重要', '研发', '工作', '日常', '灵感', '摘录'];
export const SELECTION_CATEGORY = '摘录';
export const DATA_FILE = 'memorandum-data.json';
export const BACKUP_DIR = 'backups';
export const BACKUP_KEEP = 14;

const DATA_VERSION = 1;
const HISTORY_LIMIT = 90;
const SEARCH_LIMIT = 200;
const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };

export function localDateString(date = new Date(), timeZone = 'Asia/Shanghai') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
  } catch {
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function shiftDateString(dateStr, offsetDays) {
  if (!isValidDateString(dateStr)) throw new Error('日期格式无效，应为 YYYY-MM-DD。');
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + Number(offsetDays || 0))).toISOString().slice(0, 10);
}

export async function atomicWriteJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = filePath + '.tmp.' + process.pid + '.' + randomUUID().slice(0, 8);
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
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function sortMemoItems(items) {
  return [...items].sort((left, right) => {
    if (Boolean(left.completed) !== Boolean(right.completed)) return left.completed ? 1 : -1;
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    const priorityDiff = (PRIORITY_WEIGHT[left.priority] ?? 1) - (PRIORITY_WEIGHT[right.priority] ?? 1);
    if (priorityDiff !== 0) return priorityDiff;
    if (left.completed) return String(right.completedAt || '').localeCompare(String(left.completedAt || ''));
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

function normalizeCategory(category) {
  if (category === undefined || category === null) return '';
  if (typeof category !== 'string') throw new Error('分类标签格式无效。');
  const trimmed = category.trim().replace(/^#/, '');
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

function normalizeDate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!isValidDateString(value)) throw new Error('日期格式无效，应为 YYYY-MM-DD。');
  return value;
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object') return null;
  const clip = value => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined);
  const result = { kind: clip(source.kind) || 'selection', sessionId: clip(source.sessionId), label: clip(source.label) };
  for (const key of Object.keys(result)) if (result[key] === undefined) delete result[key];
  return result;
}

/** 把一段选中文本拆成备忘标题与备注：单行短文本直接作标题，否则首行作标题、全文入备注。 */
export function parseSelectionToMemo(rawText) {
  if (typeof rawText !== 'string') throw new Error('未检测到有效的选中文本。');
  const cleaned = rawText.replace(/\r\n?/g, '\n').trim();
  if (!cleaned) throw new Error('选中文本为空，请先选择一段文字。');
  const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
  const firstLine = (lines[0] || cleaned).replace(/^[#>*\-•\d.)\s]+/, '').trim() || lines[0] || cleaned;
  if (lines.length === 1 && firstLine.length <= 120) return { title: firstLine, note: '' };
  const title = firstLine.length > 96 ? firstLine.slice(0, 96) + '…' : firstLine;
  const note = cleaned.length > 50000 ? cleaned.slice(0, 49990) + '…' : cleaned;
  return { title, note };
}

/** 对外暴露的精简条目，供 AI 工具输出使用，避免把整份数据灌进上下文。 */
export function compactItem(item) {
  const result = { id: item.id, scope: item.scope, title: item.title, completed: Boolean(item.completed) };
  if (item.scope === 'daily') result.date = item.date;
  if (item.priority && item.priority !== 'normal') result.priority = item.priority;
  if (item.category) result.category = item.category;
  if (item.pinned) result.pinned = true;
  if (item.carriedFrom) result.carriedFrom = item.carriedFrom;
  if (item.note) result.note = item.note.length > 280 ? item.note.slice(0, 280) + '…' : item.note;
  return result;
}

function sanitizeStoredItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  try {
    const scope = normalizeScope(raw.scope);
    return {
      id: raw.id,
      scope,
      date: scope === 'daily' && isValidDateString(raw.date) ? raw.date : '',
      title: normalizeTitle(raw.title),
      note: normalizeNote(raw.note),
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'normal',
      category: typeof raw.category === 'string' ? raw.category.slice(0, 24) : '',
      pinned: Boolean(raw.pinned),
      completed: Boolean(raw.completed),
      completedAt: raw.completed && typeof raw.completedAt === 'string' ? raw.completedAt : null,
      carriedFrom: isValidDateString(raw.carriedFrom) ? raw.carriedFrom : null,
      source: normalizeSource(raw.source),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export class MemorandumStore {
  /**
   * @param {{ dataDir: string, timeZone?: string, now?: () => Date, legacyFiles?: string[], backupKeep?: number }} options
   * legacyFiles：新位置没有数据文件时，按顺序寻找旧版本数据并复制过来（旧文件原样保留）。
   */
  constructor(options = {}) {
    if (!options.dataDir) throw new Error('MemorandumStore 需要 dataDir。');
    this.dataDir = options.dataDir;
    this.timeZone = options.timeZone || 'Asia/Shanghai';
    this.now = options.now || (() => new Date());
    this.legacyFiles = Array.isArray(options.legacyFiles) ? options.legacyFiles : [];
    this.backupKeep = Number.isInteger(options.backupKeep) ? options.backupKeep : BACKUP_KEEP;
    this.filePath = join(this.dataDir, DATA_FILE);
    this.backupDir = join(this.dataDir, BACKUP_DIR);
    this.state = null;
    this.migratedFrom = null;
    this.lastBackupDate = null;
    this.writeQueue = Promise.resolve();
    this.initPromise = null;
  }

  todayString() {
    return localDateString(this.now(), this.timeZone);
  }

  init() {
    this.initPromise ??= this.load().catch(error => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    if (!(await exists(this.filePath))) {
      for (const legacy of this.legacyFiles) {
        if (legacy && legacy !== this.filePath && (await exists(legacy))) {
          await copyFile(legacy, this.filePath);
          this.migratedFrom = legacy;
          break;
        }
      }
    }
    const initial = { version: DATA_VERSION, updatedAt: this.now().toISOString(), dailyNotes: {}, items: [] };
    const loaded = await readOptionalJson(this.filePath, initial);
    if (!loaded || typeof loaded !== 'object' || loaded.version !== DATA_VERSION) {
      throw new Error('备忘录数据版本不兼容：' + this.filePath);
    }
    const dailyNotes = {};
    if (loaded.dailyNotes && typeof loaded.dailyNotes === 'object') {
      for (const [date, note] of Object.entries(loaded.dailyNotes)) {
        if (isValidDateString(date) && typeof note === 'string' && note.trim()) dailyNotes[date] = note;
      }
    }
    this.state = {
      version: DATA_VERSION,
      updatedAt: typeof loaded.updatedAt === 'string' ? loaded.updatedAt : this.now().toISOString(),
      dailyNotes,
      items: (Array.isArray(loaded.items) ? loaded.items : []).map(sanitizeStoredItem).filter(Boolean),
    };
    return this;
  }

  async ensureReady() {
    if (!this.state) await this.init();
  }

  async backupOnce() {
    const today = this.todayString();
    if (this.lastBackupDate === today) return;
    this.lastBackupDate = today;
    if (this.backupKeep <= 0 || !(await exists(this.filePath))) return;
    await mkdir(this.backupDir, { recursive: true });
    const target = join(this.backupDir, 'memorandum-' + today + '.json');
    if (!(await exists(target))) await copyFile(this.filePath, target);
    const backups = (await readdir(this.backupDir)).filter(name => /^memorandum-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    for (const name of backups.slice(0, Math.max(0, backups.length - this.backupKeep))) {
      await rm(join(this.backupDir, name), { force: true });
    }
  }

  touch() {
    this.state.updatedAt = this.now().toISOString();
    return this.state.updatedAt;
  }

  enqueueSave() {
    const snapshot = structuredClone(this.state);
    const task = this.writeQueue.then(async () => {
      await this.backupOnce().catch(() => {});
      await atomicWriteJson(this.filePath, snapshot);
    });
    this.writeQueue = task.catch(() => {});
    return task;
  }

  async revision() {
    await this.ensureReady();
    return { updatedAt: this.state.updatedAt, today: this.todayString() };
  }

  dayStats(date) {
    const dayItems = this.state.items.filter(item => item.scope === 'daily' && item.date === date);
    const completed = dayItems.filter(item => item.completed).length;
    return {
      date,
      total: dayItems.length,
      completed,
      pending: dayItems.length - completed,
      highPending: dayItems.filter(item => !item.completed && item.priority === 'high').length,
      hasNote: Boolean(this.state.dailyNotes[date]),
    };
  }

  buildWeekStrip(centerDate) {
    const days = [];
    for (let offset = -3; offset <= 3; offset++) days.push(this.dayStats(shiftDateString(centerDate, offset)));
    return days;
  }

  buildHistory() {
    const dates = new Set(Object.keys(this.state.dailyNotes));
    for (const item of this.state.items) if (item.scope === 'daily' && item.date) dates.add(item.date);
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, HISTORY_LIMIT)
      .map(date => ({ ...this.dayStats(date), note: this.state.dailyNotes[date] || '' }));
  }

  matches(item, query) {
    if (!query) return true;
    return [item.title, item.note, item.category, item.date].join('\n').toLowerCase().includes(query);
  }

  overdueItems(today) {
    return sortMemoItems(this.state.items.filter(item => item.scope === 'daily' && !item.completed && item.date && item.date < today))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async snapshot(options = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const activeDate = isValidDateString(options.date) ? options.date : today;
    const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';
    const sorted = sortMemoItems(this.state.items);
    const dailyItems = sorted.filter(item => item.scope === 'daily' && item.date === activeDate);
    const evergreenItems = sorted.filter(item => item.scope === 'evergreen');
    const overdueItems = this.overdueItems(today);
    const searchResults = query ? sorted.filter(item => this.matches(item, query)).slice(0, SEARCH_LIMIT) : null;
    return {
      today,
      activeDate,
      query,
      dailyNote: this.state.dailyNotes[activeDate] || '',
      dailyItems,
      evergreenItems,
      overdueItems,
      searchResults,
      weekStrip: this.buildWeekStrip(activeDate),
      history: this.buildHistory(),
      categories: CATEGORIES,
      stats: {
        dailyTotal: dailyItems.length,
        dailyCompleted: dailyItems.filter(item => item.completed).length,
        evergreenTotal: evergreenItems.length,
        evergreenCompleted: evergreenItems.filter(item => item.completed).length,
        overdueCount: overdueItems.length,
        totalItems: this.state.items.length,
      },
      updatedAt: this.state.updatedAt,
    };
  }

  /** AI 工具用的精简查询：按范围、日期、状态、关键词筛选。 */
  async listItems(options = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';
    const status = ['open', 'done', 'all'].includes(options.status) ? options.status : 'all';
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
    let items = this.state.items;
    if (options.scope === 'daily') {
      const date = normalizeDate(options.date, query ? null : today);
      items = items.filter(item => item.scope === 'daily' && (!date || item.date === date));
    } else if (options.scope === 'evergreen') {
      items = items.filter(item => item.scope === 'evergreen');
    } else if (options.scope === 'overdue') {
      items = this.overdueItems(today);
    } else if (options.scope !== 'all' && !query) {
      const date = normalizeDate(options.date, today);
      items = items.filter(item => item.scope === 'evergreen' || item.date === date);
    }
    items = sortMemoItems(items.filter(item => this.matches(item, query)));
    if (status === 'open') items = items.filter(item => !item.completed);
    if (status === 'done') items = items.filter(item => item.completed);
    const date = options.scope === 'daily' || ((!options.scope || options.scope === 'list') && !query) ? normalizeDate(options.date, today) : null;
    return {
      today,
      date,
      dailyNote: date ? this.state.dailyNotes[date] || '' : undefined,
      total: items.length,
      items: items.slice(0, limit),
      overdueCount: this.overdueItems(today).length,
    };
  }

  findIndex(id) {
    if (typeof id !== 'string' || !id) throw new Error('缺少备忘事项 ID。');
    const index = this.state.items.findIndex(entry => entry.id === id);
    if (index === -1) throw new Error('未找到对应的备忘事项，可能已被删除。');
    return index;
  }

  async addItem(input = {}) {
    await this.ensureReady();
    const today = this.todayString();
    const scope = normalizeScope(input.scope);
    const nowIso = this.now().toISOString();
    const completed = Boolean(input.completed);
    const item = {
      id: 'memo-' + randomUUID(),
      scope,
      date: scope === 'daily' ? normalizeDate(input.date, today) : '',
      title: normalizeTitle(input.title),
      note: normalizeNote(input.note),
      priority: normalizePriority(input.priority),
      category: normalizeCategory(input.category),
      pinned: Boolean(input.pinned),
      completed,
      completedAt: completed ? nowIso : null,
      carriedFrom: null,
      source: normalizeSource(input.source),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.state.items.unshift(item);
    this.touch();
    await this.enqueueSave();
    return { item, ...(await this.snapshot({ date: input.activeDate || (scope === 'daily' ? item.date : today) })) };
  }

  async addFromSelection(input = {}) {
    const { title, note } = parseSelectionToMemo(input.text);
    return this.addItem({
      scope: input.scope,
      date: input.date,
      activeDate: input.activeDate,
      title,
      note,
      category: input.category !== undefined ? input.category : SELECTION_CATEGORY,
      priority: input.priority,
      pinned: input.pinned,
      source: { kind: 'selection', ...(input.source && typeof input.source === 'object' ? input.source : {}) },
    });
  }

  async updateItem(id, patch = {}, activeDate) {
    await this.ensureReady();
    const index = this.findIndex(id);
    const current = this.state.items[index];
    const today = this.todayString();
    const nowIso = this.now().toISOString();
    const nextScope = patch.scope !== undefined ? normalizeScope(patch.scope) : current.scope;
    let nextDate = current.date;
    if (nextScope === 'evergreen') nextDate = '';
    else if (patch.date !== undefined && patch.date !== null && patch.date !== '') nextDate = normalizeDate(patch.date, today);
    else if (!isValidDateString(current.date)) nextDate = isValidDateString(activeDate) ? activeDate : today;
    const nextCompleted = patch.completed !== undefined ? Boolean(patch.completed) : current.completed;
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
      completedAt: nextCompleted ? (current.completed ? current.completedAt || nowIso : nowIso) : null,
      updatedAt: nowIso,
    };
    this.state.items[index] = updated;
    this.touch();
    await this.enqueueSave();
    return { item: updated, ...(await this.snapshot({ date: activeDate || (nextScope === 'daily' ? nextDate : today) })) };
  }

  async toggleItem(id, completed, activeDate) {
    await this.ensureReady();
    const current = this.state.items[this.findIndex(id)];
    return this.updateItem(id, { completed: typeof completed === 'boolean' ? completed : !current.completed }, activeDate);
  }

  async deleteItem(id, activeDate) {
    await this.ensureReady();
    const [removed] = this.state.items.splice(this.findIndex(id), 1);
    this.touch();
    await this.enqueueSave();
    return { deletedId: removed.id, deletedItem: removed, ...(await this.snapshot({ date: activeDate })) };
  }

  /** 撤销删除：把客户端暂存的原条目放回，ID 冲突时拒绝。 */
  async restoreItem(raw, activeDate) {
    await this.ensureReady();
    const item = sanitizeStoredItem(raw);
    if (!item) throw new Error('要恢复的备忘事项数据无效。');
    if (this.state.items.some(entry => entry.id === item.id)) throw new Error('该备忘事项已存在，无需恢复。');
    this.state.items.push(item);
    this.touch();
    await this.enqueueSave();
    return { item, ...(await this.snapshot({ date: activeDate })) };
  }

  async clearCompleted(options = {}) {
    await this.ensureReady();
    const scope = ['daily', 'evergreen', 'all'].includes(options.scope) ? options.scope : 'daily';
    const targetDate = isValidDateString(options.date) ? options.date : this.todayString();
    const before = this.state.items.length;
    this.state.items = this.state.items.filter(item => {
      if (!item.completed) return true;
      if (scope === 'all') return false;
      if (scope === 'evergreen') return item.scope !== 'evergreen';
      return !(item.scope === 'daily' && item.date === targetDate);
    });
    const removedCount = before - this.state.items.length;
    if (removedCount > 0) {
      this.touch();
      await this.enqueueSave();
    }
    return { removedCount, ...(await this.snapshot({ date: options.activeDate || targetDate })) };
  }

  async carryOverOverdue(options = {}) {
    await this.ensureReady();
    const targetDate = isValidDateString(options.targetDate) ? options.targetDate : this.todayString();
    const idSet = Array.isArray(options.ids) && options.ids.length > 0 ? new Set(options.ids) : null;
    const nowIso = this.now().toISOString();
    let movedCount = 0;
    this.state.items = this.state.items.map(item => {
      if (item.scope !== 'daily' || item.completed || !item.date || item.date >= targetDate) return item;
      if (idSet && !idSet.has(item.id)) return item;
      movedCount += 1;
      return { ...item, carriedFrom: item.carriedFrom || item.date, date: targetDate, updatedAt: nowIso };
    });
    if (movedCount > 0) {
      this.touch();
      await this.enqueueSave();
    }
    return { movedCount, ...(await this.snapshot({ date: options.activeDate || targetDate })) };
  }

  async setDailyNote(date, note, activeDate) {
    await this.ensureReady();
    const targetDate = isValidDateString(date) ? date : this.todayString();
    const cleaned = normalizeNote(note);
    if ((this.state.dailyNotes[targetDate] || '') !== cleaned) {
      if (cleaned) this.state.dailyNotes[targetDate] = cleaned;
      else delete this.state.dailyNotes[targetDate];
      this.touch();
      await this.enqueueSave();
    }
    return this.snapshot({ date: activeDate || targetDate });
  }
}
