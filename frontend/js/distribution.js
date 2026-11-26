// Distribution page (Momen). Families + recording distributions + history.
const user = Api.requireLogin();
let stock = [];     // items offered in the distribution form (from Mohamed's /api/items)
let families = [];

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
const fmtDateTime = (iso) => new Date(iso).toLocaleString();

// ---------- families ----------
async function loadFamilies() {
  const tbody = document.getElementById('familyRows');
  try {
    const q = qs(document.getElementById('familySearch'));
    const data = await Api.get(`/api/families${q ? `?${q}` : ''}`);
    tbody.replaceChildren(...(data.families.length ? data.families.map(familyRow) : [el('tr', {}, el('td', { colspan: 6 }, 'No families found.'))]));
  } catch (err) { tbody.replaceChildren(el('tr', {}, el('td', { colspan: 6 }, `Could not load families: ${err.message}`))); }
}

// The family pickers always list every family (not only the current search), active ones for giving food.
async function loadFamilyPickers() {
  try {
    families = (await Api.get('/api/families')).families;
    const give = document.getElementById('familySelect');
    const hist = document.getElementById('historyFamily');
    give.replaceChildren(el('option', { value: '' }, 'Choose an active family...'),
      ...families.filter((f) => f.status === 'active').map((f) => el('option', { value: f.id }, `${f.household_ref} (${f.household_size} people)`)));
    hist.replaceChildren(el('option', { value: '' }, 'All families'),
      ...families.map((f) => el('option', { value: f.id }, f.household_ref)));
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

function familyRow(f) {
  const next = f.status === 'active' ? 'suspended' : 'active';
  return el('tr', {},
    el('td', {}, f.household_ref), el('td', {}, f.household_size), el('td', {}, f.contact_phone || '-'),
    el('td', {}, el('span', { class: `pill ${f.status === 'active' ? 'ok' : 'muted-pill'}` }, f.status)),
    el('td', {}, f.last_distribution_at ? fmtDateTime(f.last_distribution_at) : 'never'),
    el('td', { class: 'actions' },
      el('button', { type: 'button', class: 'secondary', onclick: () => openFamily(f) }, 'Edit'),
      el('button', { type: 'button', class: 'secondary', onclick: () => setStatus(f, next) }, next === 'suspended' ? 'Deactivate' : 'Activate')));
}

async function setStatus(f, status) {
  try {
    await Api.patch(`/api/families/${f.id}`, { status });
    showMessage('msg', `${f.household_ref} is now ${status}.`, 'success');
    await Promise.all([loadFamilies(), loadFamilyPickers()]);
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

const familyDialog = document.getElementById('familyDialog');
const familyForm = document.getElementById('familyForm');
let editingFamily = null;
function openFamily(f) {
  editingFamily = f || null;
  familyForm.reset();
  document.getElementById('familyTitle').textContent = f ? `Edit ${f.household_ref}` : 'Register a family';
  familyForm.household_ref.disabled = Boolean(f); // the reference identifies the family and is not changed
  if (f) {
    familyForm.household_ref.value = f.household_ref;
    familyForm.household_size.value = f.household_size;
    familyForm.contact_phone.value = f.contact_phone || '';
  }
  showMessage('familyMsg', '');
  familyDialog.showModal();
}
document.getElementById('newFamilyBtn').addEventListener('click', () => openFamily(null));

familyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const size = Number(familyForm.household_size.value);
  const phone = familyForm.contact_phone.value.trim();
  if (!Number.isInteger(size) || size < 1 || size > 30) return showMessage('familyMsg', 'Household size must be between 1 and 30', 'error');
  if (phone && !/^[0-9+\-\s]{6,30}$/.test(phone)) return showMessage('familyMsg', 'Phone can only contain digits, spaces, + and -', 'error');
  try {
    if (editingFamily) {
      await Api.patch(`/api/families/${editingFamily.id}`, { household_size: size, contact_phone: phone || null });
    } else {
      const ref = familyForm.household_ref.value.trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,30}$/.test(ref)) return showMessage('familyMsg', 'Reference: 3-30 letters, digits or dashes (e.g. FAM-0007)', 'error');
      await Api.post('/api/families', { household_ref: ref, household_size: size, ...(phone ? { contact_phone: phone } : {}) });
    }
    familyDialog.close();
    showMessage('msg', 'Family saved.', 'success');
    await Promise.all([loadFamilies(), loadFamilyPickers()]);
  } catch (err) { showMessage('familyMsg', err.message, 'error'); }
});

// ---------- record a distribution ----------
async function loadStock() {
  try {
    const { items } = await Api.get('/api/items?in_stock=true');
    stock = items.filter((i) => i.days_left >= 0); // never offer expired food
  } catch (err) { showMessage('msg', `Could not load stock: ${err.message}`, 'error'); }
}

function addLine() {
  const select = el('select', { required: '' }, el('option', { value: '' }, 'Choose item...'),
    ...stock.map((i) => el('option', { value: i.item_id }, `${i.name} (${i.category})`)));
  const avail = el('td', {}, '-');
  const exp = el('td', {}, '-');
  const qty = el('input', { type: 'number', min: '1', step: '1', required: '' });
  select.addEventListener('change', () => {
    const i = stock.find((s) => String(s.item_id) === select.value);
    avail.textContent = i ? `${i.quantity} ${i.unit}` : '-';
    exp.replaceChildren(i ? `${i.expiry_date} ` : '-', i && levelForDays(i.days_left) ? levelPill(levelForDays(i.days_left)) : '');
    qty.max = i ? String(i.quantity) : '';
  });
  const row = el('tr', {}, el('td', {}, select), avail, exp, el('td', {}, qty),
    el('td', {}, el('button', { type: 'button', class: 'secondary', onclick: () => row.remove() }, 'Remove')));
  document.getElementById('lineRows').append(row);
}
document.getElementById('addLineBtn').addEventListener('click', addLine);

document.getElementById('distForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const familyId = Number(document.getElementById('familySelect').value);
  const lines = [...document.querySelectorAll('#lineRows tr')].map((tr) => ({
    item_id: Number(tr.querySelector('select').value), quantity: Number(tr.querySelector('input').value),
  }));
  // Quick checks for the user; the backend checks stock again inside a transaction.
  if (!familyId) return showMessage('distMsg', 'Choose a family', 'error');
  if (!lines.length) return showMessage('distMsg', 'Add at least one item', 'error');
  for (const l of lines) {
    const i = stock.find((s) => s.item_id === l.item_id);
    if (!i) return showMessage('distMsg', 'Choose an item on every line', 'error');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) return showMessage('distMsg', `Enter a quantity for ${i.name}`, 'error');
    if (l.quantity > i.quantity) return showMessage('distMsg', `Only ${i.quantity} ${i.unit} of ${i.name} available`, 'error');
  }
  if (new Set(lines.map((l) => l.item_id)).size !== lines.length) return showMessage('distMsg', 'Each item can only appear once', 'error');

  const notes = e.target.notes.value.trim();
  try {
    const d = await Api.post('/api/distributions', { family_id: familyId, items: lines, ...(notes ? { notes } : {}) });
    showMessage('distMsg', '');
    showMessage('msg', `Distribution #${d.id} recorded for ${d.household_ref}. Stock updated.`, 'success');
    e.target.reset();
    document.getElementById('lineRows').replaceChildren();
    await loadStock();
    addLine();
    await Promise.all([loadHistory(), loadFamilies()]);
    if (window.refreshAlertBadge) window.refreshAlertBadge();
  } catch (err) { showMessage('distMsg', err.message, 'error'); }
});

// ---------- history ----------
async function loadHistory() {
  const tbody = document.getElementById('historyRows');
  const f = document.getElementById('historyForm');
  if (f.from.value && f.to.value && f.from.value > f.to.value) return showMessage('msg', '"From" must be on or before "To"', 'error');
  try {
    const q = qs(f);
    const { distributions } = await Api.get(`/api/distributions${q ? `?${q}` : ''}`);
    tbody.replaceChildren(...(distributions.length ? distributions.map((d) => el('tr', {},
      el('td', {}, d.id), el('td', {}, fmtDateTime(d.distributed_at)), el('td', {}, d.household_ref),
      el('td', {}, d.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(', ')),
      el('td', {}, d.staff_name), el('td', {}, d.notes || '-'))) : [el('tr', {}, el('td', { colspan: 6 }, 'No distributions in this period.'))]));
  } catch (err) { tbody.replaceChildren(el('tr', {}, el('td', { colspan: 6 }, `Could not load history: ${err.message}`))); }
}

document.getElementById('familySearch').addEventListener('submit', (e) => { e.preventDefault(); loadFamilies(); });
document.getElementById('historyForm').addEventListener('submit', (e) => { e.preventDefault(); loadHistory(); });

if (user) {
  Promise.all([loadFamilies(), loadFamilyPickers(), loadStock().then(addLine), loadHistory()]);
}
