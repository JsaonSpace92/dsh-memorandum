window.__ModuleLoader__.load({
  id: 'dsh-memorandum',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const PANEL_ID = 'dsh-memorandum';
    const MEMO_SYNC_EVENT = 'dsh-memorandum:sync';

    const PRIORITY_META = {
      high: { label: '重要', tone: 'high' },
      normal: { label: '常规', tone: 'normal' },
      low: { label: '随手', tone: 'low' },
    };

    const DEFAULT_CATEGORIES = ['重要', '研发', '工作', '日常', '灵感', '摘录'];
    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    function parseLocalDate(dateStr) {
      if (!dateStr || typeof dateStr !== 'string') return new Date();
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    }

    function shiftDate(dateStr, offsetDays) {
      const dt = parseLocalDate(dateStr);
      dt.setDate(dt.getDate() + offsetDays);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function formatFullDate(dateStr, todayStr) {
      const dt = parseLocalDate(dateStr);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      const d = dt.getDate();
      const wk = WEEKDAYS[dt.getDay()] || '';
      let suffix = '';
      if (dateStr === todayStr) suffix = ' · 今天';
      else if (dateStr === shiftDate(todayStr, -1)) suffix = ' · 昨天';
      else if (dateStr === shiftDate(todayStr, 1)) suffix = ' · 明天';
      return `${y} 年 ${m} 月 ${d} 日 ${wk}${suffix}`;
    }

    function formatShortDate(dateStr, todayStr) {
      if (!dateStr) return '';
      if (dateStr === todayStr) return '今天';
      if (dateStr === shiftDate(todayStr, -1)) return '昨天';
      if (dateStr === shiftDate(todayStr, 1)) return '明天';
      return dateStr.slice(5);
    }

    function formatTimeHM(isoStr) {
      if (!isoStr) return '';
      try {
        const dt = new Date(isoStr);
        return dt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      } catch {
        return '';
      }
    }

    function splitSelectionText(rawText) {
      const cleaned = String(rawText || '').replace(/\r\n/g, '\n').trim();
      const lines = cleaned
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      const firstLine = (lines[0] || cleaned).replace(/^[#>*\-•\d.)\s]+/, '').trim() || lines[0] || cleaned;
      if (lines.length === 1 && firstLine.length <= 120) {
        return { title: firstLine, note: '' };
      }
      return {
        title: firstLine.length > 96 ? `${firstLine.slice(0, 96)}…` : firstLine,
        note: cleaned.length > 3900 ? `${cleaned.slice(0, 3900)}…` : cleaned,
      };
    }

    const css = `
.mm-root {
  height: 100%;
  overflow: auto;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  box-sizing: border-box;
}
.mm-wrap {
  max-width: 1120px;
  margin: 0 auto;
  padding: 32px 36px 48px;
}
.mm-header {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 24px;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.mm-header-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}
.mm-eyebrow-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mm-eyebrow {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--dsw-alias-label-secondary);
  text-transform: uppercase;
}
.mm-seal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 999px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.mm-title {
  font-family: Georgia, 'Songti SC', serif;
  font-weight: 500;
  font-size: 28px;
  line-height: 1.28;
  margin: 8px 0 6px;
  color: var(--dsw-alias-label-primary);
}
.mm-subtitle {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
}
.mm-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.mm-stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  min-width: 195px;
}
.mm-stat-meta span {
  display: block;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.mm-stat-meta strong {
  display: block;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 22px;
  font-weight: 500;
  margin-top: 3px;
  line-height: 1.15;
}
.mm-stat-meta small {
  display: block;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  margin-top: 4px;
}
.mm-ring-box {
  position: relative;
  width: 54px;
  height: 54px;
  flex-shrink: 0;
}
.mm-ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.mm-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 20px 0 16px;
  flex-wrap: wrap;
}
.mm-date-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mm-week-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
}
.mm-day-pill {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 54px;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.mm-day-pill:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.mm-day-pill[aria-selected="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-base));
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary);
}
.mm-day-pill-wk {
  font-size: 10px;
  opacity: 0.8;
}
.mm-day-pill-num {
  font-size: 13px;
  font-weight: 600;
}
.mm-day-pill-dots {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 5px;
}
.mm-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
}
.mm-dot-pending {
  background: var(--dsw-alias-brand-primary);
}
.mm-dot-high {
  background: var(--dsw-alias-state-warn-primary);
}
.mm-dot-done {
  background: var(--dsw-alias-state-success-primary);
}
.mm-view-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 4px;
}
.mm-tab-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mm-tab-btn[aria-selected="true"] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
}
.mm-focus-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, var(--dsw-alias-bg-layer-1));
}
.mm-focus-tag {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 4px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-brand-primary);
  white-space: nowrap;
}
.mm-focus-input {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
  min-width: 0;
}
.mm-focus-input::placeholder {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.75;
}
.mm-overdue-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));
  font-size: 12px;
}
.mm-overdue-text strong {
  color: var(--dsw-alias-state-warn-primary);
}
.mm-composer {
  padding: 16px 18px;
  margin-bottom: 20px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  transition: border-color 0.15s;
}
.mm-composer:focus-within {
  border-color: var(--dsw-alias-brand-primary);
}
.mm-composer-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mm-scope-switch {
  display: inline-flex;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 2px;
  flex-shrink: 0;
}
.mm-scope-option {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 5px 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mm-scope-option[aria-pressed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}
.mm-title-input {
  flex: 1;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  min-width: 0;
}
.mm-title-input:focus, .mm-note-input:focus, .mm-search-input:focus, .mm-date-picker:focus {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.mm-note-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  min-height: 54px;
}
.mm-composer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.mm-composer-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mm-meta-label {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.mm-chip {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  padding: 3px 10px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.mm-chip:hover {
  border-color: var(--dsw-alias-label-secondary);
  color: var(--dsw-alias-label-primary);
}
.mm-chip[data-active="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}
.mm-chip[data-tone="high"][data-active="true"] {
  border-color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-state-error-primary);
}
.mm-chip[data-tone="low"][data-active="true"] {
  border-color: var(--dsw-alias-state-idle-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-idle-primary) 12%, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
}
.mm-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 7px 13px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.mm-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.mm-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.mm-btn-primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.mm-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, black);
}
.mm-btn-warn {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, var(--dsw-alias-border-l2));
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-base));
  font-weight: 500;
}
.mm-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 5px 8px;
}
.mm-btn-ghost:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.mm-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr);
  gap: 20px;
  align-items: start;
}
.mm-columns[data-single="true"] {
  grid-template-columns: minmax(0, 1fr);
}
.mm-column {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.mm-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, var(--dsw-alias-bg-layer-1));
}
.mm-col-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.mm-col-title {
  font-family: Georgia, 'Songti SC', serif;
  font-size: 16px;
  font-weight: 500;
  margin: 0;
  color: var(--dsw-alias-label-primary);
}
.mm-col-count {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.mm-col-sub {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  margin-top: 2px;
}
.mm-item-list {
  display: flex;
  flex-direction: column;
}
.mm-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  align-items: flex-start;
  transition: background 0.12s;
}
.mm-item:last-child {
  border-bottom: 0;
}
.mm-item:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 38%, var(--dsw-alias-bg-layer-1));
}
.mm-item[data-completed="true"] .mm-item-title {
  text-decoration: line-through;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.78;
}
.mm-item[data-pinned="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 4%, var(--dsw-alias-bg-layer-1));
}
.mm-check-btn {
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 6px;
  border: 1.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-bg-base);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}
.mm-check-btn:hover {
  border-color: var(--dsw-alias-brand-primary);
}
.mm-check-btn[aria-checked="true"] {
  background: var(--dsw-alias-state-success-primary);
  border-color: var(--dsw-alias-state-success-primary);
}
.mm-item-body {
  min-width: 0;
}
.mm-item-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.mm-item-title {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.mm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.mm-badge[data-tone="high"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1));
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-base));
}
.mm-badge[data-tone="pin"] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1));
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-base));
}
.mm-item-note {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 65%, transparent);
  border-left: 2px solid var(--dsw-alias-border-l2);
  padding: 6px 10px;
  border-radius: 0 6px 6px 0;
}
.mm-item-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  flex-wrap: wrap;
}
.mm-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.72;
  transition: opacity 0.15s;
}
.mm-item:hover .mm-item-actions {
  opacity: 1;
}
.mm-icon-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: 6px;
  padding: 5px 7px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.mm-icon-btn:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.mm-icon-btn-danger:hover {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-base));
}
.mm-empty {
  padding: 40px 22px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.mm-empty strong {
  display: block;
  font-family: Georgia, 'Songti SC', serif;
  font-weight: 400;
  font-size: 17px;
  color: var(--dsw-alias-label-primary);
  margin-bottom: 6px;
}
.mm-empty p {
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}
.mm-search-input {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 6px 11px;
  font: inherit;
  font-size: 12px;
  width: 200px;
}
.mm-date-picker {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 5px 9px;
  font: inherit;
  font-size: 12px;
}
.mm-edit-box {
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mm-alert {
  padding: 11px 15px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  margin-bottom: 14px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.mm-alert-error {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l2));
}
.mm-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
  pointer-events: auto;
}
.mm-ctx-menu {
  position: fixed;
  z-index: 9999;
  width: 268px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 14px 42px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  font-family: inherit;
  user-select: none;
  pointer-events: auto;
}
.mm-ctx-head {
  padding: 6px 10px 7px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  margin-bottom: 4px;
}
.mm-ctx-eyebrow {
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mm-ctx-snippet {
  font-size: 11.5px;
  color: var(--dsw-alias-label-primary);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.9;
}
.mm-ctx-item {
  appearance: none;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: background 0.12s, color 0.12s;
}
.mm-ctx-item:hover, .mm-ctx-item[data-expanded="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-brand-primary);
  font-weight: 500;
}
.mm-ctx-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mm-ctx-sublist {
  margin: 4px 0 2px;
  padding: 4px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mm-ctx-subitem {
  appearance: none;
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border-radius: 7px;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.12s, border-color 0.12s;
}
.mm-ctx-subitem:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-base));
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1));
}
.mm-ctx-subitem strong {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.mm-ctx-subitem span {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.mm-ctx-divider {
  height: 1px;
  background: var(--dsw-alias-border-l1);
  margin: 4px 2px;
}
.mm-toast {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 12px 34px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
  font-size: 12.5px;
  max-width: 420px;
  pointer-events: auto;
}
.mm-toast-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-primary);
  flex-shrink: 0;
}
.mm-toast-error .mm-toast-dot {
  background: var(--dsw-alias-state-error-primary);
}
.mm-toast-link {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-brand-primary);
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
@media (max-width: 860px) {
  .mm-wrap { padding: 20px 16px 36px; }
  .mm-header { flex-direction: column; }
  .mm-columns { grid-template-columns: minmax(0, 1fr); }
  .mm-week-strip { display: none; }
  .mm-composer-top { flex-direction: column; align-items: stretch; }
}
`;

    function Icon({ size = 20 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 5, y: 4, width: 14, height: 17, rx: 2.5 }),
        h('path', { d: 'M9 2.5v3M15 2.5v3' }),
        h('path', { d: 'M8.5 10.5l1.8 1.8 3.2-3.3' }),
        h('path', { d: 'M8.5 15h7M8.5 18h4.5' }),
      );
    }

    async function fetchSnapshot({ date, query, signal } = {}) {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (query) params.set('query', query);
      const qs = params.toString();
      const response = await fetch(`/memorandum/v1${qs ? `?${qs}` : ''}`, {
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'x-dsh-memorandum-panel': '1' },
      });
      const value = await response.json();
      if (!response.ok || value.error) {
        throw new Error(value.error || '读取备忘录数据失败。');
      }
      return value;
    }

    async function postAction(payload, nonce, onRefreshNonce) {
      let currentNonce = nonce;
      if (!currentNonce) {
        const initial = await fetchSnapshot({ date: payload.activeDate || payload.date });
        currentNonce = initial.nonce;
        if (onRefreshNonce) onRefreshNonce(initial);
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('/memorandum/v1/action', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-dsh-memorandum': currentNonce || '',
          },
          body: JSON.stringify(payload),
        });
        const value = await response.json();
        if (response.status === 409 && value.code === 'PANEL_EXPIRED' && attempt === 0) {
          const latest = await fetchSnapshot({ date: payload.activeDate || payload.date });
          currentNonce = latest.nonce;
          if (onRefreshNonce) onRefreshNonce(latest);
          continue;
        }
        if (!response.ok || value.error) {
          throw new Error(value.error || '执行备忘录操作失败。');
        }
        return value;
      }
    }

    async function addSelectionToMemorandum(rawText, scope) {
      const { title, note } = splitSelectionText(rawText);
      const result = await postAction({
        action: 'add',
        scope,
        title,
        note,
        category: '摘录',
        priority: 'normal',
      });
      window.dispatchEvent(new CustomEvent(MEMO_SYNC_EVENT, { detail: result }));
      return result;
    }

    function getSelectedTextFromPage() {
      try {
        const selection = window.getSelection?.();
        const text = selection ? String(selection.toString() || '').trim() : '';
        if (text) return text;
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text')) &&
          typeof active.selectionStart === 'number' &&
          typeof active.selectionEnd === 'number' &&
          active.selectionEnd > active.selectionStart
        ) {
          return String(active.value || '').slice(active.selectionStart, active.selectionEnd).trim();
        }
      } catch {}
      return '';
    }

    function createSelectionOverlay(clientCtx) {
      return function SelectionContextMenuOverlay() {
        const [menu, setMenu] = React.useState(null);
        const [toast, setToast] = React.useState(null);
        const [submitting, setSubmitting] = React.useState(false);

        React.useEffect(() => {
          function onContextMenu(event) {
            if (event.shiftKey) return;
            const target = event.target;
            if (target instanceof Element && target.closest('.mm-ctx-menu')) return;
            const selectedText = getSelectedTextFromPage();
            if (!selectedText) {
              setMenu(null);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            const menuWidth = 276;
            const menuHeight = 230;
            const x = Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth - 12));
            const y = Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight - 12));
            setMenu({
              x,
              y,
              text: selectedText,
              expanded: false,
            });
          }

          function onKeyDown(event) {
            if (event.key === 'Escape') {
              setMenu(null);
            }
          }

          function onScrollOrBlur() {
            setMenu(prev => (prev ? null : prev));
          }

          window.addEventListener('contextmenu', onContextMenu, true);
          window.addEventListener('keydown', onKeyDown, true);
          window.addEventListener('blur', onScrollOrBlur);
          return () => {
            window.removeEventListener('contextmenu', onContextMenu, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('blur', onScrollOrBlur);
          };
        }, []);

        React.useEffect(() => {
          if (!toast) return undefined;
          const timer = setTimeout(() => setToast(null), 4200);
          return () => clearTimeout(timer);
        }, [toast]);

        async function handleSelectScope(scope) {
          if (!menu?.text || submitting) return;
          setSubmitting(true);
          const textToSave = menu.text;
          const scopeLabel = scope === 'daily' ? '1. 当日清单' : '2. 全取清单';
          setMenu(null);
          try {
            const res = await addSelectionToMemorandum(textToSave, scope);
            const savedTitle = res?.item?.title || textToSave.slice(0, 28);
            setToast({
              error: false,
              text: `已加入「${scopeLabel}」：${savedTitle.slice(0, 30)}${savedTitle.length > 30 ? '…' : ''}`,
            });
          } catch (err) {
            setToast({
              error: true,
              text: err.message || '添加备忘录失败，请重试。',
            });
          } finally {
            setSubmitting(false);
          }
        }

        async function handleCopyText() {
          if (!menu?.text) return;
          const textToCopy = menu.text;
          setMenu(null);
          try {
            await navigator.clipboard?.writeText?.(textToCopy);
            setToast({ error: false, text: '已复制选中文本。' });
          } catch {}
        }

        function openMemoPanel() {
          setToast(null);
          try {
            clientCtx?.layout?.selectPanel?.(PANEL_ID);
          } catch {}
        }

        if (!menu && !toast) return null;

        return h(
          React.Fragment,
          null,
          h('style', null, css),
          menu &&
            h(
              React.Fragment,
              null,
              h('div', {
                className: 'mm-ctx-backdrop',
                onMouseDown: () => setMenu(null),
                onContextMenu: e => {
                  e.preventDefault();
                  setMenu(null);
                },
              }),
              h(
                'div',
                {
                  className: 'mm-ctx-menu',
                  role: 'menu',
                  'aria-label': '选中文本快捷菜单',
                  style: { left: `${menu.x}px`, top: `${menu.y}px` },
                },
                h(
                  'div',
                  { className: 'mm-ctx-head' },
                  h(
                    'div',
                    { className: 'mm-ctx-eyebrow' },
                    h('span', null, `已选中 ${menu.text.length} 字`),
                    h('span', null, 'DSH 备忘录'),
                  ),
                  h('div', { className: 'mm-ctx-snippet' }, menu.text.replace(/\s+/g, ' ')),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    className: 'mm-ctx-item',
                    'data-expanded': String(Boolean(menu.expanded)),
                    onClick: () => setMenu(prev => (prev ? { ...prev, expanded: !prev.expanded } : null)),
                  },
                  h(
                    'span',
                    { className: 'mm-ctx-item-left' },
                    h(Icon, { size: 15 }),
                    h('span', null, '添加备忘录'),
                  ),
                  h('span', null, menu.expanded ? '▾' : '▸'),
                ),
                menu.expanded &&
                  h(
                    'div',
                    { className: 'mm-ctx-sublist', role: 'group', 'aria-label': '选择备忘录清单' },
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'menuitem',
                        className: 'mm-ctx-subitem',
                        onClick: () => handleSelectScope('daily'),
                      },
                      h('strong', null, '1. 当日清单'),
                      h('span', null, '记入今日重要事件，可按日检视与顺延'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'menuitem',
                        className: 'mm-ctx-subitem',
                        onClick: () => handleSelectScope('evergreen'),
                      },
                      h('strong', null, '2. 全取清单'),
                      h('span', null, '记入全局常驻备忘，跨日期长期保留'),
                    ),
                  ),
                h('div', { className: 'mm-ctx-divider' }),
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitem',
                    className: 'mm-ctx-item',
                    onClick: handleCopyText,
                  },
                  h('span', { className: 'mm-ctx-item-left' }, h('span', null, '复制选中文本')),
                  h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, '⌘C'),
                ),
              ),
            ),
          toast &&
            h(
              'div',
              {
                className: `mm-toast ${toast.error ? 'mm-toast-error' : ''}`,
                role: 'status',
              },
              h('span', { className: 'mm-toast-dot' }),
              h('span', { style: { flex: 1 } }, toast.text),
              !toast.error &&
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-toast-link',
                    onClick: openMemoPanel,
                  },
                  '打开备忘录 →',
                ),
            ),
        );
      };
    }

    function ProgressRing({ completed = 0, total = 0 }) {
      const radius = 21;
      const circumference = 2 * Math.PI * radius;
      const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
      const offset = circumference * (1 - ratio);
      return h(
        'div',
        { className: 'mm-ring-box', title: `当日完成进度：${completed} / ${total}` },
        h(
          'svg',
          { width: 54, height: 54, viewBox: '0 0 54 54', 'aria-hidden': true },
          h('circle', {
            cx: 27,
            cy: 27,
            r: radius,
            fill: 'none',
            stroke: 'var(--dsw-alias-border-l1)',
            strokeWidth: 4,
          }),
          total > 0 &&
            h('circle', {
              cx: 27,
              cy: 27,
              r: radius,
              fill: 'none',
              stroke: ratio === 1 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-brand-primary)',
              strokeWidth: 4,
              strokeLinecap: 'round',
              strokeDasharray: `${circumference} ${circumference}`,
              strokeDashoffset: offset,
              transform: 'rotate(-90 27 27)',
            }),
        ),
        h('span', { className: 'mm-ring-label' }, total > 0 ? `${Math.round(ratio * 100)}%` : '—'),
      );
    }

    function Panel() {
      const [data, setData] = React.useState(null);
      const [activeDate, setActiveDate] = React.useState('');
      const [viewMode, setViewMode] = React.useState('split');
      const [filterState, setFilterState] = React.useState('all');
      const [query, setQuery] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [expandedNotes, setExpandedNotes] = React.useState({});

      const [draftScope, setDraftScope] = React.useState('daily');
      const [draftTitle, setDraftTitle] = React.useState('');
      const [draftNote, setDraftNote] = React.useState('');
      const [draftPriority, setDraftPriority] = React.useState('normal');
      const [draftCategory, setDraftCategory] = React.useState('');
      const [draftPinned, setDraftPinned] = React.useState(false);
      const [showNoteInput, setShowNoteInput] = React.useState(false);

      const [focusDraft, setFocusDraft] = React.useState('');

      const [editingId, setEditingId] = React.useState(null);
      const [editTitle, setEditTitle] = React.useState('');
      const [editNote, setEditNote] = React.useState('');
      const [editPriority, setEditPriority] = React.useState('normal');
      const [editCategory, setEditCategory] = React.useState('');
      const [editScope, setEditScope] = React.useState('daily');

      const loadDate = React.useCallback(async (targetDate, signal) => {
        setBusy(true);
        setError('');
        try {
          const snapshot = await fetchSnapshot({ date: targetDate, signal });
          setData(snapshot);
          setActiveDate(snapshot.activeDate);
          setFocusDraft(snapshot.dailyNote || '');
        } catch (err) {
          if (err.name !== 'AbortError') setError(err.message);
        } finally {
          setBusy(false);
        }
      }, []);

      React.useEffect(() => {
        const controller = new AbortController();
        loadDate(undefined, controller.signal);
        return () => controller.abort();
      }, [loadDate]);

      React.useEffect(() => {
        function onExternalSync(event) {
          if (event?.detail && event.detail.items) {
            setData(event.detail);
            setActiveDate(event.detail.activeDate);
            setFocusDraft(event.detail.dailyNote || '');
          } else {
            void loadDate(activeDate || undefined);
          }
        }
        window.addEventListener(MEMO_SYNC_EVENT, onExternalSync);
        return () => window.removeEventListener(MEMO_SYNC_EVENT, onExternalSync);
      }, [activeDate, loadDate]);

      async function runAction(payload) {
        setBusy(true);
        setError('');
        try {
          const result = await postAction(
            { ...payload, activeDate: payload.activeDate || activeDate || data?.today },
            data?.nonce,
            latest => {
              setData(latest);
              setActiveDate(latest.activeDate);
              setFocusDraft(latest.dailyNote || '');
            },
          );
          if (result) {
            setData(result);
            setActiveDate(result.activeDate);
            setFocusDraft(result.dailyNote || '');
          }
          return result;
        } catch (err) {
          setError(err.message);
          return null;
        } finally {
          setBusy(false);
        }
      }

      function selectDate(nextDate) {
        if (!nextDate) return;
        setActiveDate(nextDate);
        void loadDate(nextDate);
      }

      async function handleAddSubmit(event) {
        if (event) event.preventDefault();
        const trimmed = draftTitle.trim();
        if (!trimmed || busy) return;
        const result = await runAction({
          action: 'add',
          scope: draftScope,
          date: activeDate || data?.today,
          activeDate: activeDate || data?.today,
          title: trimmed,
          note: draftNote,
          priority: draftPriority,
          category: draftCategory,
          pinned: draftPinned,
        });
        if (result) {
          setDraftTitle('');
          setDraftNote('');
          setDraftPinned(false);
          if (draftPriority === 'high') setDraftPriority('normal');
        }
      }

      async function handleFocusCommit() {
        if (!data) return;
        const currentSaved = data.dailyNote || '';
        if (focusDraft.trim() === currentSaved.trim()) return;
        await runAction({
          action: 'set-daily-note',
          date: activeDate || data.today,
          note: focusDraft,
        });
      }

      function startEdit(item) {
        setEditingId(item.id);
        setEditTitle(item.title);
        setEditNote(item.note || '');
        setEditPriority(item.priority || 'normal');
        setEditCategory(item.category || '');
        setEditScope(item.scope || 'daily');
      }

      async function saveEdit(item) {
        if (!editTitle.trim()) return;
        const result = await runAction({
          action: 'update',
          id: item.id,
          patch: {
            title: editTitle.trim(),
            note: editNote,
            priority: editPriority,
            category: editCategory,
            scope: editScope,
            date: editScope === 'daily' ? item.date || activeDate || data?.today : '',
          },
        });
        if (result) setEditingId(null);
      }

      const today = data?.today || '';
      const currentDate = activeDate || today;
      const stats = data?.stats || {
        dailyTotal: 0,
        dailyCompleted: 0,
        dailyPending: 0,
        evergreenTotal: 0,
        evergreenCompleted: 0,
        evergreenPending: 0,
        overdueCount: 0,
      };

      const filterFn = item => {
        if (filterState === 'pending' && item.completed) return false;
        if (filterState === 'completed' && !item.completed) return false;
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return `${item.title}\n${item.note || ''}\n${item.category || ''}\n${item.date || ''}`
          .toLowerCase()
          .includes(q);
      };

      const dailyList = (data?.dailyItems || []).filter(filterFn);
      const evergreenList = (data?.evergreenItems || []).filter(filterFn);
      const overdueList = data?.overdueItems || [];

      function renderItemRow(item, showDateBadge = false) {
        const isEditing = editingId === item.id;
        const pri = PRIORITY_META[item.priority] || PRIORITY_META.normal;
        const noteText = item.note || '';
        const isLongNote = noteText.length > 180 || noteText.split('\n').length > 4;
        const isNoteExpanded = Boolean(expandedNotes[item.id]);
        const displayedNote =
          isLongNote && !isNoteExpanded ? `${noteText.slice(0, 180).trim()}…` : noteText;

        return h(
          'div',
          {
            key: item.id,
            className: 'mm-item',
            'data-completed': String(Boolean(item.completed)),
            'data-pinned': String(Boolean(item.pinned)),
          },
          h(
            'button',
            {
              type: 'button',
              className: 'mm-check-btn',
              role: 'checkbox',
              'aria-checked': String(Boolean(item.completed)),
              'aria-label': item.completed ? `标记为未完成：${item.title}` : `标记为已完成：${item.title}`,
              disabled: busy,
              onClick: () => runAction({ action: 'toggle', id: item.id, completed: !item.completed }),
            },
            item.completed ? '✓' : '',
          ),
          h(
            'div',
            { className: 'mm-item-body' },
            h(
              'div',
              { className: 'mm-item-title-row' },
              item.pinned && h('span', { className: 'mm-badge', 'data-tone': 'pin' }, '★ 置顶'),
              item.priority === 'high' && h('span', { className: 'mm-badge', 'data-tone': 'high' }, '重要'),
              item.priority === 'low' && h('span', { className: 'mm-badge' }, '随手'),
              item.category && h('span', { className: 'mm-badge' }, item.category),
              showDateBadge &&
                item.date &&
                h('span', { className: 'mm-badge' }, formatShortDate(item.date, today)),
              h('span', { className: 'mm-item-title' }, item.title),
            ),
            noteText &&
              !isEditing &&
              h(
                'div',
                { className: 'mm-item-note' },
                displayedNote,
                isLongNote &&
                  h(
                    'div',
                    { style: { marginTop: '6px' } },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-icon-btn',
                        style: { padding: '2px 6px', color: 'var(--dsw-alias-brand-primary)' },
                        onClick: () =>
                          setExpandedNotes(prev => ({ ...prev, [item.id]: !prev[item.id] })),
                      },
                      isNoteExpanded ? '收起全文 ▲' : '展开全文 ▼',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-icon-btn',
                        style: { padding: '2px 6px' },
                        onClick: () => navigator.clipboard?.writeText?.(noteText),
                      },
                      '复制全文',
                    ),
                  ),
              ),
            h(
              'div',
              { className: 'mm-item-meta' },
              h(
                'span',
                null,
                item.scope === 'evergreen'
                  ? '全取清单 · 全局常驻'
                  : `当日清单 · ${item.date || currentDate}`,
              ),
              item.carriedFrom && h('span', null, `顺延自 ${item.carriedFrom}`),
              item.completed && item.completedAt
                ? h('span', null, `完成于 ${formatTimeHM(item.completedAt)}`)
                : h('span', null, `记录于 ${formatTimeHM(item.createdAt)}`),
              pri && item.priority === 'normal' && h('span', null, '常规优先级'),
            ),
            isEditing &&
              h(
                'div',
                { className: 'mm-edit-box' },
                h('input', {
                  type: 'text',
                  className: 'mm-title-input',
                  value: editTitle,
                  onChange: e => setEditTitle(e.target.value),
                  placeholder: '事项标题',
                }),
                h('textarea', {
                  className: 'mm-note-input',
                  value: editNote,
                  onChange: e => setEditNote(e.target.value),
                  placeholder: '补充详情或备注（可选）',
                }),
                h(
                  'div',
                  { className: 'mm-composer-bottom' },
                  h(
                    'div',
                    { className: 'mm-composer-meta' },
                    ['high', 'normal', 'low'].map(p =>
                      h(
                        'button',
                        {
                          key: p,
                          type: 'button',
                          className: 'mm-chip',
                          'data-tone': p,
                          'data-active': String(editPriority === p),
                          onClick: () => setEditPriority(p),
                        },
                        PRIORITY_META[p].label,
                      ),
                    ),
                    DEFAULT_CATEGORIES.map(cat =>
                      h(
                        'button',
                        {
                          key: cat,
                          type: 'button',
                          className: 'mm-chip',
                          'data-active': String(editCategory === cat),
                          onClick: () => setEditCategory(editCategory === cat ? '' : cat),
                        },
                        cat,
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-chip',
                        'data-active': String(editScope === 'evergreen'),
                        onClick: () => setEditScope(editScope === 'daily' ? 'evergreen' : 'daily'),
                      },
                      editScope === 'evergreen' ? '全取清单（全局常驻）' : '转为全取清单',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'mm-composer-meta' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-btn',
                        onClick: () => setEditingId(null),
                      },
                      '取消',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-btn mm-btn-primary',
                        onClick: () => saveEdit(item),
                      },
                      '保存修改',
                    ),
                  ),
                ),
              ),
          ),
          h(
            'div',
            { className: 'mm-item-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'mm-icon-btn',
                title: item.pinned ? '取消置顶' : '置顶事项',
                onClick: () => runAction({ action: 'update', id: item.id, patch: { pinned: !item.pinned } }),
              },
              item.pinned ? '★' : '☆',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mm-icon-btn',
                title: '编辑事项',
                onClick: () => (isEditing ? setEditingId(null) : startEdit(item)),
              },
              '编辑',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mm-icon-btn mm-icon-btn-danger',
                title: '删除事项',
                onClick: () => runAction({ action: 'delete', id: item.id }),
              },
              '删除',
            ),
          ),
        );
      }

      function renderDailyColumn() {
        const completedCount = dailyList.filter(i => i.completed).length;
        return h(
          'section',
          { className: 'mm-column', 'aria-label': '当日清单' },
          h(
            'div',
            { className: 'mm-col-head' },
            h(
              'div',
              null,
              h(
                'div',
                { className: 'mm-col-title-wrap' },
                h('h2', { className: 'mm-col-title' }, '当日清单 · 每日重要事件'),
                h('span', { className: 'mm-col-count' }, `${stats.dailyCompleted} / ${stats.dailyTotal}`),
              ),
              h('div', { className: 'mm-col-sub' }, formatFullDate(currentDate, today)),
            ),
            completedCount > 0 &&
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn mm-btn-ghost',
                  disabled: busy,
                  onClick: () => runAction({ action: 'clear-completed', scope: 'daily', date: currentDate }),
                },
                '清理已完成',
              ),
          ),
          dailyList.length === 0
            ? h(
                'div',
                { className: 'mm-empty' },
                h('strong', null, currentDate === today ? '今日尚无待办事件' : '该日无备忘记录'),
                h(
                  'p',
                  null,
                  '可在上方直接录入，或在对话中选中文字后右击「添加备忘录 → 1. 当日清单」。',
                ),
              )
            : h('div', { className: 'mm-item-list' }, dailyList.map(item => renderItemRow(item, false))),
        );
      }

      function renderEvergreenColumn() {
        const completedCount = evergreenList.filter(i => i.completed).length;
        return h(
          'section',
          { className: 'mm-column', 'aria-label': '全取清单（全局常驻）' },
          h(
            'div',
            { className: 'mm-col-head' },
            h(
              'div',
              null,
              h(
                'div',
                { className: 'mm-col-title-wrap' },
                h('h2', { className: 'mm-col-title' }, '全取清单 · 常驻备忘'),
                h(
                  'span',
                  { className: 'mm-col-count' },
                  `${stats.evergreenPending} 待办 · 共 ${stats.evergreenTotal}`,
                ),
              ),
              h('div', { className: 'mm-col-sub' }, '不随日期切换消失的全局清单、关键约定与长期备忘'),
            ),
            completedCount > 0 &&
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn mm-btn-ghost',
                  disabled: busy,
                  onClick: () => runAction({ action: 'clear-completed', scope: 'evergreen' }),
                },
                '清理已完成',
              ),
          ),
          evergreenList.length === 0
            ? h(
                'div',
                { className: 'mm-empty' },
                h('strong', null, '全取清单为空'),
                h(
                  'p',
                  null,
                  '可在上方切换至「全取清单」添加，或在对话中选中文字后右击「添加备忘录 → 2. 全取清单」。',
                ),
              )
            : h('div', { className: 'mm-item-list' }, evergreenList.map(item => renderItemRow(item, false))),
        );
      }

      function renderHistoryView() {
        const allDaily = (data?.items || []).filter(i => i.scope === 'daily' && filterFn(i));
        return h(
          'section',
          { className: 'mm-column', 'aria-label': '全部历史每日记录' },
          h(
            'div',
            { className: 'mm-col-head' },
            h(
              'div',
              null,
              h(
                'div',
                { className: 'mm-col-title-wrap' },
                h('h2', { className: 'mm-col-title' }, '时间轴 · 历史每日记录总览'),
                h('span', { className: 'mm-col-count' }, `${allDaily.length} 条记录`),
              ),
              h('div', { className: 'mm-col-sub' }, '按时间倒序汇总所有日期的重要事件记录'),
            ),
          ),
          allDaily.length === 0
            ? h(
                'div',
                { className: 'mm-empty' },
                h('strong', null, '暂无匹配的每日记录'),
                h('p', null, '切换筛选条件或添加新的每日事项。'),
              )
            : h('div', { className: 'mm-item-list' }, allDaily.map(item => renderItemRow(item, true))),
        );
      }

      return h(
        'section',
        { className: 'mm-root', 'aria-label': '备忘录' },
        h('style', null, css),
        h(
          'div',
          { className: 'mm-wrap' },
          h(
            'header',
            { className: 'mm-header' },
            h(
              'div',
              { className: 'mm-header-left' },
              h(
                'div',
                { className: 'mm-eyebrow-row' },
                h('span', { className: 'mm-eyebrow' }, `DSH · 备忘录 · ${data?.version || '0.2.0'}`),
                h('span', { className: 'mm-seal' }, '✓ 支持对话选中文字右击添加备忘录'),
              ),
              h('h1', { className: 'mm-title' }, '每日要事与全取备忘'),
              h(
                'p',
                { className: 'mm-subtitle' },
                '记录当天重要事件（1. 当日清单）与跨周期保留事项（2. 全取清单），在对话中选中任意文字右击即可一键入库。',
              ),
            ),
            h(
              'div',
              { className: 'mm-header-right' },
              h(
                'div',
                { className: 'mm-stat-card' },
                h(ProgressRing, { completed: stats.dailyCompleted, total: stats.dailyTotal }),
                h(
                  'div',
                  { className: 'mm-stat-meta' },
                  h('span', null, currentDate === today ? '今日事项进度' : '当日事项进度'),
                  h('strong', null, `${stats.dailyCompleted} / ${stats.dailyTotal}`),
                  h(
                    'small',
                    null,
                    stats.dailyPending > 0 ? `剩余 ${stats.dailyPending} 项未完成` : '当日事项已全部清零',
                  ),
                ),
              ),
              h(
                'div',
                { className: 'mm-stat-card' },
                h(
                  'div',
                  { className: 'mm-stat-meta' },
                  h('span', null, '全取清单（全局常驻）'),
                  h('strong', null, `${stats.evergreenPending} 待办`),
                  h('small', null, `已完成 ${stats.evergreenCompleted} / 共 ${stats.evergreenTotal} 项`),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'mm-nav-bar' },
            h(
              'div',
              { className: 'mm-date-controls' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn',
                  onClick: () => selectDate(shiftDate(currentDate, -1)),
                  title: '前一天',
                },
                '← 前一日',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn',
                  disabled: currentDate === today,
                  onClick: () => selectDate(today),
                },
                '回到今天',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn',
                  onClick: () => selectDate(shiftDate(currentDate, 1)),
                  title: '后一天',
                },
                '后一日 →',
              ),
              h('input', {
                type: 'date',
                className: 'mm-date-picker',
                value: currentDate,
                'aria-label': '选择日期',
                onChange: e => selectDate(e.target.value),
              }),
              h(
                'div',
                { className: 'mm-week-strip', role: 'tablist', 'aria-label': '周视图切换' },
                (data?.weekStrip || []).map(day => {
                  const dt = parseLocalDate(day.date);
                  const wk = WEEKDAYS[dt.getDay()] || '';
                  const dayNum = day.date.slice(8);
                  return h(
                    'button',
                    {
                      key: day.date,
                      type: 'button',
                      role: 'tab',
                      className: 'mm-day-pill',
                      'aria-selected': String(day.date === currentDate),
                      onClick: () => selectDate(day.date),
                    },
                    h('span', { className: 'mm-day-pill-wk' }, day.date === today ? '今天' : wk),
                    h('span', { className: 'mm-day-pill-num' }, dayNum),
                    h(
                      'span',
                      { className: 'mm-day-pill-dots' },
                      day.highPending > 0 && h('span', { className: 'mm-dot mm-dot-high' }),
                      day.pending > 0 &&
                        day.highPending === 0 &&
                        h('span', { className: 'mm-dot mm-dot-pending' }),
                      day.total > 0 && day.pending === 0 && h('span', { className: 'mm-dot mm-dot-done' }),
                    ),
                  );
                }),
              ),
            ),
            h(
              'div',
              { className: 'mm-date-controls' },
              h('input', {
                type: 'search',
                className: 'mm-search-input',
                placeholder: '搜索标题、全文或分类…',
                value: query,
                onChange: e => setQuery(e.target.value),
              }),
              h(
                'div',
                { className: 'mm-view-tabs', role: 'tablist', 'aria-label': '视图模式' },
                [
                  ['split', '双栏视图'],
                  ['daily', '当日清单'],
                  ['evergreen', '全取清单'],
                  ['history', '历史时间轴'],
                ].map(([key, label]) =>
                  h(
                    'button',
                    {
                      key,
                      type: 'button',
                      role: 'tab',
                      className: 'mm-tab-btn',
                      'aria-selected': String(viewMode === key),
                      onClick: () => setViewMode(key),
                    },
                    label,
                  ),
                ),
              ),
            ),
          ),
          error &&
            h(
              'div',
              { className: 'mm-alert mm-alert-error', role: 'alert' },
              h('span', null, error),
              h('button', { type: 'button', className: 'mm-btn', onClick: () => setError('') }, '关闭'),
            ),
          overdueList.length > 0 &&
            h(
              'div',
              { className: 'mm-overdue-banner' },
              h(
                'div',
                { className: 'mm-overdue-text' },
                h('strong', null, `发现 ${overdueList.length} 项往日未完成事件`),
                h(
                  'span',
                  null,
                  `（最近来自 ${overdueList[0].date}：${overdueList[0].title}）—— 可一键顺延至今日继续跟进。`,
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mm-btn mm-btn-warn',
                  disabled: busy,
                  onClick: () => runAction({ action: 'carry-over', targetDate: today }),
                },
                `顺延全部 ${overdueList.length} 项到今天`,
              ),
            ),
          h(
            'div',
            { className: 'mm-focus-banner' },
            h(
              'span',
              { className: 'mm-focus-tag' },
              `当日焦点 · ${formatShortDate(currentDate, today) || currentDate}`,
            ),
            h('input', {
              type: 'text',
              className: 'mm-focus-input',
              value: focusDraft,
              onChange: e => setFocusDraft(e.target.value),
              onBlur: handleFocusCommit,
              onKeyDown: e => {
                if (e.key === 'Enter') e.currentTarget.blur();
              },
              placeholder: '写下今天最重要的一句话目标或核心交付物（回车或失焦自动保存）…',
            }),
          ),
          h(
            'form',
            { className: 'mm-composer', onSubmit: handleAddSubmit },
            h(
              'div',
              { className: 'mm-composer-top' },
              h(
                'div',
                { className: 'mm-scope-switch', role: 'group', 'aria-label': '新建事项类型' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-scope-option',
                    'aria-pressed': String(draftScope === 'daily'),
                    onClick: () => setDraftScope('daily'),
                  },
                  `1. 当日清单 (${formatShortDate(currentDate, today) || currentDate})`,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-scope-option',
                    'aria-pressed': String(draftScope === 'evergreen'),
                    onClick: () => setDraftScope('evergreen'),
                  },
                  '2. 全取清单 (全局常驻)',
                ),
              ),
              h('input', {
                type: 'text',
                className: 'mm-title-input',
                value: draftTitle,
                onChange: e => setDraftTitle(e.target.value),
                placeholder:
                  draftScope === 'daily'
                    ? '添加当日重要事件（按 Enter 立即添加）…'
                    : '添加长期保留的全取备忘事项（按 Enter 立即添加）…',
              }),
              h(
                'button',
                {
                  type: 'submit',
                  className: 'mm-btn mm-btn-primary',
                  disabled: busy || !draftTitle.trim(),
                },
                '+ 添加事项',
              ),
            ),
            (showNoteInput || draftNote) &&
              h('textarea', {
                className: 'mm-note-input',
                value: draftNote,
                onChange: e => setDraftNote(e.target.value),
                placeholder: '补充详细说明、上下文链接或核对清单…',
              }),
            h(
              'div',
              { className: 'mm-composer-bottom' },
              h(
                'div',
                { className: 'mm-composer-meta' },
                h('span', { className: 'mm-meta-label' }, '重要度：'),
                ['high', 'normal', 'low'].map(p =>
                  h(
                    'button',
                    {
                      key: p,
                      type: 'button',
                      className: 'mm-chip',
                      'data-tone': p,
                      'data-active': String(draftPriority === p),
                      onClick: () => setDraftPriority(p),
                    },
                    PRIORITY_META[p].label,
                  ),
                ),
                h('span', { className: 'mm-meta-label', style: { marginLeft: '6px' } }, '分类：'),
                DEFAULT_CATEGORIES.map(cat =>
                  h(
                    'button',
                    {
                      key: cat,
                      type: 'button',
                      className: 'mm-chip',
                      'data-active': String(draftCategory === cat),
                      onClick: () => setDraftCategory(draftCategory === cat ? '' : cat),
                    },
                    cat,
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-chip',
                    'data-active': String(draftPinned),
                    onClick: () => setDraftPinned(!draftPinned),
                  },
                  draftPinned ? '★ 已置顶' : '☆ 置顶',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mm-chip',
                    'data-active': String(showNoteInput || Boolean(draftNote)),
                    onClick: () => setShowNoteInput(!showNoteInput),
                  },
                  showNoteInput ? '收起备注' : '+ 补充备注',
                ),
              ),
              h(
                'div',
                { className: 'mm-composer-meta' },
                h('span', { className: 'mm-meta-label' }, '状态筛选：'),
                [
                  ['all', '全部'],
                  ['pending', '仅未完成'],
                  ['completed', '仅已完成'],
                ].map(([id, label]) =>
                  h(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      className: 'mm-chip',
                      'data-active': String(filterState === id),
                      onClick: () => setFilterState(id),
                    },
                    label,
                  ),
                ),
              ),
            ),
          ),
          viewMode === 'split' &&
            h('div', { className: 'mm-columns' }, renderDailyColumn(), renderEvergreenColumn()),
          viewMode === 'daily' &&
            h('div', { className: 'mm-columns', 'data-single': 'true' }, renderDailyColumn()),
          viewMode === 'evergreen' &&
            h('div', { className: 'mm-columns', 'data-single': 'true' }, renderEvergreenColumn()),
          viewMode === 'history' &&
            h('div', { className: 'mm-columns', 'data-single': 'true' }, renderHistoryView()),
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.locale.register('dsh-memorandum-ui', {
            zh: { title: '备忘录' },
            'zh-CN': { title: '备忘录' },
            en: { title: '备忘录' },
          }),
        );
        const t = ctx.locale.bind('dsh-memorandum-ui');

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 50,
              label: () => t('title') || '备忘录',
            },
            Icon,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
            },
            Panel,
          ),
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-memorandum-selection-menu',
              order: 95,
            },
            createSelectionOverlay(ctx),
          ),
        );
      },
    };
  },
});
