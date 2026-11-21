/**
 * DeepSeek API balance badge for the DSH sidebar footer.
 *
 * The Client reads the account's recharge and bonus wallets through the
 * existing account Remote service — the same authenticated platform session
 * the account settings page uses. No API key is read, stored, or sent to a
 * third party, and the plugin adds no Host route and no model request.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wallet-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React;

    const NS = 'balanceBadge';
    // Platform wallets change on the minute scale; one read per minute is
    // enough for a glanceable badge and stays far below any account rate cap.
    const REFRESH_MS = 60_000;
    // A reopened popover or a returning window reuses a read this recent.
    const STALE_MS = 15_000;
    const LOW_BALANCE = 5;
    const POPOVER_ID = 'dbal-popover';
    const POPOVER_WIDTH = 252;

    // ---------------------------------------------------------------------
    // Copy
    // ---------------------------------------------------------------------

    const zh = {
      'label': '余额',
      'loading': '读取中',
      'empty': '暂无余额',
      'signedOut': '未登录',
      'error': '读取失败',
      'aria': 'DeepSeek API 余额：{amount}，打开详情',
      'ariaLoading': '正在读取 DeepSeek API 余额',
      'ariaEmpty': 'DeepSeek API 余额暂无数据，打开详情',
      'ariaSignedOut': 'DeepSeek 账号未登录，查看如何登录',
      'ariaError': 'DeepSeek API 余额读取失败，打开详情重试',
      'title': 'DeepSeek API 余额',
      'row.recharge': '充值余额',
      'row.bonus': '赠送余额',
      'meta': '{time} 更新 · 每分钟检查',
      'meta.never': '尚未读取过余额',
      'meta.stale': '{time} 上次更新 · 刷新失败',
      'meta.signedOut': '登录后自动读取余额',
      'meta.retry': '读取失败 · 每分钟自动重试',
      'action.refresh': '刷新',
      'action.refreshing': '刷新中',
      'action.topUp': '去充值',
      'action.usage': '用量明细',
      'signedOut.title': '未登录 DeepSeek 账号',
      'signedOut.body': '登录后，这里会实时显示 API 剩余余额。',
      'signedOut.hint': '在左侧「设置 → 账号」中登录。',
      'error.title': '暂时读不到余额',
      'error.body': '可能是网络问题或登录状态失效，稍后会自动重试。',
      'zero.title': '余额已用尽',
      'zero.body': '充值后即可继续使用 API。',
      'low.title': '余额偏低',
      'low.body': '剩余不足 {amount}，请及时充值以免 API 中断。',
    };

    const en = {
      'label': 'Balance',
      'loading': 'Reading',
      'empty': 'No balance',
      'signedOut': 'Signed out',
      'error': 'Unavailable',
      'aria': 'DeepSeek API balance: {amount}. Open details.',
      'ariaLoading': 'Reading the DeepSeek API balance',
      'ariaEmpty': 'The DeepSeek API balance has no data. Open details.',
      'ariaSignedOut': 'Not signed in to a DeepSeek account. How to sign in.',
      'ariaError': 'The DeepSeek API balance could not be read. Open details to retry.',
      'title': 'DeepSeek API balance',
      'row.recharge': 'Recharge balance',
      'row.bonus': 'Bonus balance',
      'meta': 'Updated {time} · checked every minute',
      'meta.never': 'The balance has not been read yet',
      'meta.stale': 'Last updated {time} · refresh failed',
      'meta.signedOut': 'Reads the balance after sign-in',
      'meta.retry': 'Read failed · retries every minute',
      'action.refresh': 'Refresh',
      'action.refreshing': 'Refreshing',
      'action.topUp': 'Top up',
      'action.usage': 'Usage',
      'signedOut.title': 'Not signed in to DeepSeek',
      'signedOut.body': 'Sign in and this badge shows the remaining API balance in real time.',
      'signedOut.hint': 'Sign in under Settings → Account.',
      'error.title': 'The balance is unavailable',
      'error.body': 'A network problem or an expired sign-in may be the cause. It retries automatically.',
      'zero.title': 'The balance is used up',
      'zero.body': 'Top up to keep using the API.',
      'low.title': 'Low balance',
      'low.body': 'Less than {amount} remains. Top up to keep the API running.',
    };

    // ---------------------------------------------------------------------
    // Formatting
    // ---------------------------------------------------------------------

    function symbolOf(currency) {
      return currency === 'USD' ? '$' : '¥';
    }

    /**
     * Format one validated Platform decimal string for display.
     * @param {string} raw - balance string from the account service.
     * @param {string} currency - wallet currency code.
     * @returns {string} currency text with two decimals, grouped digits, and
     * the platform's sub-cent treatment.
     */
    function formatBalance(raw, currency) {
      const symbol = symbolOf(currency);
      const value = Number(raw);
      if (!Number.isFinite(value)) return `${symbol}${raw}`;
      const sign = value < 0 ? '-' : '';
      const abs = Math.abs(value);
      if (abs === 0) return `${symbol}0.00`;
      if (abs < 0.01) return `${sign}<${symbol}0.01`;
      // Round down so the badge never claims more money than the wallet holds.
      const cents = Math.floor(abs * 100 + 1e-9);
      const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const fraction = String(cents % 100).padStart(2, '0');
      return `${sign}${symbol}${whole}.${fraction}`;
    }

    /**
     * Sum wallets by currency, preserving first-seen order.
     * @param {Array<{currency: string, balance: string}>} wallets - platform wallets.
     * @returns {Array<{currency: string, total: number}>} one total per currency.
     */
    function aggregate(wallets) {
      const totals = new Map();
      for (const wallet of wallets) {
        const value = Number(wallet.balance);
        if (!Number.isFinite(value)) continue;
        totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + value);
      }
      return [...totals.entries()].map(([currency, total]) => ({ currency, total }));
    }

    function walletText(entries) {
      return entries.map(entry => formatBalance(String(entry.total), entry.currency)).join(' · ');
    }

    function clockText(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (_error) {
        return '--:--';
      }
    }

    // ---------------------------------------------------------------------
    // Balance store
    // ---------------------------------------------------------------------

    /**
     * Compare two platform wallet lists by currency and exact balance string.
     * @param {Array<{currency: string, balance: string}>} previous - mounted wallets.
     * @param {Array<{currency: string, balance: string}>} next - freshly read wallets.
     * @returns {boolean} whether the visible amounts are identical.
     */
    function sameWallets(previous, next) {
      if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
      for (let index = 0; index < previous.length; index += 1) {
        const left = previous[index];
        const right = next[index];
        if (left.currency !== right.currency || left.balance !== right.balance) return false;
      }
      return true;
    }

    function sameLinks(previous, next) {
      if (previous === next) return true;
      if (previous === null || next === null || previous === undefined || next === undefined) return false;
      return previous.usageUrl === next.usageUrl && previous.topUpUrl === next.topUpUrl;
    }

    /**
     * One client-wide balance snapshot shared by the row and its popover.
     * @param {{getState: () => Promise<any>, getBalance: () => Promise<any>}} ops - account Remote reads.
     */
    function createStore(ops) {
      let snapshot = {
        status: 'loading',
        wallets: [],
        bonusWallets: [],
        links: null,
        updatedAt: 0,
        refreshing: false,
        failed: false,
      };
      const listeners = new Set();
      let inFlight = null;
      let timer;
      let retryTimer;
      let retryCount = 0;
      let lastCheckAt = 0;
      let disposed = false;

      function publish(patch) {
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            console.error('balance-badge: a UI subscriber failed.', error);
          }
        }
      }

      function settle(quiet) {
        lastCheckAt = Date.now();
        if (!quiet) publish({ refreshing: false });
      }

      function signedOut(links, quiet) {
        retryCount = 0;
        clearTimeout(retryTimer);
        const nextLinks = links ?? snapshot.links;
        if (snapshot.status === 'signed-out' && sameLinks(snapshot.links, nextLinks)) {
          settle(quiet);
          return;
        }
        lastCheckAt = Date.now();
        publish({
          status: 'signed-out',
          wallets: [],
          bonusWallets: [],
          links: nextLinks,
          updatedAt: 0,
          refreshing: false,
          failed: false,
        });
      }

      function failed(links, quiet) {
        const nextLinks = links ?? snapshot.links;
        if (snapshot.failed && snapshot.status !== 'loading' && sameLinks(snapshot.links, nextLinks)) {
          settle(quiet);
          return;
        }
        lastCheckAt = Date.now();
        publish({
          status: snapshot.updatedAt === 0 ? 'error' : snapshot.status,
          refreshing: false,
          failed: true,
          links: nextLinks,
        });
      }

      /**
       * Read the account and publish only when the visible result changed.
       * @param {{quiet?: boolean}} [options] - quiet skips the busy state and
       * the no-op notification, so a background poll leaves the UI untouched.
       */
      function refresh(options) {
        const quiet = options !== undefined && options.quiet === true;
        if (disposed) return Promise.resolve();
        if (inFlight !== null) return inFlight;
        if (!quiet) publish({ refreshing: true });
        inFlight = (async () => {
          try {
            const state = await ops.getState();
            if (!state.ok) throw new Error('account state unavailable');
            const view = state.value;
            const links = view && view.links ? view.links : null;
            if (!view || view.status !== 'credential-stored') {
              signedOut(links, quiet);
              return;
            }
            const balance = await ops.getBalance();
            if (!balance.ok) throw new Error('balance unavailable');
            const value = balance.value;
            if (value === null) {
              signedOut(links, quiet);
              return;
            }
            if (value.status !== 'ready') {
              failed(links, quiet);
              return;
            }
            const wallets = Array.isArray(value.value) ? value.value : [];
            const bonusWallets = Array.isArray(value.bonusWallets) ? value.bonusWallets : [];
            const nextLinks = links ?? snapshot.links;
            const unchanged = snapshot.status === 'ready' && !snapshot.failed
              && sameWallets(snapshot.wallets, wallets)
              && sameWallets(snapshot.bonusWallets, bonusWallets)
              && sameLinks(snapshot.links, nextLinks);
            if (unchanged) {
              // The amount did not move: leave the mounted view exactly as it
              // is and advance only the freshness clock used by triggers.
              lastCheckAt = Date.now();
              if (!quiet) publish({ refreshing: false });
              retryCount = 0;
              clearTimeout(retryTimer);
              return;
            }
            lastCheckAt = Date.now();
            publish({
              status: 'ready',
              wallets,
              bonusWallets,
              links: nextLinks,
              updatedAt: Date.now(),
              refreshing: false,
              failed: false,
            });
            retryCount = 0;
            clearTimeout(retryTimer);
          } catch (_error) {
            // Keep the last known amount visible; the popover reports the failure.
            failed(undefined, quiet);
            // The connection may still be coming up on first mount; retry a
            // few times quickly before falling back to the minute cadence.
            if ((snapshot.status === 'loading' || snapshot.status === 'error') && retryCount < 3) {
              retryCount += 1;
              clearTimeout(retryTimer);
              retryTimer = setTimeout(() => { void refresh({ quiet: true }); }, 4000 * retryCount);
            }
          } finally {
            inFlight = null;
          }
        })();
        return inFlight;
      }

      /** Check now when the last read or change is older than `maxAge`. */
      function refreshIfStale(maxAge) {
        if (snapshot.refreshing) return;
        if (Date.now() - Math.max(snapshot.updatedAt, lastCheckAt) >= maxAge) void refresh({ quiet: true });
      }

      function start() {
        void refresh();
        timer = setInterval(() => {
          if (document.visibilityState !== 'hidden') void refresh({ quiet: true });
        }, REFRESH_MS);
      }

      function stop() {
        disposed = true;
        clearInterval(timer);
        clearTimeout(retryTimer);
        listeners.clear();
      }

      function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }

      return {
        getSnapshot: () => snapshot,
        subscribe,
        refresh,
        refreshIfStale,
        start,
        stop,
      };
    }

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------

    const ICON_BASE = {
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
    };

    function WalletIcon({ size }) {
      return h('svg', { ...ICON_BASE, width: size, height: size, viewBox: '0 0 20 20' },
        h('path', { d: 'M3 6.25A2.25 2.25 0 0 1 5.25 4h9.5A2.25 2.25 0 0 1 17 6.25v7.5A2.25 2.25 0 0 1 14.75 16h-9.5A2.25 2.25 0 0 1 3 13.75z' }),
        h('path', { d: 'M3 8h14' }),
        h('circle', { cx: 13.25, cy: 11.75, r: 1.4, fill: 'currentColor', stroke: 'none' }));
    }

    function RefreshIcon({ size }) {
      return h('svg', { ...ICON_BASE, width: size, height: size, viewBox: '0 0 16 16' },
        h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
        h('path', { d: 'M13 2.5V5h-2.5' }));
    }

    function WarningIcon({ size }) {
      return h('svg', { ...ICON_BASE, width: size, height: size, viewBox: '0 0 16 16' },
        h('path', { d: 'M8 2.5 14 13H2z' }),
        h('path', { d: 'M8 6.25v3.25' }),
        h('path', { d: 'M8 11.5v.01' }));
    }

    /**
     * One wallet total that rolls from the previous amount to the new one.
     * A first mount renders the current value directly; reduced-motion
     * preferences replace the tween with an immediate value.
     * @param {{value: number, currency: string}} props - target total and currency.
     */
    function AnimatedMoney({ value, currency }) {
      const target = Number.isFinite(value) ? value : 0;
      const [display, setDisplay] = useState(target);
      const displayRef = useRef(target);
      const frame = useRef(0);
      useEffect(() => {
        const from = displayRef.current;
        if (from === target) return undefined;
        const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) {
          displayRef.current = target;
          setDisplay(target);
          return undefined;
        }
        const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const duration = 560;
        const tick = now => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          const next = progress >= 1 ? target : from + (target - from) * eased;
          displayRef.current = next;
          setDisplay(next);
          if (progress < 1) frame.current = window.requestAnimationFrame(tick);
        };
        frame.current = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame.current);
      }, [target]);
      return h('span', { className: 'dbal-money' }, formatBalance(String(display), currency));
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
      /*
       * Several footer actions share one flex row. Stack them into full-width
       * rows only when more than one action is mounted; a lone action keeps
       * the host's row layout.
       */
      div:has(> [data-slot="sidebar.footer.action"] ~ [data-slot="sidebar.footer.action"]) {
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
      }
      .dbal-wrap {
        position: relative;
        flex: none;
        display: flex;
        align-items: center;
        width: 100%;
        height: 42px;
        min-width: 0;
        margin: 8px 0 0;
        order: 10;
        font-family: var(--dsh-font-family, inherit);
      }
      .dbal-wrap[data-wide="false"] {
        width: 36px;
        height: 36px;
        margin: 0;
      }
      .dbal-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: calc(100% + 4px);
        height: 42px;
        margin: 0 -2px;
        padding: 0 10px 0 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
        box-sizing: border-box;
      }
      .dbal-wrap[data-wide="false"] .dbal-row {
        justify-content: center;
        gap: 0;
        width: 36px;
        height: 36px;
        margin: 0;
        padding: 0;
        border-radius: 50%;
      }
      .dbal-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dbal-row:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: 2px;
      }
      .dbal-glyph {
        flex: none;
        display: inline-flex;
        color: var(--dsw-alias-label-secondary);
      }
      .dbal-label {
        flex: none;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbal-money {
        display: inline-block;
        font-variant-numeric: tabular-nums;
      }
      .dbal-amount {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        font-size: 14px;
        color: var(--dsw-alias-label-primary);
      }
      .dbal-amount[data-tone="warning"] { color: var(--dsw-alias-state-warn-label, #b45309); }
      .dbal-amount[data-tone="danger"] { color: var(--dsw-alias-state-error-primary, #b42318); }
      .dbal-amount[data-tone="muted"] { color: var(--dsw-alias-label-tertiary); font-weight: 500; }
      .dbal-dot {
        flex: none;
        width: 5px;
        height: 5px;
        margin-right: 2px;
        border-radius: 50%;
        background: var(--dsw-alias-state-warn-primary, #b45309);
      }
      .dbal-dot[data-busy="true"] {
        animation: dbal-pulse 1.2s ease-in-out infinite;
        background: var(--dsw-alias-label-tertiary);
      }
      @keyframes dbal-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .dbal-dot[data-busy="true"] { animation: none; }
      }
      .dbal-popover {
        position: fixed;
        isolation: isolate;
        z-index: 30;
        max-width: calc(100vw - 16px);
        max-height: 60vh;
        overflow-y: auto;
        padding: 10px;
        box-sizing: border-box;
        border: 0.5px solid var(--dsw-alias-border-l1, var(--dsw-alias-border-l3));
        border-radius: 12px;
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));
        -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);
        backdrop-filter: var(--dsw-menu-backdrop-filter);
        box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgba(0, 0, 0, 0.18));
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsh-font-family, inherit);
        font-size: 13px;
        line-height: 20px;
        outline: none;
      }
      .dbal-head {
        color: var(--dsw-alias-label-caption);
        font-size: 12px;
        line-height: 18px;
        padding: 0 2px 6px;
      }
      .dbal-rows { display: flex; flex-direction: column; gap: 2px; }
      .dbal-amountRow {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        padding: 3px 2px;
      }
      .dbal-amountRow span { color: var(--dsw-alias-label-secondary); }
      .dbal-amountRow strong {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--dsw-alias-label-primary);
      }
      .dbal-amountRow[data-row="bonus"] strong { color: var(--dsw-alias-label-secondary); }
      .dbal-note {
        display: flex;
        gap: 6px;
        margin: 8px 0 0;
        padding: 7px 8px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-l2, rgba(127, 127, 127, 0.08));
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 17px;
      }
      .dbal-note[data-tone="warning"] { color: var(--dsw-alias-state-warn-label, #b45309); }
      .dbal-note[data-tone="warning"] svg { flex: none; margin-top: 1px; }
      .dbal-copy { display: flex; flex-direction: column; gap: 3px; }
      .dbal-copy strong { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 13px; }
      .dbal-meta {
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 16px;
        padding: 8px 2px 2px;
      }
      .dbal-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 0.5px solid var(--dsw-alias-border-l4);
      }
      .dbal-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 28px;
        padding: 3px 9px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        text-decoration: none;
        cursor: pointer;
      }
      .dbal-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dbal-action:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: 1px;
      }
      .dbal-action:disabled { opacity: 0.6; cursor: default; }
      .dbal-spacer { flex: 1 1 auto; }
    `;

    // ---------------------------------------------------------------------
    // Sidebar row
    // ---------------------------------------------------------------------

    function BalanceFooter({ store, t, wide }) {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState(null);
      const wrap = useRef(null);
      const trigger = useRef(null);
      const popover = useRef(null);
      const focusOnOpen = useRef(false);

      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = event => {
          if (wrap.current !== null && !wrap.current.contains(event.target)
            && popover.current !== null && !popover.current.contains(event.target)) {
            setOpen(false);
          }
        };
        const onKeyDown = event => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          setOpen(false);
          if (trigger.current !== null) trigger.current.focus();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      useEffect(() => {
        if (open) store.refreshIfStale(STALE_MS);
      }, [open, store]);

      // A rail/expanded switch moves the row; close rather than leave a stale card.
      useEffect(() => { setOpen(false); }, [wide]);

      // The sidebar clips overflow, so the card is fixed and follows the row
      // through a measured, viewport-clamped offset.
      useLayoutEffect(() => {
        if (!open) {
          setAnchor(null);
          return undefined;
        }
        const place = () => {
          const rect = trigger.current === null ? null : trigger.current.getBoundingClientRect();
          if (rect === null) return;
          const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
          setAnchor({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            bottom: window.innerHeight - rect.top + 8,
            width,
          });
        };
        focusOnOpen.current = true;
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open]);

      useEffect(() => {
        if (!open || anchor === null || !focusOnOpen.current) return;
        focusOnOpen.current = false;
        if (popover.current !== null) popover.current.focus();
      }, [open, anchor]);

      const status = snapshot.status;
      const normal = Array.isArray(snapshot.wallets) ? snapshot.wallets : [];
      const bonus = Array.isArray(snapshot.bonusWallets) ? snapshot.bonusWallets : [];
      const recharge = aggregate(normal);
      const bonusEntries = aggregate(bonus).filter(entry => entry.total > 0);
      const spendable = aggregate([...normal, ...bonus]);
      const amount = walletText(spendable);
      const amountNodes = [];
      spendable.forEach((entry, index) => {
        if (index > 0) amountNodes.push(h('span', { key: `sep-${entry.currency}` }, ' · '));
        amountNodes.push(h(AnimatedMoney, { key: entry.currency, value: entry.total, currency: entry.currency }));
      });
      const primary = spendable.length > 0 ? spendable[0] : null;
      const total = primary === null ? 0 : primary.total;
      const tone = status !== 'ready'
        ? 'muted'
        : primary === null || total <= 0 ? 'danger'
          : total < 1 ? 'danger'
            : total < LOW_BALANCE ? 'warning' : 'normal';
      let chip;
      if (status === 'loading') chip = t('loading');
      else if (status === 'ready') chip = amountNodes.length > 0 ? amountNodes : t('empty');
      else if (status === 'signed-out') chip = t('signedOut');
      else chip = t('error');

      const aria = status === 'loading'
        ? t('ariaLoading')
        : status === 'ready'
          ? t(amount ? 'aria' : 'ariaEmpty', { amount })
          : status === 'signed-out' ? t('ariaSignedOut') : t('ariaError');

      let meta;
      if (status === 'loading') meta = t('meta.never');
      else if (status === 'signed-out') meta = t('meta.signedOut');
      else if (status === 'error') meta = t('meta.retry');
      else meta = t(snapshot.failed ? 'meta.stale' : 'meta', { time: clockText(snapshot.updatedAt) });

      const rows = [];
      if (status === 'ready') {
        if (recharge.length === 0 && bonusEntries.length === 0) {
          rows.push(h('div', { className: 'dbal-amountRow', key: 'empty' },
            h('span', null, t('row.recharge')), h('strong', null, formatBalance('0', 'CNY'))));
        }
        for (const entry of recharge) {
          rows.push(h('div', { className: 'dbal-amountRow', key: `recharge-${entry.currency}`, 'data-row': 'recharge' },
            h('span', null, t('row.recharge')),
            h('strong', null, h(AnimatedMoney, { value: entry.total, currency: entry.currency }))));
        }
        for (const entry of bonusEntries) {
          rows.push(h('div', { className: 'dbal-amountRow', key: `bonus-${entry.currency}`, 'data-row': 'bonus' },
            h('span', null, t('row.bonus')),
            h('strong', null, h(AnimatedMoney, { value: entry.total, currency: entry.currency }))));
        }
      }

      const note = (titleKey, bodyKey, vars) => h('div', { className: 'dbal-note', 'data-tone': 'warning' },
        h(WarningIcon, { size: 14 }),
        h('div', { className: 'dbal-copy' },
          h('strong', null, t(titleKey)),
          h('span', null, t(bodyKey, vars))));

      let lowNote = null;
      if (status === 'ready' && primary !== null) {
        if (total <= 0) lowNote = note('zero.title', 'zero.body');
        else if (total < LOW_BALANCE) lowNote = note('low.title', 'low.body', {
          amount: formatBalance(String(LOW_BALANCE), primary.currency),
        });
      }

      let body;
      if (status === 'loading') {
        body = h('div', { className: 'dbal-note' }, t('meta.never'));
      } else if (status === 'signed-out') {
        body = h('div', { className: 'dbal-note' },
          h('div', { className: 'dbal-copy' },
            h('strong', null, t('signedOut.title')),
            h('span', null, t('signedOut.body')),
            h('span', null, t('signedOut.hint'))));
      } else if (status === 'error') {
        body = h('div', { className: 'dbal-note' },
          h('div', { className: 'dbal-copy' },
            h('strong', null, t('error.title')),
            h('span', null, t('error.body'))));
      } else {
        body = h('div', { className: 'dbal-rows' }, rows);
      }

      const actions = [];
      if (status !== 'loading') {
        actions.push(h('button', {
          key: 'refresh',
          type: 'button',
          className: 'dbal-action',
          disabled: snapshot.refreshing,
          onClick: () => { void store.refresh(); },
        }, snapshot.refreshing
          ? h('span', null, t('action.refreshing'))
          : [h(RefreshIcon, { key: 'icon', size: 12 }), h('span', { key: 'label' }, t('action.refresh'))]));
      }
      if (snapshot.links && snapshot.links.topUpUrl) {
        actions.push(h('span', { className: 'dbal-spacer', key: 'spacer' }));
        actions.push(h('a', {
          key: 'top-up',
          className: 'dbal-action',
          href: snapshot.links.topUpUrl,
          target: '_blank',
          rel: 'noreferrer',
        }, t('action.topUp')));
      }
      if (snapshot.links && snapshot.links.usageUrl) {
        actions.push(h('a', {
          key: 'usage',
          className: 'dbal-action',
          href: snapshot.links.usageUrl,
          target: '_blank',
          rel: 'noreferrer',
        }, t('action.usage')));
      }

      const card = open && anchor !== null
        ? h('div', {
          ref: popover,
          id: POPOVER_ID,
          className: 'dbal-popover',
          role: 'dialog',
          'aria-label': t('title'),
          'aria-busy': snapshot.refreshing ? 'true' : 'false',
          tabIndex: -1,
          style: { left: anchor.left, bottom: anchor.bottom, width: anchor.width },
        },
        h('div', { className: 'dbal-head' }, t('title')),
        body,
        lowNote,
        h('div', { className: 'dbal-meta', 'aria-live': 'polite' }, meta),
        actions.length > 0 ? h('div', { className: 'dbal-actions' }, actions) : null)
        : null;

      return h('div', { ref: wrap, className: 'dbal-wrap', 'data-wide': wide ? 'true' : 'false' },
        h('style', null, CSS),
        h('button', {
          ref: trigger,
          type: 'button',
          className: 'dbal-row',
          'aria-label': aria,
          title: aria,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': open ? POPOVER_ID : undefined,
          'data-state': status,
          onClick: () => { setOpen(value => !value); },
          onContextMenu: event => {
            event.preventDefault();
            void store.refresh();
          },
        },
        h('span', { className: 'dbal-glyph' }, h(WalletIcon, { size: 16 })),
        wide ? h('span', { className: 'dbal-label' }, t('label')) : null,
        wide ? h('span', { className: 'dbal-amount', 'data-tone': tone }, chip) : null,
        wide && snapshot.refreshing ? h('span', { className: 'dbal-dot', 'data-busy': 'true' }) : null,
        wide && !snapshot.refreshing && snapshot.failed && status === 'ready'
          ? h('span', { className: 'dbal-dot' })
          : null),
        card);
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'balance-badge: locale dictionaries');
      const t = ctx.locale.bind(NS);

      const clientMetadata = () => ({
        version: (typeof process !== 'undefined' && process.env && process.env.DSH_CLIENT_VERSION) || '0.0.0',
        locale: ctx.locale.getSnapshot().active,
        // Date.getTimezoneOffset reports minutes west of UTC; platform wants seconds east.
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      });

      const store = createStore({
        getState: () => ctx.remote.account.getState(),
        getBalance: () => ctx.remote.account.getBalance(clientMetadata()),
      });

      ctx.effect(() => {
        store.start();
        return () => store.stop();
      }, 'balance-badge: refresh loop');

      ctx.effect(() => {
        const onVisibility = () => {
          if (document.visibilityState === 'visible') store.refreshIfStale(STALE_MS);
        };
        const onFocus = () => store.refreshIfStale(STALE_MS);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        // A new Host connection re-establishes the account session; re-read once.
        const offConnection = ctx.on('connection/reset', () => { void store.refresh({ quiet: true }); });
        // Signing in or out elsewhere in DSH updates the badge without waiting.
        const offAccount = ctx.on('account-ui/change', (_state, reset) => {
          if (reset) void store.refresh({ quiet: true });
        });
        return () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onFocus);
          offConnection();
          offAccount();
        };
      }, 'balance-badge: freshness triggers');

      ctx.effect(
        () => ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'balance-badge',
            order: 10,
            locale: NS,
            inject: () => ({ store, t }),
          }, BalanceFooter)),
        'balance-badge: sidebar balance row',
      );
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply,
    };
  },
});
