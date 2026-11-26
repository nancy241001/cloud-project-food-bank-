// Users page (Momen, auth). Admin only: the API returns 403 for staff, and the page says so.
const user = Api.requireLogin();
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

async function loadUsers() {
  const tbody = document.getElementById('userRows');
  try {
    const { users } = await Api.get('/api/users');
    tbody.replaceChildren(...users.map(userRow));
  } catch (err) {
    if (err.status === 403) document.getElementById('newUserBtn').hidden = true;
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 6 }, err.status === 403 ? 'Only an admin can manage users.' : `Could not load users: ${err.message}`)));
  }
}

function userRow(u) {
  const isMe = u.id === user.id;
  const actions = el('td', { class: 'actions' });
  if (!isMe) { // an admin cannot demote or deactivate themselves (the API refuses it too)
    const other = u.role === 'admin' ? 'staff' : 'admin';
    actions.append(
      el('button', { type: 'button', class: 'secondary', onclick: () => update(u, { role: other }, `${u.name} is now ${other}`) }, `Make ${other}`),
      el('button', { type: 'button', class: u.is_active ? 'danger' : 'secondary', onclick: () => update(u, { is_active: !u.is_active }, `${u.name} ${u.is_active ? 'deactivated' : 'reactivated'}`) },
        u.is_active ? 'Deactivate' : 'Reactivate'));
  } else actions.append(el('span', { class: 'muted' }, 'you'));
  return el('tr', {},
    el('td', {}, u.name), el('td', {}, u.email), el('td', {}, u.role),
    el('td', {}, el('span', { class: `pill ${u.is_active ? 'ok' : 'muted-pill'}` }, u.is_active ? 'active' : 'inactive')),
    el('td', {}, new Date(u.created_at).toLocaleDateString()), actions);
}

async function update(u, body, done) {
  if (body.role === 'admin' && !window.confirm(`Give ${u.name} full admin rights?`)) return;
  try {
    await Api.patch(`/api/users/${u.id}`, body);
    showMessage('msg', `${done}.`, 'success');
    loadUsers();
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

const dialog = document.getElementById('userDialog');
const form = document.getElementById('userForm');
document.getElementById('newUserBtn').addEventListener('click', () => { form.reset(); showMessage('userMsg', ''); dialog.showModal(); });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: form.full_name.value.trim(), email: form.email.value.trim().toLowerCase(),
    password: form.password.value, role: form.role.value,
  };
  if (!body.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return showMessage('userMsg', 'Enter a name and a valid email', 'error');
  if (body.password.length < 10) return showMessage('userMsg', 'Password must be at least 10 characters', 'error');
  try {
    await Api.post('/api/users', body);
    dialog.close();
    showMessage('msg', `${body.name} can now log in.`, 'success');
    loadUsers();
  } catch (err) { showMessage('userMsg', err.message, 'error'); }
});

if (user) loadUsers();
