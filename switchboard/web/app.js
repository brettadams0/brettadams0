// Switchboard web UI. No build step, no dependencies.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// ---- token ------------------------------------------------------------------

let token = store.get('sb.token') || '';
const hashToken = new URLSearchParams(location.hash.slice(1)).get('token');
if (hashToken) {
  token = hashToken;
  store.set('sb.token', token);
  history.replaceState(null, '', location.pathname);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) { logout(); throw new Error('bad token'); }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

function logout() {
  store.set('sb.token', null);
  token = '';
  ws?.close();
  $('#app').hidden = true;
  $('#login').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('#login-token').value.trim();
  try {
    await api('GET', '/api/sessions');
    store.set('sb.token', token);
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').hidden = false;
  }
});

// ---- state ------------------------------------------------------------------

const S = {
  sessions: [],
  current: store.get('sb.current') || '',   // '' = everything
  messages: [],                             // current thread, oldest first
  unread: {},
  permissions: new Map(),                   // key session/request_id
  release: null,
  tab: 'chat',
  screenTimer: null,
};
const me = (m) => m.from_kind === 'user';

// ---- websocket --------------------------------------------------------------

let ws = null;
let backoff = 500;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=client&token=${encodeURIComponent(token)}`);
  ws.onopen = () => { backoff = 500; setConn('on'); };
  ws.onclose = () => {
    setConn('off');
    if (!token) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10000);
  };
  ws.onmessage = (e) => onEvent(JSON.parse(e.data));
}
function setConn(state) {
  const d = $('#conn');
  d.className = `dot ${state}`;
  d.title = state === 'on' ? 'connected' : 'disconnected';
}

function onEvent(ev) {
  switch (ev.type) {
    case 'hello':
      S.sessions = ev.sessions;
      S.permissions = new Map(ev.pending_permissions.map((p) => [`${p.session}/${p.request_id}`, p]));
      S.release = ev.latest_release;
      renderSessions(); renderPermissions(); renderRelease();
      loadThread();
      break;
    case 'sessions':
      S.sessions = ev.sessions; renderSessions(); renderThreadHead(); break;
    case 'message': onMessage(ev.message); break;
    case 'permission': {
      const key = `${ev.request.session}/${ev.request.request_id}`;
      if (ev.request.status === 'pending') S.permissions.set(key, ev.request); else S.permissions.delete(key);
      renderPermissions();
      break;
    }
    case 'task': if (S.tab === 'tasks') loadTasks(); break;
    case 'app_release': S.release = ev.release; renderRelease(); break;
  }
}

function inThread(m) {
  return !S.current || m.from_name === S.current || m.to_name === S.current;
}

function onMessage(m) {
  if (inThread(m)) {
    const i = S.messages.findIndex((x) => x.id === m.id);
    if (i >= 0) S.messages[i] = m; else S.messages.push(m);
    appendMessage(m);
  } else {
    const who = m.from_kind === 'session' ? m.from_name : m.to_name;
    S.unread[who] = (S.unread[who] || 0) + 1;
    renderSessions();
  }
  if (m.speak && m.to_kind === 'user') say(m);
}

// ---- sessions sidebar -------------------------------------------------------

function renderSessions() {
  const list = $('#session-list');
  list.replaceChildren(
    h('li', {}, h('button', { 'aria-current': String(!S.current), onclick: () => select('') },
      h('span', { class: 'dot', style: 'background:var(--accent)' }), h('span', { class: 'name' }, 'Everything'), '',
      h('span', { class: 'sub' }, 'all sessions, all messages'))),
    ...S.sessions.map((s) => {
      const state = s.online ? 'on' : s.tmux_alive ? 'mid' : 'off';
      const n = S.unread[s.name];
      return h('li', {}, h('button', { 'aria-current': String(S.current === s.name), onclick: () => select(s.name) },
        h('span', { class: `dot ${state}`, title: s.online ? 'connected' : s.tmux_alive ? 'starting / channel down' : 'stopped' }),
        h('span', { class: 'name' }, s.name),
        n ? h('span', { class: 'badge unread' }, String(n)) : s.role === 'orchestrator' ? h('span', { class: 'badge' }, 'lead') : '',
        h('span', { class: 'sub' }, s.description || s.cwd || '')));
    }),
  );
}

function select(name) {
  S.current = name;
  S.unread[name] = 0;
  store.set('sb.current', name);
  closeSidebar();
  closeScreen();
  renderSessions();
  loadThread();
}

function renderThreadHead() {
  const s = S.sessions.find((x) => x.name === S.current);
  $('#thread-title').textContent = S.current || 'Everything';
  $('#thread-sub').textContent = s
    ? `${s.online ? 'connected' : s.tmux_alive ? 'starting…' : 'stopped'} · ${s.cwd ?? ''}`
    : `${S.sessions.filter((x) => x.online).length} of ${S.sessions.length} sessions connected`;
  $('#screen-btn').hidden = !s?.tmux_alive;
  $('#stop-btn').hidden = !s?.tmux_alive;
  const orch = S.sessions.find((x) => x.role === 'orchestrator');
  $('#input').placeholder = S.current ? `Message ${S.current}…` : orch ? `Message ${orch.name} (orchestrator)…` : 'Start a session first';
}

// ---- thread -----------------------------------------------------------------

async function loadThread(before) {
  renderThreadHead();
  const q = new URLSearchParams({ limit: '80' });
  if (S.current) q.set('session', S.current);
  if (before) q.set('before', String(before));
  const msgs = await api('GET', `/api/messages?${q}`);
  S.messages = before ? [...msgs, ...S.messages] : msgs;
  renderMessages(!before, msgs.length === 80);
}

function renderMessages(scroll = true, more = false) {
  const ol = $('#messages');
  ol.replaceChildren(
    more ? h('li', { class: 'load-more' }, h('button', { class: 'small', onclick: () => loadThread(S.messages[0]?.id) }, 'Earlier messages')) : '',
    ...S.messages.map(messageEl),
  );
  if (scroll) ol.scrollTop = ol.scrollHeight;
}

function appendMessage(m) {
  const ol = $('#messages');
  const nearBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 120;
  const existing = ol.querySelector(`[data-id="${m.id}"]`);
  if (existing) existing.replaceWith(messageEl(m));
  else ol.append(messageEl(m));
  if (nearBottom || me(m)) ol.scrollTop = ol.scrollHeight;
}

function messageEl(m) {
  const kind = m.from_kind === 'system' || m.kind === 'system' ? 'system'
    : me(m) ? 'mine'
    : m.to_kind === 'session' ? 'peer' : 'theirs';
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const route = me(m) ? `→ ${m.to_name}` : m.to_kind === 'session' ? `${m.from_name} → ${m.to_name}` : m.from_name;
  const queued = m.to_kind === 'session' && !m.delivered && m.kind === 'chat';
  return h('li', { class: `msg ${kind}${m.kind === 'permission' ? ' perm-msg' : ''}`, 'data-id': m.id },
    kind === 'system' ? '' : h('div', { class: 'meta' }, `${route} · ${time}${m.kind === 'verdict' ? ' · answered prompt' : ''}`),
    h('div', { class: 'body' }, m.body),
    queued ? h('div', { class: 'meta queued' }, 'queued until the session connects') : '');
}

// ---- composer ---------------------------------------------------------------

async function send(text) {
  text = text.trim();
  if (!text) return;
  try {
    await api('POST', '/api/messages', { to: S.current || undefined, body: text });
  } catch (e) {
    alert(e.message);
  }
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#input');
  send(t.value);
  t.value = '';
  autosize();
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
const autosize = () => { const t = $('#input'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
$('#input').addEventListener('input', autosize);

// ---- voice: read aloud ------------------------------------------------------

$('#speak').checked = store.get('sb.speak') === '1';
$('#speak').addEventListener('change', (e) => {
  store.set('sb.speak', e.target.checked ? '1' : '0');
  if (e.target.checked) say({ body: 'Reading replies aloud.', from_kind: 'system' });
  else speechSynthesis?.cancel();
});
function say(m) {
  if (!$('#speak').checked || !('speechSynthesis' in window)) return;
  const prefix = m.from_kind === 'session' && m.from_name ? `${m.from_name} says: ` : '';
  const u = new SpeechSynthesisUtterance(prefix + m.body.replace(/```[\s\S]*?```/g, ' (code on screen) ').slice(0, 1200));
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ---- voice: hold to talk ----------------------------------------------------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#mic').hidden = true;
let rec = null;
let heard = '';
function startTalk(e) {
  e.preventDefault();
  if (rec) return;
  speechSynthesis?.cancel();
  heard = '';
  rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (ev) => {
    heard = [...ev.results].map((r) => r[0].transcript).join(' ');
    $('#input').value = heard;
    autosize();
  };
  rec.onend = () => {
    $('#mic').classList.remove('live');
    rec = null;
    if (heard.trim()) { send(heard); $('#input').value = ''; autosize(); }
  };
  rec.onerror = () => {};
  rec.start();
  $('#mic').classList.add('live');
}
const stopTalk = () => rec?.stop();
$('#mic').addEventListener('pointerdown', startTalk);
$('#mic').addEventListener('pointerup', stopTalk);
$('#mic').addEventListener('pointerleave', stopTalk);
$('#mic').addEventListener('pointercancel', stopTalk);

// ---- permission prompts -----------------------------------------------------

function renderPermissions() {
  const list = [...S.permissions.values()].filter((p) => !S.current || p.session === S.current);
  $('#permissions').replaceChildren(...list.map((p) =>
    h('div', { class: 'perm' },
      h('div', {}, h('strong', {}, p.session), ` wants to use `, h('code', {}, p.tool_name)),
      h('div', {}, p.description),
      p.input_preview ? h('pre', {}, p.input_preview) : '',
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => decide(p, 'allow') }, 'Allow'),
        h('button', { class: 'danger', onclick: () => decide(p, 'deny') }, 'Deny')))));
}
async function decide(p, behavior) {
  try {
    await api('POST', `/api/permissions/${encodeURIComponent(p.session)}/${p.request_id}`, { behavior });
  } catch (e) {
    alert(e.message);
  }
  S.permissions.delete(`${p.session}/${p.request_id}`);
  renderPermissions();
}

// ---- screen peek ------------------------------------------------------------

async function refreshScreen() {
  if (!S.current) return;
  try {
    const r = await api('GET', `/api/sessions/${encodeURIComponent(S.current)}/screen?lines=80`);
    const pre = $('#screen');
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
    pre.textContent = r.screen;
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    $('#screen').textContent = e.message;
  }
}
function closeScreen() {
  $('#screen-panel').hidden = true;
  clearInterval(S.screenTimer);
}
$('#screen-btn').addEventListener('click', () => {
  const p = $('#screen-panel');
  if (!p.hidden) return closeScreen();
  p.hidden = false;
  refreshScreen();
  S.screenTimer = setInterval(refreshScreen, 2000);
});
$('#screen-refresh').addEventListener('click', refreshScreen);
$$('.screen-keys [data-key]').forEach((b) => b.addEventListener('click', async () => {
  await api('POST', `/api/sessions/${encodeURIComponent(S.current)}/keys`, { keys: [b.dataset.key] });
  setTimeout(refreshScreen, 300);
}));
$('#stop-btn').addEventListener('click', async () => {
  if (!confirm(`Stop ${S.current}? Its tmux session will be killed. Messages stay searchable.`)) return;
  await api('DELETE', `/api/sessions/${encodeURIComponent(S.current)}`);
});

// ---- new session ------------------------------------------------------------

$('#new-session-btn').addEventListener('click', () => {
  $('#new-session-error').hidden = true;
  $('#new-session').showModal();
});
$('#new-session-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const s = await api('POST', '/api/sessions', {
      name: f.get('name'), cwd: f.get('cwd') || undefined, description: f.get('description') || undefined,
      prompt: f.get('prompt') || undefined, role: f.get('orchestrator') ? 'orchestrator' : 'worker',
    });
    $('#new-session').close();
    e.target.reset();
    select(s.name);
  } catch (err) {
    $('#new-session-error').textContent = err.message;
    $('#new-session-error').hidden = false;
  }
});

// ---- tasks ------------------------------------------------------------------

const STATUSES = ['backlog', 'todo', 'doing', 'blocked', 'done'];
async function loadTasks() {
  const q = new URLSearchParams();
  if ($('#task-status').value) q.set('status', $('#task-status').value);
  if ($('#task-project').value) q.set('project', $('#task-project').value);
  const tasks = await api('GET', `/api/tasks?${q}`);
  if (!$('#task-project').value) {
    const all = await api('GET', '/api/tasks?limit=2000');
    const projects = [...new Set(all.map((t) => t.project))].sort();
    const sel = $('#task-project');
    const cur = sel.value;
    sel.replaceChildren(h('option', { value: '' }, 'All projects'), ...projects.map((p) => h('option', { value: p }, p)));
    sel.value = cur;
  }
  const groups = new Map();
  for (const t of tasks) groups.set(t.project, [...(groups.get(t.project) || []), t]);
  $('#task-groups').replaceChildren(
    ...(tasks.length ? [] : [h('p', { class: 'muted' }, 'Nothing here.')]),
    ...[...groups].map(([project, ts]) => h('div', { class: 'group' }, h('h3', {}, `${project} · ${ts.length}`), ...ts.map(taskEl))),
  );
}
function taskEl(t) {
  return h('div', { class: `task ${t.status}` },
    h('button', { class: `prio p${t.priority}`, title: 'Priority (tap to change)', onclick: () => patchTask(t.id, { priority: (t.priority + 1) % 4 }) }, `P${t.priority}`),
    h('div', { class: 'title' }, t.title, t.assignee ? h('span', { class: 'muted small-text' }, `  @${t.assignee}`) : ''),
    h('div', { class: 'controls' },
      h('select', { onchange: (e) => patchTask(t.id, { status: e.target.value }) },
        ...STATUSES.map((s) => h('option', { value: s, selected: s === t.status }, s))),
      h('button', { class: 'small', title: 'Delete', onclick: () => confirm(`Delete "${t.title}"?`) && api('DELETE', `/api/tasks/${t.id}`) }, '×')),
    t.notes ? h('div', { class: 'notes' }, t.notes) : '');
}
async function patchTask(id, patch) {
  try { await api('PATCH', `/api/tasks/${id}`, patch); } catch (e) { alert(e.message); }
}
$('#task-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  let title = $('#task-title').value;
  let project = $('#task-project').value || undefined;
  let priority;
  title = title.replace(/(^|\s)#([\w-]+)/, (_, s, p) => { project = p; return s; });
  title = title.replace(/(^|\s)!([0-3])\b/, (_, s, p) => { priority = Number(p); return s; });
  title = title.trim();
  if (!title) return;
  await api('POST', '/api/tasks', { title, project, priority, status: 'todo' });
  $('#task-title').value = '';
});
$('#task-status').addEventListener('change', loadTasks);
$('#task-project').addEventListener('change', loadTasks);

// ---- search -----------------------------------------------------------------

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-q').value.trim();
  if (!q) return;
  const res = await api('GET', `/api/search?q=${encodeURIComponent(q)}&limit=100`);
  $('#search-results').replaceChildren(
    ...(res.length ? res.map((m) => {
      const el = messageEl(m);
      el.querySelector('.meta')?.prepend(`${new Date(m.created_at).toLocaleDateString()} · `);
      return el;
    }) : [h('li', { class: 'muted' }, 'No matches.')]));
});

// ---- tabs, sidebar, release banner ------------------------------------------

$$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
  S.tab = b.dataset.tab;
  $$('.tabs [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $$('.tab').forEach((t) => (t.hidden = t.id !== `tab-${S.tab}`));
  if (S.tab === 'tasks') loadTasks();
  if (S.tab === 'search') $('#search-q').focus();
}));
const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; };
$('#menu-btn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; });
$('#scrim').addEventListener('click', closeSidebar);

function renderRelease() {
  const b = $('#update-banner');
  if (!S.release) { b.hidden = true; return; }
  b.hidden = false;
  b.replaceChildren('Android app ', h('strong', {}, S.release.version_name), ' · ',
    h('a', { href: `/api/app/download/${S.release.version_code}?token=${encodeURIComponent(token)}` }, 'Download APK'));
}

// ---- go ---------------------------------------------------------------------

function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  connect();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (token) start(); else $('#login').hidden = false;
