/* The Family Ledger — the household's Statement of Financial Condition workbook as a small app.
   One part per sheet: Notes (pay schedule), Worksheet (monthly expenses, loans and net worth),
   the rent sheet, and Cut Expenses. Kept in this browser (localStorage), optionally mirrored
   to a folder the owner picks, imported from and exported to Excel. No server, no account.
   All user text is escaped before it goes into the page. */
'use strict';

/* ------------------------------------------------------------ basics */
const KEY = 'ledger.v1';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const num = v => { if (v === '' || v == null) return null; if (typeof v === 'number') return Number.isFinite(v) ? v : null; const s = String(v).trim(); const neg = /^\(.*\)$/.test(s); const n = Number(s.replace(/[$,%()\s]/g, '')); return Number.isFinite(n) ? (neg ? -n : n) : null; };
const r2 = n => Math.round(n * 100) / 100;
const sum = (arr, f) => r2(arr.reduce((t, x) => t + (f(x) || 0), 0));
const money = (n, cents = true) => n == null || !Number.isFinite(n) ? '' : (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0});
const monthKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const thisMonth = () => monthKey(new Date());
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = k => { const m = /^(\d{4})-(\d{2})$/.exec(k || ''); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : (k || ''); };
const parseDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : (s || ''); };
const ordinal = n => { n = num(n); if (n == null) return ''; const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };

/* ------------------------------------------------------------ state */
function blank() {
  return {
    version: 1, savedAt: null,
    title: 'The Family Ledger',
    schedule: [],          // {id, name, group: first|last|other, due, pay, amount}  income +, bills −
    monthly: [],           // {id, name, due, amount}
    paid: {},              // {'2026-10': {itemId: true}} for schedule and monthly items
    monthlyNotes: [],      // {id, text}
    loans: [],             // {id, name, balance, asOf, value, payoff, rate, notes}
    worksheetNotes: [],
    insurance: {name: 'Home & farm insurance', rows: []},   // {id, year, premium, note}
    rent: {title: 'Family Rent', charges: [], payments: [], notes: []},  // payments {id, month, amount, paid, note}
    cuts: {income: [], expenses: [], side: [], changes: [], jobsA: [], jobsB: [], jobsATitle: 'Possible jobs for me', jobsBTitle: 'Other options'}
  };
}
function normalize(d) {
  const b = blank();
  const out = {...b, ...d, insurance: {...b.insurance, ...(d.insurance || {})}, rent: {...b.rent, ...(d.rent || {})}, cuts: {...b.cuts, ...(d.cuts || {})}};
  return out;
}
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.version === 1) return normalize(d); } catch (e) { /* start fresh */ }
  return blank();
}
let S = load();
const ui = {open: null, month: thisMonth()};

/* ------------------------------------------------------------ saving */
let folder = null, folderTimer = 0;
function save() {
  S.savedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { saveLine('Could not save on this device. Download a backup now (Import, Export & Backups).', true); return; }
  if (folder) { clearTimeout(folderTimer); folderTimer = setTimeout(writeFolder, 400); }
  saveLine(); renderLanding();
}
function saveLine(msg, bad) {
  const el = $('saveLine'); if (!el) return;
  el.classList.toggle('bad', !!bad);
  if (msg) { el.textContent = msg; return; }
  const t = S.savedAt ? new Date(S.savedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}) : '';
  el.textContent = 'Saved on this device' + (t ? ' · ' + t : '') + (folder ? ' · also saving to folder “' + folder.name + '”' : '');
}
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('ledger-folder', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function rememberFolder(h) { try { const db = await idb(); db.transaction('h', 'readwrite').objectStore('h').put(h, 'dir'); } catch (e) { /* not essential */ } }
async function recallFolder() { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
async function writeFolder() {
  if (!folder) return;
  try { const f = await folder.getFileHandle('family-ledger.json', {create: true}); const w = await f.createWritable(); await w.write(JSON.stringify(S, null, 1)); await w.close(); }
  catch (e) { saveLine('Saved on this device, but not to the folder: ' + e.message, true); }
}
async function chooseFolder() {
  if (!window.showDirectoryPicker) { alert('Saving to a folder works in Microsoft Edge or Google Chrome on a computer. On this device, use “Download a backup” instead.'); return; }
  try { const h = await window.showDirectoryPicker({mode: 'readwrite'}); folder = h; await rememberFolder(h); await writeFolder(); saveLine(); renderSheet(); toast('Saving to “' + h.name + '”'); }
  catch (e) { if (e && e.name !== 'AbortError') alert('Could not use that folder: ' + e.message); }
}

/* ------------------------------------------------------------ figures */
const isPaid = (id, m = ui.month) => !!(S.paid[m] && S.paid[m][id]);
const setPaid = (id, v, m = ui.month) => { S.paid[m] = S.paid[m] || {}; if (v) S.paid[m][id] = true; else delete S.paid[m][id]; };
const group = g => S.schedule.filter(x => (x.group || 'first') === g);
const amt = x => num(x.amount) || 0;
const scheduleNet = g => sum(group(g), amt);
const leftToPay = list => sum(list.filter(x => amt(x) < 0 && !isPaid(x.id)), x => -amt(x));
const monthlyBalance = () => sum(S.monthly, amt);
const debt = () => sum(S.loans, x => num(x.balance));
const worth = () => sum(S.loans, x => num(x.value));
const netWorth = () => r2(worth() - debt());
const rentMonthly = () => sum(S.rent.charges, amt);
const rentOwed = () => sum(S.rent.payments.filter(p => !p.paid && p.month && p.month <= thisMonth()), p => num(p.amount));
const cutIncome = () => sum(S.cuts.income, amt);
const cutExpenses = () => sum(S.cuts.expenses, amt);
const cutBalance = () => r2(cutIncome() - cutExpenses());
const sideIncome = () => sum(S.cuts.side, amt);
function payoffText(s) {
  const d = parseDate(s); if (!d) return '';
  const now = new Date(); let m = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  if (m <= 0) return 'due now';
  const y = Math.floor(m / 12); m %= 12;
  return (y ? y + ' yr' + (y === 1 ? '' : 's') : '') + (y && m ? ' ' : '') + (m ? m + ' mo' : '') + ' to go';
}

/* ------------------------------------------------------------ editable tables */
// each list the screens can edit, by name
const LISTS = {
  schedule: () => S.schedule, monthly: () => S.monthly, monthlyNotes: () => S.monthlyNotes, loans: () => S.loans, worksheetNotes: () => S.worksheetNotes,
  insurance: () => S.insurance.rows, rentCharges: () => S.rent.charges, rentPayments: () => S.rent.payments, rentNotes: () => S.rent.notes,
  cutIncome: () => S.cuts.income, cutExpenses: () => S.cuts.expenses, cutSide: () => S.cuts.side, cutChanges: () => S.cuts.changes, jobsA: () => S.cuts.jobsA, jobsB: () => S.cuts.jobsB
};
const PAY_WAYS = ['Bank', 'CC', 'Auto', 'Cash', 'Check'];
function cellInput(list, row, c) {
  const v = row[c.k], name = esc(c.label + ' for ' + (row.name || row.text || row.month || 'this row'));
  const at = `data-list="${list}" data-id="${row.id}" data-k="${c.k}" aria-label="${name}"`;
  switch (c.type) {
    case 'paid': return `<label class="tick"><input type="checkbox" data-paid="${row.id}" aria-label="${esc('Paid ' + (row.name || '') + ' in ' + monthName(ui.month))}"${isPaid(row.id) ? ' checked' : ''}><span aria-hidden="true"></span></label>`;
    case 'check': return `<label class="tick"><input type="checkbox" ${at}${v ? ' checked' : ''}><span aria-hidden="true"></span></label>`;
    case 'money': return `<input class="num${num(v) != null && num(v) < 0 ? ' neg' : num(v) > 0 && c.signed ? ' pos' : ''}" inputmode="decimal" ${at} value="${esc(v ?? '')}">`;
    case 'number': case 'day': case 'pct': return `<input class="num${c.type === 'day' ? ' short' : ''}" inputmode="decimal" ${at} value="${esc(v ?? '')}">`;
    case 'date': return `<input type="date" ${at} value="${esc(v || '')}">`;
    case 'month': return `<input type="month" ${at} value="${esc(v || '')}">`;
    case 'pay': return `<input list="payWays" class="short" ${at} value="${esc(v || '')}">`;
    case 'group': return `<select ${at}>${[['first', 'First'], ['last', 'Last'], ['other', 'Separate']].map(([k, l]) => `<option value="${k}"${(v || 'first') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    case 'calc': return `<span class="calc" data-calc="${list}:${row.id}:${c.k}">${esc(c.get(row))}</span>`;
    default: return `<input ${at} value="${esc(v || '')}"${c.ph ? ` placeholder="${esc(c.ph)}"` : ''}>`;
  }
}
function grid(list, rows, cols, opts = {}) {
  const head = cols.map(c => `<th class="${c.cls || ''}${c.type === 'money' || c.type === 'number' || c.type === 'pct' || c.type === 'day' ? ' r' : ''}" scope="col">${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr${opts.rowClass ? ` class="${opts.rowClass(r)}"` : ''}>${cols.map(c => `<td class="${c.cls || ''}">${cellInput(list, r, c)}</td>`).join('')}<td class="x"><button type="button" class="del" data-del="${list}" data-id="${r.id}" aria-label="Remove ${esc(r.name || r.text || monthName(r.month) || 'row')}">&times;</button></td></tr>`).join('');
  const foot = opts.foot ? `<tfoot>${opts.foot}</tfoot>` : '';
  return `<div class="grid-wrap"><table class="grid${opts.wide ? ' wide' : ''}">${opts.caption ? `<caption>${esc(opts.caption)}</caption>` : ''}<thead><tr>${head}<th class="x"><span class="sr">Remove</span></th></tr></thead><tbody>${body || `<tr><td colspan="${cols.length + 1}" class="empty">Nothing here yet.</td></tr>`}</tbody>${foot}</table></div>
    <button type="button" class="add" data-add="${list}"${opts.addDefaults ? ` data-defaults='${esc(JSON.stringify(opts.addDefaults))}'` : ''}>+ ${esc(opts.addLabel || 'Add a line')}</button>`;
}
const notesBlock = (list, title) => `<section class="block notes-block"><h3>${esc(title)}</h3>
  <ul class="notes">${LISTS[list]().map(n => `<li><textarea rows="1" data-list="${list}" data-id="${n.id}" data-k="text" aria-label="Note">${esc(n.text || '')}</textarea><button type="button" class="del" data-del="${list}" data-id="${n.id}" aria-label="Remove note">&times;</button></li>`).join('')}</ul>
  <button type="button" class="add" data-add="${list}">+ Add a note</button></section>`;
const figure = (label, value, cls = '', small = '') => `<div class="fig ${cls}"><dt>${esc(label)}</dt><dd>${value}</dd>${small ? `<dd class="small">${small}</dd>` : ''}</div>`;
const signCls = n => n < 0 ? 'neg' : n > 0 ? 'pos' : '';
function monthPicker() {
  const now = new Date(), opts = [];
  for (let i = -12; i <= 3; i++) opts.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  if (!opts.includes(ui.month)) opts.push(ui.month);
  return `<label class="month-pick">Month <select id="monthPick">${opts.sort().reverse().map(m => `<option value="${m}"${m === ui.month ? ' selected' : ''}>${monthName(m)}</option>`).join('')}</select></label>`;
}

/* ------------------------------------------------------------ the parts (one per sheet) */
const SHEETS = {
  schedule: {
    title: 'Pay Schedule', from: 'From the “Notes” sheet', tools: monthPicker, cls: 'sp-schedule',
    body() {
      const cols = [{k: 'name', label: 'Item', ph: 'e.g. Electric'}, {k: 'due', label: 'Due', type: 'day', cls: 'w-day'}, {k: 'pay', label: 'Pay', type: 'pay', cls: 'w-pay hide-sm'},
        {k: 'amount', label: 'Amount', type: 'money', signed: true, cls: 'w-money'}, {k: 'paid', label: 'Paid?', type: 'paid', cls: 'w-tick'}, {k: 'group', label: 'Move to', type: 'group', cls: 'w-group hide-print hide-sm'}];
      const half = (g, title) => `<section class="block"><h3>${title}</h3>${grid('schedule', group(g), cols, {addLabel: 'Add to ' + title.toLowerCase(), addDefaults: {group: g},
        foot: `<tr><td colspan="3">Net</td><td class="r"><span data-sum="net-${g}"></span></td><td colspan="3"></td></tr>`})}<p class="left" data-sum="left-${g}"></p></section>`;
      return `<p class="lede">Money in is a plus, bills are a minus. Tick each bill as it’s paid for <b>${esc(monthName(ui.month))}</b>; the ticks are kept month by month.</p>
        <dl class="figs" data-sum="schedFigs"></dl>
        <div class="two">${half('first', 'First of Month')}${half('last', 'Last of Month')}</div>
        ${group('other').length ? half('other', 'Kept separate') : `<button type="button" class="add" data-add="schedule" data-defaults='${esc(JSON.stringify({group: 'other'}))}'>+ Add a bill kept separate from both halves</button>`}`;
    }
  },
  monthly: {
    title: 'Monthly Expenses & Net Worth', from: 'From the “Worksheet” sheet', tools: monthPicker, cls: 'sp-monthly',
    body() {
      const mcols = [{k: 'name', label: 'Item', ph: 'e.g. House'}, {k: 'due', label: 'Due', type: 'day', cls: 'w-day'}, {k: 'amount', label: 'Amount', type: 'money', signed: true, cls: 'w-money'}, {k: 'paid', label: 'Paid?', type: 'paid', cls: 'w-tick'}];
      const lcols = [{k: 'name', label: 'Loan or asset', ph: 'e.g. Truck'}, {k: 'balance', label: 'Balance owed', type: 'money', cls: 'w-money'}, {k: 'asOf', label: 'As of', type: 'date', cls: 'w-date'},
        {k: 'value', label: 'Value', type: 'money', cls: 'w-money'}, {k: 'payoff', label: 'Pay off', type: 'date', cls: 'w-date'}, {k: 'rate', label: 'Rate %', type: 'pct', cls: 'w-rate'},
        {k: 'left', label: 'Left', type: 'calc', get: r => num(r.balance) ? payoffText(r.payoff) : '', cls: 'w-left'}, {k: 'notes', label: 'Notes'}];
      const icols = [{k: 'year', label: 'Year', type: 'number', cls: 'w-day'}, {k: 'premium', label: 'Premium', type: 'money', cls: 'w-money'},
        {k: 'change', label: 'Change', type: 'calc', get: r => insChange(r), cls: 'w-money r'}, {k: 'note', label: 'Notes'}];
      return `<section class="block"><h3>Statement of Financial Condition</h3>
          <dl class="figs" data-sum="worthFigs"></dl>
          ${grid('loans', S.loans, lcols, {wide: true, addLabel: 'Add a loan or asset', foot: `<tr><td>Totals</td><td class="r"><span data-sum="debt"></span></td><td></td><td class="r"><span data-sum="worth"></span></td><td colspan="5"></td></tr>`})}
        </section>
        <div class="two">
        <section class="block"><h3>Monthly Expenses</h3>
          <p class="lede">Paychecks as a plus, bills as a minus. Ticks are for <b>${esc(monthName(ui.month))}</b>.</p>
          ${grid('monthly', S.monthly, mcols, {addLabel: 'Add an expense', foot: `<tr><td colspan="2">Balance</td><td class="r"><span data-sum="monthlyBal"></span></td><td colspan="2"></td></tr>`})}
          <p class="left" data-sum="left-monthly"></p>
          ${notesBlock('monthlyNotes', 'Reminders')}
        </section>
        <section class="block">
          ${notesBlock('worksheetNotes', 'Notes')}
          <section class="block"><h3><input class="title-input" data-title="insurance" value="${esc(S.insurance.name)}" aria-label="Name of the insurance"> by year</h3>
            ${grid('insurance', S.insurance.rows.slice().sort((a, b) => (num(b.year) || 0) - (num(a.year) || 0)), icols, {addLabel: 'Add a year'})}</section>
        </section></div>`;
    }
  },
  rent: {
    title: () => S.rent.title || 'Family Rent', from: () => 'From the “' + (S.rent.title || 'rent') + '” sheet', cls: 'sp-rent',
    body() {
      const ccols = [{k: 'name', label: 'Covers', ph: 'e.g. Cell phone'}, {k: 'amount', label: 'Each month', type: 'money', cls: 'w-money'}];
      const pcols = [{k: 'month', label: 'Month', type: 'month', cls: 'w-month'}, {k: 'amount', label: 'Amount', type: 'money', cls: 'w-money'}, {k: 'paid', label: 'Paid?', type: 'check', cls: 'w-tick'}, {k: 'note', label: 'Notes'}];
      const pays = S.rent.payments.slice().sort((a, b) => (a.month || '') < (b.month || '') ? 1 : -1);
      return `<div class="field-line"><label for="rentTitle">Sheet name</label><input id="rentTitle" data-title="rent" value="${esc(S.rent.title)}"></div>
        <dl class="figs" data-sum="rentFigs"></dl>
        <div class="two wide-right">
          <section class="block"><h3>What it covers</h3>${grid('rentCharges', S.rent.charges, ccols, {addLabel: 'Add a charge', foot: `<tr><td>Total each month</td><td class="r"><span data-sum="rentMonthly"></span></td><td></td></tr>`})}
            ${notesBlock('rentNotes', 'Notes')}</section>
          <section class="block"><h3>Month by month</h3>
            <button type="button" class="add solid" id="nextRentMonth">+ Add the next month</button>
            ${grid('rentPayments', pays, pcols, {addLabel: 'Add a month', rowClass: r => !r.paid && r.month && r.month <= thisMonth() ? 'due' : ''})}</section>
        </div>`;
    }
  },
  cuts: {
    title: 'Cut Expenses', from: 'From the “Cut Expenses” sheet', cls: 'sp-cuts',
    body() {
      const mc = [{k: 'name', label: 'Item'}, {k: 'amount', label: 'Amount', type: 'money', cls: 'w-money'}];
      const sc = [{k: 'name', label: 'Side income'}, {k: 'amount', label: 'About a month', type: 'money', cls: 'w-money'}, {k: 'note', label: 'Notes'}];
      return `<p class="lede">The leaner monthly budget. Expenses here are entered as plain amounts (no minus sign).</p>
        <dl class="figs" data-sum="cutFigs"></dl>
        <div class="two">
          <section class="block"><h3>Income</h3>${grid('cutIncome', S.cuts.income, mc, {addLabel: 'Add income', foot: `<tr><td>Total income</td><td class="r"><span data-sum="cutIncome"></span></td><td></td></tr>`})}
            <h3>Expenses</h3>${grid('cutExpenses', S.cuts.expenses, mc, {addLabel: 'Add an expense', foot: `<tr><td>Total expenses</td><td class="r"><span data-sum="cutExpenses"></span></td><td></td></tr><tr><td>Balance</td><td class="r"><span data-sum="cutBalance"></span></td><td></td></tr>`})}
            <h3>Extra income</h3>${grid('cutSide', S.cuts.side, sc, {addLabel: 'Add side income'})}</section>
          <section class="block"><h3>Changes to make</h3>
            ${grid('cutChanges', S.cuts.changes, [{k: 'done', label: 'Done', type: 'check', cls: 'w-tick'}, {k: 'text', label: 'Change'}], {addLabel: 'Add a change', rowClass: r => r.done ? 'done' : ''})}
            <h3><input class="title-input" data-title="jobsA" value="${esc(S.cuts.jobsATitle)}" aria-label="Heading for the first job list"></h3>
            ${grid('jobsA', S.cuts.jobsA, [{k: 'name', label: 'Job'}, {k: 'pay', label: 'Pay', cls: 'w-pay2'}], {addLabel: 'Add a job'})}
            <h3><input class="title-input" data-title="jobsB" value="${esc(S.cuts.jobsBTitle)}" aria-label="Heading for the second list"></h3>
            ${grid('jobsB', S.cuts.jobsB, [{k: 'name', label: 'Option'}], {addLabel: 'Add an option'})}</section>
        </div>`;
    }
  },
  data: {
    title: 'Import, Export & Backups', from: 'Everything stays on this device unless you save it somewhere', cls: 'sp-data', noPrint: true,
    body() {
      const n = S.schedule.length + S.monthly.length + S.loans.length + S.rent.payments.length + S.cuts.expenses.length;
      return `<div class="cards3">
        <section class="block card"><h3>Bring in the Excel file</h3><p>Choose the Statement of Financial Condition workbook. Each sheet fills its part of the ledger. This replaces what’s here now.</p>
          <button type="button" class="btn" id="importXlsx">Choose the Excel file…</button></section>
        <section class="block card"><h3>Save it back to Excel</h3><p>Makes a workbook with the same four sheets, laid out like the original, plus a hidden sheet so it imports back exactly.</p>
          <button type="button" class="btn" id="exportXlsx">Download Excel file</button></section>
        <section class="block card"><h3>Print</h3><p>Each part has its own Print button at the top. This prints all four parts together.</p>
          <button type="button" class="btn" id="printAll">Print everything</button></section>
        <section class="block card"><h3>Backups</h3><p>${n ? n + ' lines in the ledger.' : 'The ledger is empty.'} Keep a backup file somewhere safe, or let it save itself to a folder (OneDrive works) on a computer.</p>
          <div class="stack"><button type="button" class="btn ghost" id="backupJson">Download a backup</button>
          <button type="button" class="btn ghost" id="restoreJson">Restore from a backup</button>
          <button type="button" class="btn ghost" id="pickFolder">${folder ? 'Saving to “' + esc(folder.name) + '” · change' : 'Save automatically to a folder…'}</button></div></section>
        <section class="block card"><h3>The book</h3>
          <div class="field-line"><label for="bookTitle">Name on the ledger</label><input id="bookTitle" data-title="book" value="${esc(S.title)}"></div>
          <button type="button" class="btn ghost danger" id="clearAll" style="margin-top:14px">Clear everything on this device</button></section>
      </div>`;
    }
  }
};
function insChange(r) {
  const prev = S.insurance.rows.filter(x => num(x.year) === num(r.year) - 1)[0];
  if (!prev || num(prev.premium) == null || num(r.premium) == null) return '';
  const d = r2(num(r.premium) - num(prev.premium));
  return (d > 0 ? '+' : '') + money(d);
}

/* live figures on each part */
const SUMS = {
  'net-first': () => money(scheduleNet('first')), 'net-last': () => money(scheduleNet('last')), 'net-other': () => money(scheduleNet('other')),
  'left-first': () => leftText(group('first')), 'left-last': () => leftText(group('last')), 'left-other': () => leftText(group('other')),
  'left-monthly': () => leftText(S.monthly),
  schedFigs: () => {
    const inc = sum(S.schedule.filter(x => amt(x) > 0), amt), out = sum(S.schedule.filter(x => amt(x) < 0), x => -amt(x));
    return figure('Money in', money(inc), 'pos') + figure('Bills', money(out)) + figure('Net for the month', money(r2(inc - out)), signCls(inc - out)) +
      figure('Still to pay in ' + MONTHS[+ui.month.slice(5) - 1], money(leftToPay(S.schedule)), leftToPay(S.schedule) ? 'warn' : 'pos');
  },
  monthlyBal: () => money(monthlyBalance()),
  debt: () => money(debt()), worth: () => money(worth()),
  worthFigs: () => figure('Total value', money(worth(), false)) + figure('Total owed', money(debt(), false)) + figure('Net worth', money(netWorth(), false), 'big ' + signCls(netWorth()), 'value minus what’s owed'),
  rentMonthly: () => money(rentMonthly()),
  rentFigs: () => {
    const paid = S.rent.payments.filter(p => p.paid);
    return figure('Owed each month', money(rentMonthly())) + figure('Paid so far', money(sum(paid, p => num(p.amount))), 'pos', paid.length + ' month' + (paid.length === 1 ? '' : 's')) +
      figure('Not marked paid', money(rentOwed()), rentOwed() ? 'warn' : '', 'up to ' + monthName(thisMonth()));
  },
  cutIncome: () => money(cutIncome()), cutExpenses: () => money(cutExpenses()), cutBalance: () => `<b class="${signCls(cutBalance())}">${money(cutBalance())}</b>`,
  cutFigs: () => figure('Income', money(cutIncome())) + figure('Expenses', money(cutExpenses())) + figure('Left each month', money(cutBalance()), 'big ' + signCls(cutBalance())) +
    (S.cuts.side.length ? figure('With extra income', money(r2(cutBalance() + sideIncome())), signCls(cutBalance() + sideIncome()), money(sideIncome()) + ' a month more') : '')
};
function leftText(list) {
  const bills = list.filter(x => amt(x) < 0); if (!bills.length) return '';
  const unpaid = bills.filter(x => !isPaid(x.id));
  return unpaid.length ? `${unpaid.length} of ${bills.length} bills still to pay in ${MONTHS[+ui.month.slice(5) - 1]}: ${money(leftToPay(list))}` : `All ${bills.length} bills paid for ${MONTHS[+ui.month.slice(5) - 1]}.`;
}
function refreshSums() {
  document.querySelectorAll('#sheetBody [data-sum]').forEach(el => { const f = SUMS[el.dataset.sum]; if (f) el.innerHTML = f(); });
  document.querySelectorAll('#sheetBody [data-calc]').forEach(el => {
    const [list, id, k] = el.dataset.calc.split(':'); const row = LISTS[list]().find(r => r.id === id); if (!row) return;
    el.textContent = list === 'loans' ? (num(row.balance) ? payoffText(row.payoff) : '') : list === 'insurance' && k === 'change' ? insChange(row) : '';
  });
  document.querySelectorAll('#sheetBody input.num[data-k="amount"]').forEach(i => { const n = num(i.value); i.classList.toggle('neg', n != null && n < 0); });
}

/* ------------------------------------------------------------ the sheet dialog */
function openSheet(key) {
  ui.open = key;
  const d = $('sheet');
  d.className = 'sheet ' + SHEETS[key].cls;
  renderSheet();
  if (!d.open) d.showModal();
  $('sheetBody').scrollTop = 0; $('sheetBody').focus();
}
function renderSheet() {
  const key = ui.open; if (!key) return;
  const p = SHEETS[key], val = v => typeof v === 'function' ? v() : v;
  $('sheetTitle').textContent = val(p.title);
  $('sheetFrom').textContent = val(p.from);
  $('sheetTools').innerHTML = p.tools ? p.tools() : '';
  $('printSheet').hidden = !!p.noPrint;
  $('sheetBody').innerHTML = p.body() + `<datalist id="payWays">${PAY_WAYS.map(w => `<option value="${w}">`).join('')}</datalist>`;
  refreshSums(); saveLine(); autosize();
}
function autosize() { document.querySelectorAll('#sheetBody textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }

/* ------------------------------------------------------------ landing */
function renderLanding() {
  $('landTitle').textContent = S.title || 'The Family Ledger';
  document.title = S.title || 'The Family Ledger';
  $('spRent').textContent = S.rent.title || 'Family Rent';
  const items = [];
  if (S.loans.length) items.push(['Net worth', money(netWorth(), false)]);
  if (S.monthly.length) items.push(['Monthly balance', money(monthlyBalance(), false)]);
  const left = S.schedule.filter(x => amt(x) < 0 && !isPaid(x.id, thisMonth())).length;
  if (S.schedule.length) items.push(['Still to pay in ' + MONTHS[new Date().getMonth()], left ? left + ' bill' + (left === 1 ? '' : 's') : 'all paid']);
  $('glance').innerHTML = items.length ? items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')
    : `<div class="empty-glance"><dt>Start here</dt><dd>Open <b>Import, Export &amp; Backups</b> and bring in the Excel file, or open any part and type in it.</dd></div>`;
}

/* ------------------------------------------------------------ printing */
function printable(html, title) {
  // a copy of the part with every box turned into plain text
  const box = document.createElement('div'); box.innerHTML = html;
  box.querySelectorAll('input, select, textarea').forEach(el => {
    let t;
    if (el.type === 'checkbox') t = el.checked ? '✓' : '';
    else if (el.tagName === 'SELECT') t = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
    else if (el.type === 'month') t = monthName(el.value);
    else if (el.type === 'date') t = fmtDate(el.value);
    else if (el.classList.contains('num') && num(el.value) != null && el.dataset.k !== 'rate' && el.dataset.k !== 'due' && el.dataset.k !== 'year') t = money(num(el.value));
    else t = el.value;
    const s = document.createElement('span'); s.className = el.className + ' printed'; s.textContent = t;
    (el.closest('label.tick') || el).replaceWith(s);
  });
  box.querySelectorAll('button, datalist, .hide-print').forEach(el => el.remove());
  return `<section class="print-part"><h1>${esc(title)}</h1><p class="print-sub">${esc(S.title)} · printed ${new Date().toLocaleDateString('en-US', {month: 'long', day: 'numeric', year: 'numeric'})}</p>${box.innerHTML}</section>`;
}
function printParts(keys) {
  const keep = ui.open, parts = [];
  keys.forEach(k => {
    ui.open = k; const p = SHEETS[k];
    const holder = document.createElement('div'); holder.innerHTML = p.body();
    holder.querySelectorAll('[data-sum]').forEach(el => { const f = SUMS[el.dataset.sum]; if (f) el.innerHTML = f(); });
    holder.querySelectorAll('[data-calc]').forEach(el => { const [list, id] = el.dataset.calc.split(':'); const row = LISTS[list]().find(r => r.id === id); if (row) el.textContent = list === 'loans' ? (num(row.balance) ? payoffText(row.payoff) : '') : insChange(row); });
    // a detached copy keeps the typed values only as attributes, which is what printable() reads
    parts.push(printable(holder.innerHTML, typeof p.title === 'function' ? p.title() : p.title));
  });
  ui.open = keep;
  $('printArea').innerHTML = parts.join('');
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); }, 50);
}
window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); $('printArea').innerHTML = ''; });

/* ------------------------------------------------------------ Excel import */
function needXlsx() { if (window.XLSX) return true; alert('The Excel tool hasn’t loaded yet. Check the internet connection and try again.'); return false; }
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files && i.files[0]); i.click(); }); }
const cellAt = (ws, addr) => ws && ws[addr];
const val = (ws, addr) => { const c = cellAt(ws, addr); return c ? c.v : undefined; };
const txt = (ws, addr) => { const v = val(ws, addr); return v == null ? '' : String(v).trim(); };
const isoOf = v => v instanceof Date ? v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate()) : (typeof v === 'number' && window.XLSX ? (d => d.y + '-' + pad(d.m) + '-' + pad(d.d))(XLSX.SSF.parse_date_code(v)) : '');
const rowsOf = ws => { const r = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1'); return [r.s.r + 1, r.e.r + 1]; };
const findCell = (ws, test) => { for (const a of Object.keys(ws)) { if (a[0] === '!') continue; const v = ws[a].v; if (typeof v === 'string' && test(v.trim())) return XLSX.utils.decode_cell(a); } return null; };
const A = (c, r) => XLSX.utils.encode_cell({c, r: r - 1});
const sheetByName = (wb, re) => { const n = wb.SheetNames.find(x => re.test(x)); return n ? wb.Sheets[n] : null; };

function importWorkbook(wb) {
  const hidden = wb.Sheets._ledger;
  if (hidden) { const raw = Object.keys(hidden).filter(a => /^A\d+$/.test(a)).sort((x, y) => +x.slice(1) - +y.slice(1)).map(a => String(hidden[a].v ?? '')).join(''); const d = JSON.parse(raw); if (d && d.version === 1) return normalize(d); }
  const out = blank(), found = [];
  // Notes: the first block holds the pay schedule; the same block repeats lower down
  const notes = sheetByName(wb, /^notes$/i);
  if (notes) {
    const [, last] = rowsOf(notes);
    const second = []; for (let r = 2; r <= last; r++) if (/first of month/i.test(txt(notes, 'A' + r))) second.push(r);
    const end = second.length ? second[0] - 1 : last;
    let netA = Infinity; for (let r = 1; r <= end; r++) if (/^net$/i.test(txt(notes, 'C' + r))) netA = r;
    for (let r = 3; r <= end; r++) {
      const name = txt(notes, 'A' + r), a = num(val(notes, 'D' + r));
      if (name && a != null && !/first of month/i.test(name)) out.schedule.push({id: uid(), name, group: r > netA ? 'other' : 'first', due: num(val(notes, 'B' + r)) ?? '', pay: txt(notes, 'C' + r), amount: a});
      const n2 = txt(notes, 'G' + r), b = num(val(notes, 'J' + r));
      if (n2 && b != null && !/last of month/i.test(n2)) out.schedule.push({id: uid(), name: n2, group: 'last', due: num(val(notes, 'H' + r)) ?? '', pay: txt(notes, 'I' + r), amount: b});
    }
    found.push('Notes');
  }
  // Worksheet: monthly expenses in B–D, loans and assets in H–R, notes and the insurance history below
  const ws = sheetByName(wb, /^worksheet$/i);
  if (ws) {
    const [, last] = rowsOf(ws);
    let bal = last + 1;
    for (let r = 3; r <= last; r++) { if (/^balance$/i.test(txt(ws, 'B' + r))) { bal = r; break; } }
    for (let r = 3; r < bal; r++) { const name = txt(ws, 'B' + r), a = num(val(ws, 'D' + r)); if (name && a != null) out.monthly.push({id: uid(), name, due: num(val(ws, 'C' + r)) ?? '', amount: a}); }
    for (let r = bal + 1; r <= last; r++) { const t = txt(ws, 'B' + r); if (t) out.monthlyNotes.push({id: uid(), text: t.replace(/^\*+\s*/, '')}); }
    const loanRows = [];
    for (let r = 3; r <= last; r++) {
      const name = txt(ws, 'H' + r); if (!name) continue;
      const bv = num(val(ws, 'K' + r)), vv = num(val(ws, 'O' + r));
      if (bv == null && vv == null) break;
      loanRows.push(r);
      const rate = num(val(ws, 'Q' + r));
      out.loans.push({id: uid(), name, balance: bv ?? '', asOf: isoOf(val(ws, 'M' + r)), value: vv ?? '', payoff: isoOf(val(ws, 'P' + r)), rate: rate == null ? '' : Math.round((rate < 1 ? rate * 100 : rate) * 1000) / 1000, notes: txt(ws, 'R' + r)});
    }
    const ins = findCell(ws, v => /^farm bureau$/i.test(v) || /insurance$/i.test(v));
    const after = loanRows.length ? loanRows[loanRows.length - 1] + 1 : 3;
    for (let r = after; r <= last; r++) {
      if (ins && r >= ins.r + 1) break;
      for (let c = 7; c <= 19; c++) { const raw = val(ws, A(c, r)); if (typeof raw !== 'string') continue; const v = raw.trim(); if (v && !/^(debt|value)$/i.test(v)) out.worksheetNotes.push({id: uid(), text: v}); }
    }
    if (ins) {
      out.insurance.name = txt(ws, A(ins.c, ins.r + 1));
      for (let r = ins.r + 2; r <= last; r++) { const y = num(val(ws, A(ins.c, r))), p = num(val(ws, A(ins.c + 1, r))); if (y == null) break; out.insurance.rows.push({id: uid(), year: y, premium: p ?? '', note: txt(ws, A(ins.c + 2, r))}); }
    }
    found.push('Worksheet');
  }
  // the rent sheet: charges at the top, then a month-by-month list
  const rentName = wb.SheetNames.find(n => /rent/i.test(n));
  if (rentName) {
    const rs = wb.Sheets[rentName], [, last] = rowsOf(rs);
    out.rent.title = rentName;
    for (let r = 1; r <= 6; r++) {
      const name = txt(rs, 'A' + r), a = num(val(rs, 'B' + r));
      if (name && a != null && !MONTHS.includes(name)) out.rent.charges.push({id: uid(), name, amount: a});
      for (const c of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) { const t = txt(rs, c + r); if (t && num(t) == null) out.rent.notes.push({id: uid(), text: t}); }
    }
    const each = sum(out.rent.charges, amt);
    for (let r = 1; r <= last; r++) {
      const m = MONTHS.indexOf(txt(rs, 'A' + r)), y = num(val(rs, 'B' + r));
      if (m >= 0 && y) out.rent.payments.push({id: uid(), month: y + '-' + pad(m + 1), amount: each, paid: false, note: [txt(rs, 'C' + r), txt(rs, 'D' + r)].filter(Boolean).join(' ')});
    }
    found.push(rentName);
  }
  // Cut Expenses: rows above the SUM range are income; the SUM range is the expenses
  const cs = sheetByName(wb, /cut/i);
  if (cs) {
    const [, last] = rowsOf(cs);
    let totalRow = null, start = 5, stop = 20;
    for (let r = 3; r <= last; r++) if (/total expenses/i.test(txt(cs, 'B' + r))) { totalRow = r; const f = (cellAt(cs, 'C' + r) || {}).f || ''; const m = /C(\d+):C(\d+)/i.exec(f); if (m) { start = +m[1]; stop = +m[2]; } break; }
    for (let r = 3; r <= (totalRow || last); r++) {
      const name = txt(cs, 'B' + r), a = num(val(cs, 'C' + r));
      if (!name || a == null || r === totalRow) continue;
      if (r < start) out.cuts.income.push({id: uid(), name, amount: a});
      else if (r <= stop) out.cuts.expenses.push({id: uid(), name, amount: a});
    }
    let fRow = 3, jobsA = null, jobsB = null;
    for (let r = 2; r <= last; r++) {
      const b = txt(cs, 'B' + r), f = txt(cs, 'F' + r);
      if (/:$/.test(b)) jobsA = {r, title: b.replace(/:$/, '')};
      if (/:$/.test(f) && r > 2) jobsB = {r, title: f.replace(/:$/, '')};
    }
    for (let r = fRow; r <= last; r++) { const t = txt(cs, 'F' + r); if (!t || (jobsB && r >= jobsB.r)) break; out.cuts.changes.push({id: uid(), text: t, done: false}); }
    for (let r = (totalRow || 3) + 2; r <= last; r++) { const b = txt(cs, 'B' + r), a = num(val(cs, 'C' + r)); if (jobsA && r >= jobsA.r) break; if (b && a != null && !/balance/i.test(b)) out.cuts.side.push({id: uid(), name: b, amount: a, note: txt(cs, 'D' + r).replace(/^\*/, '')}); }
    if (jobsA) { out.cuts.jobsATitle = jobsA.title; for (let r = jobsA.r + 1; r <= last; r++) { const b = txt(cs, 'B' + r); if (!b) continue; out.cuts.jobsA.push({id: uid(), name: b, pay: txt(cs, 'C' + r)}); } }
    if (jobsB) { out.cuts.jobsBTitle = jobsB.title; for (let r = jobsB.r + 1; r <= last; r++) { const f = txt(cs, 'F' + r); if (!f) continue; out.cuts.jobsB.push({id: uid(), name: f}); } }
    found.push('Cut Expenses');
  }
  if (!found.length) throw Error('None of the expected sheets (Notes, Worksheet, a rent sheet, Cut Expenses) are in that file.');
  out.title = S.title;
  return out;
}
async function importXlsx() {
  if (!needXlsx()) return;
  const f = await pickFile('.xlsx,.xlsm,.xls'); if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), {type: 'array', cellDates: true, cellFormula: true});
    const d = importWorkbook(wb);
    const has = S.schedule.length || S.monthly.length || S.loans.length || S.cuts.expenses.length || S.rent.payments.length;
    if (has && !confirm('Replace everything in the ledger with “' + f.name + '”?')) return;
    S = d; save(); renderSheet(); toast('Brought in ' + f.name);
  } catch (e) { alert('Could not read that file: ' + e.message); }
}

/* ------------------------------------------------------------ Excel export */
function exportXlsx() {
  if (!needXlsx()) return;
  const wb = XLSX.utils.book_new(), m = ui.month;
  const sheet = (name, aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = widths.map(w => ({wch: w})); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); return ws; };
  const paidMark = x => amt(x) < 0 ? (isPaid(x.id, m) ? 'Yes' : '') : '';
  // Notes
  const F = group('first'), L = group('last'), O = group('other'), n = Math.max(F.length, L.length);
  const nAoa = [['First of Month', '', '', '', '', '', 'Last of Month'], ['', 'Due', 'Pay', 'Amount', 'Paid? (' + monthName(m) + ')', '', '', 'Due', 'Pay', 'Amount', 'Paid?']];
  for (let i = 0; i < n; i++) { const a = F[i], b = L[i]; nAoa.push([a ? a.name : '', a ? num(a.due) ?? '' : '', a ? a.pay || '' : '', a ? amt(a) : '', a ? paidMark(a) : '', '', b ? b.name : '', b ? num(b.due) ?? '' : '', b ? b.pay || '' : '', b ? amt(b) : '', b ? paidMark(b) : '']); }
  nAoa.push(['', '', 'Net', scheduleNet('first'), '', '', '', '', 'Net', scheduleNet('last')]);
  if (O.length) { nAoa.push([]); O.forEach(a => nAoa.push([a.name, num(a.due) ?? '', a.pay || '', amt(a), paidMark(a)])); }
  sheet('Notes', nAoa, [24, 6, 8, 12, 16, 3, 26, 6, 8, 12, 10]);
  // Worksheet
  const w = [['', 'Monthly Expenses', '', '', '', '', '', 'Loans', '', '', 'Balance', '', 'As of', '', 'Value', 'Pay Off', 'Rate', 'Notes'], ['', '', 'Due', 'Amount', 'Paid? (' + monthName(m) + ')']];
  const rows = Math.max(S.monthly.length + 2, S.loans.length + 1);
  for (let i = 0; i < rows; i++) w.push([]);
  S.monthly.forEach((x, i) => { const r = w[i + 2]; r[1] = x.name; r[2] = num(x.due) ?? ''; r[3] = amt(x); r[4] = paidMark(x); });
  w[S.monthly.length + 3] = w[S.monthly.length + 3] || []; w[S.monthly.length + 3][1] = 'Balance'; w[S.monthly.length + 3][3] = monthlyBalance();
  S.loans.forEach((x, i) => { const r = w[i + 1] = w[i + 1] || []; r[7] = x.name; r[10] = num(x.balance) ?? ''; r[12] = x.asOf ? parseDate(x.asOf) : ''; r[14] = num(x.value) ?? ''; r[15] = x.payoff ? parseDate(x.payoff) : ''; r[16] = num(x.rate) != null ? num(x.rate) / 100 : ''; r[17] = x.notes || ''; });
  const t = w[S.loans.length + 1] = w[S.loans.length + 1] || []; t[10] = debt(); t[11] = 'Debt'; t[14] = worth(); t[15] = 'Value'; t[16] = netWorth(); t[17] = 'Net worth';
  let r0 = w.length + 1; w[r0] = [];
  S.monthlyNotes.forEach(x => w.push(['', x.text]));
  w.push([]); S.worksheetNotes.forEach(x => { const r = []; r[7] = x.text; w.push(r); });
  if (S.insurance.rows.length) { w.push([]); const h = []; h[7] = S.insurance.name; w.push(h); S.insurance.rows.slice().sort((a, b) => num(b.year) - num(a.year)).forEach(x => { const r = []; r[7] = num(x.year); r[8] = num(x.premium) ?? ''; r[9] = x.note || ''; w.push(r); }); }
  for (let i = 0; i < w.length; i++) if (!w[i]) w[i] = [];
  const wsW = sheet('Worksheet', w, [2, 26, 6, 12, 16, 2, 2, 30, 2, 12, 12, 8, 12, 2, 12, 12, 8, 50]);
  Object.keys(wsW).forEach(a => { if (a[0] === '!') return; const c = XLSX.utils.decode_cell(a); if ((c.c === 12 || c.c === 15) && wsW[a].v instanceof Date) wsW[a].z = 'm/d/yyyy'; if (c.c === 16 && typeof wsW[a].v === 'number' && wsW[a].v < 1) wsW[a].z = '0.00%'; });
  // rent
  const rAoa = S.rent.charges.map(x => [x.name, amt(x)]); rAoa.push(['Total', rentMonthly()]); rAoa.push([]);
  rAoa.push(['Month', 'Year', 'Amount', 'Paid?', 'Notes']);
  S.rent.payments.slice().sort((a, b) => (a.month || '') < (b.month || '') ? -1 : 1).forEach(p => { const [y, mm] = (p.month || '-').split('-'); rAoa.push([MONTHS[+mm - 1] || '', +y || '', num(p.amount) ?? '', p.paid ? 'Yes' : '', p.note || '']); });
  if (S.rent.notes.length) { rAoa.push([]); S.rent.notes.forEach(x => rAoa.push(['', '', '', '', x.text])); }
  sheet(S.rent.title || 'Rent', rAoa, [14, 8, 10, 8, 80]);
  // Cut Expenses
  const c = [['', 'Monthly Expenses', '', '', '', 'Changes to Make:'], ['', '', 'Amount']];
  const inc = S.cuts.income, ex = S.cuts.expenses, ch = S.cuts.changes;
  const lines = [...inc.map(x => [x.name, amt(x)]), ...ex.map(x => [x.name, amt(x)]), [], ['Total Expenses', cutExpenses()], ['Balance', cutBalance()], [], ...S.cuts.side.map(x => [x.name, amt(x), x.note ? '*' + x.note : ''])];
  const len = Math.max(lines.length, ch.length);
  for (let i = 0; i < len; i++) { const l = lines[i] || [], k = ch[i]; c.push(['', l[0] ?? '', l[1] ?? '', l[2] ?? '', '', k ? (k.done ? '✓ ' : '') + k.text : '']); }
  c.push([]); c.push(['', S.cuts.jobsATitle + ':', '', '', '', S.cuts.jobsBTitle + ':']);
  for (let i = 0; i < Math.max(S.cuts.jobsA.length, S.cuts.jobsB.length); i++) { const a = S.cuts.jobsA[i], b = S.cuts.jobsB[i]; c.push(['', a ? a.name : '', a ? a.pay || '' : '', '', '', b ? b.name : '']); }
  sheet('Cut Expenses', c, [2, 26, 14, 18, 2, 70]);
  // hidden copy of the whole ledger so it imports back exactly
  const json = JSON.stringify(S), chunks = [];
  for (let i = 0; i < json.length; i += 30000) chunks.push([json.slice(i, i + 30000)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chunks), '_ledger');
  wb.Workbook = {Sheets: wb.SheetNames.map(n => ({name: n, Hidden: n === '_ledger' ? 1 : 0}))};
  XLSX.writeFile(wb, (S.title || 'Family Ledger').replace(/[^\w\- ]+/g, '') + ' ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Excel file downloaded');
}

/* ------------------------------------------------------------ backups */
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function backupJson() { download('family-ledger-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(S, null, 1), 'application/json'); toast('Backup downloaded'); }
async function restoreJson() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.version !== 1 || !Array.isArray(d.schedule)) throw Error('That isn’t a Family Ledger backup.');
    if (!confirm('Replace everything with the backup from ' + (d.savedAt ? new Date(d.savedAt).toLocaleString() : 'that file') + '?')) return;
    S = normalize(d); save(); renderSheet(); toast('Backup restored');
  } catch (e) { alert('Could not restore: ' + e.message); }
}

/* ------------------------------------------------------------ events */
function addRow(list, defaults) {
  const base = {id: uid()};
  const blanks = {schedule: {name: '', due: '', pay: '', amount: '', group: 'first'}, monthly: {name: '', due: '', amount: ''}, loans: {name: '', balance: '', asOf: '', value: '', payoff: '', rate: '', notes: ''},
    insurance: {year: (Math.max(0, ...S.insurance.rows.map(r => num(r.year) || 0)) || new Date().getFullYear() - 1) + 1, premium: '', note: ''},
    rentCharges: {name: '', amount: ''}, rentPayments: {month: '', amount: rentMonthly(), paid: false, note: ''}, cutChanges: {text: '', done: false}, cutSide: {name: '', amount: '', note: ''}, jobsA: {name: '', pay: ''}};
  LISTS[list]().push({...base, ...(blanks[list] || {name: '', amount: '', text: ''}), ...(defaults || {})});
  save(); renderSheet();
  const rows = document.querySelectorAll(`#sheetBody [data-list="${list}"][data-id="${base.id}"]`);
  if (rows[0]) rows[0].focus();
}
document.addEventListener('DOMContentLoaded', () => {
  renderLanding();
  document.querySelector('.spines').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSheet(b.dataset.open); });
  $('closeSheet').addEventListener('click', () => $('sheet').close());
  $('sheet').addEventListener('close', () => { ui.open = null; renderLanding(); });
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').close(); });
  $('printSheet').addEventListener('click', () => printParts([ui.open]));
  $('sheetTools').addEventListener('change', e => { if (e.target.id === 'monthPick') { ui.month = e.target.value; renderSheet(); } });
  const body = $('sheetBody');
  body.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.title) {
      const k = t.dataset.title;
      if (k === 'book') S.title = t.value; else if (k === 'rent') { S.rent.title = t.value; $('sheetTitle').textContent = t.value || 'Family Rent'; }
      else if (k === 'insurance') S.insurance.name = t.value; else if (k === 'jobsA') S.cuts.jobsATitle = t.value; else if (k === 'jobsB') S.cuts.jobsBTitle = t.value;
      save(); return;
    }
    if (t.dataset.list && t.type !== 'checkbox') {
      const row = LISTS[t.dataset.list]().find(r => r.id === t.dataset.id); if (!row) return;
      const k = t.dataset.k, raw = t.value;
      row[k] = t.classList.contains('num') ? (raw.trim() === '' ? '' : (num(raw) ?? raw)) : raw;
      t.classList.toggle('bad', t.classList.contains('num') && raw.trim() !== '' && num(raw) == null);
      if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
      save(); refreshSums();
    }
  });
  body.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.paid) { setPaid(t.dataset.paid, t.checked); save(); refreshSums(); return; }
    if (t.dataset.list && t.type === 'checkbox') { const row = LISTS[t.dataset.list]().find(r => r.id === t.dataset.id); if (row) { row[t.dataset.k] = t.checked; save(); refreshSums(); const tr = t.closest('tr'); if (tr && t.dataset.k === 'done') tr.classList.toggle('done', t.checked); if (tr && t.dataset.list === 'rentPayments') tr.classList.toggle('due', !t.checked && row.month && row.month <= thisMonth()); } return; }
    if (t.dataset.list && (t.dataset.k === 'group' || t.dataset.k === 'month' || t.dataset.k === 'year')) renderSheet();
  });
  body.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.add) { addRow(t.dataset.add, t.dataset.defaults ? JSON.parse(t.dataset.defaults) : null); return; }
    if (t.dataset.del) {
      const list = LISTS[t.dataset.del](), i = list.findIndex(r => r.id === t.dataset.id); if (i < 0) return;
      const r = list[i], label = r.name || r.text || monthName(r.month) || 'this line';
      if ((r.name || r.text || num(r.amount) || num(r.balance)) && !confirm('Remove “' + label + '”?')) return;
      list.splice(i, 1); Object.values(S.paid).forEach(m => delete m[r.id]); save(); renderSheet(); return;
    }
    const id = t.id;
    if (id === 'nextRentMonth') {
      const ms = S.rent.payments.map(p => p.month).filter(Boolean).sort(), last = ms[ms.length - 1];
      let next = thisMonth(); if (last) { const [y, mm] = last.split('-').map(Number); next = monthKey(new Date(y, mm, 1)); }
      S.rent.payments.push({id: uid(), month: next, amount: rentMonthly(), paid: false, note: ''}); save(); renderSheet();
    }
    else if (id === 'importXlsx') importXlsx();
    else if (id === 'exportXlsx') exportXlsx();
    else if (id === 'printAll') printParts(['schedule', 'monthly', 'rent', 'cuts']);
    else if (id === 'backupJson') backupJson();
    else if (id === 'restoreJson') restoreJson();
    else if (id === 'pickFolder') chooseFolder();
    else if (id === 'clearAll') { if (confirm('Clear the whole ledger on this device? Download a backup first if you might want it back.')) { const title = S.title; S = blank(); S.title = title; save(); renderSheet(); toast('Ledger cleared'); } }
  });
  recallFolder().then(async h => { if (h && h.queryPermission && (await h.queryPermission({mode: 'readwrite'})) === 'granted') { folder = h; saveLine(); } });
  const hash = location.hash.slice(1); if (SHEETS[hash]) openSheet(hash);
});
