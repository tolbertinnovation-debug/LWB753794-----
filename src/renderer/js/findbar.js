import { h, $ } from './util.js';
import { icon } from './icons.js';
import { bus, send, state } from './state.js';

let input;
let count;
let matchCase = false;
let lastText = '';
let openTabId = null;

function isOpen() {
  return !$('#findbar').hidden;
}

function find(opts = {}) {
  const text = input.value;
  lastText = text;
  send('find', text, { matchCase, ...opts });
  if (!text) setCount(null);
}

function setCount(result) {
  if (!result || !input.value) {
    count.textContent = '';
    count.classList.remove('none');
    return;
  }
  count.textContent = result.matches ? `${result.activeMatchOrdinal}/${result.matches}` : 'No results';
  count.classList.toggle('none', result.matches === 0);
}

export function openFind() {
  const bar = $('#findbar');
  bar.hidden = false;
  openTabId = state.activeId;
  input.value = lastText;
  input.focus();
  input.select();
  if (input.value) find();
}

export function closeFind({ focusPage = true } = {}) {
  const bar = $('#findbar');
  if (bar.hidden) return;
  bar.hidden = true;
  openTabId = null;
  send('stopFind');
  setCount(null);
  if (focusPage) send('focusPage');
}

export function initFindbar() {
  const bar = $('#findbar');
  input = h('input', { type: 'text', placeholder: 'Find in page', spellcheck: 'false', 'aria-label': 'Find in page' });
  count = h('span.find-count', { 'aria-live': 'polite' });
  const prev = h('button.icon-btn.small', { title: 'Previous (Shift+Enter)', 'aria-label': 'Previous match', html: icon('arrowUp', 16) });
  const next = h('button.icon-btn.small', { title: 'Next (Enter)', 'aria-label': 'Next match', html: icon('arrowDown', 16) });
  const caseBtn = h('button.icon-btn.small.case-btn', { title: 'Match case', 'aria-pressed': 'false' }, 'Aa');
  const close = h('button.icon-btn.small', { title: 'Close (Esc)', 'aria-label': 'Close find bar', html: icon('x', 16) });
  bar.append(h('div.find-field', {}, h('span', { html: icon('search', 15) }), input, count), prev, next, caseBtn, h('span', { style: { flex: 1 } }), close);

  input.addEventListener('input', () => find({ findNext: false }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value) find({ findNext: true, forward: !e.shiftKey });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFind();
    }
  });
  prev.addEventListener('click', () => input.value && find({ findNext: true, forward: false }));
  next.addEventListener('click', () => input.value && find({ findNext: true, forward: true }));
  caseBtn.addEventListener('click', () => {
    matchCase = !matchCase;
    caseBtn.classList.toggle('on', matchCase);
    caseBtn.setAttribute('aria-pressed', String(matchCase));
    if (input.value) find();
  });
  close.addEventListener('click', () => closeFind());

  bus.on('find-open', openFind);
  bus.on('find-step', ({ forward }) => {
    if (!isOpen()) openFind();
    else if (input.value) find({ findNext: true, forward });
  });
  bus.on('find-result', setCount);
  bus.on('tabs', () => {
    if (isOpen() && openTabId !== state.activeId) closeFind({ focusPage: false });
  });
}
