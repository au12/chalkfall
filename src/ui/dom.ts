// Tiny DOM helpers.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
}

export function canvasImg(c: HTMLCanvasElement, cls = ''): HTMLImageElement {
  const img = new Image();
  img.src = c.toDataURL();
  img.className = cls;
  img.draggable = false;
  img.alt = '';
  return img;
}
