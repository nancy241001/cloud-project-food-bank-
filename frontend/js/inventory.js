// Inventory page (Mohamed). All data comes from GET/POST/PATCH/DELETE /api/items.
const user = Api.requireLogin();
const isAdmin = user && user.role === 'admin';
const LOW_STOCK = 10;

fillSelect(document.getElementById('donorType'), DONOR_TYPES);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- list / search ----------
async function loadItems() {
  const tbody = document.getElementById('itemRows');
  try {
    const q = qs(document.getElementById('searchForm'));
    const { items } = await Api.get(`/api/items${q ? `?${q}` : ''}`);
    renderTiles(items);
    tbody.replaceChildren(...(items.length ? items.map(itemRow) : [el('tr', {}, el('td', { colspan: 9 }, 'No items match these filters.'))]));
  } catch (err) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 9 }, `Could not load inventory: ${err.message}`)));
  }
}

function renderTiles(items) {
  const inStock = items.filter((i) => i.quantity > 0);
  const tiles = [
    [inStock.length, 'Item lines in stock'],
    [inStock.reduce((t, i) => t + i.quantity, 0), 'Units in stock'],
    [inStock.filter((i) => i.quantity <= LOW_STOCK).length, 'Low stock lines', 'warning'],
    [inStock.filter((i) => i.days_left >= 0 && i.days_left <= 7).length, 'Expiring within 7 days', 'critical'],
    [inStock.filter((i) => i.days_left < 0).length, 'Expired (still in stock)', 'expired'],
  ];
  document.getElementById('tiles').replaceChildren(...tiles.map(([v, l, cls = '']) =>
    el('div', { class: `tile ${cls}` }, el('div', { class: 'tile-value' }, String(v)), el('div', { class: 'tile-label' }, l))));
}

function itemRow(i) {
  const level = levelForDays(i.days_left);
  const qty = el('td', { class: 'nowrap' }, `${i.quantity} ${i.unit}`);
  if (i.quantity > 0 && i.quantity <= LOW_STOCK) qty.append(' ', el('span', { class: 'pill warning' }, 'low'));
  const actions = el('td', { class: 'actions' }, el('button', { type: 'button', onclick: () => openEdit(i) }, 'Edit'));
  if (isAdmin) actions.append(el('button', { type: 'button', class: 'danger', onclick: () => removeItem(i) }, 'Delete'));
  return el('tr', { class: level },
    el('td', {}, i.name, i.lot ? el('div', { class: 'muted' }, `lot ${i.lot}`) : ''),
    el('td', {}, i.category), qty, el('td', { class: 'nowrap' }, i.donation_date),
    el('td', { class: 'nowrap' }, i.expiry_date, level ? el('br') : '', level ? levelPill(level) : ''),
    el('td', {}, daysText(i.days_left)),
    el('td', {}, i.donor_name ? `${i.donor_name} (${i.donor_type})` : i.donor_type),
    el('td', {}, i.storage_location || '-'), actions);
}

// ---------- record a donation ----------
const donationDialog = document.getElementById('donationDialog');
const donationForm = document.getElementById('donationForm');
document.getElementById('newDonationBtn').addEventListener('click', () => {
  donationForm.reset();
  donationForm.donation_date.value = todayIso();
  showMessage('donationMsg', '');
  donationDialog.showModal();
});

// Client-side checks give quick feedback; the backend repeats them (it is the real protection).
function donationBody(f) {
  const body = {
    name: f.name.value.trim(), category: f.category.value, unit: f.unit.value.trim(),
    quantity: Number(f.quantity.value), donation_date: f.donation_date.value, expiry_date: f.expiry_date.value,
    donor_type: f.donor_type.value,
  };
  ['donor_name', 'lot', 'storage_location'].forEach((k) => { if (f[k].value.trim()) body[k] = f[k].value.trim(); });
  if (!body.name || !body.category || !body.unit || !body.donation_date || !body.expiry_date) throw new Error('Fill in all required fields');
  if (!Number.isInteger(body.quantity) || body.quantity < 1) throw new Error('Quantity must be a whole number of at least 1');
  if (body.expiry_date < body.donation_date) throw new Error('Expiry date cannot be before the donation date');
  if (body.expiry_date < todayIso()) throw new Error('This food has already expired and cannot be accepted');
  return body;
}

donationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const item = await Api.post('/api/items', donationBody(donationForm));
    donationDialog.close();
    showMessage('msg', `Donation recorded: ${item.quantity} ${item.unit} of ${item.name}.`, 'success');
    loadItems();
  } catch (err) { showMessage('donationMsg', err.message, 'error'); }
});

// ---------- edit ----------
const editDialog = document.getElementById('editDialog');
const editForm = document.getElementById('editForm');
let editing = null;
function openEdit(i) {
  editing = i;
  document.getElementById('editName').textContent = i.name;
  editForm.quantity.value = i.quantity;
  editForm.expiry_date.value = i.expiry_date;
  editForm.storage_location.value = i.storage_location || '';
  editForm.lot.value = i.lot || '';
  showMessage('editMsg', '');
  editDialog.showModal();
}
editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  const qty = Number(editForm.quantity.value);
  if (!Number.isInteger(qty) || qty < 0) return showMessage('editMsg', 'Quantity must be a whole number of 0 or more', 'error');
  if (qty !== editing.quantity) body.quantity = qty;
  if (editForm.expiry_date.value !== editing.expiry_date) body.expiry_date = editForm.expiry_date.value;
  ['storage_location', 'lot'].forEach((k) => { if (editForm[k].value.trim() !== (editing[k] || '')) body[k] = editForm[k].value.trim(); });
  if (!Object.keys(body).length) return editDialog.close(); // nothing changed, so no request
  try {
    await Api.patch(`/api/items/${editing.item_id}`, body);
    editDialog.close();
    showMessage('msg', `${editing.name} updated.`, 'success');
    loadItems();
  } catch (err) { showMessage('editMsg', err.message, 'error'); }
});

// ---------- delete (admin) ----------
async function removeItem(i) {
  if (!window.confirm(`Delete "${i.name}" permanently? If it was ever distributed, set its quantity to 0 instead.`)) return;
  try {
    await Api.del(`/api/items/${i.item_id}`);
    showMessage('msg', `${i.name} deleted.`, 'success');
    loadItems();
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

document.getElementById('searchForm').addEventListener('submit', (e) => { e.preventDefault(); loadItems(); });
if (user) loadItems();
