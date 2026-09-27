import { h, $ } from './util.js';
import { icon } from './icons.js';
import { state, bus, send } from './state.js';
import { holdRaise, releaseRaise } from './popups.js';

/**
 * Things drawn in the content area underneath/between the tab views:
 * the crashed-tab page and the draggable dividers for split view & DevTools.
 */
let layer;

function render() {
  layer.textContent = '';
  const info = state.layout || {};
  for (const pane of info.panes || []) {
    if (!pane.crashed) continue;
    const reload = h('button.btn.primary', {}, 'Reload');
    reload.addEventListener('click', () => {
      send('activateTab', pane.tabId);
      send('nav', 'reload');
    });
    layer.append(
      h(
        'div.sad-tab',
        { style: { left: `${pane.x}px`, top: `${pane.y}px`, width: `${pane.width}px`, height: `${pane.height}px` } },
        h(
          'div.sad-inner',
          {},
          h('div.sad-icon', { html: icon('sad', 34) }),
          h('h2', {}, 'This page crashed'),
          h('p', {}, 'Something went wrong while displaying this page. Other tabs are fine.'),
          reload,
        ),
      ),
    );
  }
  if (info.divider) layer.append(divider(info.divider, 'split'));
  if (info.devtools) layer.append(divider(info.devtools, info.devtools.side === 'right' ? 'devtools-right' : 'devtools-bottom'));
}

function divider(rect, kind) {
  const vertical = kind !== 'devtools-bottom';
  const el = h(`div.divider.${vertical ? 'vertical' : 'horizontal'}`, {
    style: { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` },
    title: kind === 'split' ? 'Drag to resize · double-click to reset' : 'Drag to resize DevTools',
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    // Raise the UI so the pointer keeps reporting to us over the page views.
    holdRaise('divider');
    const region = $('#content').getBoundingClientRect();
    let frame = 0;
    const move = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (kind === 'split') send('splitRatio', (ev.clientX - region.left) / region.width);
        else if (kind === 'devtools-right') send('devtoolsRatio', (region.right - ev.clientX) / region.width);
        else send('devtoolsRatio', (region.bottom - ev.clientY) / region.height);
      });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      releaseRaise('divider');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => {
    if (kind === 'split') send('splitRatio', 0.5);
    else send('devtoolsRatio', 0.42);
  });
  return el;
}

export function initContent() {
  layer = h('div#content-layer');
  document.body.insertBefore(layer, $('#popup-layer'));
  bus.on('layout', render);
}
