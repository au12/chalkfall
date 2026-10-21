// Settings: volumes, screen shake, hints, reset.
import { el } from '../ui/dom.ts';
import type { App } from '../main.ts';

export function showSettings(app: App): void {
  const s = app.save.settings;
  const slider = (key: 'sfx' | 'music') => {
    const r = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]), 'aria-label': key });
    r.addEventListener('input', () => { app.save.set(key, +r.value); app.applySettings(); if (key === 'sfx') app.audio.tap(); });
    return r;
  };
  const toggle = (key: 'shake' | 'hints') => {
    const box = el('div', { class: 'toggle' });
    const draw = () => box.replaceChildren(
      ...([['On', true], ['Off', false]] as const).map(([t, v]) => {
        const b = el('button', { class: 'chip' + (app.save.settings[key] === v ? ' on' : '') }, t);
        b.onclick = () => { app.audio.tap(); app.save.set(key, v); draw(); };
        return b;
      }));
    draw();
    return box;
  };
  const m = app.modal(
    el('h2', {}, 'Settings'),
    el('div', { class: 'settings' },
      el('span', {}, 'Sound effects'), slider('sfx'),
      el('span', {}, 'Music'), slider('music'),
      el('span', {}, 'Screen shake'), toggle('shake'),
      el('span', {}, 'Level tips'), toggle('hints')),
    el('div', { class: 'btns' },
      el('button', { class: 'btn primary chalk-box', onclick: () => { app.audio.tap(); m.remove(); } }, 'Done'),
      el('button', { class: 'btn small chalk-box', onclick: () => {
        app.audio.tap();
        const c = app.modal(el('h2', {}, 'Start over?'), el('p', {}, 'This erases all your stars and scores.'),
          el('div', { class: 'btns' },
            el('button', { class: 'btn chalk-box', onclick: () => { app.save.reset(); c.remove(); m.remove(); app.goTitle(); } }, 'Erase'),
            el('button', { class: 'btn primary chalk-box', onclick: () => c.remove() }, 'Keep')));
      } }, 'Reset progress')),
  );
}
