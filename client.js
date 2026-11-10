window.__ModuleLoader__.load({
  id: 'dsh-memorandum',
  factory(require) {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    const PANEL_ID = 'dsh-memorandum';
    const NS = 'dsh-memorandum-ui';
    const ROUTE = '/memorandum/v1';
    const SYNC_EVENT = 'dsh-memorandum:sync';
    const STYLE_ID = 'dsh-memorandum';
    const PREF_SELECTION_MENU = 'dsh-memorandum:selection-menu';
    const POLL_MS = 20000;
    const UNDO_MS = 6000;

    const PRIORITIES = [
      { id: 'high', label: '重要' },
      { id: 'normal', label: '常规' },
      { id: 'low', label: '随手' },
    ];
    const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

    // ───────────────────────── 工具函数 ─────────────────────────

    function parseDate(value) {
      const [y, m, d] = String(value).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    }
    function shiftDate(value, days) {
      const date = parseDate(value);
      date.setDate(date.getDate() + days);
      const pad = n => String(n).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    }
    function dayDiff(from, to) {
      return Math.round((parseDate(to) - parseDate(from)) / 86400000);
    }
    function formatMonthDay(value) {
      const date = parseDate(value);
      return date.getMonth() + 1 + '月' + date.getDate() + '日';
    }
    function formatWeekday(value) {
      return '周' + WEEKDAYS[parseDate(value).getDay()];
    }
    function relativeDayLabel(value, today) {
      const diff = dayDiff(today, value);
      if (diff === 0) return '今天';
      if (diff === -1) return '昨天';
      if (diff === 1) return '明天';
      if (diff === -2) return '前天';
      if (diff === 2) return '后天';
      return diff < 0 ? -diff + ' 天前' : diff + ' 天后';
    }
    function formatTime(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }
    function cx(...names) {
      return names.filter(Boolean).join(' ');
    }
    function readPref(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : raw === '1';
      } catch {
        return fallback;
      }
    }
    function writePref(key, value) {
      try {
        window.localStorage.setItem(key, value ? '1' : '0');
      } catch {}
    }

    /** 解析快速输入：句首或独立的「!」标为重要，「#标签」作为分类。 */
    function parseQuickInput(raw) {
      let text = String(raw || '').trim();
      let priority = 'normal';
      let category = '';
      if (/^!+\s*/.test(text) || /\s!+$/.test(text)) {
        priority = 'high';
        text = text.replace(/^!+\s*/, '').replace(/\s!+$/, '');
      }
      const tag = text.match(/(?:^|\s)#([^\s#]{1,24})(?=\s|$)/);
      if (tag) {
        category = tag[1];
        text = (text.slice(0, tag.index) + ' ' + text.slice(tag.index + tag[0].length)).replace(/\s+/g, ' ');
      }
      return { title: text.trim(), priority, category };
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      }
    }

    // ───────────────────────── 与 Host 通信 ─────────────────────────

    const api = {
      nonce: '',
      async get(params = {}) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value) search.set(key, String(value));
        const qs = search.toString();
        const response = await fetch(ROUTE + (qs ? '?' + qs : ''), {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'x-dsh-memorandum-panel': '1' },
        });
        const value = await response.json().catch(() => ({}));
        if (!response.ok || value.error) throw new Error(value.error || '读取备忘录失败（HTTP ' + response.status + '）。');
        if (value.nonce) api.nonce = value.nonce;
        return value;
      },
      async post(payload) {
        if (!api.nonce) await api.get({ date: payload.activeDate });
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(ROUTE + '/action', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-memorandum': api.nonce },
            body: JSON.stringify(payload),
          });
          const value = await response.json().catch(() => ({}));
          if (response.status === 409 && value.code === 'PANEL_EXPIRED' && attempt === 0) {
            await api.get({ date: payload.activeDate });
            continue;
          }
          if (!response.ok || value.error) throw new Error(value.error || '备忘录操作失败（HTTP ' + response.status + '）。');
          if (value.nonce) api.nonce = value.nonce;
          window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { updatedAt: value.updatedAt } }));
          return value;
        }
        throw new Error('面板会话已失效，请刷新 DSH 页面。');
      },
    };

    // ───────────────────────── 图标 ─────────────────────────

    const ICON_PATHS = {
      memo: ['M7 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M9 2.5v3M15 2.5v3', 'm8.6 10.6 1.8 1.8 3.2-3.3', 'M8.6 15.2h6.8M8.6 18h4.2'],
      chevronLeft: ['m14.5 6-6 6 6 6'],
      chevronRight: ['m9.5 6 6 6-6 6'],
      chevronDown: ['m6 9.5 6 6 6-6'],
      search: ['M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z', 'm16 16 4.5 4.5'],
      plus: ['M12 5v14M5 12h14'],
      pin: ['M9 4h6l-1 6 3 3v1.5H7V13l3-3-1-6Z', 'M12 14.5V20'],
      edit: ['M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4Z', 'm13.5 6.5 4 4'],
      trash: ['M5 7h14', 'M10 4h4', 'M7 7l.8 12a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7', 'M10.5 11v6M13.5 11v6'],
      copy: ['M9 9h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 21H9a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 9 9Z', 'M15.5 9V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h1.5'],
      check: ['m5.5 12.5 4 4 9-9'],
      arrowRight: ['M5 12h14', 'm13 6 6 6-6 6'],
      calendar: ['M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M4 10h16M9 3v4M15 3v4'],
      repeat: ['M17 3l3 3-3 3', 'M4 12v-1a5 5 0 0 1 5-5h11', 'M7 21l-3-3 3-3', 'M20 12v1a5 5 0 0 1-5 5H4'],
      quote: ['M7 8h4v4c0 2.5-1.5 4-4 4.5', 'M14 8h4v4c0 2.5-1.5 4-4 4.5'],
      close: ['m6 6 12 12M18 6 6 18'],
      sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'],
      infinity: ['M7.5 15.5c-2 0-3.5-1.6-3.5-3.5s1.5-3.5 3.5-3.5c3.5 0 5.5 7 9 7 2 0 3.5-1.6 3.5-3.5S18.5 8.5 16.5 8.5c-3.5 0-5.5 7-9 7Z'],
    };
    function Icon({ name, size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        (ICON_PATHS[name] || []).map((d, index) => h('path', { key: index, d })),
      );
    }
    function SidebarIcon() {
      return h(
        'svg',
        { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        ICON_PATHS.memo.map((d, index) => h('path', { key: index, d })),
      );
    }

    const CSS = `
.mm-root{--mm-accent:var(--dsw-alias-state-business-primary);--mm-line:var(--dsw-alias-border-l1);--mm-line-strong:var(--dsw-alias-border-l2);--mm-muted:var(--dsw-alias-label-tertiary);--mm-soft:var(--dsw-alias-interactive-bg-hover);--mm-radius:10px;container-type:inline-size;height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font:var(--dsw-font-s-14);}
.mm-root *{box-sizing:border-box}
:where(.mm-root,.mm-sel) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:where(.mm-root,.mm-sel) button:disabled{cursor:default;opacity:.45}
:where(.mm-root) input,:where(.mm-root) textarea{font:inherit;color:inherit}
.mm-shell{max-width:1120px;margin:0 auto;padding:20px 28px 72px}
.mm-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.mm-title{display:flex;align-items:baseline;gap:10px;margin-right:auto;min-width:0}
.mm-title h1{margin:0;font:var(--dsw-font-l-20);font-weight:600;letter-spacing:.01em;white-space:nowrap}
.mm-title .mm-sub{color:var(--mm-muted);font:var(--dsw-font-xs-13);white-space:nowrap}
.mm-datenav{display:flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--mm-soft)}
.mm-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;color:var(--dsw-alias-label-secondary)}
.mm-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mm-iconbtn[data-active=true]{color:var(--mm-accent)}
.mm-datebtn{position:relative;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;font:var(--dsw-font-xs-strong-13)}
.mm-datebtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-datebtn input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
.mm-today-chip{height:24px;padding:0 10px;border-radius:999px;font:var(--dsw-font-xxs-12);color:var(--mm-accent);background:var(--dsw-alias-state-business-tertiary)}
.mm-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:999px;background:var(--mm-soft);color:var(--mm-muted);width:220px;transition:width .15s}
.mm-search:focus-within{width:280px;color:var(--dsw-alias-label-secondary);box-shadow:0 0 0 1px var(--mm-line-strong) inset}
.mm-search input{flex:1;min-width:0;border:0;outline:0;background:none;font:var(--dsw-font-xs-13)}
.mm-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:16px}
.mm-day{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0 6px;border-radius:var(--mm-radius);color:var(--dsw-alias-label-secondary)}
.mm-day:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-day .mm-dw{font:var(--dsw-font-xxxs-11);color:var(--mm-muted)}
.mm-day .mm-dd{font:var(--dsw-font-s-strong-14);font-variant-numeric:tabular-nums}
.mm-day[data-today=true] .mm-dd{color:var(--mm-accent)}
.mm-day[data-active=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.mm-dots{display:flex;gap:3px;height:5px}
.mm-dots i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-border-l3)}
.mm-dots i[data-k=done]{background:var(--dsw-alias-state-success-primary)}
.mm-dots i[data-k=high]{background:var(--dsw-alias-state-error-primary)}
.mm-tabs{display:flex;align-items:center;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--mm-line)}
.mm-tab{position:relative;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 10px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-strong-13)}
.mm-tab:hover{color:var(--dsw-alias-label-primary)}
.mm-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.mm-tab[data-active=true]::after{content:'';position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:var(--mm-accent)}
.mm-count{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--mm-soft);color:var(--mm-muted);font:var(--dsw-font-xxxs-11);line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.mm-tabs .mm-spacer{flex:1}
.mm-hint{color:var(--mm-muted);font:var(--dsw-font-xxs-12)}
.mm-board{display:grid;gap:28px;grid-template-columns:minmax(0,1fr)}
@container (min-width:900px){.mm-board[data-split=true]{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}}
.mm-section{min-width:0}
.mm-section-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;min-height:24px}
.mm-section-head h2{margin:0;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}
.mm-progress{flex:1;max-width:120px;height:4px;border-radius:999px;background:var(--mm-soft);overflow:hidden}
.mm-progress span{display:block;height:100%;background:var(--dsw-alias-state-success-primary);transition:width .25s}
.mm-section-head .mm-meta{margin-left:auto;color:var(--mm-muted);font:var(--dsw-font-xxs-12);font-variant-numeric:tabular-nums}
.mm-focus{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;padding:10px 12px;border-radius:var(--mm-radius);background:var(--dsw-alias-state-warn-tertiary)}
.mm-focus .mm-focus-label{flex:none;padding-top:2px;color:var(--dsw-alias-state-warn-label);font:var(--dsw-font-xxs-strong-12)}
.mm-focus textarea{flex:1;min-height:22px;border:0;outline:0;resize:none;background:none;line-height:1.55;overflow:hidden}
.mm-focus textarea::placeholder{color:var(--mm-muted)}
.mm-banner{margin-bottom:12px;border-radius:var(--mm-radius);border:1px solid var(--mm-line);overflow:hidden}
.mm-banner-row{display:flex;align-items:center;gap:10px;padding:8px 12px;font:var(--dsw-font-xs-13)}
.mm-banner-row .mm-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
.mm-banner-row .mm-grow{flex:1;min-width:0}
.mm-link{color:var(--mm-accent);font:var(--dsw-font-xs-strong-13);white-space:nowrap}
.mm-link:hover{text-decoration:underline}
.mm-link[data-tone=muted]{color:var(--dsw-alias-label-secondary);font-weight:400}
.mm-banner-list{border-top:1px solid var(--mm-line);background:var(--mm-soft);padding:4px 0}
.mm-composer{display:flex;align-items:center;gap:8px;height:40px;padding:0 6px 0 12px;margin-bottom:6px;border-radius:var(--mm-radius);border:1px dashed var(--mm-line-strong);color:var(--mm-muted)}
.mm-composer:focus-within{border-style:solid;border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.mm-composer input{flex:1;min-width:0;border:0;outline:0;background:none}
.mm-composer input::placeholder{color:var(--mm-muted)}
.mm-kbd{padding:1px 6px;border-radius:5px;border:1px solid var(--mm-line-strong);color:var(--mm-muted);font:var(--dsw-font-xxxs-11)}
.mm-list{list-style:none;margin:0;padding:0}
.mm-item{position:relative;display:flex;gap:10px;align-items:flex-start;padding:8px 10px 8px 8px;border-radius:8px}
.mm-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-item:hover,.mm-item:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
.mm-item[data-high=true]::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:2px;border-radius:2px;background:var(--dsw-alias-state-error-primary)}
.mm-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-top:1px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l4);color:transparent;transition:background .15s,border-color .15s}
.mm-check:hover{border-color:var(--mm-accent)}
.mm-item[data-done=true] .mm-check{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-inverted)}
.mm-body{flex:1;min-width:0}
.mm-item-title{display:block;width:100%;text-align:left;line-height:1.5;word-break:break-word;white-space:pre-wrap}
.mm-item[data-done=true] .mm-item-title{color:var(--mm-muted);text-decoration:line-through;text-decoration-color:var(--dsw-alias-border-l3)}
.mm-item-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:2px;color:var(--mm-muted);font:var(--dsw-font-xxs-12)}
.mm-item-meta span{display:inline-flex;align-items:center;gap:3px}
.mm-tag{color:var(--dsw-alias-label-secondary)}
.mm-tag[data-tone=high]{color:var(--dsw-alias-state-error-primary)}
.mm-tag[data-tone=warn]{color:var(--dsw-alias-state-warn-label)}
.mm-note{margin-top:4px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:1.6;white-space:pre-wrap;word-break:break-word}
.mm-note[data-clamp=true]{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mm-actions{position:absolute;top:5px;right:6px;display:flex;gap:2px;padding:1px;border-radius:8px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-soft);opacity:0;pointer-events:none;transition:opacity .12s}
.mm-item:hover .mm-actions,.mm-item:focus-within .mm-actions{opacity:1;pointer-events:auto}
.mm-actions .mm-iconbtn{width:26px;height:26px}
.mm-actions .mm-iconbtn[data-danger=true]:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.mm-pinmark{flex:none;color:var(--mm-accent);margin-top:2px}
.mm-done-toggle{display:flex;align-items:center;gap:6px;width:100%;margin-top:8px;padding:6px 6px;border-radius:8px;color:var(--mm-muted);font:var(--dsw-font-xxs-12)}
.mm-done-toggle:hover{color:var(--dsw-alias-label-secondary)}
.mm-done-toggle svg{transition:transform .15s}
.mm-done-toggle[data-open=false] svg{transform:rotate(-90deg)}
.mm-done-toggle .mm-link{font:var(--dsw-font-xxs-12)}
.mm-done-toggle .mm-clear{margin-left:auto}
.mm-empty{padding:22px 12px;border-radius:var(--mm-radius);color:var(--mm-muted);font:var(--dsw-font-xs-13);text-align:center}
.mm-editor{display:flex;flex-direction:column;gap:10px;width:100%;padding:12px;border-radius:var(--mm-radius);background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--mm-line-strong) inset}
.mm-editor input[type=text],.mm-editor textarea{width:100%;border:0;outline:0;background:none}
.mm-editor .mm-edit-title{font:var(--dsw-font-s-strong-14)}
.mm-editor textarea{min-height:64px;resize:vertical;line-height:1.6;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}
.mm-fields{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.mm-field{display:flex;align-items:center;gap:6px;color:var(--mm-muted);font:var(--dsw-font-xxs-12)}
.mm-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.mm-seg button{height:24px;padding:0 9px;border-radius:6px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}
.mm-seg button[data-active=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-soft)}
.mm-chipinput{width:84px;height:26px;padding:0 8px;border-radius:7px;border:1px solid var(--mm-line-strong);background:var(--dsw-alias-bg-base);outline:0;font:var(--dsw-font-xxs-12)}
.mm-chipinput[type=date]{width:auto}
.mm-editor-foot{display:flex;align-items:center;gap:8px}
.mm-editor-foot .mm-hint{margin-right:auto}
.mm-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}
.mm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mm-btn[data-primary=true]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.mm-btn[data-primary=true]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.mm-history{display:flex;flex-direction:column;gap:2px}
.mm-hrow{display:grid;grid-template-columns:88px minmax(0,1fr) 120px;gap:14px;align-items:center;width:100%;padding:10px 10px;border-radius:8px;text-align:left}
.mm-hrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-hrow .mm-hdate{font:var(--dsw-font-xs-strong-13);font-variant-numeric:tabular-nums}
.mm-hrow .mm-hdate small{display:block;color:var(--mm-muted);font:var(--dsw-font-xxxs-11)}
.mm-hrow .mm-hnote{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mm-hrow .mm-hstat{display:flex;align-items:center;gap:8px;color:var(--mm-muted);font:var(--dsw-font-xxs-12);font-variant-numeric:tabular-nums}
.mm-hrow .mm-progress{max-width:none}
.mm-group-label{margin:14px 6px 4px;color:var(--mm-muted);font:var(--dsw-font-xxs-strong-12)}
.mm-error{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;border-radius:var(--mm-radius);background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xs-13)}
.mm-error span{flex:1}
.mm-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin-top:40px;padding-top:14px;border-top:1px solid var(--mm-line);color:var(--mm-muted);font:var(--dsw-font-xxs-12)}
.mm-switch{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}
.mm-switch i{position:relative;width:26px;height:15px;border-radius:999px;background:var(--dsw-alias-border-l3);transition:background .15s}
.mm-switch i::after{content:'';position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s}
.mm-switch[aria-checked=true] i{background:var(--mm-accent)}
.mm-switch[aria-checked=true] i::after{transform:translateX(11px)}
.mm-toast{position:sticky;bottom:18px;z-index:5;display:flex;justify-content:center;pointer-events:none;margin-top:-40px}
.mm-toast>div{display:flex;align-items:center;gap:14px;padding:8px 10px 8px 14px;border-radius:10px;background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);box-shadow:var(--dsw-elevation-prominent);font:var(--dsw-font-xs-13);pointer-events:auto}
.mm-toast .mm-link{color:inherit;text-decoration:underline}
.mm-loading{padding:64px 0;text-align:center;color:var(--mm-muted)}
@container (max-width:640px){.mm-shell{padding:14px 14px 64px}.mm-search,.mm-search:focus-within{width:100%;order:3}.mm-hrow{grid-template-columns:72px minmax(0,1fr)}.mm-hrow .mm-hstat{grid-column:2}}
.mm-sel{display:flex;flex-direction:column;min-width:188px;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-button-floating-fill));--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel);font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}
.mm-sel button{display:flex;align-items:center;gap:9px;width:100%;height:30px;padding:0 10px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mm-sel button:hover:not(:disabled),.mm-sel button:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:0}
.mm-sel button:disabled{opacity:.45;cursor:default}
.mm-sel button svg{flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary))}
.mm-sel button span{flex:1}
.mm-sel kbd{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.mm-sel hr{height:1px;margin:4px 6px;border:0;background:var(--dsw-alias-border-l2)}
.mm-sel .mm-sel-head{padding:4px 10px 2px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxxs-11)}
.mm-sel .mm-sel-ok{color:var(--dsw-alias-state-success-primary)}
`;

    function ensureStyle() {
      if (typeof document === 'undefined') return;
      let style = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]');
      if (!style) {
        style = document.createElement('style');
        style.dataset.plugin = PANEL_ID;
        style.dataset.pluginCss = STYLE_ID;
        document.head.appendChild(style);
      }
      if (style.textContent !== CSS) style.textContent = CSS;
    }

    // ───────────────────────── 面板组件 ─────────────────────────

    const shortcutState = { label: '' };
    const pendingFocus = { composer: false };

    function useAutoGrow(ref, value) {
      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }, [ref, value]);
    }

    function Composer({ placeholder, onSubmit, inputRef }) {
      const [value, setValue] = useState('');
      const [pending, setPending] = useState(false);
      const submit = async () => {
        const parsed = parseQuickInput(value);
        if (!parsed.title || pending) return;
        setPending(true);
        const ok = await onSubmit(parsed);
        setPending(false);
        if (ok) setValue('');
      };
      return h(
        'label',
        { className: 'mm-composer' },
        h(Icon, { name: 'plus' }),
        h('input', {
          ref: inputRef,
          value,
          placeholder,
          maxLength: 500,
          disabled: pending,
          onChange: event => setValue(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              setValue('');
              event.currentTarget.blur();
            }
          },
        }),
        value.trim() ? h('span', { className: 'mm-kbd' }, '↵ 添加') : null,
      );
    }

    function DailyFocus({ value, onSave }) {
      const [text, setText] = useState(value);
      const focused = useRef(false);
      const ref = useRef(null);
      useEffect(() => {
        if (!focused.current) setText(value);
      }, [value]);
      useAutoGrow(ref, text);
      const commit = () => {
        focused.current = false;
        if (text.trim() !== (value || '').trim()) onSave(text);
      };
      return h(
        'div',
        { className: 'mm-focus' },
        h('span', { className: 'mm-focus-label' }, '当日焦点'),
        h('textarea', {
          ref,
          rows: 1,
          value: text,
          placeholder: '这一天最重要的一件事是什么？',
          onFocus: () => (focused.current = true),
          onBlur: commit,
          onChange: event => setText(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setText(value);
              focused.current = false;
              event.currentTarget.blur();
            }
          },
        }),
      );
    }

    function Segmented({ value, options, onChange }) {
      return h(
        'div',
        { className: 'mm-seg', role: 'radiogroup' },
        options.map(option =>
          h('button', { key: option.id, type: 'button', role: 'radio', 'aria-checked': value === option.id, 'data-active': String(value === option.id), onClick: () => onChange(option.id) }, option.label),
        ),
      );
    }

    function Editor({ item, ctl }) {
      const [form, setForm] = useState(() => ({
        title: item.title,
        note: item.note || '',
        scope: item.scope,
        date: item.date || ctl.activeDate,
        priority: item.priority || 'normal',
        category: item.category || '',
        pinned: Boolean(item.pinned),
      }));
      const [saving, setSaving] = useState(false);
      const noteRef = useRef(null);
      useAutoGrow(noteRef, form.note);
      const set = patch => setForm(prev => ({ ...prev, ...patch }));
      const save = async () => {
        if (!form.title.trim() || saving) return;
        setSaving(true);
        const ok = await ctl.save(item.id, {
          title: form.title,
          note: form.note,
          scope: form.scope,
          date: form.scope === 'daily' ? form.date : undefined,
          priority: form.priority,
          category: form.category,
          pinned: form.pinned,
        });
        setSaving(false);
        if (ok) ctl.setEditingId(null);
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          ctl.setEditingId(null);
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          save();
        }
      };
      const listId = 'mm-cats-' + item.id;
      return h(
        'div',
        { className: 'mm-editor', onKeyDown },
        h('input', { type: 'text', className: 'mm-edit-title', value: form.title, maxLength: 500, autoFocus: true, placeholder: '事项标题', onChange: e => set({ title: e.target.value }) }),
        h('textarea', { ref: noteRef, value: form.note, placeholder: '补充备注（可选）', onChange: e => set({ note: e.target.value }) }),
        h(
          'div',
          { className: 'mm-fields' },
          h('span', { className: 'mm-field' }, '归属', h(Segmented, { value: form.scope, options: [{ id: 'daily', label: '当日' }, { id: 'evergreen', label: '常驻' }], onChange: scope => set({ scope }) })),
          form.scope === 'daily'
            ? h('span', { className: 'mm-field' }, '日期', h('input', { type: 'date', className: 'mm-chipinput', value: form.date, onChange: e => e.target.value && set({ date: e.target.value }) }))
            : null,
          h('span', { className: 'mm-field' }, '重要度', h(Segmented, { value: form.priority, options: PRIORITIES, onChange: priority => set({ priority }) })),
          h(
            'span',
            { className: 'mm-field' },
            '分类',
            h('input', { type: 'text', className: 'mm-chipinput', list: listId, maxLength: 24, value: form.category, placeholder: '无', onChange: e => set({ category: e.target.value }) }),
            h('datalist', { id: listId }, ctl.categories.map(name => h('option', { key: name, value: name }))),
          ),
          h(
            'button',
            { type: 'button', className: 'mm-switch', role: 'switch', 'aria-checked': form.pinned, onClick: () => set({ pinned: !form.pinned }) },
            h('i'),
            '置顶',
          ),
        ),
        h(
          'div',
          { className: 'mm-editor-foot' },
          h('span', { className: 'mm-hint' }, '⌘↵ 保存 · Esc 取消'),
          h('button', { type: 'button', className: 'mm-btn', onClick: () => ctl.setEditingId(null) }, '取消'),
          h('button', { type: 'button', className: 'mm-btn', 'data-primary': 'true', disabled: saving || !form.title.trim(), onClick: save }, saving ? '保存中…' : '保存'),
        ),
      );
    }

    function ItemRow({ item, ctl, showDate, extra }) {
      const [noteOpen, setNoteOpen] = useState(false);
      if (ctl.editingId === item.id) return h('li', { className: 'mm-item' }, h(Editor, { item, ctl }));
      const meta = [];
      if (item.priority === 'high') meta.push(h('span', { key: 'p', className: 'mm-tag', 'data-tone': 'high' }, '重要'));
      if (item.priority === 'low') meta.push(h('span', { key: 'p', className: 'mm-tag' }, '随手'));
      if (item.category) meta.push(h('span', { key: 'c', className: 'mm-tag' }, '#' + item.category));
      if (showDate && item.scope === 'daily') meta.push(h('span', { key: 'd' }, h(Icon, { name: 'calendar', size: 12 }), formatMonthDay(item.date) + ' · ' + relativeDayLabel(item.date, ctl.today)));
      if (showDate && item.scope === 'evergreen') meta.push(h('span', { key: 'd' }, h(Icon, { name: 'infinity', size: 12 }), '常驻'));
      if (item.carriedFrom) meta.push(h('span', { key: 'r', className: 'mm-tag', 'data-tone': 'warn' }, h(Icon, { name: 'repeat', size: 12 }), '顺延自 ' + formatMonthDay(item.carriedFrom)));
      if (item.completed && item.completedAt) meta.push(h('span', { key: 't' }, '完成于 ' + formatTime(item.completedAt)));
      const longNote = item.note && (item.note.length > 120 || item.note.split('\n').length > 2);
      return h(
        'li',
        { className: 'mm-item', 'data-done': String(Boolean(item.completed)), 'data-high': String(item.priority === 'high' && !item.completed) },
        h(
          'button',
          { type: 'button', className: 'mm-check', role: 'checkbox', 'aria-checked': Boolean(item.completed), 'aria-label': item.completed ? '标记为未完成' : '标记为完成', onClick: () => ctl.toggle(item) },
          h(Icon, { name: 'check', size: 12 }),
        ),
        h(
          'div',
          { className: 'mm-body' },
          h('button', { type: 'button', className: 'mm-item-title', title: '点击编辑', onClick: () => ctl.setEditingId(item.id) }, item.title),
          item.note
            ? h(
                'div',
                {
                  className: 'mm-note',
                  'data-clamp': String(longNote && !noteOpen),
                  title: longNote ? (noteOpen ? '点击收起' : '点击展开') : undefined,
                  onClick: longNote ? () => setNoteOpen(open => !open) : undefined,
                  style: longNote ? { cursor: 'pointer' } : undefined,
                },
                item.note,
              )
            : null,
          meta.length ? h('div', { className: 'mm-item-meta' }, meta) : null,
        ),
        item.pinned ? h('span', { className: 'mm-pinmark', title: '已置顶' }, h(Icon, { name: 'pin', size: 14 })) : null,
        h(
          'div',
          { className: 'mm-actions' },
          extra || null,
          h('button', { type: 'button', className: 'mm-iconbtn', title: item.pinned ? '取消置顶' : '置顶', 'aria-label': item.pinned ? '取消置顶' : '置顶', 'data-active': String(Boolean(item.pinned)), onClick: () => ctl.save(item.id, { pinned: !item.pinned }) }, h(Icon, { name: 'pin', size: 15 })),
          h('button', { type: 'button', className: 'mm-iconbtn', title: '复制内容', 'aria-label': '复制内容', onClick: () => ctl.copy(item) }, h(Icon, { name: 'copy', size: 15 })),
          h('button', { type: 'button', className: 'mm-iconbtn', title: '编辑', 'aria-label': '编辑', onClick: () => ctl.setEditingId(item.id) }, h(Icon, { name: 'edit', size: 15 })),
          h('button', { type: 'button', className: 'mm-iconbtn', title: '删除', 'aria-label': '删除', 'data-danger': 'true', onClick: () => ctl.remove(item) }, h(Icon, { name: 'trash', size: 15 })),
        ),
      );
    }

    function ItemList({ items, ctl, showDate }) {
      return h('ul', { className: 'mm-list' }, items.map(item => h(ItemRow, { key: item.id, item, ctl, showDate })));
    }

    function ListSection({ icon, title, items, ctl, before, composer, emptyText, clearScope }) {
      const [showDone, setShowDone] = useState(false);
      const open = items.filter(item => !item.completed);
      const done = items.filter(item => item.completed);
      const ratio = items.length ? Math.round((done.length / items.length) * 100) : 0;
      return h(
        'section',
        { className: 'mm-section' },
        h(
          'div',
          { className: 'mm-section-head' },
          h('h2', null, h(Icon, { name: icon, size: 15 }), title),
          items.length ? h('div', { className: 'mm-progress', title: '完成 ' + ratio + '%' }, h('span', { style: { width: ratio + '%' } })) : null,
          h('span', { className: 'mm-meta' }, items.length ? done.length + ' / ' + items.length : ''),
        ),
        before,
        composer,
        open.length ? h(ItemList, { items: open, ctl }) : h('div', { className: 'mm-empty' }, done.length ? '全部完成，干得漂亮。' : emptyText),
        done.length
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'mm-done-toggle', 'data-open': String(showDone) },
                h('button', { type: 'button', className: 'mm-link', 'data-tone': 'muted', onClick: () => setShowDone(value => !value), style: { display: 'inline-flex', alignItems: 'center', gap: '6px', font: 'inherit' } }, h(Icon, { name: 'chevronDown', size: 13 }), '已完成 ' + done.length),
                h('button', { type: 'button', className: 'mm-link mm-clear', onClick: () => ctl.clearCompleted(clearScope, done) }, '清理已完成'),
              ),
              showDone ? h(ItemList, { items: done, ctl }) : null,
            )
          : null,
      );
    }

    function OverdueBanner({ items, ctl }) {
      const [open, setOpen] = useState(false);
      if (!items.length) return null;
      return h(
        'div',
        { className: 'mm-banner' },
        h(
          'div',
          { className: 'mm-banner-row' },
          h('span', { className: 'mm-dot' }),
          h('span', { className: 'mm-grow' }, '有 ' + items.length + ' 条往日未完成的事项'),
          h('button', { type: 'button', className: 'mm-link', 'data-tone': 'muted', onClick: () => setOpen(value => !value) }, open ? '收起' : '查看'),
          h('button', { type: 'button', className: 'mm-link', onClick: () => ctl.carry() }, '全部顺延到今天'),
        ),
        open
          ? h(
              'ul',
              { className: 'mm-list mm-banner-list' },
              items.map(item =>
                h(ItemRow, {
                  key: item.id,
                  item,
                  ctl,
                  showDate: true,
                  extra: h('button', { type: 'button', className: 'mm-iconbtn', title: '顺延到今天', 'aria-label': '顺延到今天', onClick: () => ctl.carry([item.id]) }, h(Icon, { name: 'arrowRight', size: 15 })),
                }),
              ),
            )
          : null,
      );
    }

    function HistoryView({ history, today, onPick }) {
      if (!history.length) return h('div', { className: 'mm-empty' }, '还没有任何按日记录。');
      return h(
        'div',
        { className: 'mm-history' },
        history.map(day => {
          const ratio = day.total ? Math.round((day.completed / day.total) * 100) : 0;
          return h(
            'button',
            { key: day.date, type: 'button', className: 'mm-hrow', onClick: () => onPick(day.date) },
            h('span', { className: 'mm-hdate' }, formatMonthDay(day.date), h('small', null, formatWeekday(day.date) + ' · ' + relativeDayLabel(day.date, today))),
            h('span', { className: 'mm-hnote' }, day.note || (day.total ? (day.pending ? day.pending + ' 项未完成' : '全部完成') : '—')),
            h(
              'span',
              { className: 'mm-hstat' },
              day.total ? h('span', { className: 'mm-progress' }, h('span', { style: { width: ratio + '%' } })) : h('span', { style: { flex: 1 } }),
              day.total ? day.completed + '/' + day.total : '',
            ),
          );
        }),
      );
    }

    function SearchView({ results, query, ctl }) {
      if (!results.length) return h('div', { className: 'mm-empty' }, '没有找到包含「' + query + '」的事项。');
      const evergreen = results.filter(item => item.scope === 'evergreen');
      const byDate = new Map();
      for (const item of results) {
        if (item.scope !== 'daily') continue;
        if (!byDate.has(item.date)) byDate.set(item.date, []);
        byDate.get(item.date).push(item);
      }
      const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
      return h(
        'section',
        { className: 'mm-section' },
        h('div', { className: 'mm-section-head' }, h('h2', null, h(Icon, { name: 'search', size: 15 }), '搜索「' + query + '」'), h('span', { className: 'mm-meta' }, results.length + ' 条')),
        evergreen.length ? h(React.Fragment, null, h('div', { className: 'mm-group-label' }, '常驻'), h(ItemList, { items: evergreen, ctl })) : null,
        dates.map(date =>
          h(React.Fragment, { key: date }, h('div', { className: 'mm-group-label' }, formatMonthDay(date) + ' ' + formatWeekday(date) + ' · ' + relativeDayLabel(date, ctl.today)), h(ItemList, { items: byDate.get(date), ctl })),
        ),
      );
    }

    function WeekStrip({ days, today, activeDate, onPick }) {
      return h(
        'div',
        { className: 'mm-week', role: 'tablist', 'aria-label': '本周日期' },
        days.map(day => {
          const dots = [];
          for (let i = 0; i < Math.min(day.highPending, 3); i++) dots.push('high');
          for (let i = 0; i < Math.min(day.pending - day.highPending, 3 - dots.length); i++) dots.push('open');
          for (let i = 0; i < Math.min(day.completed, 3 - dots.length); i++) dots.push('done');
          return h(
            'button',
            {
              key: day.date,
              type: 'button',
              role: 'tab',
              className: 'mm-day',
              'aria-selected': day.date === activeDate,
              'data-active': String(day.date === activeDate),
              'data-today': String(day.date === today),
              title: day.total ? day.completed + '/' + day.total + ' 已完成' : '无事项',
              onClick: () => onPick(day.date),
            },
            h('span', { className: 'mm-dw' }, day.date === today ? '今天' : formatWeekday(day.date)),
            h('span', { className: 'mm-dd' }, String(parseDate(day.date).getDate())),
            h('span', { className: 'mm-dots' }, dots.map((kind, index) => h('i', { key: index, 'data-k': kind }))),
          );
        }),
      );
    }

    // ───────────────────────── 主面板 ─────────────────────────

    const VIEWS = [
      { id: 'board', label: '看板' },
      { id: 'daily', label: '当日' },
      { id: 'evergreen', label: '常驻' },
      { id: 'history', label: '历史' },
    ];

    function isEditableTarget(target) {
      if (!target || !(target instanceof Element)) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    }

    function Panel() {
      ensureStyle();
      const [snap, setSnap] = useState(null);
      const [activeDate, setActiveDate] = useState('');
      const [view, setView] = useState('board');
      const [queryInput, setQueryInput] = useState('');
      const [query, setQuery] = useState('');
      const [error, setError] = useState('');
      const [toast, setToast] = useState(null);
      const [editingId, setEditingId] = useState(null);
      const [selectionMenu, setSelectionMenu] = useState(() => readPref(PREF_SELECTION_MENU, true));
      const rootRef = useRef(null);
      const searchRef = useRef(null);
      const dailyComposerRef = useRef(null);
      const evergreenComposerRef = useRef(null);
      const toastTimer = useRef(0);
      const seq = useRef(0);
      const stateRef = useRef({ activeDate: '', query: '', updatedAt: '', today: '' });
      stateRef.current = { activeDate, query, updatedAt: snap ? snap.updatedAt : '', today: snap ? snap.today : '' };

      const load = useCallback(async (date, nextQuery) => {
        const ticket = ++seq.current;
        try {
          const value = await api.get({ date, query: nextQuery });
          if (ticket !== seq.current) return;
          setSnap(value);
          setActiveDate(value.activeDate);
          setError('');
        } catch (err) {
          if (ticket === seq.current) setError(err.message || String(err));
        }
      }, []);

      const reload = useCallback(() => load(stateRef.current.activeDate || undefined, stateRef.current.query || undefined), [load]);

      useEffect(() => {
        load(undefined, undefined);
      }, [load]);

      useEffect(() => {
        const timer = setTimeout(() => setQuery(queryInput.trim()), 220);
        return () => clearTimeout(timer);
      }, [queryInput]);

      useEffect(() => {
        if (snap) load(stateRef.current.activeDate, query || undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [query]);

      // 其他入口（对话选区、AI 工具）写入后自动刷新：窗口事件 + 低频轮询 revision。
      useEffect(() => {
        const onSync = event => {
          const updatedAt = event.detail && event.detail.updatedAt;
          if (!updatedAt || updatedAt !== stateRef.current.updatedAt) reload();
        };
        const poll = async () => {
          if (document.visibilityState !== 'visible') return;
          try {
            const value = await api.get({ revision: 1 });
            if (value.updatedAt !== stateRef.current.updatedAt || value.today !== stateRef.current.today) reload();
          } catch {}
        };
        const onVisible = () => document.visibilityState === 'visible' && poll();
        window.addEventListener(SYNC_EVENT, onSync);
        document.addEventListener('visibilitychange', onVisible);
        const timer = setInterval(poll, POLL_MS);
        return () => {
          window.removeEventListener(SYNC_EVENT, onSync);
          document.removeEventListener('visibilitychange', onVisible);
          clearInterval(timer);
        };
      }, [reload]);

      useEffect(() => () => clearTimeout(toastTimer.current), []);

      const showToast = useCallback((text, action) => {
        clearTimeout(toastTimer.current);
        setToast({ text, action, key: Date.now() });
        toastTimer.current = setTimeout(() => setToast(null), action ? UNDO_MS : 2600);
      }, []);

      const run = useCallback(
        async payload => {
          try {
            const value = await api.post({ activeDate: stateRef.current.activeDate, ...payload });
            if (stateRef.current.query) await reload();
            else if (value.activeDate) {
              setSnap(value);
              setActiveDate(value.activeDate);
            }
            setError('');
            return value;
          } catch (err) {
            setError(err.message || String(err));
            return null;
          }
        },
        [reload],
      );

      const pickDate = useCallback(
        date => {
          if (!date) return;
          setEditingId(null);
          setQueryInput('');
          setQuery('');
          if (view === 'history') setView('board');
          load(date, undefined);
        },
        [load, view],
      );

      const ctl = useMemo(
        () => ({
          activeDate,
          today: snap ? snap.today : '',
          categories: snap ? snap.categories : [],
          editingId,
          setEditingId,
          async save(id, patch) {
            return Boolean(await run({ action: 'update', id, patch }));
          },
          async toggle(item) {
            await run({ action: 'toggle', id: item.id, completed: !item.completed });
          },
          async copy(item) {
            const ok = await copyText(item.note ? item.title + '\n\n' + item.note : item.title);
            showToast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本');
          },
          async remove(item) {
            if (editingId === item.id) setEditingId(null);
            const value = await run({ action: 'delete', id: item.id });
            if (!value) return;
            const removed = value.deletedItem;
            showToast('已删除「' + (removed.title.length > 18 ? removed.title.slice(0, 18) + '…' : removed.title) + '」', {
              label: '撤销',
              run: () => run({ action: 'restore', item: removed }),
            });
          },
          async clearCompleted(scope, doneItems) {
            const value = await run({ action: 'clear-completed', scope, date: stateRef.current.activeDate });
            if (!value || !value.removedCount) return;
            showToast('已清理 ' + value.removedCount + ' 条已完成事项', {
              label: '撤销',
              run: async () => {
                for (const item of doneItems) await run({ action: 'restore', item });
              },
            });
          },
          async carry(ids) {
            const value = await run({ action: 'carry-over', targetDate: snap ? snap.today : undefined, ids });
            if (value) showToast('已顺延 ' + value.movedCount + ' 条到今天');
          },
        }),
        [activeDate, snap, editingId, run, showToast],
      );

      const addTo = useCallback(
        scope => async parsed => {
          const value = await run({
            action: 'add',
            scope,
            date: scope === 'daily' ? stateRef.current.activeDate : undefined,
            title: parsed.title,
            priority: parsed.priority,
            category: parsed.category,
          });
          return Boolean(value);
        },
        [run],
      );

      // 面板内快捷键：只在面板获得焦点或鼠标所在时生效，不抢输入框。
      useEffect(() => {
        const onKey = event => {
          const root = rootRef.current;
          if (!root || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
          if (!root.contains(document.activeElement) && !root.matches(':hover')) return;
          if (isEditableTarget(event.target)) return;
          const key = event.key;
          if (key === '/') {
            event.preventDefault();
            searchRef.current && searchRef.current.focus();
          } else if (key === 'n' || key === 'N') {
            event.preventDefault();
            const target = view === 'evergreen' ? evergreenComposerRef.current : dailyComposerRef.current || evergreenComposerRef.current;
            target && target.focus();
          } else if (key === '[' && activeDate) {
            pickDate(shiftDate(activeDate, -1));
          } else if (key === ']' && activeDate) {
            pickDate(shiftDate(activeDate, 1));
          } else if ((key === 't' || key === 'T') && snap) {
            pickDate(snap.today);
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [activeDate, snap, view, pickDate]);

      useEffect(() => {
        if (snap && pendingFocus.composer) {
          pendingFocus.composer = false;
          const target = dailyComposerRef.current || evergreenComposerRef.current;
          target && target.focus();
        }
      }, [snap]);

      if (!snap) {
        return h(
          'div',
          { className: 'mm-root', ref: rootRef },
          h('div', { className: 'mm-shell' }, error ? h(ErrorBar, { error, onRetry: reload }) : h('div', { className: 'mm-loading' }, '正在载入备忘录…')),
        );
      }

      const today = snap.today;
      const isToday = activeDate === today;
      const stats = snap.stats;
      const dailyPending = snap.dailyItems.filter(item => !item.completed).length;
      const evergreenPending = snap.evergreenItems.filter(item => !item.completed).length;
      const counts = { board: dailyPending + evergreenPending, daily: dailyPending, evergreen: evergreenPending, history: 0 };
      const dayLabel = relativeDayLabel(activeDate, today);

      const dailySection = h(ListSection, {
        key: 'daily',
        icon: 'sun',
        title: isToday ? '今天' : formatMonthDay(activeDate) + ' · ' + dayLabel,
        items: snap.dailyItems,
        ctl,
        clearScope: 'daily',
        emptyText: isToday ? '今天还没有安排，按 N 开始记录。' : '这一天没有记录。',
        before: h(
          React.Fragment,
          null,
          h(DailyFocus, { key: activeDate, value: snap.dailyNote || '', onSave: note => run({ action: 'set-daily-note', date: activeDate, note }) }),
          isToday ? h(OverdueBanner, { items: snap.overdueItems, ctl }) : null,
        ),
        composer: h(Composer, {
          inputRef: dailyComposerRef,
          placeholder: '添加到' + (isToday ? '今天' : formatMonthDay(activeDate)) + '…  ! 标重要  #分类',
          onSubmit: addTo('daily'),
        }),
      });
      const evergreenSection = h(ListSection, {
        key: 'evergreen',
        icon: 'infinity',
        title: '常驻',
        items: snap.evergreenItems,
        ctl,
        clearScope: 'evergreen',
        emptyText: '长期要记住的事放这里，不随日期变化。',
        composer: h(Composer, { inputRef: evergreenComposerRef, placeholder: '添加常驻事项…  ! 标重要  #分类', onSubmit: addTo('evergreen') }),
      });

      let content;
      if (query && snap.searchResults) content = h(SearchView, { results: snap.searchResults, query, ctl });
      else if (view === 'history') content = h(HistoryView, { history: snap.history, today, onPick: pickDate });
      else if (view === 'daily') content = h('div', { className: 'mm-board' }, dailySection);
      else if (view === 'evergreen') content = h('div', { className: 'mm-board' }, evergreenSection);
      else content = h('div', { className: 'mm-board', 'data-split': 'true' }, dailySection, evergreenSection);

      return h(
        'div',
        { className: 'mm-root', ref: rootRef },
        h(
          'div',
          { className: 'mm-shell' },
          h(
            'header',
            { className: 'mm-head' },
            h('div', { className: 'mm-title' }, h('h1', null, '备忘录'), h('span', { className: 'mm-sub' }, formatMonthDay(today) + ' ' + formatWeekday(today))),
            h(
              'div',
              { className: 'mm-datenav' },
              h('button', { type: 'button', className: 'mm-iconbtn', title: '前一天  [', 'aria-label': '前一天', onClick: () => pickDate(shiftDate(activeDate, -1)) }, h(Icon, { name: 'chevronLeft' })),
              h(
                'label',
                { className: 'mm-datebtn', title: '选择日期' },
                h(Icon, { name: 'calendar', size: 14 }),
                formatMonthDay(activeDate) + ' ' + formatWeekday(activeDate),
                h('input', {
                  type: 'date',
                  value: activeDate,
                  'aria-label': '选择日期',
                  onClick: event => {
                    try {
                      event.currentTarget.showPicker && event.currentTarget.showPicker();
                    } catch {}
                  },
                  onChange: event => pickDate(event.target.value),
                }),
              ),
              h('button', { type: 'button', className: 'mm-iconbtn', title: '后一天  ]', 'aria-label': '后一天', onClick: () => pickDate(shiftDate(activeDate, 1)) }, h(Icon, { name: 'chevronRight' })),
            ),
            isToday ? null : h('button', { type: 'button', className: 'mm-today-chip', title: '回到今天  T', onClick: () => pickDate(today) }, '回到今天'),
            h(
              'label',
              { className: 'mm-search' },
              h(Icon, { name: 'search', size: 14 }),
              h('input', {
                ref: searchRef,
                type: 'search',
                value: queryInput,
                placeholder: '搜索全部事项  /',
                onChange: event => setQueryInput(event.target.value),
                onKeyDown: event => {
                  if (event.key === 'Escape') {
                    setQueryInput('');
                    event.currentTarget.blur();
                  }
                },
              }),
              queryInput ? h('button', { type: 'button', className: 'mm-iconbtn', style: { width: 20, height: 20 }, 'aria-label': '清空搜索', onClick: () => setQueryInput('') }, h(Icon, { name: 'close', size: 12 })) : null,
            ),
          ),
          h(WeekStrip, { days: snap.weekStrip, today, activeDate, onPick: pickDate }),
          h(
            'nav',
            { className: 'mm-tabs', role: 'tablist' },
            VIEWS.map(item =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  role: 'tab',
                  className: 'mm-tab',
                  'aria-selected': view === item.id && !query,
                  'data-active': String(view === item.id && !query),
                  onClick: () => {
                    setView(item.id);
                    setQueryInput('');
                    setQuery('');
                  },
                },
                item.label,
                counts[item.id] ? h('span', { className: 'mm-count' }, counts[item.id]) : null,
              ),
            ),
            h('span', { className: 'mm-spacer' }),
            h('span', { className: 'mm-hint' }, (shortcutState.label ? shortcutState.label + ' 打开 · ' : '') + 'N 新建 · / 搜索 · [ ] 切换日期'),
          ),
          error ? h(ErrorBar, { error, onRetry: reload, onClose: () => setError('') }) : null,
          content,
          h(
            'footer',
            { className: 'mm-foot' },
            h('span', null, '共 ' + stats.totalItems + ' 条 · 待顺延 ' + stats.overdueCount),
            h(
              'button',
              {
                type: 'button',
                className: 'mm-switch',
                role: 'switch',
                'aria-checked': selectionMenu,
                title: '在对话正文中选中文字后右击，出现“复制 / 引用 / 记入备忘”菜单；其他区域始终保留系统原生菜单。',
                onClick: () => {
                  const next = !selectionMenu;
                  writePref(PREF_SELECTION_MENU, next);
                  setSelectionMenu(next);
                },
              },
              h('i'),
              '对话选区右键记入备忘',
            ),
            h('span', { className: 'mm-spacer', style: { flex: 1 } }),
            snap.dataDir ? h('span', { title: snap.dataDir }, '数据：' + snap.dataDir.replace(/^\/Users\/[^/]+/, '~')) : null,
            h('span', null, 'v' + (snap.version || '')),
          ),
        ),
        toast
          ? h(
              'div',
              { className: 'mm-toast', role: 'status', key: toast.key },
              h(
                'div',
                null,
                h('span', null, toast.text),
                toast.action
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'mm-link',
                        onClick: () => {
                          const action = toast.action;
                          setToast(null);
                          action.run();
                        },
                      },
                      toast.action.label,
                    )
                  : null,
              ),
            )
          : null,
      );
    }

    function ErrorBar({ error, onRetry, onClose }) {
      return h(
        'div',
        { className: 'mm-error', role: 'alert' },
        h('span', null, error),
        h('button', { type: 'button', className: 'mm-link', onClick: onRetry }, '重试'),
        onClose ? h('button', { type: 'button', className: 'mm-iconbtn', 'aria-label': '关闭', onClick: onClose }, h(Icon, { name: 'close', size: 12 })) : null,
      );
    }

    // ───────────────────────── 对话选区右键菜单 ─────────────────────────
    // 只接管 DSH 对话正文里「有选区的右击」：由官方 text-interaction 机制分发，
    // 第一项始终是复制，保证不比系统原生菜单少功能；其他区域一律不碰。

    const lastInteraction = { sessionId: undefined };

    function sessionAcceptsQuote(s) {
      if (!s || s.removed) return false;
      return s.subagent == null || (s.subagent.address && s.subagent.address.mode === 'continuable' && s.subagent.parentAvailable === true);
    }

    function createSelectionMenu(clientCtx) {
      return function SelectionMenu({ dismiss, readText, clearSelection, inputActions, useSession }) {
        ensureStyle();
        const [state, setState] = useState({ phase: 'idle', text: '' });
        const textRef = useRef(null);
        if (textRef.current === null) textRef.current = readText() || '';
        const text = textRef.current;
        const sessionId = lastInteraction.sessionId;
        const quotable = typeof useSession === 'function' ? useSession(sessionAcceptsQuote) : true;
        const canQuote = quotable && Boolean(inputActions && typeof inputActions.insertQuote === 'function');
        const firstRef = useRef(null);
        useEffect(() => {
          firstRef.current && firstRef.current.focus({ preventScroll: true });
        }, []);
        useEffect(() => {
          if (state.phase !== 'done') return;
          const timer = setTimeout(dismiss, 2200);
          return () => clearTimeout(timer);
        }, [state.phase, dismiss]);

        const keep = event => event.preventDefault();
        const copy = async () => {
          await copyText(text);
          dismiss();
        };
        const quote = () => {
          inputActions.insertQuote(text);
          clearSelection();
          dismiss();
        };
        const add = async scope => {
          setState({ phase: 'busy', text: '' });
          try {
            await api.post({ action: 'add-from-selection', text, scope, source: { kind: 'conversation', sessionId } });
            setState({ phase: 'done', text: scope === 'daily' ? '已记入今天' : '已记入常驻' });
          } catch (err) {
            setState({ phase: 'error', text: err.message || String(err) });
          }
        };
        const open = () => {
          try {
            clientCtx.layout.selectPanel(PANEL_ID);
          } catch {}
          dismiss();
        };
        const onKeyDown = event => {
          const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next] && buttons[next].focus();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
          }
        };

        if (state.phase === 'done' || state.phase === 'error') {
          return h(
            'div',
            { className: 'mm-sel', role: 'status', onPointerDown: keep, onKeyDown },
            h(
              'div',
              { className: 'mm-sel-head ' + (state.phase === 'done' ? 'mm-sel-ok' : ''), style: { padding: '6px 10px', font: 'var(--dsw-font-xs-13)' } },
              state.phase === 'done' ? '✓ ' + state.text : state.text,
            ),
            state.phase === 'done' ? h('button', { type: 'button', ref: firstRef, onClick: open }, h(Icon, { name: 'arrowRight', size: 15 }), h('span', null, '打开备忘录')) : null,
          );
        }
        const busy = state.phase === 'busy';
        return h(
          'div',
          { className: 'mm-sel', role: 'menu', 'aria-label': '选中文本操作', onPointerDown: keep, onKeyDown, onContextMenu: event => event.preventDefault() },
          h('div', { className: 'mm-sel-head' }, '已选 ' + text.length + ' 字'),
          h('button', { type: 'button', role: 'menuitem', ref: firstRef, onClick: copy }, h(Icon, { name: 'copy', size: 15 }), h('span', null, '复制'), h('kbd', null, '⌘C')),
          canQuote ? h('button', { type: 'button', role: 'menuitem', onClick: quote }, h(Icon, { name: 'quote', size: 15 }), h('span', null, '引用到输入框')) : null,
          h('hr'),
          h('button', { type: 'button', role: 'menuitem', disabled: busy, onClick: () => add('daily') }, h(Icon, { name: 'sun', size: 15 }), h('span', null, '记入今天的备忘')),
          h('button', { type: 'button', role: 'menuitem', disabled: busy, onClick: () => add('evergreen') }, h(Icon, { name: 'infinity', size: 15 }), h('span', null, '记入常驻备忘')),
        );
      };
    }

    // ───────────────────────── 注册 ─────────────────────────

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() =>
          ctx.locale.register(NS, {
            zh: { title: '备忘录' },
            'zh-CN': { title: '备忘录' },
            en: { title: 'Memorandum' },
          }),
        );
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => t('title') || '备忘录' }, SidebarIcon),
        );
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel));

        // 对话正文选区右击：走官方 text-interaction 分发，只认 contextmenu 触发，
        // 把左键选区浮动按钮留给官方「引用」。服务不存在时整段静默跳过。
        ctx.inject(['uiConversation'], scope => {
          scope.effect(() =>
            scope.uiConversation.interactions.register({
              id: PANEL_ID,
              onInteraction(request) {
                if (request.trigger !== 'contextmenu' || !request.hasSelection) return;
                if (!readPref(PREF_SELECTION_MENU, true)) return;
                const text = request.readText();
                if (!text || !text.trim()) return;
                lastInteraction.sessionId = request.sessionId;
                request.preventDefault();
                request.open();
              },
            }),
          );
        });
        ctx.slots.inject('conversation.chat.text-interaction', () =>
          ctx.slots.register({ name: 'conversation.chat.text-interaction', key: PANEL_ID, locale: NS }, createSelectionMenu(ctx)),
        );

        ctx.inject(['shortcuts'], scope => {
          const binding = { code: 'KeyM', modifiers: ['primary', 'shift'] };
          scope.effect(() => {
            try {
              const dispose = scope.shortcuts.register({
                id: 'dsh-memorandum.open',
                label: () => '打开备忘录',
                aliases: ['memo', 'memorandum', 'beiwang'],
                defaults: { 'desktop:macos': binding, 'desktop:windows': binding, 'desktop:linux': binding, 'web:macos': binding, 'web:windows': binding },
                regions: ['page', 'editable', 'terminal'],
                modals: [],
                resolve: () => ({
                  status: 'handled',
                  run: () => {
                    pendingFocus.composer = true;
                    ctx.layout.selectPanel(PANEL_ID);
                  },
                }),
              });
              const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
              shortcutState.label = isMac ? '⌘⇧M' : 'Ctrl+Shift+M';
              return () => {
                shortcutState.label = '';
                dispose && dispose();
              };
            } catch (error) {
              console.warn('[dsh-memorandum] 快捷键未注册：', error && error.message);
              return () => {};
            }
          });
        });
      },
    };
  },
});