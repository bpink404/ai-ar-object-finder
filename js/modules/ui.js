/**
 * UI module — manages DOM element visibility, status messages,
 * and wires button events back to callback handlers.
 *
 * The two screens (#screen-idle, #screen-ar) are toggled via the
 * .active class.  The AR overlay uses a data-state attribute for
 * fine-grained show/hide of sub-elements.
 */

// ---- DOM references ---------------------------------------------------

const $ = (sel) => document.querySelector(sel);

const els = {
  screenIdle: $('#screen-idle'),
  screenAR: $('#screen-ar'),
  apiKeyInput: $('#api-key-input'),
  modelSelect: $('#model-select'),
  btnStart: $('#btn-start'),
  statusBar: $('#status-bar'),
  statusText: $('#status-text'),
  modelBadge: $('#model-badge'),
  objectInput: $('#object-input'),
  btnFind: $('#btn-find'),
  btnDelete: $('#btn-delete'),
  btnClose: $('#btn-close'),
};

// ---- Callbacks (set by app.js) ----------------------------------------

let callbacks = {};

/** Register event callbacks from the app controller.
 *  Expected keys: onStart, onFind, onDelete, onClose */
function bindCallbacks(cbs) {
  callbacks = cbs;
}

// ---- Event wiring -----------------------------------------------------

function wireEvents() {
  // Enable Start button when API key is entered
  els.apiKeyInput.addEventListener('input', () => {
    els.btnStart.disabled = !els.apiKeyInput.value.trim();
  });

  // Restore key from sessionStorage if available
  const savedKey = sessionStorage.getItem('gemini_api_key');
  if (savedKey) {
    els.apiKeyInput.value = savedKey;
    els.btnStart.disabled = false;
  }

  const savedModel = sessionStorage.getItem('gemini_model');
  if (savedModel && els.modelSelect.querySelector(`option[value="${savedModel}"]`)) {
    els.modelSelect.value = savedModel;
  }

  els.btnStart.addEventListener('click', () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) return;
    sessionStorage.setItem('gemini_api_key', key);
    sessionStorage.setItem('gemini_model', els.modelSelect.value);
    callbacks.onStart?.(key, els.modelSelect.value);
  });

  els.btnFind.addEventListener('click', () => {
    const obj = els.objectInput.value.trim();
    if (!obj) return;
    callbacks.onFind?.(obj);
  });

  // Allow Enter key to trigger Find
  els.objectInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      els.btnFind.click();
    }
  });

  els.btnDelete.addEventListener('click', () => callbacks.onDelete?.());
  els.btnClose.addEventListener('click', () => callbacks.onClose?.());
}

// ---- Screen transitions -----------------------------------------------

function showIdle() {
  els.screenAR.classList.remove('active');
  els.screenAR.removeAttribute('data-state');
  els.screenIdle.classList.add('active');
}

function showAR() {
  els.screenIdle.classList.remove('active');
  els.screenAR.classList.add('active');
}

// ---- AR overlay state -------------------------------------------------

function setARState(state) {
  els.screenAR.setAttribute('data-state', state);
}

function setModelBadge(label) {
  els.modelBadge.textContent = label;
}

function setStatus(text, variant = '') {
  els.statusText.textContent = text;
  els.statusBar.className = '';
  if (variant) els.statusBar.classList.add(`status-${variant}`);
}

function setFindEnabled(enabled) {
  els.btnFind.disabled = !enabled;
}

function setDeleteVisible(visible) {
  els.btnDelete.hidden = !visible;
}

function focusObjectInput() {
  els.objectInput.value = '';
  els.objectInput.focus();
}

function getObjectInputValue() {
  return els.objectInput.value.trim();
}

export {
  wireEvents,
  bindCallbacks,
  showIdle,
  showAR,
  setARState,
  setModelBadge,
  setStatus,
  setFindEnabled,
  setDeleteVisible,
  focusObjectInput,
  getObjectInputValue,
};
