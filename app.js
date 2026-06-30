const STORAGE_KEY = 'labNotebookEntries';
const LOADING_MESSAGES = [
  'Pulling the transcript…',
  'Reading through the video…',
  'Sorting out the key concepts…',
  'Mapping how it all connects…'
];

const form = document.getElementById('summarizeForm');
const urlInput = document.getElementById('videoUrl');
const submitBtn = document.getElementById('submitBtn');
const formError = document.getElementById('formError');
const loadingState = document.getElementById('loadingState');
const loadingText = document.getElementById('loadingText');
const report = document.getElementById('report');
const emptyState = document.getElementById('emptyState');
const saveBtn = document.getElementById('saveBtn');

let currentEntry = null;
let loadingInterval = null;

document.getElementById('slipDate').textContent = new Date().toLocaleDateString(undefined, {
  month: 'short', day: 'numeric', year: 'numeric'
});

// ---------- Archive (localStorage) ----------
function getArchive() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function setArchive(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  renderArchiveList();
}

function isSaved(videoId) {
  return getArchive().some((e) => e.videoId === videoId);
}

function renderArchiveList() {
  const entries = getArchive();
  const list = document.getElementById('archiveList');
  const empty = document.getElementById('archiveEmpty');
  document.getElementById('archiveCount').textContent = entries.length;

  if (entries.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = entries
    .slice()
    .reverse()
    .map((e, i) => {
      const realIndex = entries.length - 1 - i;
      return `
        <div class="archive-card" data-index="${realIndex}">
          <img src="${e.thumbnail || ''}" alt="" loading="lazy">
          <div class="archive-card-body">
            <p class="archive-card-title">${escapeHtml(e.title)}</p>
            <span class="archive-card-date">${e.savedAt}</span>
          </div>
          <button class="archive-card-delete" data-delete="${realIndex}" aria-label="Delete">✕</button>
        </div>
      `;
    })
    .join('');
}

document.getElementById('archiveList').addEventListener('click', (e) => {
  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) {
    e.stopPropagation();
    const idx = Number(delBtn.dataset.delete);
    const entries = getArchive();
    entries.splice(idx, 1);
    setArchive(entries);
    return;
  }
  const card = e.target.closest('.archive-card');
  if (card) {
    const idx = Number(card.dataset.index);
    const entry = getArchive()[idx];
    if (entry) {
      renderReport(entry);
      closeArchive();
    }
  }
});

function openArchive() {
  document.getElementById('archivePanel').classList.add('open');
  document.getElementById('archiveScrim').hidden = false;
  document.getElementById('archiveToggle').setAttribute('aria-expanded', 'true');
}
function closeArchive() {
  document.getElementById('archivePanel').classList.remove('open');
  document.getElementById('archiveScrim').hidden = true;
  document.getElementById('archiveToggle').setAttribute('aria-expanded', 'false');
}
document.getElementById('archiveToggle').addEventListener('click', openArchive);
document.getElementById('archiveClose').addEventListener('click', closeArchive);
document.getElementById('archiveScrim').addEventListener('click', closeArchive);

saveBtn.addEventListener('click', () => {
  if (!currentEntry) return;
  const entries = getArchive();
  const existingIndex = entries.findIndex((e) => e.videoId === currentEntry.videoId);
  if (existingIndex >= 0) {
    entries.splice(existingIndex, 1);
  } else {
    entries.push({ ...currentEntry, savedAt: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
  }
  setArchive(entries);
  updateSaveButton();
});

function updateSaveButton() {
  if (!currentEntry) return;
  const saved = isSaved(currentEntry.videoId);
  saveBtn.classList.toggle('saved', saved);
  document.getElementById('saveIcon').textContent = saved ? '★' : '☆';
  document.getElementById('saveLabel').textContent = saved ? 'Saved' : 'Save to archive';
}

// ---------- Rendering ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderReport(data) {
  currentEntry = data;
  emptyState.hidden = true;
  report.hidden = false;

  document.getElementById('reportThumb').src = data.thumbnail || '';
  document.getElementById('reportTopic').textContent = data.topic || data.title;
  document.getElementById('reportTitle').textContent = data.title;
  document.getElementById('truncatedNote').hidden = !data.truncated;

  const tileGrid = document.getElementById('tileGrid');
  tileGrid.innerHTML = (data.keyConcepts || [])
    .map((c, i) => `
      <button type="button" class="tile" data-tile="${i}">
        <span class="tile-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="tile-symbol">${escapeHtml(c.symbol)}</span>
        <span class="tile-term">${escapeHtml(c.term)}</span>
      </button>
    `)
    .join('');

  tileGrid.querySelectorAll('[data-tile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.tile);
      const existing = tileGrid.querySelector('.tile-explanation');
      const alreadyOpenFor = existing && existing.dataset.for === String(idx);
      if (existing) existing.remove();
      if (!alreadyOpenFor) {
        const div = document.createElement('div');
        div.className = 'tile-explanation';
        div.dataset.for = String(idx);
        div.textContent = data.keyConcepts[idx].explanation;
        btn.insertAdjacentElement('afterend', div);
      }
    });
  });

  document.getElementById('summaryText').innerHTML = (data.summary || '')
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

  document.getElementById('connectionsList').innerHTML = (data.connections || [])
    .map((c) => `
      <li>
        <span class="conn-pair">${escapeHtml(c.concept)} ↔ ${escapeHtml(c.relatedTo)}</span>
        ${escapeHtml(c.why)}
      </li>
    `)
    .join('');

  document.getElementById('notesList').innerHTML = (data.importantNotes || [])
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join('');

  updateSaveButton();
  report.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Form submission ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const url = urlInput.value.trim();
  if (!url) return;

  submitBtn.disabled = true;
  report.hidden = true;
  emptyState.hidden = true;
  loadingState.hidden = false;

  let msgIndex = 0;
  loadingText.textContent = LOADING_MESSAGES[0];
  loadingInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
    loadingText.textContent = LOADING_MESSAGES[msgIndex];
  }, 2800);

  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong.');
    }

    renderReport(data);
  } catch (err) {
    formError.textContent = err.message || 'Something went wrong. Try again.';
    formError.hidden = false;
    emptyState.hidden = false;
  } finally {
    clearInterval(loadingInterval);
    loadingState.hidden = true;
    submitBtn.disabled = false;
  }
});

renderArchiveList();
