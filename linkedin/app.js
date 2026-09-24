async function load() {
  try {
    const res = await fetch('status.json?_=' + Date.now(), { cache: 'no-store' });
    render(await res.json());
  } catch (e) {
    document.getElementById('bar-text').textContent = 'Could not load status';
  }
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function render(events) {
  const bar = document.getElementById('bar');
  const barText = document.getElementById('bar-text');
  const barMeta = document.getElementById('bar-meta');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');

  if (!events.length) {
    bar.className = 'idle';
    barText.textContent = 'No activity yet';
    barMeta.textContent = '';
    empty.hidden = false;
    list.innerHTML = '';
    return;
  }

  empty.hidden = true;
  const latest = events[0];
  bar.className = latest.status;
  barText.textContent = latest.status === 'success'
    ? 'Converted: ' + latest.filename
    : 'Failed: ' + latest.filename + (latest.error ? ' — ' + latest.error : '');
  barMeta.textContent = timeAgo(latest.timestamp);

  list.innerHTML = events.map(e =>
    '<li class="' + e.status + '">' +
      '<span class="tag">' + e.status + '</span>' +
      '<span class="file">' + escapeHtml(e.filename) + '</span>' +
      (e.error ? '<span class="err">' + escapeHtml(e.error) + '</span>' : '') +
      '<time>' + timeAgo(e.timestamp) + '</time>' +
    '</li>'
  ).join('');
}

load();
setInterval(load, 20000);
