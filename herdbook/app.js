/* Herd Book — a cattle record book for a cow-calf herd and weekly sale-barn trading.
   Everything is kept in this browser (localStorage), optionally mirrored to a folder
   the owner picks (e.g. OneDrive) and exportable to Excel. No server, no account.
   All user text is escaped before it is put into the page. */
'use strict';

/* ------------------------------------------------------------ basics */
const KEY = 'herdbook.v1';
const FARMINGTON_REPORT = 'https://www.ams.usda.gov/mnreports/AMS_1812.pdf';
const MMN = 'https://mymarketnews.ams.usda.gov/';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const parseDate = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const addDays = (s, n) => { const d = parseDate(s); if (!d) return ''; d.setDate(d.getDate() + Number(n || 0)); return iso(d); };
const daysFrom = (a, b) => { const x = parseDate(a), y = parseDate(b); return x && y ? Math.round((y - x) / 864e5) : null; };
const fmtDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : ''; };
const fmtShort = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : ''; };
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const money = (n, cents = true) => n == null || !Number.isFinite(n) ? '' : (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0});
const whole = n => n == null || !Number.isFinite(n) ? '' : Math.round(n).toLocaleString('en-US');
const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
const yearOf = s => (s || '').slice(0, 4);
const thisYear = () => String(new Date().getFullYear());

/* ------------------------------------------------------------ state */
function blank() {
  return {
    version: 1, savedAt: null,
    settings: {
      farmName: "Michelle’s Herd Book",
      owners: [{id: 'o1', name: 'My herd'}, {id: 'o2', name: "Step-dad's herd"}],
      gestation: 283, mileRate: 0.70, saleBarn: 'Farmington Regional Stockyards',
      // what Farmington took out on every 2026 ticket; editable in Settings
      barnRates: {commissionPct: 3.25, insurancePct: 0.484, yardagePerHead: 2, beefCouncilPerHead: 1, vetInspectionPerHead: 0.25, vetPerCow: 9, vetPerHeifer: 4.5}
    },
    animals: [], breedings: [], calvings: [], purchases: [], sales: [], expenses: [], treatments: [], medicines: [], market: [],
    expPresets: [
      {id: 'p1', name: 'Cow feed', category: 'Feed & grain', unit: 'bags', cost: ''},
      {id: 'p2', name: 'Hay', category: 'Hay', unit: 'bales', cost: ''},
      {id: 'p3', name: 'Mineral', category: 'Mineral & salt', unit: 'bags', cost: ''},
      {id: 'p4', name: 'Fuel to the sale barn', category: 'Travel / fuel', unit: '', cost: ''},
      {id: 'p5', name: 'Vet call', category: 'Vet', unit: '', cost: ''}
    ],
    beef: {live: 1200, hangPct: 60, yieldPct: 62, price: 4.00, killFee: 100, cutWrap: 1.00, customerPaysProcessing: true,
           finishDays: 0, feedPerDay: 0, otherCost: 0, barnPrice: 0, barnCommissionPct: 3, barnTrucking: 0},
    bid: {buyWt: 500, sellWt: 650, sellPrice: 0, days: 60, feedPerDay: 1.5, trucking: 15, commissionPct: 3, deathPct: 1, target: 50}
  };
}
// fills in anything a saved book is missing and brings old records up to date
function normalize(s) {
  const b = blank();
  if (s.settings && s.settings.farmName === 'Herd Book') s.settings.farmName = b.settings.farmName;
  const out = {...b, ...s, settings: {...b.settings, ...s.settings}, beef: {...b.beef, ...s.beef}, bid: {...b.bid, ...s.bid}};
  out.settings.barnRates = {...b.settings.barnRates, ...(out.settings.barnRates || {})};
  // a sale used to be one line with a lump of fees; now it is a ticket with a line per animal or lot
  out.sales.forEach(x => {
    if (Array.isArray(x.lines)) return;
    const cwt = num(x.pricePerCwt), hd = num(x.pricePerHead);
    x.lines = [{id: uid(), head: x.head, tag: (x.animalIds || []).map(id => (out.animals.find(a => a.id === id) || {}).tag || '').filter(Boolean).join(', '), desc: x.what || '', weight: x.totalWeight, price: cwt != null ? cwt : hd, per: cwt != null ? 'cwt' : 'head', animalId: '', comments: ''}];
    x.otherFees = x.fees || '';
    ['head', 'totalWeight', 'pricePerCwt', 'pricePerHead', 'fees'].forEach(k => delete x[k]);
  });
  return out;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === 1) return normalize(s);
  } catch (e) { /* fall through to a fresh book */ }
  return blank();
}
let S = load();
let ownerFilter = 'all';
let tab = 'overview';

const owners = () => S.settings.owners;
const ownerName = id => (owners().find(o => o.id === id) || {}).name || '';
const animal = id => S.animals.find(a => a.id === id);
const tagOf = id => { const a = animal(id); return a ? a.tag : '(removed)'; };
const inFilter = rec => ownerFilter === 'all' || rec.owner === ownerFilter;

/* ------------------------------------------------------------ saving */
let folder = null, folderTimer = 0;
function save(quiet) {
  S.savedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { saveLine('Could not save on this device — export a backup now (Settings & data).', true); return; }
  if (folder) { clearTimeout(folderTimer); folderTimer = setTimeout(writeFolder, 400); }
  saveLine();
  if (!quiet) renderGlance();
}
function saveLine(msg, bad) {
  const el = $('saveLine'); if (!el) return;
  el.classList.toggle('bad', !!bad);
  if (msg) { el.textContent = msg; return; }
  const t = S.savedAt ? new Date(S.savedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}) : '';
  el.textContent = 'Saved on this device' + (t ? ' · ' + t : '') + (folder ? ' · also saving to folder “' + folder.name + '”' : '');
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }

/* folder auto-save (Edge/Chrome on a computer) */
const FOLDER_FILE = 'herdbook-data.json';
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('herdbook-folder', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function rememberFolder(h) { try { const d = await idb(); d.transaction('h', 'readwrite').objectStore('h').put(h, 'dir'); } catch (e) {} }
async function recallFolder() { try { const d = await idb(); return await new Promise(res => { const q = d.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
async function writeFolder() {
  if (!folder) return;
  try { const fh = await folder.getFileHandle(FOLDER_FILE, {create: true}); const w = await fh.createWritable(); await w.write(JSON.stringify(S, null, 1)); await w.close(); saveLine(); }
  catch (e) { saveLine('Could not save to the folder — open Settings & data and reconnect it.', true); }
}
async function useFolder(h) {
  folder = h; await rememberFolder(h);
  try {
    const fh = await h.getFileHandle(FOLDER_FILE, {create: false});
    const other = JSON.parse(await (await fh.getFile()).text());
    if (other && other.version === 1 && (other.savedAt || '') > (S.savedAt || '') &&
        confirm('The folder has a newer copy of the herd book (saved ' + new Date(other.savedAt).toLocaleString() + '). Use it on this computer?')) {
      const b = blank(); S = {...b, ...other, settings: {...b.settings, ...other.settings}, beef: {...b.beef, ...other.beef}, bid: {...b.bid, ...other.bid}};
      localStorage.setItem(KEY, JSON.stringify(S));
    }
  } catch (e) { /* first time: the file is created on the next save */ }
  await writeFolder(); render(); renderGlance();
}

/* ------------------------------------------------------------ derived facts */
function calvingsOf(cowId) { return S.calvings.filter(c => c.cowId === cowId).sort((a, b) => a.date < b.date ? -1 : 1); }
function lastCalving(cowId) { const c = calvingsOf(cowId); return c.length ? c[c.length - 1] : null; }
function dueDate(b) { return addDays(b.date, S.settings.gestation); }
/* The breeding a cow is currently carrying: the latest one after her last calving that isn't checked open. */
function currentBreeding(cowId) {
  const last = lastCalving(cowId), after = last ? last.date : '';
  const list = S.breedings.filter(b => b.cowId === cowId && b.date > after && b.pregCheck !== 'Open').sort((a, b) => a.date < b.date ? 1 : -1);
  return list[0] || null;
}
function ageText(a) {
  if (a.birthDate) { const m = Math.max(0, Math.round(daysFrom(a.birthDate, today()) / 30.44)); return m < 24 ? m + ' mo' : Math.floor(m / 12) + ' yr'; }
  if (a.birthYear) return (new Date().getFullYear() - Number(a.birthYear)) + ' yr';
  return '';
}
function clearDate(t) { return t.withdrawalDays ? addDays(t.date, t.withdrawalDays) : ''; }
function holds() {
  const t = today(), out = [];
  S.treatments.forEach(tr => {
    const c = clearDate(tr); if (!c || c <= t) return;
    if (tr.herdWide) out.push({label: (ownerName(tr.owner) || 'Herd') + ' (whole herd)', owner: tr.owner, until: c, product: tr.product, ids: null});
    else (tr.animalIds || []).forEach(id => { const a = animal(id); if (a && a.status === 'Active') out.push({label: a.tag, owner: a.owner, until: c, product: tr.product, ids: [id]}); });
  });
  return out.sort((a, b) => a.until < b.until ? -1 : 1);
}
function onHold(id, onDate) {
  const a = animal(id); if (!a) return null;
  const d = onDate || today();
  return S.treatments.find(tr => { const c = clearDate(tr); return c && tr.date <= d && c > d && (tr.herdWide ? tr.owner === a.owner : (tr.animalIds || []).includes(id)); }) || null;
}
function purchaseCost(p) {
  const w = num(p.totalWeight), c = num(p.pricePerCwt), h = num(p.pricePerHead), n = num(p.head);
  const base = w != null && c != null ? w / 100 * c : (h != null && n != null ? h * n : 0);
  return base + (num(p.fees) || 0) + (num(p.trucking) || 0);
}
// a sale is a sale-barn ticket: a line per animal or lot, and the barn's charges for the whole ticket
const DEDS = [['commission', 'Commission'], ['insurance', 'Insurance'], ['yardage', 'Yardage'], ['beefCouncil', 'Beef council'],
  ['vetInspection', 'Vet inspection'], ['vet', 'Vet'], ['otherFees', 'Other fees'], ['trucking', 'Trucking']];
const r2 = n => Math.round(n * 100) / 100;
function lineAmount(l) {
  const p = num(l.price); if (p == null) return 0;
  if (l.per === 'head') return r2(p * (num(l.head) || 1));
  const w = num(l.weight); return w == null ? 0 : r2(w / 100 * p);
}
const saleLines = s => s.lines || [];
// which cow a sold animal came out of: the herd list knows for raised calves, otherwise the ticket line says
const damOf = l => (l.animalId && (animal(l.animalId) || {}).damId) || l.damId || '';
const saleGross = s => r2(sum(saleLines(s), lineAmount));
const saleHead = s => sum(saleLines(s), l => num(l.head));
const saleWeight = s => sum(saleLines(s), l => num(l.weight));
const saleDeductions = s => r2(sum(DEDS, ([k]) => num(s[k])));
const saleNet = s => r2(saleGross(s) - saleDeductions(s));
const isCowLine = l => /\bcows?\b/i.test(l.desc || '') && !/heifer|hfr/i.test(l.desc || '');
const isHeiferLine = l => /heifer|hfr/i.test(l.desc || '');
// the barn's usual charges for a ticket, from the rates in Settings
function barnCharges(lines) {
  const R = S.settings.barnRates, g = sum(lines, lineAmount), head = sum(lines, l => num(l.head));
  return {
    commission: r2(g * (num(R.commissionPct) || 0) / 100), insurance: r2(g * (num(R.insurancePct) || 0) / 100),
    yardage: r2(head * (num(R.yardagePerHead) || 0)), beefCouncil: r2(head * (num(R.beefCouncilPerHead) || 0)),
    vetInspection: r2(head * (num(R.vetInspectionPerHead) || 0)),
    vet: r2(sum(lines.filter(isCowLine), l => num(l.head)) * (num(R.vetPerCow) || 0) + sum(lines.filter(isHeiferLine), l => num(l.head)) * (num(R.vetPerHeifer) || 0))
  };
}
function expenseCost(e) { const c = num(e.cost); if (c != null) return c; const m = num(e.miles); return m != null ? m * (Number(S.settings.mileRate) || 0) : 0; }

/* ------------------------------------------------------------ choices */
const TYPES = ['Cow', 'Heifer', 'Bull', 'Steer', 'Calf'];
const EXP_CATS = ['Feed & grain', 'Hay', 'Mineral & salt', 'Medicine & vaccine', 'Vet', 'Travel / fuel', 'Trucking & hauling', 'Sale-barn fees', 'Fencing & equipment', 'Pasture rent', 'Bull & breeding', 'Other'];
const MARKET_CLASSES = [
  'Feeder steers 300–400 lb', 'Feeder steers 400–500 lb', 'Feeder steers 500–600 lb', 'Feeder steers 600–700 lb', 'Feeder steers 700–800 lb', 'Feeder steers 800 lb+',
  'Feeder heifers 300–400 lb', 'Feeder heifers 400–500 lb', 'Feeder heifers 500–600 lb', 'Feeder heifers 600–700 lb', 'Feeder heifers 700–800 lb',
  'Slaughter cows – Breaker', 'Slaughter cows – Boner', 'Slaughter cows – Lean', 'Slaughter bulls',
  'Bred cows (per head)', 'Cow-calf pairs (per head)'];
const perHeadClass = c => /per head/.test(c);

/* ------------------------------------------------------------ record types (drive the forms and tables) */
const animalOptions = (types, rec) => S.animals
  .filter(a => (a.status === 'Active' || (rec && (a.id === rec.cowId || a.id === rec.bullId))) && (!types || types.includes(a.type)))
  .sort((a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true}))
  .map(a => [a.id, a.tag + ' · ' + a.type + (owners().length > 1 ? ' · ' + ownerName(a.owner) : '')]);

const COLS = {
  animals: {
    one: 'animal', title: 'Herd',
    fields: [
      {k: 'tag', label: 'Tag number', type: 'text', required: true, hint: 'Ear tag or name'},
      {k: 'owner', label: 'Whose', type: 'owner', required: true},
      {k: 'type', label: 'Type', type: 'select', options: TYPES, required: true, def: 'Cow'},
      {k: 'sex', label: 'Calf sex', type: 'select', options: ['', 'Bull calf', 'Heifer calf', 'Steer'], show: r => r.type === 'Calf'},
      {k: 'breed', label: 'Breed', type: 'text', half: true},
      {k: 'markings', label: 'Color / markings', type: 'text', half: true},
      {k: 'birthYear', label: 'Year born', type: 'number', half: true, show: r => r.type !== 'Calf'},
      {k: 'birthDate', label: 'Date born', type: 'date', half: true, show: r => r.type === 'Calf'},
      {k: 'damId', label: 'Mother (dam)', type: 'animal', types: ['Cow', 'Heifer'], show: r => r.type === 'Calf'},
      {k: 'source', label: 'Raised or bought', type: 'select', options: ['Raised', 'Bought'], def: 'Raised'},
      {k: 'boughtDate', label: 'Date bought', type: 'date', half: true, show: r => r.source === 'Bought'},
      {k: 'boughtPrice', label: 'Price paid ($)', type: 'money', half: true, show: r => r.source === 'Bought'},
      {k: 'boughtWeight', label: 'Weight when bought (lb)', type: 'number', half: true, show: r => r.source === 'Bought'},
      {k: 'boughtFrom', label: 'Bought from / where', type: 'text', half: true, show: r => r.source === 'Bought'},
      {k: 'status', label: 'Status', type: 'select', options: ['Active', 'Sold', 'Died', 'Culled'], def: 'Active'},
      {k: 'statusDate', label: 'Date', type: 'date', show: r => r.status && r.status !== 'Active'},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    validate: (r, old) => S.animals.some(a => a.id !== (old && old.id) && a.status === 'Active' && a.tag.trim().toLowerCase() === String(r.tag).trim().toLowerCase() && a.owner === r.owner) ? {tag: 'Another active animal in this herd already has this tag.'} : null
  },
  breedings: {
    one: 'breeding', title: 'Bred / exposed',
    fields: [
      {k: 'cowId', label: 'Cow or heifer', type: 'animal', types: ['Cow', 'Heifer'], required: true},
      {k: 'date', label: 'Date bred or bull turned in', type: 'date', required: true, def: today},
      {k: 'bullId', label: 'Bull', type: 'animal', types: ['Bull'], half: true},
      {k: 'method', label: 'How', type: 'select', options: ['Bull', 'AI'], def: 'Bull', half: true},
      {k: 'pregCheck', label: 'Preg check', type: 'select', options: ['Not checked', 'Bred', 'Open'], def: 'Not checked', half: true},
      {k: 'pregDate', label: 'Checked on', type: 'date', half: true, show: r => r.pregCheck && r.pregCheck !== 'Not checked'},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    computed: r => r.date ? 'Due about ' + fmtDate(addDays(r.date, S.settings.gestation)) + ' (' + S.settings.gestation + '-day gestation)' : '',
    owner: r => (animal(r.cowId) || {}).owner
  },
  calvings: {
    one: 'calving', title: 'Calvings',
    fields: [
      {k: 'cowId', label: 'Cow', type: 'animal', types: ['Cow', 'Heifer'], required: true},
      {k: 'date', label: 'Date calved', type: 'date', required: true, def: today},
      {k: 'calfTag', label: 'Calf tag', type: 'text', half: true},
      {k: 'calfSex', label: 'Calf', type: 'select', options: ['Bull calf', 'Heifer calf'], half: true},
      {k: 'birthWeight', label: 'Birth weight (lb)', type: 'number', half: true},
      {k: 'ease', label: 'Calving', type: 'select', options: ['Unassisted', 'Assisted', 'Hard pull', 'C-section'], def: 'Unassisted', half: true},
      {k: 'calfStatus', label: 'Calf', type: 'select', options: ['Alive', 'Died at birth', 'Died later'], def: 'Alive'},
      {k: 'addCalf', label: 'Add this calf to the herd list', type: 'check', def: true, newOnly: true, show: r => r.calfStatus === 'Alive'},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    owner: r => (animal(r.cowId) || {}).owner,
    after: (r, isNew) => {
      if (!isNew || !r.addCalf || r.calfStatus !== 'Alive') return;
      const cow = animal(r.cowId);
      S.animals.push({id: uid(), tag: r.calfTag || ('Calf of ' + (cow ? cow.tag : '?')), owner: cow ? cow.owner : owners()[0].id, type: 'Calf',
        sex: r.calfSex || '', birthDate: r.date, damId: r.cowId, source: 'Raised', status: 'Active', breed: cow ? cow.breed : '', notes: ''});
    }
  },
  purchases: {
    one: 'purchase', title: 'Bought',
    fields: [
      {k: 'date', label: 'Date', type: 'date', required: true, def: today, half: true},
      {k: 'owner', label: 'Whose', type: 'owner', required: true, half: true},
      {k: 'place', label: 'Where', type: 'text', def: () => S.settings.saleBarn},
      {k: 'lot', label: 'Group name', type: 'text', hint: 'Name the group (e.g. “Oct 22 heifers”) and use the same name when they sell, to see the profit.'},
      {k: 'what', label: 'What', type: 'select', options: ['Feeder steers', 'Feeder heifers', 'Bred cows', 'Cow-calf pairs', 'Bull', 'Other'], def: 'Feeder steers'},
      {k: 'head', label: 'Head', type: 'number', required: true, half: true},
      {k: 'totalWeight', label: 'Total weight (lb)', type: 'number', half: true},
      {k: 'pricePerCwt', label: 'Price ($/cwt)', type: 'money', half: true},
      {k: 'pricePerHead', label: 'or price per head ($)', type: 'money', half: true},
      {k: 'fees', label: 'Fees ($)', type: 'money', half: true},
      {k: 'trucking', label: 'Trucking ($)', type: 'money', half: true},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    computed: r => { const t = purchaseCost(r), h = num(r.head), w = num(r.totalWeight); return t ? 'Total cost ' + money(t) + (h ? ' · ' + money(t / h) + ' a head' : '') + (h && w ? ' · avg ' + whole(w / h) + ' lb' : '') : ''; }
  },
  expenses: {
    one: 'expense', title: 'Expenses',
    fields: [
      {k: 'preset', label: 'Pick a saved expense', type: 'select', options: () => [''].concat(S.expPresets.map(p => p.name)), newOnly: true, hint: 'Fills in the kind, unit and usual cost. Manage the list at the bottom of the Expenses tab.'},
      {k: 'date', label: 'Date', type: 'date', required: true, def: today, half: true},
      {k: 'owner', label: 'Whose', type: 'owner', required: true, half: true},
      {k: 'category', label: 'Kind', type: 'select', options: EXP_CATS, required: true, def: 'Feed & grain'},
      {k: 'item', label: 'What', type: 'text', hint: 'e.g. 20% range cubes, round bales, diesel to Farmington'},
      {k: 'qty', label: 'Quantity', type: 'number', half: true},
      {k: 'unit', label: 'Unit', type: 'select', options: ['', 'bags', 'lb', 'tons', 'bales', 'gallons', 'head', 'doses', 'each'], half: true},
      {k: 'miles', label: 'Miles (round trip)', type: 'number', show: r => r.category === 'Travel / fuel', hint: 'Leave the cost empty to use the mileage rate from Settings.'},
      {k: 'cost', label: 'Cost ($)', type: 'money'},
      {k: 'lot', label: 'Group name (optional)', type: 'text', hint: 'Charge it to a traded group to include it in that group’s profit.'},
      {k: 'notes', label: 'Notes', type: 'textarea'},
      {k: 'savePreset', label: 'Add “What” to the saved expenses menu', type: 'check', newOnly: true, show: r => !r.preset && !!r.item && !S.expPresets.some(p => p.name.toLowerCase() === String(r.item).toLowerCase())}
    ],
    computed: r => { const c = expenseCost(r), q = num(r.qty); return c ? money(c) + (q && r.unit ? ' · ' + money(c / q) + ' per ' + r.unit.replace(/s$/, '') : '') : ''; },
    after: (r, isNew) => {
      if (isNew && r.savePreset && r.item && !S.expPresets.some(p => p.name.toLowerCase() === r.item.toLowerCase()))
        S.expPresets.push({id: uid(), name: r.item, category: r.category, unit: r.unit || '', cost: r.cost === '' ? '' : r.cost});
    }
  },
  expPresets: {
    one: 'saved expense', title: 'Saved expenses',
    fields: [
      {k: 'name', label: 'Name in the menu', type: 'text', required: true, hint: 'e.g. Cow feed, 20% cubes, Round bales'},
      {k: 'category', label: 'Kind', type: 'select', options: EXP_CATS, required: true, def: 'Feed & grain'},
      {k: 'unit', label: 'Unit', type: 'select', options: ['', 'bags', 'lb', 'tons', 'bales', 'gallons', 'head', 'doses', 'each'], half: true},
      {k: 'cost', label: 'Usual cost ($, optional)', type: 'money', half: true}
    ],
    validate: (r, old) => S.expPresets.some(p => p !== old && p.name.trim().toLowerCase() === String(r.name).trim().toLowerCase()) ? {name: 'That name is already in the menu.'} : null
  },
  treatments: {
    one: 'treatment', title: 'Treatments',
    fields: [
      {k: 'date', label: 'Date given', type: 'date', required: true, def: today, half: true},
      {k: 'owner', label: 'Whose', type: 'owner', required: true, half: true},
      {k: 'herdWide', label: 'Whole herd (everyone in this herd)', type: 'check'},
      {k: 'animalIds', label: 'Which animals', type: 'animals', show: r => !r.herdWide},
      {k: 'product', label: 'Medicine', type: 'medicine', required: true},
      {k: 'dose', label: 'Dose', type: 'text', half: true, hint: 'e.g. 5 cc'},
      {k: 'route', label: 'Given', type: 'select', options: ['SubQ', 'IM', 'Pour-on', 'Oral', 'Intranasal', 'IV', 'Other'], half: true},
      {k: 'withdrawalDays', label: 'Meat withdrawal (days)', type: 'number', hint: 'Filled in from the medicine cabinet when the medicine is there.'},
      {k: 'reason', label: 'Why', type: 'text'},
      {k: 'givenBy', label: 'Given by', type: 'text'},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    computed: r => r.date && num(r.withdrawalDays) ? 'Clear to sell on ' + fmtDate(addDays(r.date, r.withdrawalDays)) : ''
  },
  medicines: {
    one: 'medicine', title: 'Medicine cabinet',
    fields: [
      {k: 'name', label: 'Medicine', type: 'text', required: true},
      {k: 'kind', label: 'Kind', type: 'select', options: ['Vaccine', 'Antibiotic', 'Dewormer', 'Pour-on', 'Fly control', 'Vitamin / mineral', 'Other'], def: 'Vaccine'},
      {k: 'owner', label: 'Whose (who paid)', type: 'owner', required: true},
      {k: 'withdrawalDays', label: 'Meat withdrawal (days)', type: 'number', half: true},
      {k: 'expires', label: 'Expires', type: 'date', half: true},
      {k: 'onHand', label: 'On hand', type: 'number', half: true},
      {k: 'unit', label: 'Unit', type: 'select', options: ['', 'mL', 'doses', 'bottles', 'tubes', 'lb', 'gallons'], half: true},
      {k: 'cost', label: 'Cost ($)', type: 'money', half: true},
      {k: 'boughtDate', label: 'Bought', type: 'date', half: true, def: today},
      {k: 'lotNo', label: 'Lot / serial number', type: 'text'},
      {k: 'recordExpense', label: 'Also record the cost as an expense', type: 'check', def: true, newOnly: true},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ],
    after: (r, isNew) => { if (isNew && r.recordExpense && num(r.cost)) S.expenses.push({id: uid(), date: r.boughtDate || today(), owner: r.owner, category: 'Medicine & vaccine', item: r.name, qty: r.onHand || '', unit: '', cost: r.cost, notes: 'From the medicine cabinet'}); }
  },
  market: {
    one: 'market price', title: 'Market prices',
    fields: [
      {k: 'date', label: 'Sale date', type: 'date', required: true, def: today, half: true},
      {k: 'barn', label: 'Sale barn', type: 'text', def: () => S.settings.saleBarn, half: true},
      {k: 'cls', label: 'Class', type: 'select', options: MARKET_CLASSES, required: true},
      {k: 'price', label: 'Average price', type: 'money', required: true, half: true, hint: '$ per cwt (per head for bred cows and pairs)'},
      {k: 'avgWeight', label: 'Average weight (lb)', type: 'number', half: true},
      {k: 'head', label: 'Head', type: 'number', half: true},
      {k: 'notes', label: 'Notes', type: 'textarea'}
    ]
  }
};

/* ------------------------------------------------------------ the drawer (add / edit) */
let editing = null;
function fieldValue(f, rec) { let v = rec[f.k]; if (v === undefined) v = typeof f.def === 'function' ? f.def() : f.def; return v; }
function fieldHtml(f, rec) {
  const id = 'f-' + f.k, v = fieldValue(f, rec), req = f.required ? ' <span aria-hidden="true">*</span>' : '';
  const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : '';
  const desc = f.hint ? ` aria-describedby="${id}-hint"` : '';
  let input;
  switch (f.type) {
    case 'textarea': input = `<textarea id="${id}" name="${f.k}"${desc}>${esc(v || '')}</textarea>`; break;
    case 'select': input = `<select id="${id}" name="${f.k}"${desc}>${(typeof f.options === 'function' ? f.options() : f.options).map(o => `<option value="${esc(o)}"${o === (v || '') ? ' selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`; break;
    case 'owner': {
      const cur = v || (ownerFilter !== 'all' ? ownerFilter : owners()[0].id);
      input = `<select id="${id}" name="${f.k}">${owners().map(o => `<option value="${o.id}"${o.id === cur ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`; break;
    }
    case 'animal': {
      const opts = animalOptions(f.types, rec);
      input = `<select id="${id}" name="${f.k}"><option value="">${opts.length ? 'Choose…' : 'None in the herd list yet'}</option>${opts.map(([val, label]) => `<option value="${val}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`; break;
    }
    case 'animals': {
      const sel = new Set(v || []);
      const own = editing && editing.draftOwner;
      const list = S.animals.filter(a => (a.status === 'Active' || sel.has(a.id)) && (!own || a.owner === own)).sort((a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true}));
      input = list.length
        ? `<div class="checks" id="${id}" role="group" aria-label="${esc(f.label)}">${list.map(a => `<label><input type="checkbox" name="${f.k}" value="${a.id}"${sel.has(a.id) ? ' checked' : ''}> ${esc(a.tag)}</label>`).join('')}</div>`
        : `<p class="empty" id="${id}">No animals in this herd list yet.</p>`;
      return `<div class="field" data-k="${f.k}"><span class="label">${esc(f.label)}${req}</span>${input}${hint}</div>`;
    }
    case 'medicine': {
      input = `<input id="${id}" name="${f.k}" list="medList" value="${esc(v || '')}" autocomplete="off"${desc}><datalist id="medList">${S.medicines.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist>`; break;
    }
    case 'check': return `<div class="field" data-k="${f.k}"><label class="inline-check"><input type="checkbox" id="${id}" name="${f.k}"${v ? ' checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
    case 'date': input = `<input type="date" id="${id}" name="${f.k}" value="${esc(v || '')}"${desc}>`; break;
    case 'number': case 'money': input = `<input type="text" inputmode="decimal" id="${id}" name="${f.k}" value="${esc(v == null ? '' : v)}"${desc}>`; break;
    default: input = `<input type="text" id="${id}" name="${f.k}" value="${esc(v || '')}"${desc}>`;
  }
  return `<div class="field" data-k="${f.k}"><label for="${id}">${esc(f.label)}${req}</label>${input}${hint}</div>`;
}
function readForm(fields) {
  const form = $('drawerForm'), r = {};
  fields.forEach(f => {
    if (f.type === 'animals') { r[f.k] = [...form.querySelectorAll(`input[name="${f.k}"]:checked`)].map(i => i.value); return; }
    const el = form.elements.namedItem(f.k); if (!el) return;
    if (f.type === 'check') r[f.k] = el.checked;
    else if (f.type === 'number' || f.type === 'money') { const n = num(el.value); r[f.k] = el.value.trim() === '' ? '' : (n == null ? el.value : n); }
    else r[f.k] = el.value.trim ? el.value.trim() : el.value;
  });
  return r;
}
function layoutFields(fields, rec) {
  let html = '', half = [];
  const flush = () => { if (half.length) { html += half.length === 2 ? `<div class="row2">${half.join('')}</div>` : half[0]; half = []; } };
  fields.forEach(f => {
    const h = fieldHtml(f, rec);
    if (f.half) { half.push(h); if (half.length === 2) flush(); } else { flush(); html += h; }
  });
  flush();
  return html;
}
function applyShow(fields, rec) {
  fields.forEach(f => { const box = document.querySelector(`#drawerBody .field[data-k="${f.k}"]`); if (box) box.hidden = !!(f.show && !f.show(rec)) || (f.newOnly && editing && editing.rec); });
  // keep half-rows tidy when one side is hidden
  document.querySelectorAll('#drawerBody .row2').forEach(row => { const vis = [...row.children].filter(c => !c.hidden).length; row.style.display = vis ? '' : 'none'; row.style.gridTemplateColumns = vis === 1 ? '1fr' : ''; });
}
function openForm(key, rec, preset) {
  $('drawerBody').onclick = null; $('drawer').classList.remove('wide');
  const def = COLS[key];
  const fields = def.fields;
  editing = {key, rec: rec || null, fields, draftOwner: (rec && rec.owner) || (preset && preset.owner) || (ownerFilter !== 'all' ? ownerFilter : owners()[0].id)};
  const start = {...(preset || {}), ...(rec || {})};
  $('drawerTitle').textContent = (rec ? 'Edit ' : 'Add ') + def.one;
  $('drawerBody').innerHTML = layoutFields(fields, start) + (def.computed ? '<div class="computed" id="computed" hidden></div>' : '');
  $('drawerDelete').hidden = !rec;
  $('drawer').hidden = false;
  const refresh = () => {
    const cur = {...start, ...readForm(fields)};
    // a change of herd re-lists the animals to pick from
    if (cur.owner && cur.owner !== editing.draftOwner && fields.some(f => f.type === 'animals')) {
      editing.draftOwner = cur.owner;
      fields.filter(f => f.type === 'animals').forEach(f => { const box = document.querySelector(`#drawerBody .field[data-k="${f.k}"]`); if (box) box.outerHTML = fieldHtml(f, {...cur, [f.k]: []}); });
    }
    // medicine picked from the cabinet fills in its withdrawal days
    if (key === 'treatments') {
      const med = S.medicines.find(m => m.name.toLowerCase() === String(cur.product || '').toLowerCase());
      const wd = $('f-withdrawalDays');
      if (med && med.withdrawalDays !== '' && med.withdrawalDays != null && wd && !wd.dataset.touched) { wd.value = med.withdrawalDays; cur.withdrawalDays = med.withdrawalDays; }
    }
    // a saved expense picked from the menu fills in the rest
    if (key === 'expenses' && cur.preset !== editing.lastPreset) {
      const prev = S.expPresets.find(p => p.name === editing.lastPreset), p = S.expPresets.find(x => x.name === cur.preset);
      editing.lastPreset = cur.preset;
      if (p) {
        const set = (k, v) => { const el = $('f-' + k); if (el) { el.value = v; cur[k] = v; } };
        set('category', p.category);
        if (!cur.item || (prev && cur.item === prev.name)) set('item', p.name);
        if (p.unit) set('unit', p.unit);
        if (num(p.cost) != null && (cur.cost === '' || (prev && num(cur.cost) === num(prev.cost)))) set('cost', p.cost);
      }
    }
    applyShow(fields, cur);
    if (def.computed) { const t = def.computed(cur); const c = $('computed'); c.hidden = !t; c.textContent = t; c.style.whiteSpace = 'pre-line'; }
  };
  $('drawerBody').oninput = e => { if (e.target.id === 'f-withdrawalDays') e.target.dataset.touched = '1'; refresh(); };
  $('drawerBody').onchange = refresh;
  refresh();
  setTimeout(() => { const first = $('drawerBody').querySelector('input:not([type=checkbox]),select,textarea'); if (first) first.focus(); }, 30);
}
function closeForm() { $('drawer').hidden = true; $('drawer').classList.remove('wide'); $('drawerBody').onclick = null; editing = null; }
function submitForm(e) {
  e.preventDefault(); if (!editing) return;
  const {key, rec, fields} = editing, def = COLS[key];
  const r = readForm(fields);
  const errs = {};
  fields.forEach(f => {
    const box = document.querySelector(`#drawerBody .field[data-k="${f.k}"]`);
    if (box && box.hidden) return;
    if (f.required && (r[f.k] === '' || r[f.k] == null || (Array.isArray(r[f.k]) && !r[f.k].length))) errs[f.k] = 'Required';
    if ((f.type === 'number' || f.type === 'money') && r[f.k] !== '' && typeof r[f.k] !== 'number') errs[f.k] = 'Enter a number';
  });
  if (key === 'treatments' && !r.herdWide && !(r.animalIds || []).length) errs.animalIds = 'Pick at least one animal, or tick Whole herd';
  Object.assign(errs, (def.validate && def.validate(r, rec)) || {});
  document.querySelectorAll('#drawerBody .field').forEach(b => { b.classList.remove('bad'); const x = b.querySelector('.err'); if (x) x.remove(); });
  const keys = Object.keys(errs);
  if (keys.length) {
    keys.forEach(k => { const b = document.querySelector(`#drawerBody .field[data-k="${k}"]`); if (b) { b.classList.add('bad'); b.insertAdjacentHTML('beforeend', `<div class="err" role="alert">${esc(errs[k])}</div>`); } });
    const first = document.querySelector('#drawerBody .field.bad input, #drawerBody .field.bad select'); if (first) first.focus();
    return;
  }
  // drop hidden fields' stale values
  fields.forEach(f => { const box = document.querySelector(`#drawerBody .field[data-k="${f.k}"]`); if (box && box.hidden && !f.newOnly) r[f.k] = f.type === 'animals' ? [] : ''; });
  if (def.owner) r.owner = def.owner(r) || r.owner;
  const isNew = !rec;
  let out;
  if (isNew) { out = {id: uid(), ...r}; S[key].push(out); } else { out = Object.assign(rec, r); }
  if (def.after) def.after(out, isNew);
  fields.filter(f => f.newOnly).forEach(f => delete out[f.k]);
  save(); closeForm(); render();
  toast((isNew ? 'Added ' : 'Saved ') + def.one);
}
function deleteRecord() {
  if (editing && editing.special === 'ticket' && editing.rec) {
    if (!confirm('Delete this sale ticket?')) return;
    S.sales = S.sales.filter(x => x !== editing.rec); save(); closeForm(); render(); toast('Deleted sale'); return;
  }
  if (!editing || !editing.rec) return;
  const {key, rec} = editing, def = COLS[key];
  if (key === 'animals' && (S.calvings.some(c => c.cowId === rec.id) || S.breedings.some(b => b.cowId === rec.id))) {
    if (!confirm('This animal has breeding or calving records. Delete it anyway? (To keep her history, set her status to Sold, Died or Culled instead.)')) return;
  } else if (!confirm('Delete this ' + def.one + '?')) return;
  S[key] = S[key].filter(x => x !== rec);
  save(); closeForm(); render(); toast('Deleted ' + def.one);
}

/* ------------------------------------------------------------ tables */
function table(rows, cols, opts = {}) {
  if (!rows.length) return `<div class="panel"><p class="empty">${esc(opts.empty || 'Nothing here yet.')}</p></div>`;
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}${c.sm ? ' hide-sm' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr class="clickable" data-col="${opts.key}" data-id="${r.id}" tabindex="0">${cols.map(c => `<td class="${c.num ? 'num' : ''}${c.sm ? ' hide-sm' : ''}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('');
  const foot = cols.some(c => c.total) ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.num ? 'num' : ''}${c.sm ? ' hide-sm' : ''}">${c.total ? esc(c.total(rows)) : (i === 0 ? 'Total' : '')}</td>`).join('')}</tr></tfoot>` : '';
  return `<div class="table-wrap"><table class="rows"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}
const searchBox = (id, ph) => `<input type="search" class="search" id="${id}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" value="${esc(searches[id] || '')}">`;
const searches = {};
const matches = (id, text) => { const q = (searches[id] || '').trim().toLowerCase(); return !q || text.toLowerCase().includes(q); };
const ownerCol = {label: 'Whose', get: r => ownerName(r.owner), sm: true};
const showOwnerCol = () => ownerFilter === 'all' && owners().length > 1;

/* ------------------------------------------------------------ views */
const TABS = [
  ['overview', 'Overview'], ['herd', 'Herd'], ['calving', 'Breeding & calving'], ['cows', 'Cow profit'], ['money', 'Bought & sold'],
  ['expenses', 'Expenses'], ['health', 'Health & medicine'], ['market', 'Market'], ['direct', 'Sell direct'], ['settings', 'Settings & data']];

function renderTabs() {
  const h = holds().filter(inFilter).length;
  $('tabs').innerHTML = TABS.map(([k, label]) => `<button type="button" role="tab" id="tab-${k}" aria-selected="${k === tab}" aria-controls="view" data-tab="${k}">${esc(label)}${k === 'health' && h ? `<span class="badge" aria-label="${h} on withdrawal">${h}</span>` : ''}</button>`).join('');
  $('tabs').setAttribute('role', 'tablist');
}
function renderOwnerSwitch() {
  const opts = [['all', 'All']].concat(owners().map(o => [o.id, o.name]));
  $('ownerSwitch').innerHTML = opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === ownerFilter}" data-owner="${v}">${esc(l)}</button>`).join('');
}
function render() {
  $('bookTitle').textContent = S.settings.farmName || "Michelle’s Herd Book";
  renderOwnerSwitch(); renderTabs();
  const v = VIEWS[tab]();
  $('view').innerHTML = v;
  $('view').setAttribute('aria-labelledby', 'tab-' + tab);
  if (tab === 'market') drawChart();
  if (tab === 'direct') calcBeef();
  if (tab === 'market') calcBid();
  saveLine();
}

const VIEWS = {
  overview() {
    const A = S.animals.filter(a => a.status === 'Active' && inFilter(a));
    const count = t => A.filter(a => a.type === t).length;
    const y = thisYear();
    const sales = S.sales.filter(s => inFilter(s) && yearOf(s.date) === y), buys = S.purchases.filter(p => inFilter(p) && yearOf(p.date) === y), exps = S.expenses.filter(e => inFilter(e) && yearOf(e.date) === y);
    const inc = sum(sales, saleNet), out = sum(buys, purchaseCost) + sum(exps, expenseCost), net = inc - out;
    const cows = count('Cow');
    const due = A.filter(a => a.type === 'Cow' || a.type === 'Heifer').map(a => ({a, b: currentBreeding(a.id)})).filter(x => x.b)
      .map(x => ({...x, due: dueDate(x.b), days: daysFrom(today(), dueDate(x.b))})).filter(x => x.days != null && x.days <= 75 && x.days >= -30).sort((p, q) => p.days - q.days);
    // calves born alive this year. A calf can be recorded as a calving, on the Herd tab, or both, so each
    // live calving is paired with one herd-list calf of the same cow born this year; herd-list calves
    // left unpaired are counted on their own. A calf is still alive unless marked died later or Died.
    const calves = S.calvings.filter(c => yearOf(c.date) === y && inFilter(c));
    const yrCalves = S.animals.filter(a => yearOf(a.birthDate) === y && (a.type === 'Calf' || a.damId) && inFilter(a));
    const paired = new Set();
    const births = calves.filter(c => c.calfStatus !== 'Died at birth').sort((p, q) => p.date < q.date ? -1 : 1).map(c => {
      const k = yrCalves.filter(a => !paired.has(a.id) && a.damId && a.damId === c.cowId)
        .sort((p, q) => Math.abs(daysFrom(c.date, p.birthDate) || 0) - Math.abs(daysFrom(c.date, q.birthDate) || 0))[0];
      if (k) paired.add(k.id);
      return {died: c.calfStatus === 'Died later' || !!(k && k.status === 'Died')};
    });
    yrCalves.filter(a => !paired.has(a.id)).forEach(a => births.push({died: a.status === 'Died'}));
    const alive = births.length, stillAlive = births.filter(b => !b.died).length;
    const hold = holds().filter(inFilter);
    const meds = S.medicines.filter(m => m.expires && inFilter(m)).map(m => ({m, d: daysFrom(today(), m.expires)})).filter(x => x.d <= 60).sort((p, q) => p.d - q.d);
    const open = A.filter(a => (a.type === 'Cow' || a.type === 'Heifer')).filter(a => { const b = S.breedings.filter(x => x.cowId === a.id).sort((p, q) => p.date < q.date ? 1 : -1)[0]; return b && b.pregCheck === 'Open' && (!lastCalving(a.id) || b.date > lastCalving(a.id).date); });
    const latest = S.market.length ? S.market.reduce((m, r) => r.date > m ? r.date : m, '') : '';
    const latestRows = S.market.filter(r => r.date === latest).sort((a, b) => MARKET_CLASSES.indexOf(a.cls) - MARKET_CLASSES.indexOf(b.cls));
    const empty = !S.animals.length;
    return `
      <h3 class="sec">${empty ? 'Welcome' : 'At a glance'}</h3>
      <p class="lede">${empty ? 'Start by adding the cows on the <b>Herd</b> tab, or bring in an existing Excel list from <b>Settings &amp; data</b>. Everything is saved on this device as you go.' : `${ownerFilter === 'all' ? 'All herds' : esc(ownerName(ownerFilter))} · ${new Date().getFullYear()} so far.`}</p>
      <div class="cards">
        <div class="stat"><div class="k">Cows</div><div class="v">${cows}</div><div class="s">${count('Heifer')} heifer${count('Heifer') === 1 ? '' : 's'} · ${count('Bull')} bull${count('Bull') === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="k">Calves on the ground</div><div class="v">${count('Calf')}</div><div class="s">${alive} born alive this year · ${stillAlive} still alive</div></div>
        <div class="stat"><div class="k">Due in the next 75 days</div><div class="v">${due.filter(x => x.days >= 0).length}</div><div class="s">${due.filter(x => x.days < 0).length} past due date</div></div>
        <div class="stat"><div class="k">Money in this year</div><div class="v">${money(inc, false)}</div><div class="s">sales, after fees</div></div>
        <div class="stat"><div class="k">Money out this year</div><div class="v">${money(out, false)}</div><div class="s">cattle bought + expenses</div></div>
        <div class="stat"><div class="k">Result this year</div><div class="v${net < 0 ? ' neg' : ''}">${money(net, false)}</div><div class="s">${cows ? money(sum(exps, expenseCost) / cows, false) + ' expenses per cow' : '&nbsp;'}</div></div>
      </div>
      <div class="grid2">
        <section class="panel"><h4>Calving due <span class="count">${due.length}</span></h4>
          ${due.length ? `<ul class="list">${due.map(x => `<li><span class="what">${esc(x.a.tag)}${showOwnerCol() ? ` <span class="pill">${esc(ownerName(x.a.owner))}</span>` : ''}</span><span class="when">${x.days < 0 ? `<span class="pill warn">${-x.days} days past</span>` : x.days === 0 ? '<span class="pill warn">today</span>' : 'in ' + x.days + ' days'} · ${fmtShort(x.due)}</span></li>`).join('')}</ul>` : '<p class="empty">No cows due in the next 75 days. Record bull turn-in or breeding dates on Breeding &amp; calving.</p>'}
        </section>
        <section class="panel"><h4>Not clear to sell <span class="count">${hold.length}</span></h4>
          ${hold.length ? `<ul class="list">${hold.map(h => `<li><span class="what">${esc(h.label)}</span><span class="when">${esc(h.product)} · until ${fmtShort(h.until)}</span></li>`).join('')}</ul>` : '<p class="empty">Nothing is in a medicine withdrawal period.</p>'}
        </section>
        <section class="panel"><h4>Latest market${latest ? ` <span class="count">${fmtDate(latest)}</span>` : ''}</h4>
          ${latestRows.length ? `<ul class="list">${latestRows.slice(0, 8).map(r => `<li><span class="what">${esc(r.cls)}</span><span class="when">${money(num(r.price))}${perHeadClass(r.cls) ? ' /hd' : ' /cwt'}</span></li>`).join('')}</ul>` : `<p class="empty">Enter Wednesday’s Farmington prices on the Market tab to compare against your own sales.</p>`}
        </section>
        <section class="panel"><h4>Keep an eye on</h4>
          <ul class="list">
            ${open.map(a => `<li><span class="what">${esc(a.tag)}</span><span class="when"><span class="pill bad">checked open</span></span></li>`).join('')}
            ${meds.map(x => `<li><span class="what">${esc(x.m.name)}</span><span class="when">${x.d < 0 ? '<span class="pill bad">expired</span>' : `<span class="pill warn">expires in ${x.d} days</span>`}</span></li>`).join('')}
            ${!open.length && !meds.length ? '<li><span class="empty">Nothing needs attention.</span></li>' : ''}
          </ul>
        </section>
      </div>`;
  },

  herd() {
    const rows = S.animals.filter(inFilter).filter(a => (searches.herdStatus || 'Active') === 'All' || a.status === (searches.herdStatus || 'Active'))
      .filter(a => matches('herdSearch', [a.tag, a.type, a.breed, a.markings, a.notes, ownerName(a.owner)].join(' ')))
      .sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.tag.localeCompare(b.tag, undefined, {numeric: true}));
    const cols = [
      {label: 'Tag', html: r => `<span class="tag">${esc(r.tag)}</span>`},
      {label: 'Type', get: r => r.type + (r.type === 'Calf' && r.sex ? ' (' + r.sex.replace(' calf', '') + ')' : '')},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Age', get: r => ageText(r)},
      {label: 'Breed', get: r => r.breed || '', sm: true},
      {label: 'Calves', num: true, get: r => r.type === 'Cow' || r.type === 'Heifer' ? calvingsOf(r.id).length : ''},
      {label: 'Last calved', get: r => { const c = lastCalving(r.id); return c ? fmtDate(c.date) : ''; }, sm: true},
      {label: 'Due', html: r => { const b = currentBreeding(r.id); if (!b) return ''; const d = daysFrom(today(), dueDate(b)); return esc(fmtShort(dueDate(b))) + (d != null && d <= 30 ? ` <span class="pill warn">${d < 0 ? 'past' : d + 'd'}</span>` : ''); }},
      {label: 'Status', html: r => r.status === 'Active' ? (onHold(r.id) ? '<span class="pill warn">withdrawal</span>' : '<span class="pill ok">Active</span>') : `<span class="pill">${esc(r.status)}</span>`}
    ];
    const st = searches.herdStatus || 'Active';
    return `
      <h3 class="sec">Herd</h3>
      <p class="lede">Every animal, by tag. Select a row to see or change it.</p>
      <div class="toolbar">
        <button type="button" class="btn" data-add="animals">Add animal</button>
        ${searchBox('herdSearch', 'Search tags, breed, notes')}
        <select class="search" id="herdStatus" aria-label="Show">${['Active', 'Sold', 'Died', 'Culled', 'All'].map(s => `<option${s === st ? ' selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      ${table(rows, cols, {key: 'animals', empty: st === 'Active' ? 'No animals yet. Select Add animal, or import an Excel list from Settings & data.' : 'None.'})}`;
  },

  calving() {
    const B = S.breedings.filter(inFilter).filter(b => matches('brSearch', tagOf(b.cowId))).sort((a, b) => a.date < b.date ? 1 : -1);
    const C = S.calvings.filter(inFilter).filter(c => matches('brSearch', tagOf(c.cowId) + ' ' + (c.calfTag || ''))).sort((a, b) => a.date < b.date ? 1 : -1);
    const bcols = [
      {label: 'Cow', html: r => `<span class="tag">${esc(tagOf(r.cowId))}</span>`},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Bred / exposed', get: r => fmtDate(r.date)},
      {label: 'Bull', get: r => r.method === 'AI' ? 'AI' : (r.bullId ? tagOf(r.bullId) : ''), sm: true},
      {label: 'Preg check', html: r => r.pregCheck === 'Open' ? '<span class="pill bad">Open</span>' : r.pregCheck === 'Bred' ? '<span class="pill ok">Bred</span>' : '<span class="pill">Not checked</span>'},
      {label: 'Due', html: r => { const lc = lastCalving(r.cowId); if (lc && lc.date > r.date) return `<span class="pill ok">calved ${esc(fmtShort(lc.date))}</span>`; if (r.pregCheck === 'Open') return ''; const d = daysFrom(today(), dueDate(r)); return esc(fmtDate(dueDate(r))) + (d <= 30 ? ` <span class="pill warn">${d < 0 ? -d + ' days past' : d + ' days'}</span>` : ''); }}
    ];
    const ccols = [
      {label: 'Date', get: r => fmtDate(r.date)},
      {label: 'Cow', html: r => `<span class="tag">${esc(tagOf(r.cowId))}</span>`},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Calf tag', get: r => r.calfTag || ''},
      {label: 'Calf', get: r => r.calfSex || ''},
      {label: 'Birth wt', num: true, get: r => r.birthWeight ? r.birthWeight + ' lb' : '', sm: true},
      {label: 'Calving', get: r => r.ease || '', sm: true},
      {label: 'Status', html: r => r.calfStatus === 'Alive' ? '<span class="pill ok">Alive</span>' : `<span class="pill bad">${esc(r.calfStatus || '')}</span>`}
    ];
    return `
      <h3 class="sec">Breeding &amp; calving</h3>
      <p class="lede">Record when the bull went in (or each cow was bred) and the due date is worked out at ${S.settings.gestation} days. Record each calf as it comes; the calf can be added to the herd list in the same step.</p>
      <div class="toolbar">
        <button type="button" class="btn" data-add="calvings">Record a calving</button>
        <button type="button" class="btn ghost" data-add="breedings">Record a breeding</button>
        <button type="button" class="btn ghost" id="turnIn">Bull turned in with…</button>
        ${searchBox('brSearch', 'Search by tag')}
      </div>
      <h4 class="sec" style="font-size:1.1rem;margin:18px 0 8px">Calvings</h4>
      ${table(C, ccols, {key: 'calvings', empty: 'No calvings recorded yet.'})}
      <h4 class="sec" style="font-size:1.1rem;margin:22px 0 8px">Bred / exposed and due dates</h4>
      ${table(B, bcols, {key: 'breedings', empty: 'No breedings recorded yet. Use “Bull turned in with…” to record a whole group at once.'})}`;
  },

  cows() {
    const since = searches.cowSince || 'All';
    const sort = searches.cowSort || 'avgNet';
    // every calf sold on a ticket, with its share of that ticket's barn charges
    const sold = [];
    S.sales.forEach(x => {
      const g = saleGross(x), ded = saleDeductions(x);
      saleLines(x).forEach(l => {
        const dam = damOf(l); if (!dam) return;
        const amt = lineAmount(l), share = g ? ded * amt / g : 0, head = num(l.head) || 1;
        sold.push({sale: x, line: l, dam, head, amt, net: r2(amt - share), weight: num(l.weight), cwt: l.per !== 'head' ? num(l.price) : null});
      });
    });
    const yearOK = d => since === 'All' || (d || '') >= since;
    const born = S.animals.filter(a => a.damId);
    const cows = S.animals.filter(a => (a.type === 'Cow' || a.type === 'Heifer') && inFilter(a));
    const rows = cows.map(c => {
      const mine = sold.filter(s => s.dam === c.id && yearOK(s.sale.date));
      const calves = born.filter(a => a.damId === c.id && yearOK(a.birthDate)), calvings = calvingsOf(c.id).filter(cv => yearOK(cv.date));
      const head = sum(mine, s => s.head), gross = r2(sum(mine, s => s.amt)), net = r2(sum(mine, s => s.net));
      const wtHead = sum(mine.filter(s => s.weight), s => s.head), wt = sum(mine, s => s.weight || 0);
      const cwtRows = mine.filter(s => s.cwt != null && s.weight);
      const avgCwt = cwtRows.length ? sum(cwtRows, s => s.amt) / sum(cwtRows, s => s.weight) * 100 : null;
      const bornN = Math.max(calvings.length, calves.length);
      const lost = calvings.filter(cv => cv.calfStatus && cv.calfStatus !== 'Alive').length + calves.filter(a => a.status === 'Died').length;
      const onHand = calves.filter(a => a.status === 'Active').length;
      return {c, mine, head, gross, net, avgNet: head ? net / head : null, avgWt: wtHead ? wt / wtHead : null, avgCwt, born: bornN, lost, onHand};
    }).filter(r => r.head || r.born);
    const key = {avgNet: r => r.avgNet ?? -1, total: r => r.net, avgCwt: r => r.avgCwt ?? -1, avgWt: r => r.avgWt ?? -1, calves: r => r.head}[sort];
    rows.sort((a, b) => key(b) - key(a) || a.c.tag.localeCompare(b.c.tag, undefined, {numeric: true}));
    const ranked = rows.filter(r => r.head), herdAvg = ranked.length ? sum(ranked, r => r.net) / sum(ranked, r => r.head) : null;
    const best = ranked.length ? ranked.slice().sort((a, b) => b.avgNet - a.avgNet)[0] : null;
    const years = [...new Set(S.sales.map(x => yearOf(x.date)).concat(S.calvings.map(c => yearOf(c.date))).filter(Boolean))].sort().reverse();
    const open = searches.cowOpen;
    const detail = r => `<tr class="cow-detail"><td colspan="9"><div class="cow-calves">
      ${r.mine.length ? `<table class="rows mini"><thead><tr><th>Sold</th><th>Calf</th><th class="num">Head</th><th class="num">Weight</th><th class="num">Price</th><th class="num">Gross</th><th class="num">After barn charges</th></tr></thead><tbody>
        ${r.mine.slice().sort((a, b) => a.sale.date < b.sale.date ? 1 : -1).map(s => `<tr><td>${esc(fmtDate(s.sale.date))}${s.sale.ticket ? `<br><small>Ticket ${esc(s.sale.ticket)}</small>` : ''}</td><td>${esc([s.line.tag, s.line.desc].filter(Boolean).join(' · ') || '—')}${s.line.comments ? ` <span class="pill warn">${esc(s.line.comments)}</span>` : ''}</td><td class="num">${whole(s.head)}</td><td class="num">${s.weight ? whole(s.weight) + ' lb' : ''}</td><td class="num">${s.line.price !== '' && s.line.price != null ? money(num(s.line.price)) + (s.line.per === 'head' ? '/hd' : '/cwt') : ''}</td><td class="num">${money(s.amt)}</td><td class="num"><b>${money(s.net)}</b></td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">None of her calves sold yet' + (since !== 'All' ? ' since ' + since : '') + '.</p>'}
      </div></td></tr>`;
    return `
      <h3 class="sec">Cow profit</h3>
      <p class="lede">What each cow’s calves brought at the sale barn, after the barn’s charges, so you can see which cows raise the calves that sell best. A sold calf counts toward a cow when it’s linked to her: raised calves from the herd list link on their own, and on older tickets pick her in “Out of which cow”.</p>
      <div class="toolbar">
        <label class="inline-sel">Since <select class="search" id="cowSince" aria-label="Since year">${['All'].concat(years).map(y => `<option${y === since ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        <label class="inline-sel">Rank by <select class="search" id="cowSort" aria-label="Rank cows by">${[['avgNet', 'Check per calf'], ['total', 'Total from her calves'], ['avgCwt', 'Price per cwt'], ['avgWt', 'Sale weight'], ['calves', 'Calves sold']].map(([v, l]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${ranked.length ? `<div class="cards">
        <div class="stat"><div class="k">Best cow</div><div class="v">${esc(best.c.tag)}</div><div class="s">${money(best.avgNet, false)} a calf after charges</div></div>
        <div class="stat"><div class="k">Herd average</div><div class="v">${money(herdAvg, false)}</div><div class="s">per calf sold, after charges</div></div>
        <div class="stat"><div class="k">Calves counted</div><div class="v">${whole(sum(ranked, r => r.head))}</div><div class="s">from ${ranked.length} cow${ranked.length === 1 ? '' : 's'}</div></div>
      </div>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="rows cow-table"><thead><tr><th>Cow</th>${showOwnerCol() ? '<th class="hide-sm">Whose</th>' : ''}<th class="num">Calves born</th><th class="num">Sold</th><th class="num hide-sm">Avg sale wt</th><th class="num hide-sm">Avg $/cwt</th><th class="num">Check per calf</th><th class="num hide-sm">vs. herd</th><th class="num">Total</th></tr></thead><tbody>
        ${rows.map((r, i) => { const diff = r.avgNet != null && herdAvg != null ? r.avgNet - herdAvg : null; return `<tr class="clickable${open === r.c.id ? ' open' : ''}" data-cow="${r.c.id}" tabindex="0" aria-expanded="${open === r.c.id}">
          <td><span class="rank">${r.head ? ranked.indexOf(r) + 1 : ''}</span><span class="tag">${esc(r.c.tag)}</span>${r.c.status !== 'Active' ? ` <span class="pill">${esc(r.c.status)}</span>` : ''}${r.c.breed || r.c.markings ? `<br><small>${esc([r.c.breed, r.c.markings].filter(Boolean).join(' · '))}</small>` : ''}</td>
          ${showOwnerCol() ? `<td class="hide-sm">${esc(ownerName(r.c.owner))}</td>` : ''}
          <td class="num">${r.born || ''}${r.lost ? `<br><small>${r.lost} lost</small>` : ''}${r.onHand ? `<br><small>${r.onHand} on hand</small>` : ''}</td>
          <td class="num">${whole(r.head) || ''}</td>
          <td class="num hide-sm">${r.avgWt ? whole(r.avgWt) + ' lb' : ''}</td>
          <td class="num hide-sm">${r.avgCwt != null ? money(r.avgCwt) : ''}</td>
          <td class="num"><b>${r.avgNet != null ? money(r.avgNet) : ''}</b></td>
          <td class="num hide-sm">${diff == null ? '' : `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${money(Math.abs(diff), false)}</span>`}</td>
          <td class="num">${r.net ? money(r.net, false) : ''}</td></tr>${open === r.c.id ? detail(r) : ''}`; }).join('')}
      </tbody></table></div>
      <p class="note">Click a cow to see each of her calves that sold. Feed and other costs aren’t split by cow, so this compares what each cow’s calves bring in.</p>`
      : `<div class="panel"><p class="empty">No cows with calves yet. Record calvings on Breeding &amp; calving, and link sold calves to their mothers on sale tickets.</p></div>`}`;
  },

  money() {
    const P = S.purchases.filter(inFilter).filter(p => matches('mSearch', [p.lot, p.what, p.place, p.notes].join(' '))).sort((a, b) => a.date < b.date ? 1 : -1);
    const year = searches.saleYear || 'All';
    const years = [...new Set(S.sales.map(x => yearOf(x.date)).filter(Boolean))].sort().reverse();
    const T = S.sales.filter(inFilter).filter(x => year === 'All' || yearOf(x.date) === year)
      .filter(x => matches('mSearch', [x.lot, x.what, x.place, x.ticket, x.notes].concat(saleLines(x).map(l => [l.tag, l.desc, l.comments].join(' '))).join(' ')))
      .sort((a, b) => a.date < b.date ? 1 : -1);
    const pcols = [
      {label: 'Date', get: r => fmtDate(r.date)},
      {label: 'What', get: r => (r.lot ? r.lot + ' · ' : '') + (r.what || '')},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Head', num: true, get: r => r.head, total: rs => whole(sum(rs, r => num(r.head)))},
      {label: 'Avg wt', num: true, get: r => num(r.head) && num(r.totalWeight) ? whole(num(r.totalWeight) / num(r.head)) + ' lb' : '', sm: true},
      {label: '$/cwt', num: true, get: r => num(r.pricePerCwt) != null ? money(num(r.pricePerCwt)) : (num(r.pricePerHead) != null ? money(num(r.pricePerHead)) + '/hd' : ''), sm: true},
      {label: 'Total cost', num: true, get: r => money(purchaseCost(r)), total: rs => money(sum(rs, purchaseCost))}
    ];
    // profit by group: sales net − purchase cost − expenses charged to the group
    const lots = [...new Set([...S.purchases, ...S.sales].filter(inFilter).map(x => (x.lot || '').trim()).filter(Boolean))];
    const lotRows = lots.map(l => {
      const same = x => (x.lot || '').trim().toLowerCase() === l.toLowerCase() && inFilter(x);
      const bought = S.purchases.filter(same), sold = S.sales.filter(same), ex = S.expenses.filter(same);
      const cost = sum(bought, purchaseCost) + sum(ex, expenseCost), inc = sum(sold, saleNet), headB = sum(bought, p => num(p.head)), headS = sum(sold, saleHead);
      const days = bought.length && sold.length ? daysFrom(bought.map(b => b.date).sort()[0], sold.map(x => x.date).sort().slice(-1)[0]) : null;
      return {id: l, lot: l, headB, headS, cost, inc, profit: inc - cost, days, open: headS < headB};
    }).sort((a, b) => a.lot.localeCompare(b.lot));
    return `
      <h3 class="sec">Bought &amp; sold</h3>
      <p class="lede">Enter each sale like the barn ticket: every animal or lot on its own line, and the barn’s charges (commission, insurance, yardage and the rest) once for the whole ticket.</p>
      <div class="toolbar">
        <button type="button" class="btn" data-add="sales">Record a sale ticket</button>
        <button type="button" class="btn ghost" data-add="purchases">Record a purchase</button>
        ${searchBox('mSearch', 'Search tag, ticket, what, where')}
        <select class="search" id="saleYear" aria-label="Year of sales">${['All'].concat(years).map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      ${T.length ? `<div class="cards">
        <div class="stat"><div class="k">Head sold</div><div class="v">${whole(sum(T, saleHead))}</div><div class="s">${year === 'All' ? 'all years' : year}</div></div>
        <div class="stat"><div class="k">Gross sales</div><div class="v">${money(sum(T, saleGross), false)}</div><div class="s">before barn charges</div></div>
        <div class="stat"><div class="k">Barn charges</div><div class="v">${money(sum(T, saleDeductions), false)}</div><div class="s">${sum(T, saleGross) ? (sum(T, saleDeductions) / sum(T, saleGross) * 100).toFixed(1) + '% of gross' : ''}</div></div>
        <div class="stat"><div class="k">Checks</div><div class="v">${money(sum(T, saleNet), false)}</div><div class="s">${T.length} ticket${T.length === 1 ? '' : 's'}</div></div>
      </div>` : ''}
      ${lotRows.length ? `<h4 class="sec" style="font-size:1.1rem;margin:18px 0 8px">Profit by group</h4>
      <div class="table-wrap"><table class="rows"><thead><tr><th>Group</th><th class="num">Bought</th><th class="num">Sold</th><th class="num hide-sm">Days</th><th class="num">Cost + expenses</th><th class="num">Sales net</th><th class="num">Profit</th></tr></thead><tbody>
      ${lotRows.map(r => `<tr><td><b>${esc(r.lot)}</b>${r.open ? ' <span class="pill warn">still on hand</span>' : ''}</td><td class="num">${whole(r.headB)}</td><td class="num">${whole(r.headS)}</td><td class="num hide-sm">${r.days == null ? '' : r.days}</td><td class="num">${money(r.cost)}</td><td class="num">${money(r.inc)}</td><td class="num"><b style="color:${r.profit < 0 ? 'var(--barn)' : 'var(--ok)'}">${money(r.profit)}</b>${r.headS ? `<br><small>${money(r.profit / r.headS)} a head</small>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <h4 class="sec" style="font-size:1.1rem;margin:22px 0 8px">Sold</h4>
      ${T.length ? T.map(ticketCard).join('') : `<div class="panel"><p class="empty">No sales ${year === 'All' ? 'recorded yet' : 'in ' + year}.</p></div>`}
      <h4 class="sec" style="font-size:1.1rem;margin:22px 0 8px">Bought</h4>
      ${table(P, pcols, {key: 'purchases', empty: 'No purchases recorded yet.'})}`;
  },

  expenses() {
    const year = searches.expYear || thisYear();
    const E = S.expenses.filter(inFilter).filter(e => year === 'All' || yearOf(e.date) === year).filter(e => matches('eSearch', [e.category, e.item, e.notes, e.lot].join(' '))).sort((a, b) => a.date < b.date ? 1 : -1);
    const years = [...new Set(S.expenses.map(e => yearOf(e.date)).concat([thisYear()]))].sort().reverse();
    const byCat = EXP_CATS.map(c => [c, sum(E.filter(e => e.category === c), expenseCost)]).filter(x => x[1]);
    const total = sum(E, expenseCost);
    const cols = [
      {label: 'Date', get: r => fmtDate(r.date)},
      {label: 'Kind', get: r => r.category},
      {label: 'What', get: r => (r.item || '') + (r.category === 'Travel / fuel' && num(r.miles) ? ' (' + whole(num(r.miles)) + ' mi)' : '')},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Qty', num: true, get: r => r.qty ? r.qty + ' ' + (r.unit || '') : '', sm: true},
      {label: 'Cost', num: true, get: r => money(expenseCost(r)), total: rs => money(sum(rs, expenseCost))}
    ];
    return `
      <h3 class="sec">Expenses</h3>
      <p class="lede">Grain, hay, mineral, vet, fuel and miles to the sale, hauling, fees — everything it costs to run the cattle. Travel can be entered as miles; it is costed at ${money(Number(S.settings.mileRate))} a mile (change it in Settings).</p>
      <div class="toolbar">
        <button type="button" class="btn" data-add="expenses">Add expense</button>
        ${searchBox('eSearch', 'Search kind, item, notes')}
        <select class="search" id="expYear" aria-label="Year">${years.concat(['All']).map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      ${byCat.length ? `<div class="cards">${byCat.sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => `<div class="stat"><div class="k">${esc(c)}</div><div class="v">${money(v, false)}</div><div class="s">${Math.round(v / total * 100)}% of ${year === 'All' ? 'all years' : year}</div></div>`).join('')}</div>` : ''}
      ${table(E, cols, {key: 'expenses', empty: 'No expenses for this year yet.'})}
      <h4 class="sec" style="font-size:1.1rem;margin:26px 0 4px">Saved expenses</h4>
      <p class="lede" style="margin-bottom:10px">The menu at the top of Add expense. Click one to change it, or add your own.</p>
      <div class="toolbar"><button type="button" class="btn ghost small" data-add="expPresets">Add a saved expense</button></div>
      ${table(S.expPresets.slice().sort((a, b) => a.name.localeCompare(b.name)), [
        {label: 'Name', get: r => r.name}, {label: 'Kind', get: r => r.category}, {label: 'Unit', get: r => r.unit || '', sm: true},
        {label: 'Usual cost', num: true, get: r => num(r.cost) != null ? money(num(r.cost)) : ''}], {key: 'expPresets', empty: 'No saved expenses yet.'})}`;
  },

  health() {
    const T = S.treatments.filter(inFilter).filter(t => matches('hSearch', [t.product, t.reason, t.herdWide ? 'whole herd' : (t.animalIds || []).map(tagOf).join(' ')].join(' '))).sort((a, b) => a.date < b.date ? 1 : -1);
    const M = S.medicines.filter(inFilter).sort((a, b) => a.name.localeCompare(b.name));
    const tcols = [
      {label: 'Date', get: r => fmtDate(r.date)},
      {label: 'Animals', get: r => r.herdWide ? 'Whole herd' : (r.animalIds || []).map(tagOf).join(', ')},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'Medicine', get: r => r.product},
      {label: 'Dose', get: r => [r.dose, r.route].filter(Boolean).join(' '), sm: true},
      {label: 'Clear to sell', html: r => { const c = clearDate(r); if (!c) return ''; return c > today() ? `<span class="pill warn">${esc(fmtShort(c))}</span>` : `<span class="pill ok">clear</span>`; }}
    ];
    const mcols = [
      {label: 'Medicine', get: r => r.name},
      {label: 'Kind', get: r => r.kind || '', sm: true},
      ...(showOwnerCol() ? [ownerCol] : []),
      {label: 'On hand', num: true, get: r => r.onHand !== '' && r.onHand != null ? r.onHand + ' ' + (r.unit || '') : ''},
      {label: 'Withdrawal', num: true, get: r => r.withdrawalDays !== '' && r.withdrawalDays != null ? r.withdrawalDays + ' days' : ''},
      {label: 'Expires', html: r => { if (!r.expires) return ''; const d = daysFrom(today(), r.expires); return d < 0 ? '<span class="pill bad">expired</span>' : d <= 60 ? `<span class="pill warn">${esc(fmtShort(r.expires))}</span>` : esc(fmtDate(r.expires)); }}
    ];
    return `
      <h3 class="sec">Health &amp; medicine</h3>
      <p class="lede">Every shot, pour-on and dewormer, who got it and when they are clear to sell. Keep the medicine you buy in the cabinet so its withdrawal days fill in on their own.</p>
      <div class="toolbar">
        <button type="button" class="btn" data-add="treatments">Record a treatment</button>
        <button type="button" class="btn ghost" data-add="medicines">Add to medicine cabinet</button>
        ${searchBox('hSearch', 'Search medicine, tag, reason')}
      </div>
      <h4 class="sec" style="font-size:1.1rem;margin:18px 0 8px">Treatments</h4>
      ${table(T, tcols, {key: 'treatments', empty: 'No treatments recorded yet.'})}
      <h4 class="sec" style="font-size:1.1rem;margin:22px 0 8px">Medicine cabinet</h4>
      ${table(M, mcols, {key: 'medicines', empty: 'The cabinet is empty.'})}`;
  },

  market() {
    const classes = [...new Set(S.market.map(r => r.cls))].sort((a, b) => MARKET_CLASSES.indexOf(a) - MARKET_CLASSES.indexOf(b));
    const pick = searches.mktClass && classes.includes(searches.mktClass) ? searches.mktClass : classes[0] || '';
    const rows = S.market.slice().sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : MARKET_CLASSES.indexOf(a.cls) - MARKET_CLASSES.indexOf(b.cls)));
    const cols = [
      {label: 'Sale date', get: r => fmtDate(r.date)},
      {label: 'Class', get: r => r.cls},
      {label: 'Avg wt', num: true, get: r => r.avgWeight ? whole(num(r.avgWeight)) + ' lb' : '', sm: true},
      {label: 'Head', num: true, get: r => r.head || '', sm: true},
      {label: 'Avg price', num: true, get: r => money(num(r.price)) + (perHeadClass(r.cls) ? ' /hd' : ' /cwt')}
    ];
    const b = S.bid;
    const bidField = (k, label, hint) => `<div class="field"><label for="bid-${k}">${esc(label)}</label><input type="text" inputmode="decimal" id="bid-${k}" data-bid="${k}" value="${esc(b[k])}">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
    return `
      <h3 class="sec">Market</h3>
      <p class="lede">USDA reports every Wednesday sale at Farmington Regional Stockyards. Open the report, then enter the prices you follow in one go — the book keeps the history and charts it.</p>
      <div class="toolbar">
        <a class="btn" href="${FARMINGTON_REPORT}" target="_blank" rel="noopener">Open this week’s Farmington report (USDA)</a>
        <button type="button" class="btn ghost" id="enterWeek">Enter a sale’s prices</button>
        <a class="btn ghost" href="${MMN}" target="_blank" rel="noopener">All USDA market reports</a>
      </div>
      ${classes.length ? `<section class="panel" style="margin-bottom:18px"><h4>Price history
        <select class="search" id="mktClass" aria-label="Class to chart" style="margin-left:auto;font:600 .9rem var(--ui)">${classes.map(c => `<option${c === pick ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></h4>
        <svg class="chart" id="mktChart" viewBox="0 0 720 240" role="img" aria-label="Price history for ${esc(pick)}"></svg></section>` : ''}
      <div class="calc" style="margin-bottom:22px">
        <section class="panel"><h4>What can I pay?</h4>
          ${bidField('buyWt', 'Weight when bought (lb per head)')}
          ${bidField('sellWt', 'Expected sale weight (lb per head)')}
          ${bidField('sellPrice', 'Expected sale price ($/cwt)', 'Use the latest Farmington price for that weight')}
          <div class="row2">${bidField('days', 'Days kept')}${bidField('feedPerDay', 'Feed / head / day ($)')}</div>
          <div class="row2">${bidField('trucking', 'Trucking / head ($)')}${bidField('commissionPct', 'Commission (%)')}</div>
          <div class="row2">${bidField('deathPct', 'Death loss (%)')}${bidField('target', 'Profit / head ($)')}</div>
        </section>
        <section class="panel" aria-live="polite" id="bidOut"></section>
      </div>
      <h4 class="sec" style="font-size:1.1rem;margin:0 0 8px">Prices recorded</h4>
      ${table(rows, cols, {key: 'market', empty: 'No prices yet. Select “Enter a sale’s prices” after the Wednesday sale.'})}`;
  },

  direct() {
    const b = S.beef;
    const f = (k, label, hint) => `<div class="field"><label for="beef-${k}">${esc(label)}</label><input type="text" inputmode="decimal" id="beef-${k}" data-beef="${k}" value="${esc(b[k])}">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
    return `
      <h3 class="sec">Sell direct: quarters, halves and wholes</h3>
      <p class="lede">See whether selling beef to people beats taking the same animal to the sale barn. The numbers here are examples — put in your processor’s prices and what you would charge.</p>
      <div class="calc">
        <section class="panel">
          <h4>The animal</h4>
          ${f('live', 'Live weight (lb)')}
          <div class="row2">${f('hangPct', 'Hanging (% of live)', 'Usually about 58–62%')}${f('yieldPct', 'Meat (% of hanging)', 'Take-home; usually 60–65%')}</div>
          <div class="row2">${f('finishDays', 'Days on feed')}${f('feedPerDay', 'Feed per day ($)')}</div>
          ${f('otherCost', 'Other costs ($)', 'Hauling to the processor, advertising…')}
          <h4 style="margin-top:18px">Selling direct</h4>
          ${f('price', 'Your price ($ per lb hanging)')}
          <div class="row2">${f('killFee', 'Kill fee ($)')}${f('cutWrap', 'Cut & wrap ($/lb)')}</div>
          <div class="field"><label class="inline-check"><input type="checkbox" id="beef-customerPaysProcessing" data-beef="customerPaysProcessing"${b.customerPaysProcessing ? ' checked' : ''}> Customers pay the processor themselves</label></div>
          <h4 style="margin-top:18px">Or the sale barn</h4>
          ${f('barnPrice', 'Sale-barn price ($/cwt)', 'From the Market tab for this kind of animal')}
          <div class="row2">${f('barnCommissionPct', 'Commission (%)')}${f('barnTrucking', 'Trucking ($)')}</div>
        </section>
        <section aria-live="polite" id="beefOut"></section>
      </div>`;
  },

  settings() {
    const st = S.settings;
    const counts = ['animals', 'breedings', 'calvings', 'purchases', 'sales', 'expenses', 'treatments', 'medicines', 'market'].map(k => S[k].length).reduce((a, b) => a + b, 0);
    return `
      <h3 class="sec">Settings &amp; data</h3>
      <div class="grid2">
        <section class="panel"><h4>The book</h4>
          <div class="field"><label for="set-farm">Name on the book</label><input id="set-farm" data-set="farmName" value="${esc(st.farmName)}"></div>
          ${st.owners.map((o, i) => `<div class="field"><label for="set-o${i}">Herd ${i + 1} name</label><input id="set-o${i}" data-owner-name="${o.id}" value="${esc(o.name)}"></div>`).join('')}
          <button type="button" class="btn ghost small" id="addOwner" style="margin-top:10px">Add another herd</button>
          <div class="row2">
            <div class="field"><label for="set-gest">Gestation (days)</label><input id="set-gest" inputmode="numeric" data-set="gestation" value="${esc(st.gestation)}"><span class="hint">About 283 for beef cows.</span></div>
            <div class="field"><label for="set-mile">Mileage rate ($ a mile)</label><input id="set-mile" inputmode="decimal" data-set="mileRate" value="${esc(st.mileRate)}"></div>
          </div>
          <div class="field"><label for="set-barn">Usual sale barn</label><input id="set-barn" data-set="saleBarn" value="${esc(st.saleBarn)}"></div>
        </section>
        <section class="panel"><h4>Sale barn charges</h4>
          <p class="empty" style="margin-bottom:4px">Used by “Fill in the barn’s charges” on a sale ticket. Set to what Farmington took out on the 2026 tickets.</p>
          <div class="row2">
            ${[['commissionPct', 'Commission (% of gross)'], ['insurancePct', 'Insurance (% of gross)'], ['yardagePerHead', 'Yardage ($ a head)'], ['beefCouncilPerHead', 'Beef council ($ a head)'],
              ['vetInspectionPerHead', 'Vet inspection ($ a head)'], ['vetPerCow', 'Vet ($ a cow)'], ['vetPerHeifer', 'Vet ($ a heifer)']].map(([k, l]) =>
              `<div class="field"><label for="rate-${k}">${l}</label><input id="rate-${k}" inputmode="decimal" data-rate="${k}" value="${esc(st.barnRates[k])}"></div>`).join('')}
          </div>
        </section>
        <section class="panel"><h4>Keep it safe <span class="count">${counts} records</span></h4>
          <p class="empty" style="margin-bottom:10px">The book is saved in this browser on this device. Make a backup now and then, or let it save itself to a folder (OneDrive works) on a computer.</p>
          <div class="toolbar" style="flex-direction:column;align-items:stretch">
            <button type="button" class="btn" id="exportXlsx">Export everything to Excel</button>
            <button type="button" class="btn ghost" id="backupJson">Download a backup file</button>
            <button type="button" class="btn ghost" id="restoreJson">Restore from a backup file</button>
            <button type="button" class="btn ghost" id="pickFolder">${folder ? 'Saving to folder “' + esc(folder.name) + '” — change' : 'Save automatically to a folder…'}</button>
          </div>
        </section>
        <section class="panel"><h4>Bring in an existing Excel list</h4>
          <p class="empty" style="margin-bottom:10px">Have the herd in a spreadsheet already? Choose the file, then match its columns to tag, type, breed and so on.</p>
          <button type="button" class="btn ghost" id="importXlsx">Choose a spreadsheet…</button>
          <div id="importArea"></div>
        </section>
      </div>`;
  }
};

/* ------------------------------------------------------------ market chart + calculators */
function drawChart() {
  const svg = $('mktChart'); if (!svg) return;
  const cls = $('mktClass').value;
  const pts = S.market.filter(r => r.cls === cls && num(r.price) != null).sort((a, b) => a.date < b.date ? -1 : 1);
  const W = 720, H = 240, L = 64, R = 20, T = 18, B = 34;
  if (pts.length < 2) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#5d6957" font-size="15">${pts.length ? 'One sale recorded — the line starts with the next one.' : ''}</text>` + (pts.length ? `<text x="${W / 2}" y="${H / 2 + 26}" text-anchor="middle" fill="#24391f" font-size="22" font-weight="700">${esc(money(num(pts[0].price)))}</text>` : ''); return; }
  const xs = pts.map(p => parseDate(p.date).getTime()), ys = pts.map(p => num(p.price));
  let lo = Math.min(...ys), hi = Math.max(...ys); if (hi === lo) { lo -= 5; hi += 5; } const padY = (hi - lo) * .12; lo -= padY; hi += padY;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => L + (t - x0) / (x1 - x0) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = 4, grid = Array.from({length: ticks + 1}, (_, i) => lo + (hi - lo) * i / ticks);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(ys[i]).toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  svg.innerHTML = grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e4e8dc"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#5d6957">${esc(money(v, false))}</text>`).join('')
    + `<text x="${L}" y="${H - 10}" font-size="12" fill="#5d6957">${esc(fmtShort(pts[0].date))}</text><text x="${W - R}" y="${H - 10}" text-anchor="end" font-size="12" fill="#5d6957">${esc(fmtShort(last.date))}</text>`
    + `<path d="${line}" fill="none" stroke="#5b7a35" stroke-width="2.5" stroke-linejoin="round"/>`
    + pts.map((p, i) => `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="${i === pts.length - 1 ? 5 : 3}" fill="${i === pts.length - 1 ? '#e2a743' : '#5b7a35'}"><title>${esc(fmtDate(p.date) + ': ' + money(ys[i]))}</title></circle>`).join('')
    + `<text x="${X(xs[xs.length - 1]) - 8}" y="${Y(ys[ys.length - 1]) - 10}" text-anchor="end" font-size="13" font-weight="700" fill="#24391f">${esc(money(ys[ys.length - 1]))}</text>`;
}
function calcBid() {
  const out = $('bidOut'); if (!out) return;
  const b = S.bid, n = k => num(b[k]) || 0;
  const revenue = n('sellWt') / 100 * n('sellPrice');
  const costs = n('days') * n('feedPerDay') + n('trucking') + revenue * n('commissionPct') / 100 + revenue * n('deathPct') / 100;
  const maxTotal = revenue - costs - n('target');
  const maxCwt = n('buyWt') ? maxTotal / (n('buyWt') / 100) : 0;
  out.innerHTML = !n('sellPrice') || !n('buyWt')
    ? '<h4>Most you can pay</h4><p class="empty">Enter the weights and the expected sale price.</p>'
    : `<h4>Most you can pay</h4><div class="result-big">${money(maxCwt)} <small style="font:600 1rem var(--ui);color:var(--muted)">per cwt</small></div>
       <p style="margin:6px 0 14px;font-weight:600">${money(maxTotal)} a head for a ${whole(n('buyWt'))} lb animal</p>
       <ul class="list"><li><span>Sale value</span><span>${money(revenue)}</span></li><li><span>Feed (${whole(n('days'))} days)</span><span>−${money(n('days') * n('feedPerDay'))}</span></li>
       <li><span>Trucking</span><span>−${money(n('trucking'))}</span></li><li><span>Commission + death loss</span><span>−${money(revenue * (n('commissionPct') + n('deathPct')) / 100)}</span></li><li><span>Profit wanted</span><span>−${money(n('target'))}</span></li></ul>
       <p class="note">Bid under this and the cattle should clear your target at the expected price.</p>`;
}
function calcBeef() {
  const out = $('beefOut'); if (!out) return;
  const b = S.beef, n = k => num(b[k]) || 0;
  const hang = n('live') * n('hangPct') / 100, take = hang * n('yieldPct') / 100;
  const processing = n('killFee') + hang * n('cutWrap');
  const finish = n('finishDays') * n('feedPerDay') + n('otherCost');
  const directGross = hang * n('price');
  const directNet = directGross - (b.customerPaysProcessing ? 0 : processing) - finish;
  const barnGross = n('live') / 100 * n('barnPrice');
  const barnNet = barnGross - barnGross * n('barnCommissionPct') / 100 - n('barnTrucking');
  const diff = directNet - barnNet;
  const share = frac => { const pay = hang * frac * n('price'); const proc = b.customerPaysProcessing ? processing * frac : 0; const meat = take * frac; return {pay, proc, all: pay + proc, meat, perLb: meat ? (pay + proc) / meat : 0}; };
  const breakEven = hang ? (barnNet + (b.customerPaysProcessing ? 0 : processing) + finish) / hang : 0;
  const q = share(.25), h = share(.5), w = share(1);
  out.innerHTML = `
    <div class="compare">
      <div class="stat${diff >= 0 ? ' win' : ''}"><div class="k">Selling direct, you keep</div><div class="v">${money(directNet, false)}</div><div class="s">${whole(hang)} lb hanging × ${money(n('price'))}${b.customerPaysProcessing ? '' : ' − processing'}${finish ? ' − feed & costs' : ''}</div></div>
      <div class="stat${diff < 0 ? ' win' : ''}"><div class="k">At the sale barn, you keep</div><div class="v">${n('barnPrice') ? money(barnNet, false) : '—'}</div><div class="s">${n('barnPrice') ? whole(n('live')) + ' lb × ' + money(n('barnPrice')) + '/cwt − commission & trucking' : 'Enter a sale-barn price to compare'}</div></div>
    </div>
    ${n('barnPrice') ? `<div class="panel" style="margin-top:12px"><div class="result-big" style="font-size:1.5rem;color:${diff >= 0 ? 'var(--ok)' : 'var(--barn)'}">${diff >= 0 ? 'Direct earns ' + money(diff, false) + ' more' : 'The sale barn earns ' + money(-diff, false) + ' more'}</div>
      <p class="note">To match the sale barn you would need to charge at least <b>${money(breakEven)}</b> per lb hanging.</p></div>` : ''}
    <div class="panel" style="margin-top:12px"><h4>What a customer pays</h4>
      <div class="table-wrap" style="border:0"><table class="rows"><thead><tr><th></th><th class="num">To you</th><th class="num">Processor</th><th class="num">Total</th><th class="num">Meat (about)</th><th class="num">Per lb of meat</th></tr></thead><tbody>
      ${[['Quarter', q], ['Half', h], ['Whole', w]].map(([l, s]) => `<tr><td><b>${l}</b></td><td class="num">${money(s.pay, false)}</td><td class="num">${b.customerPaysProcessing ? money(s.proc, false) : 'you pay'}</td><td class="num"><b>${money(s.all, false)}</b></td><td class="num">${whole(s.meat)} lb</td><td class="num">${money(s.perLb)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note">Hanging weight about ${whole(hang)} lb; take-home meat about ${whole(take)} lb. Processing about ${money(processing, false)} for the whole animal. Check the rules for selling beef with your processor or the Missouri Department of Agriculture before you sell.</p>
    </div>`;
}

/* ------------------------------------------------------------ special forms: bull turn-in, a sale's prices */
function openTurnIn() {
  $('drawerBody').onclick = null; $('drawer').classList.remove('wide');
  const cows = S.animals.filter(a => a.status === 'Active' && (a.type === 'Cow' || a.type === 'Heifer') && inFilter(a)).sort((a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true}));
  const bulls = animalOptions(['Bull']);
  editing = {special: 'turnin'};
  $('drawerTitle').textContent = 'Bull turned in';
  $('drawerBody').innerHTML = `<p class="lede" style="margin-top:12px">Records one breeding date for every cow you tick, so each gets a due date.</p>
    <div class="field"><label for="ti-date">Date the bull went in</label><input type="date" id="ti-date" value="${today()}"></div>
    <div class="field"><label for="ti-bull">Bull</label><select id="ti-bull"><option value="">—</option>${bulls.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><span class="label">Cows with him</span>${cows.length ? `<label class="inline-check" style="margin:4px 0 8px"><input type="checkbox" id="ti-all"> All ${cows.length}</label><div class="checks">${cows.map(a => `<label><input type="checkbox" name="ti-cow" value="${a.id}"> ${esc(a.tag)}</label>`).join('')}</div>` : '<p class="empty">No cows or heifers in this herd list yet.</p>'}</div>
    <div class="computed" id="computed"></div>`;
  $('drawerDelete').hidden = true; $('drawer').hidden = false;
  const upd = () => { const d = $('ti-date').value; $('computed').textContent = d ? 'Due about ' + fmtDate(addDays(d, S.settings.gestation)) : ''; };
  $('drawerBody').oninput = e => { if (e.target.id === 'ti-all') document.querySelectorAll('input[name="ti-cow"]').forEach(c => { c.checked = e.target.checked; }); upd(); };
  $('drawerBody').onchange = null; upd();
}
function saveTurnIn() {
  const date = $('ti-date').value, bullId = $('ti-bull').value, ids = [...document.querySelectorAll('input[name="ti-cow"]:checked')].map(i => i.value);
  if (!date || !ids.length) { toast('Pick the date and at least one cow'); return; }
  ids.forEach(id => S.breedings.push({id: uid(), cowId: id, owner: (animal(id) || {}).owner, date, bullId, method: 'Bull', pregCheck: 'Not checked', notes: ''}));
  save(); closeForm(); render(); toast('Recorded ' + ids.length + ' cow' + (ids.length === 1 ? '' : 's'));
}
function openWeek() {
  $('drawerBody').onclick = null; $('drawer').classList.remove('wide');
  editing = {special: 'week'};
  $('drawerTitle').textContent = 'A sale’s prices';
  $('drawerBody').innerHTML = `<p class="lede" style="margin-top:12px">Fill in only the classes you follow; leave the rest empty. Prices are $ per cwt, except bred cows and pairs ($ per head).</p>
    <div class="row2"><div class="field"><label for="wk-date">Sale date</label><input type="date" id="wk-date" value="${today()}"></div>
    <div class="field"><label for="wk-barn">Sale barn</label><input id="wk-barn" value="${esc(S.settings.saleBarn)}"></div></div>
    ${MARKET_CLASSES.map((c, i) => `<div class="row2" style="align-items:end"><div class="field"><label for="wk-p${i}">${esc(c)}</label><input id="wk-p${i}" inputmode="decimal" data-cls="${i}" placeholder="Avg price"></div><div class="field"><label for="wk-w${i}" class="hide-sm">Avg weight (lb)</label><input id="wk-w${i}" inputmode="decimal" placeholder="Avg weight (lb)" aria-label="${esc(c)} average weight"></div></div>`).join('')}`;
  $('drawerDelete').hidden = true; $('drawer').hidden = false;
  $('drawerBody').oninput = null; $('drawerBody').onchange = null;
}
function saveWeek() {
  const date = $('wk-date').value, barn = $('wk-barn').value.trim();
  if (!date) { toast('Pick the sale date'); return; }
  let n = 0, bad = 0;
  MARKET_CLASSES.forEach((c, i) => {
    const raw = $('wk-p' + i).value.trim(); if (!raw) return;
    const p = num(raw); if (p == null) { bad++; return; }
    S.market = S.market.filter(r => !(r.date === date && r.cls === c && (r.barn || '') === barn));
    S.market.push({id: uid(), date, barn, cls: c, price: p, avgWeight: num($('wk-w' + i).value) || '', head: '', notes: ''}); n++;
  });
  if (bad) { toast('Some prices are not numbers'); return; }
  if (!n) { toast('Enter at least one price'); return; }
  save(); closeForm(); render(); toast('Saved ' + n + ' price' + (n === 1 ? '' : 's'));
}

/* ------------------------------------------------------------ sale tickets */
const DESC_OPTIONS = ['Steer feeder', 'Heifer feeder', 'Steer calf', 'Heifer calf', 'Bull calf', 'Cow', 'Bred cow', 'Cow-calf pair', 'Heifer', 'Bull'];
function ticketCard(x) {
  const L = saleLines(x), g = saleGross(x), w = saleWeight(x), net = saleNet(x);
  const allCwt = L.length && L.every(l => l.per !== 'head');
  const deds = DEDS.filter(([k]) => num(x[k]));
  const chk = num(x.checkAmount), off = chk != null && Math.abs(chk - net) >= 0.01;
  const held = L.filter(l => l.animalId && onHold(l.animalId, x.date));
  const sub = [x.place, x.ticket ? 'Ticket ' + x.ticket : '', showOwnerCol() ? ownerName(x.owner) : '', x.lot ? 'Group: ' + x.lot : ''].filter(Boolean).join(' · ');
  return `<section class="panel ticket">
    <div class="ticket-head"><h4>${esc(fmtDate(x.date))}<span class="count">${esc(sub)}</span></h4>
      <button type="button" class="btn ghost small" data-ticket="${x.id}" aria-label="Edit the ${esc(fmtDate(x.date))} sale">Edit</button></div>
    <div class="table-wrap flat"><table class="rows">
      <thead><tr><th>Tag</th><th class="num">Head</th><th>Description</th><th class="num">Weight</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${L.map(l => `<tr><td>${esc(l.tag || '—')}</td><td class="num">${esc(l.head)}</td><td>${esc(l.desc || '')}${l.comments ? ` <span class="pill warn">${esc(l.comments)}</span>` : ''}</td>
        <td class="num">${num(l.weight) != null ? whole(num(l.weight)) + ' lb' + (num(l.head) > 1 ? `<br><small>avg ${whole(Math.floor(num(l.weight) / num(l.head)))}</small>` : '') : ''}</td>
        <td class="num">${num(l.price) != null ? money(num(l.price)) + (l.per === 'head' ? '/hd' : '/cwt') : ''}</td><td class="num">${money(lineAmount(l))}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${whole(saleHead(x))}</td><td></td><td class="num">${w ? whole(w) + ' lb' : ''}</td><td class="num">${allCwt && w ? money(g / w * 100) + '/cwt' : ''}</td><td class="num">${money(g)}</td></tr></tfoot>
    </table></div>
    <div class="ticket-foot">
      <dl class="deds">${deds.length ? deds.map(([k, l]) => `<div><dt>${l}</dt><dd>${money(num(x[k]))}</dd></div>`).join('') : '<div><dt>Barn charges</dt><dd>none entered</dd></div>'}</dl>
      <dl class="totals"><div><dt>Total charges</dt><dd>${money(saleDeductions(x))}</dd></div><div class="check"><dt>Check</dt><dd>${money(net)}</dd></div>
        ${saleHead(x) ? `<div><dt>Per head</dt><dd>${money(net / saleHead(x))}</dd></div>` : ''}</dl>
    </div>
    ${off ? `<p class="warnline">The ticket says ${money(chk)}; these lines and charges add up to ${money(net)}. Check the numbers.</p>` : ''}
    ${held.length ? `<p class="warnline">Still in medicine withdrawal on the sale date: ${held.map(l => esc(tagOf(l.animalId))).join(', ')}</p>` : ''}
    ${x.notes ? `<p class="note">${esc(x.notes)}</p>` : ''}
  </section>`;
}
function ticketLineHtml(l, n) {
  const id = l.id || uid(), f = k => `tl-${k}-${id}`;
  const animals = S.animals.filter(a => a.status === 'Active' || a.id === l.animalId).sort((a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true}));
  const mothers = S.animals.filter(a => a.type === 'Cow' || a.type === 'Heifer' || a.id === damOf(l)).sort((a, b) => a.tag.localeCompare(b.tag, undefined, {numeric: true}));
  return `<fieldset class="tline" data-id="${id}">
    <legend>Animal or lot <span class="ln">${n}</span></legend>
    <button type="button" class="btn ghost small danger tl-remove" aria-label="Remove line ${n}">Remove</button>
    <div class="tgrid">
      <div class="field"><label for="${f('head')}">Head</label><input id="${f('head')}" data-l="head" inputmode="numeric" value="${esc(l.head ?? 1)}"></div>
      <div class="field"><label for="${f('tag')}">Tag</label><input id="${f('tag')}" data-l="tag" value="${esc(l.tag || '')}"></div>
      <div class="field wide2"><label for="${f('desc')}">Description</label><input id="${f('desc')}" data-l="desc" list="descList" value="${esc(l.desc || '')}" placeholder="e.g. Steer feeder (BLK)"></div>
      <div class="field"><label for="${f('weight')}">Weight (lb)</label><input id="${f('weight')}" data-l="weight" inputmode="decimal" value="${esc(l.weight ?? '')}"></div>
      <div class="field"><label for="${f('price')}">Price ($)</label><input id="${f('price')}" data-l="price" inputmode="decimal" value="${esc(l.price ?? '')}"></div>
      <div class="field"><label for="${f('per')}">Per</label><select id="${f('per')}" data-l="per"><option value="cwt"${l.per !== 'head' ? ' selected' : ''}>cwt</option><option value="head"${l.per === 'head' ? ' selected' : ''}>head</option></select></div>
      <div class="field amt"><span class="label">Amount</span><output data-l="amount">${money(lineAmount(l))}</output></div>
      <div class="field wide2"><label for="${f('animalId')}">From the herd list (optional)</label><select id="${f('animalId')}" data-l="animalId"><option value="">—</option>${animals.map(a => `<option value="${a.id}"${a.id === l.animalId ? ' selected' : ''}>${esc(a.tag + ' · ' + a.type + (owners().length > 1 ? ' · ' + ownerName(a.owner) : ''))}</option>`).join('')}</select></div>
      <div class="field wide2"><label for="${f('comments')}">Comments</label><input id="${f('comments')}" data-l="comments" value="${esc(l.comments || '')}" placeholder="e.g. Fancy, Open"></div>
      <div class="field wide2"><label for="${f('damId')}">Out of which cow (optional)</label><select id="${f('damId')}" data-l="damId"><option value="">—</option>${mothers.map(a => `<option value="${a.id}"${a.id === damOf(l) ? ' selected' : ''}>${esc(a.tag + (a.status !== 'Active' ? ' (' + a.status.toLowerCase() + ')' : '') + (owners().length > 1 ? ' · ' + ownerName(a.owner) : ''))}</option>`).join('')}</select><span class="hint">Fills in by itself for a calf from the herd list. Used by the Cow profit tab.</span></div>
    </div>
  </fieldset>`;
}
function openTicket(rec) {
  const x = rec || {date: today(), owner: ownerFilter !== 'all' ? ownerFilter : owners()[0].id, place: S.settings.saleBarn, what: 'Calves', lines: [{id: uid(), head: 1, per: 'cwt'}]};
  editing = {special: 'ticket', rec: rec || null};
  $('drawer').classList.add('wide');
  $('drawerTitle').textContent = rec ? 'Edit sale ticket' : 'Record a sale ticket';
  const whats = ['Calves', 'Feeder steers', 'Feeder heifers', 'Cull cows', 'Bred cows', 'Cow-calf pairs', 'Bull', 'Beef sold direct', 'Other'];
  $('drawerBody').innerHTML = `<p class="lede" style="margin-top:12px">Copy the barn ticket: one line per animal or lot, then the barn’s charges once for the whole ticket.</p>
    <div class="row2"><div class="field"><label for="tk-date">Sale date *</label><input type="date" id="tk-date" value="${esc(x.date || '')}"></div>
      <div class="field"><label for="tk-owner">Whose</label><select id="tk-owner">${owners().map(o => `<option value="${o.id}"${o.id === x.owner ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div></div>
    <div class="row2"><div class="field"><label for="tk-place">Where</label><input id="tk-place" value="${esc(x.place || '')}"></div>
      <div class="field"><label for="tk-ticket">Ticket number</label><input id="tk-ticket" value="${esc(x.ticket || '')}"></div></div>
    <div class="row2"><div class="field"><label for="tk-what">What sold</label><select id="tk-what">${whats.map(w => `<option${w === x.what ? ' selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="field"><label for="tk-lot">Group name (optional)</label><input id="tk-lot" value="${esc(x.lot || '')}"><span class="hint">Same name as when bought, for traded cattle.</span></div></div>
    <datalist id="descList">${DESC_OPTIONS.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
    <div id="tk-lines">${saleLines(x).map((l, i) => ticketLineHtml(l, i + 1)).join('')}</div>
    <button type="button" class="btn ghost" id="tk-addline" style="margin-top:10px">+ Add another animal or lot</button>
    <fieldset class="tline deds-box"><legend>The barn’s charges (whole ticket)</legend>
      <button type="button" class="btn ghost small" id="tk-fill" style="margin:6px 0 2px">Fill in the barn’s charges</button>
      <span class="hint" style="display:block">Uses the rates in Settings &amp; data. Change any number to match the ticket.</span>
      <div class="row2">${DEDS.map(([k, l]) => `<div class="field"><label for="tk-${k}">${l} ($)</label><input id="tk-${k}" data-ded="${k}" inputmode="decimal" value="${esc(x[k] ?? '')}"></div>`).join('')}</div>
    </fieldset>
    <div class="field"><label for="tk-check">Check amount on the ticket (optional)</label><input id="tk-check" inputmode="decimal" value="${esc(x.checkAmount ?? '')}"><span class="hint">If you type it, the book warns you when the lines and charges don’t add up to it.</span></div>
    <div class="field"><label for="tk-notes">Notes</label><textarea id="tk-notes">${esc(x.notes || '')}</textarea></div>
    <div class="computed" id="computed"></div>`;
  $('drawerDelete').hidden = !rec; $('drawer').hidden = false;
  const body = $('drawerBody');
  body.oninput = e => {
    const sel = e.target.closest('[data-l="animalId"]');
    if (sel && sel.value) {
      const fs = sel.closest('.tline'), t = fs.querySelector('[data-l="tag"]'), a = animal(sel.value), d = fs.querySelector('[data-l="damId"]');
      if (!t.value) t.value = tagOf(sel.value);
      if (a && a.damId && d && !d.value) d.value = a.damId;
    }
    updateTicket();
  };
  body.onchange = body.oninput;
  body.onclick = e => {
    if (e.target.id === 'tk-addline') {
      const n = body.querySelectorAll('#tk-lines .tline').length + 1;
      $('tk-lines').insertAdjacentHTML('beforeend', ticketLineHtml({id: uid(), head: 1, per: 'cwt'}, n));
      body.querySelector('#tk-lines .tline:last-child [data-l="tag"]').focus(); updateTicket();
    } else if (e.target.classList.contains('tl-remove')) {
      const fs = e.target.closest('.tline');
      if (body.querySelectorAll('#tk-lines .tline').length === 1) { fs.querySelectorAll('input').forEach(i => { i.value = i.dataset.l === 'head' ? '1' : ''; }); }
      else fs.remove();
      body.querySelectorAll('#tk-lines .ln').forEach((s, i) => { s.textContent = i + 1; });
      updateTicket();
    } else if (e.target.id === 'tk-fill') {
      const c = barnCharges(readTicket().lines);
      Object.entries(c).forEach(([k, v]) => { $('tk-' + k).value = v ? v.toFixed(2) : ''; });
      updateTicket(); toast('Barn charges filled in');
    }
  };
  updateTicket();
  setTimeout(() => $('tk-date').focus(), 30);
}
const numOr = v => { v = String(v ?? '').trim(); if (v === '') return ''; const n = num(v); return n == null ? v : n; };
function readTicket() {
  const v = id => $(id).value.trim();
  const lines = [...document.querySelectorAll('#tk-lines .tline')].map(fs => {
    const q = k => fs.querySelector(`[data-l="${k}"]`).value.trim();
    return {id: fs.dataset.id, head: numOr(q('head')), tag: q('tag'), desc: q('desc'), weight: numOr(q('weight')), price: numOr(q('price')), per: q('per'), animalId: q('animalId'), comments: q('comments'), damId: q('damId')};
  });
  const r = {date: v('tk-date'), owner: v('tk-owner'), place: v('tk-place'), ticket: v('tk-ticket'), what: v('tk-what'), lot: v('tk-lot'), lines, checkAmount: numOr(v('tk-check')), notes: v('tk-notes')};
  DEDS.forEach(([k]) => { r[k] = numOr(v('tk-' + k)); });
  return r;
}
function updateTicket() {
  const r = readTicket();
  document.querySelectorAll('#tk-lines .tline').forEach((fs, i) => { fs.querySelector('[data-l="amount"]').textContent = money(lineAmount(r.lines[i])) || '$0.00'; });
  const g = saleGross(r), d = saleDeductions(r), net = saleNet(r), head = saleHead(r);
  let t = `${whole(head)} head · gross ${money(g)} · barn charges ${money(d)} · check ${money(net)}` + (head ? ` (${money(net / head)} a head)` : '');
  const chk = num(r.checkAmount);
  if (chk != null && Math.abs(chk - net) >= 0.01) t += `\n⚠ The ticket says ${money(chk)}, ${money(Math.abs(chk - net))} ${chk > net ? 'more' : 'less'} than these numbers.`;
  const held = r.lines.filter(l => l.animalId && onHold(l.animalId, r.date));
  if (held.length) t += '\n⚠ Still in medicine withdrawal on this date: ' + held.map(l => tagOf(l.animalId) + ' (' + onHold(l.animalId, r.date).product + ' until ' + fmtShort(clearDate(onHold(l.animalId, r.date))) + ')').join(', ');
  const c = $('computed'); c.textContent = t; c.style.whiteSpace = 'pre-line';
}
function saveTicket() {
  const r = readTicket();
  r.lines = r.lines.filter(l => [l.tag, l.desc, l.weight, l.price, l.animalId, l.comments].some(x => x !== '' && x != null));
  document.querySelectorAll('#drawerBody .bad').forEach(b => b.classList.remove('bad'));
  const bad = [];
  if (!r.date) bad.push($('tk-date'));
  document.querySelectorAll('#tk-lines .tline').forEach(fs => ['head', 'weight', 'price'].forEach(k => { const el = fs.querySelector(`[data-l="${k}"]`); if (el.value.trim() && num(el.value) == null) bad.push(el); }));
  DEDS.concat([['check']]).forEach(([k]) => { const el = $('tk-' + k); if (el && el.value.trim() && num(el.value) == null) bad.push(el); });
  if (bad.length) { bad.forEach(el => el.closest('.field').classList.add('bad')); bad[0].focus(); toast(r.date ? 'Some numbers aren’t numbers' : 'Pick the sale date'); return; }
  if (!r.lines.length) { toast('Add at least one animal or lot'); return; }
  r.lines.forEach(l => { if (l.head === '') l.head = 1; });
  const isNew = !editing.rec;
  if (isNew) S.sales.push({id: uid(), ...r}); else Object.assign(editing.rec, r);
  r.lines.forEach(l => { const a = l.animalId && animal(l.animalId); if (a && a.status === 'Active') { a.status = 'Sold'; a.statusDate = r.date; } });
  save(); closeForm(); render(); toast(isNew ? 'Sale recorded' : 'Sale saved');
}

/* ------------------------------------------------------------ Excel + backups */
const SHEETS = [
  ['Herd', 'animals', [['Tag', r => r.tag], ['Herd', r => ownerName(r.owner)], ['Type', r => r.type], ['Calf sex', r => r.sex || ''], ['Breed', r => r.breed || ''], ['Color / markings', r => r.markings || ''], ['Year born', r => r.birthYear || ''], ['Date born', r => r.birthDate || ''], ['Dam', r => r.damId ? tagOf(r.damId) : ''], ['Raised / bought', r => r.source || ''], ['Date bought', r => r.boughtDate || ''], ['Price paid', r => num(r.boughtPrice)], ['Weight bought', r => num(r.boughtWeight)], ['Bought from', r => r.boughtFrom || ''], ['Status', r => r.status], ['Status date', r => r.statusDate || ''], ['Calves', r => calvingsOf(r.id).length || ''], ['Next due', r => { const b = currentBreeding(r.id); return b ? dueDate(b) : ''; }], ['Notes', r => r.notes || '']]],
  ['Breeding', 'breedings', [['Cow', r => tagOf(r.cowId)], ['Herd', r => ownerName(r.owner)], ['Date bred / exposed', r => r.date], ['Bull', r => r.method === 'AI' ? 'AI' : (r.bullId ? tagOf(r.bullId) : '')], ['Preg check', r => r.pregCheck || ''], ['Checked on', r => r.pregDate || ''], ['Due', r => dueDate(r)], ['Notes', r => r.notes || '']]],
  ['Calvings', 'calvings', [['Date', r => r.date], ['Cow', r => tagOf(r.cowId)], ['Herd', r => ownerName(r.owner)], ['Calf tag', r => r.calfTag || ''], ['Calf', r => r.calfSex || ''], ['Birth weight', r => num(r.birthWeight)], ['Calving', r => r.ease || ''], ['Calf status', r => r.calfStatus || ''], ['Notes', r => r.notes || '']]],
  ['Bought', 'purchases', [['Date', r => r.date], ['Herd', r => ownerName(r.owner)], ['Where', r => r.place || ''], ['Group', r => r.lot || ''], ['What', r => r.what || ''], ['Head', r => num(r.head)], ['Total weight', r => num(r.totalWeight)], ['$/cwt', r => num(r.pricePerCwt)], ['$/head', r => num(r.pricePerHead)], ['Fees', r => num(r.fees)], ['Trucking', r => num(r.trucking)], ['Total cost', r => +purchaseCost(r).toFixed(2)], ['Notes', r => r.notes || '']]],
  ['Sale tickets', 'sales', [['Date', r => r.date], ['Herd', r => ownerName(r.owner)], ['Where', r => r.place || ''], ['Ticket', r => r.ticket || ''], ['Group', r => r.lot || ''], ['What', r => r.what || ''], ['Head', r => saleHead(r)], ['Total weight', r => saleWeight(r)], ['Gross', r => saleGross(r)]]
    .concat(DEDS.map(([k, l]) => [l, r => num(r[k])])).concat([['Total charges', r => saleDeductions(r)], ['Check', r => saleNet(r)], ['Notes', r => r.notes || '']])],
  ['Sold animals', 'saleLines', [['Date', r => r.sale.date], ['Herd', r => ownerName(r.sale.owner)], ['Ticket', r => r.sale.ticket || ''], ['Tag', r => r.tag || ''], ['Out of', r => damOf(r) ? tagOf(damOf(r)) : ''], ['Head', r => num(r.head)], ['Description', r => r.desc || ''], ['Comments', r => r.comments || ''], ['Weight', r => num(r.weight)], ['Avg weight', r => num(r.head) && num(r.weight) ? Math.floor(num(r.weight) / num(r.head)) : ''], ['Price', r => num(r.price)], ['Per', r => r.per === 'head' ? 'head' : 'cwt'], ['Amount', r => lineAmount(r)]]],
  ['Expenses', 'expenses', [['Date', r => r.date], ['Herd', r => ownerName(r.owner)], ['Kind', r => r.category], ['What', r => r.item || ''], ['Quantity', r => num(r.qty)], ['Unit', r => r.unit || ''], ['Miles', r => num(r.miles)], ['Cost', r => +expenseCost(r).toFixed(2)], ['Group', r => r.lot || ''], ['Notes', r => r.notes || '']]],
  ['Treatments', 'treatments', [['Date', r => r.date], ['Herd', r => ownerName(r.owner)], ['Animals', r => r.herdWide ? 'Whole herd' : (r.animalIds || []).map(tagOf).join(', ')], ['Medicine', r => r.product], ['Dose', r => r.dose || ''], ['Given', r => r.route || ''], ['Withdrawal days', r => num(r.withdrawalDays)], ['Clear to sell', r => clearDate(r)], ['Why', r => r.reason || ''], ['Given by', r => r.givenBy || ''], ['Notes', r => r.notes || '']]],
  ['Medicine cabinet', 'medicines', [['Medicine', r => r.name], ['Kind', r => r.kind || ''], ['Herd', r => ownerName(r.owner)], ['Withdrawal days', r => num(r.withdrawalDays)], ['Expires', r => r.expires || ''], ['On hand', r => num(r.onHand)], ['Unit', r => r.unit || ''], ['Cost', r => num(r.cost)], ['Bought', r => r.boughtDate || ''], ['Lot / serial', r => r.lotNo || ''], ['Notes', r => r.notes || '']]],
  ['Market prices', 'market', [['Sale date', r => r.date], ['Sale barn', r => r.barn || ''], ['Class', r => r.cls], ['Avg price', r => num(r.price)], ['Avg weight', r => num(r.avgWeight)], ['Head', r => num(r.head)], ['Notes', r => r.notes || '']]]
];
function needXlsx() { if (window.XLSX) return true; alert('The Excel tool has not loaded yet. Check the internet connection and try again.'); return false; }
function exportXlsx() {
  if (!needXlsx()) return;
  const wb = XLSX.utils.book_new();
  SHEETS.forEach(([name, key, cols]) => {
    const src = key === 'saleLines' ? S.sales.flatMap(x => saleLines(x).map(l => ({...l, sale: x, date: x.date}))) : S[key];
    const rows = src.slice().sort((a, b) => (a.date || a.tag || a.name || '') < (b.date || b.tag || b.name || '') ? -1 : 1).map(r => Object.fromEntries(cols.map(([h, g]) => [h, g(r) ?? ''])));
    const ws = XLSX.utils.json_to_sheet(rows, {header: cols.map(c => c[0])});
    ws['!cols'] = cols.map(([h]) => ({wch: Math.max(10, Math.min(40, h.length + 4))}));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, (S.settings.farmName || "Michelle’s Herd Book").replace(/[^\w\- ]+/g, '') + ' ' + today() + '.xlsx');
  toast('Excel file downloaded');
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function backupJson() { download('herd-book-backup-' + today() + '.json', JSON.stringify(S, null, 1), 'application/json'); toast('Backup downloaded'); }
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files && i.files[0]); i.click(); }); }
async function restoreJson() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || d.version !== 1 || !Array.isArray(d.animals)) throw Error('That is not a Herd Book backup file.');
    if (!confirm('Replace everything in this book with the backup from ' + (d.savedAt ? new Date(d.savedAt).toLocaleString() : 'that file') + '?')) return;
    S = normalize(d);
    save(); render(); toast('Backup restored');
  } catch (e) { alert('Could not restore: ' + e.message); }
}
async function chooseFolder() {
  if (!window.showDirectoryPicker) { alert('Saving to a folder works in Microsoft Edge or Google Chrome on a computer. On this device, use “Download a backup file” instead.'); return; }
  try { const h = await window.showDirectoryPicker({mode: 'readwrite'}); await useFolder(h); toast('Saving to “' + h.name + '”'); }
  catch (e) { if (e && e.name !== 'AbortError') alert('Could not use that folder: ' + e.message); }
}

/* import a herd list from any spreadsheet, matching its columns */
const IMPORT_FIELDS = [['tag', 'Tag number', /tag|number|^id$|name|cow/i], ['type', 'Type', /type|kind|class/i], ['breed', 'Breed', /breed/i], ['markings', 'Color / markings', /colou?r|mark/i],
  ['birthYear', 'Year born', /year|born|birth|age/i], ['boughtDate', 'Date bought', /bought.*date|purchase.*date|date.*bought/i], ['boughtPrice', 'Price paid', /price|cost|paid/i], ['notes', 'Notes', /note|comment/i]];
let importData = null;
async function importXlsx() {
  if (!needXlsx()) return;
  const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), {type: 'array', cellDates: true});
    importData = {wb, name: f.name}; showImport(wb.SheetNames[0]);
  } catch (e) { alert('Could not read that file: ' + e.message); }
}
function showImport(sheet) {
  const {wb, name} = importData;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {defval: '', raw: false});
  const heads = rows.length ? Object.keys(rows[0]) : [];
  importData.rows = rows; importData.sheet = sheet;
  const guess = re => heads.find(h => re.test(h)) || '';
  const used = new Set();
  $('importArea').innerHTML = `
    <p style="margin:12px 0 4px"><b>${esc(name)}</b> · ${rows.length} rows</p>
    <div class="field"><label for="imp-sheet">Sheet</label><select id="imp-sheet">${wb.SheetNames.map(s => `<option${s === sheet ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="field"><label for="imp-owner">Put them in</label><select id="imp-owner">${owners().map(o => `<option value="${o.id}"${o.id === (ownerFilter !== 'all' ? ownerFilter : owners()[0].id) ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>
    ${IMPORT_FIELDS.map(([k, label, re]) => { let g = guess(re); if (used.has(g)) g = ''; if (g) used.add(g); return `<div class="field"><label for="imp-${k}">${esc(label)}${k === 'tag' ? ' *' : ''}</label><select id="imp-${k}" data-imp="${k}"><option value="">(not in the file)</option>${heads.map(h => `<option${h === g ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`; }).join('')}
    <div class="field"><label for="imp-deftype">Type when the file doesn’t say</label><select id="imp-deftype">${TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
    <button type="button" class="btn" id="imp-go" style="margin-top:14px">Import ${rows.length} animals</button>`;
}
function runImport() {
  const map = {}; document.querySelectorAll('[data-imp]').forEach(s => { map[s.dataset.imp] = s.value; });
  if (!map.tag) { alert('Choose which column has the tag numbers.'); return; }
  const owner = $('imp-owner').value, defType = $('imp-deftype').value;
  const typeOf = v => { const t = String(v || '').trim().toLowerCase(); return TYPES.find(x => t.startsWith(x.toLowerCase())) || (/bull/.test(t) ? 'Bull' : /heif/.test(t) ? 'Heifer' : /steer/.test(t) ? 'Steer' : /calf/.test(t) ? 'Calf' : /cow/.test(t) ? 'Cow' : defType); };
  const dateOf = v => { if (!v) return ''; if (v instanceof Date) return iso(v); const d = new Date(v); return isNaN(d) ? '' : iso(d); };
  let added = 0, skipped = 0;
  importData.rows.forEach(row => {
    const tag = String(row[map.tag] || '').trim(); if (!tag) { skipped++; return; }
    if (S.animals.some(a => a.owner === owner && a.status === 'Active' && a.tag.toLowerCase() === tag.toLowerCase())) { skipped++; return; }
    const by = String(map.birthYear ? row[map.birthYear] : '').trim();
    const year = /^\d{4}$/.test(by) ? by : (/^\d{1,2}$/.test(by) ? String(new Date().getFullYear() - Number(by)) : (dateOf(by) || '').slice(0, 4));
    S.animals.push({id: uid(), tag, owner, type: typeOf(map.type ? row[map.type] : ''), breed: map.breed ? String(row[map.breed]).trim() : '', markings: map.markings ? String(row[map.markings]).trim() : '',
      birthYear: year, source: map.boughtDate && row[map.boughtDate] ? 'Bought' : 'Raised', boughtDate: map.boughtDate ? dateOf(row[map.boughtDate]) : '', boughtPrice: map.boughtPrice ? num(row[map.boughtPrice]) ?? '' : '',
      status: 'Active', notes: map.notes ? String(row[map.notes]).trim() : ''});
    added++;
  });
  save(); importData = null; tab = 'herd'; render();
  toast('Imported ' + added + ' animals' + (skipped ? ' (' + skipped + ' skipped: blank or already in the list)' : ''));
}

/* ------------------------------------------------------------ landing glance */
function renderGlance() {
  const A = S.animals.filter(a => a.status === 'Active');
  const due = A.filter(a => a.type === 'Cow' || a.type === 'Heifer').map(a => currentBreeding(a.id)).filter(Boolean).map(b => daysFrom(today(), dueDate(b))).filter(d => d >= 0 && d <= 30).length;
  const items = [];
  if (A.length) items.push(A.length + ' head');
  if (due) items.push(due + ' due in the next 30 days');
  const h = holds().length; if (h) items.push(h + ' in withdrawal');
  $('landGlance').innerHTML = items.map(t => `<li>${esc(t)}</li>`).join('');
  $('landTitle').textContent = S.settings.farmName || "Michelle’s Herd Book";
  document.title = S.settings.farmName || "Michelle’s Herd Book";
}

/* ------------------------------------------------------------ events */
function openBook() { const d = $('book'); if (!d.open) d.showModal(); render(); $('view').focus(); }
document.addEventListener('DOMContentLoaded', () => {
  renderGlance();
  $('openBook').addEventListener('click', openBook);
  $('closeBook').addEventListener('click', () => { closeForm(); $('book').close(); renderGlance(); });
  $('book').addEventListener('cancel', e => { if (!$('drawer').hidden) { e.preventDefault(); closeForm(); } });
  $('book').addEventListener('close', renderGlance);
  $('drawerClose').addEventListener('click', closeForm);
  $('drawerCancel').addEventListener('click', closeForm);
  $('drawerDelete').addEventListener('click', deleteRecord);
  $('drawerForm').addEventListener('submit', e => {
    if (editing && editing.special === 'turnin') { e.preventDefault(); saveTurnIn(); return; }
    if (editing && editing.special === 'week') { e.preventDefault(); saveWeek(); return; }
    if (editing && editing.special === 'ticket') { e.preventDefault(); saveTicket(); return; }
    submitForm(e);
  });
  $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; closeForm(); render(); $('view').scrollTop = 0; });
  $('tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(t => t[0] === tab), j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    tab = TABS[j][0]; render(); $('tab-' + tab).focus();
  });
  $('ownerSwitch').addEventListener('click', e => { const b = e.target.closest('[data-owner]'); if (!b) return; ownerFilter = b.dataset.owner; render(); });

  const view = $('view');
  view.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'); if (add) { if (add.dataset.add === 'sales') openTicket(); else openForm(add.dataset.add); return; }
    const cw = e.target.closest('tr[data-cow]'); if (cw) { searches.cowOpen = searches.cowOpen === cw.dataset.cow ? '' : cw.dataset.cow; render(); const n = document.querySelector(`tr[data-cow="${cw.dataset.cow}"]`); if (n) n.focus(); return; }
    const tk = e.target.closest('[data-ticket]'); if (tk) { const rec = S.sales.find(r => r.id === tk.dataset.ticket); if (rec) openTicket(rec); return; }
    const row = e.target.closest('tr[data-col]'); if (row) { const key = row.dataset.col, rec = S[key].find(r => r.id === row.dataset.id); if (rec) openForm(key, rec); return; }
    const id = e.target.id;
    if (id === 'turnIn') openTurnIn();
    else if (id === 'enterWeek') openWeek();
    else if (id === 'exportXlsx') exportXlsx();
    else if (id === 'backupJson') backupJson();
    else if (id === 'restoreJson') restoreJson();
    else if (id === 'pickFolder') chooseFolder();
    else if (id === 'importXlsx') importXlsx();
    else if (id === 'imp-go') runImport();
    else if (id === 'addOwner') { S.settings.owners.push({id: 'o' + uid().slice(0, 6), name: 'Herd ' + (owners().length + 1)}); save(); render(); }
  });
  view.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-col], tr[data-cow]')) { e.preventDefault(); e.target.click(); } });
  view.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('search') && t.type === 'search') { searches[t.id] = t.value; const pos = t.selectionStart; render(); const n = $(t.id); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (t.dataset.bid) { S.bid[t.dataset.bid] = t.value; save(true); calcBid(); return; }
    if (t.dataset.beef) { S.beef[t.dataset.beef] = t.type === 'checkbox' ? t.checked : t.value; save(true); calcBeef(); return; }
    if (t.dataset.set) { const k = t.dataset.set; S.settings[k] = (k === 'gestation' || k === 'mileRate') ? (num(t.value) ?? t.value) : t.value; save(true); $('bookTitle').textContent = S.settings.farmName || "Michelle’s Herd Book"; return; }
    if (t.dataset.rate) { S.settings.barnRates[t.dataset.rate] = num(t.value) ?? t.value; save(true); return; }
    if (t.dataset.ownerName) { const o = owners().find(x => x.id === t.dataset.ownerName); if (o) { o.name = t.value; save(true); renderOwnerSwitch(); } }
  });
  view.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'herdStatus' || t.id === 'expYear' || t.id === 'saleYear' || t.id === 'cowSince' || t.id === 'cowSort') { searches[t.id] = t.value; render(); }
    else if (t.id === 'mktClass') { searches.mktClass = t.value; drawChart(); }
    else if (t.id === 'imp-sheet') showImport(t.value);
    else if (t.dataset.beef && t.type === 'checkbox') { S.beef[t.dataset.beef] = t.checked; save(true); calcBeef(); }
  });

  // reconnect a remembered folder silently when the browser still allows it
  recallFolder().then(async h => { if (h && h.queryPermission && (await h.queryPermission({mode: 'readwrite'})) === 'granted') useFolder(h); });
  if (location.hash === '#book') openBook();
});
