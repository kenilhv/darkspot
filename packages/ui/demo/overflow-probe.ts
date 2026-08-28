/**
 * Demo-only diagnostic: with `?debug=overflow`, after paint, list every element whose
 * right edge exceeds the viewport into <pre id="overflow-probe"> so headless Chrome's
 * --dump-dom can read it. Never shipped in the library.
 */
export function installOverflowProbe() {
  if (typeof window === 'undefined' || new URLSearchParams(location.search).get('debug') !== 'overflow') return;
  const run = () => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.className && typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
    });
    const pre = document.createElement('pre');
    pre.id = 'overflow-probe';
    pre.textContent = `vw=${vw} scrollW=${document.documentElement.scrollWidth}\n` + bad.slice(0, 40).join('\n');
    document.body.appendChild(pre);
  };
  setTimeout(run, 500);
}
