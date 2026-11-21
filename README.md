# API Balance / API 余额

`dsh-wallet-badge` — a persistent DeepSeek API balance row for the DeepSeek
Harness sidebar footer. It reads the recharge and bonus wallets of the signed-in
DeepSeek account and checks them once a minute, so the remaining amount is
visible without opening the platform website.

## What it does

- Adds a **余额 / Balance** row above **Settings** in the sidebar footer.
  - Expanded sidebar: `余额   ¥12.34`, the sum of the recharge and bonus wallets.
  - Collapsed sidebar: a wallet icon only; the tooltip and the detail card show
    the amount.
  - The amount turns amber below `¥5`, red at `¥0` or below `¥1`.
- Click the row to open a small detail card:
  - recharge balance, and bonus balance when it is non-zero;
  - the last update time and the automatic refresh cadence;
  - **刷新 / Refresh**, **去充值 / Top up**, and **用量明细 / Usage** actions.
- Refreshes immediately when the window regains focus, when the page becomes
  visible again, when a new Host connection is established, and when the DSH
  account signs in or out. Right-click the row to refresh on demand.
- A poll that returns the same wallets leaves the rendered row untouched — no
  re-render and no animation. Only an actual balance change updates the UI.
- When an amount changes, it rolls from the old value to the new one over about
  0.6s; `prefers-reduced-motion` users see the final value immediately.
- Signed out: the row reads `未登录 / Signed out` and the card explains where to
  sign in (**Settings → Account**). Afterwards the badge fills in by itself.

## Data and privacy

- The balance comes from the same authenticated account Remote call that the
  **Settings → Account** page uses (`account.getBalance`): the DSH Host holds the
  credential and requests `/api/v0/users/get_user_summary` from the configured
  DeepSeek platform origin. This plugin never sees, reads, or stores the token.
- No API key is needed or read. The plugin adds no Host route, no model request,
  no session event, and no token usage.
- Turning the plugin off removes the row and stops the polling.

## Limits

- The row shows the usable total (recharge plus bonus), so it can be larger
  than the platform's **recharge balance** line; the detail card splits the two.
- Requires a signed-in DeepSeek account in DSH. A profile that only uses a
  manually entered API key with an unrelated provider has no account wallet to
  read, so the row stays at `未登录`.
- The collapsed rail (Windows/Web) shows the wallet icon only; the amount is in
  its tooltip and in the detail card. Desktop macOS hides the sidebar entirely
  when collapsed.
- The badge is a read-only glance: recharge and detailed billing still happen on
  the platform website, which the card links to.
- Automatic refresh is a one-minute poll rather than a server push; a change on
  the platform appears within a minute or on the next focus/refresh.
- The row shares the sidebar footer with other plugins; when several footer
  actions are mounted they stack, which can make the sidebar foot taller.

## Install

```sh
# Add this package as a DSH profile bundle
npm install dsh-wallet-badge
```

Then add `dsh-wallet-badge` to the profile's `dsh.profile.bundles`, or install
the directory through DSH's **Plugins → Add plugin** (it accepts a local path or
an npm package name). The bundle contains a no-op Host half and one Client
contribution.
