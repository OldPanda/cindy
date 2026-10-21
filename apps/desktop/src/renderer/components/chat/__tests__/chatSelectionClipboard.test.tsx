// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import katex from 'katex';
import { File } from 'lucide-react';
import { InlineReferenceChip } from '../InlineReferenceChip';
import { copyChatSelection } from '../chatSelectionClipboard';

// Regression: selecting chat text and copying to a rich-text editor carries
// Cindy's background/theme. Existing copy-button tests do not exercise native
// selection copy. This unit suite dispatches copy through the production handler
// and checks the exported clipboard formats and the native-copy fallbacks.
afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

function setup(html: string) {
  const view = render(<div onCopy={copyChatSelection} dangerouslySetInnerHTML={{ __html: html }} />);
  const root = view.container.firstElementChild!;
  const select = (start: Node = root, end?: Node) => {
    const range = document.createRange();
    if (end) {
      range.setStart(start, 0);
      range.setEnd(end, end.textContent!.length);
    } else {
      range.selectNodeContents(start);
    }
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  };
  const copy = (target: Element = root) => {
    const clipboardData = { setData: vi.fn() };
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    fireEvent(target, event);
    return { event, clipboardData };
  };
  return { root, select, copy };
}

describe('chat selection clipboard', () => {
  it.each(['#fffdf5', '#171717'])('exports semantic HTML without the %s theme', (background) => {
    const { root, select, copy } = setup(`<p class="theme" style="background:${background};color:red">Hello <strong>world</strong></p><p><a href="https://example.com" style="background-color:${background}">guide</a> <code class="token" style="color:blue">x &lt; y</code></p>`);
    select();
    const text = window.getSelection()!.toString();
    const { event, clipboardData } = copy();
    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', text);
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    expect(html).toBe('<p>Hello <strong>world</strong></p><p><a href="https://example.com">guide</a> <code>x &lt; y</code></p>');
    expect(root.querySelector('p')!.getAttribute('style')).toContain('background');
  });

  it('copies only the selected substring', () => {
    const { root, copy } = setup('<p>Hello world</p>');
    const range = document.createRange();
    range.setStart(root.firstChild!.firstChild!, 6);
    range.setEnd(root.firstChild!.firstChild!, 11);
    window.getSelection()!.addRange(range);
    const { clipboardData } = copy();
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'world');
    expect(clipboardData.setData).toHaveBeenCalledWith('text/html', '<p>world</p>');
  });

  it('retains link and emphasis ancestors for a partial text selection', () => {
    const { root, copy } = setup('<p><strong><a href="https://example.com" style="color:red">Hello world</a></strong></p>');
    const range = document.createRange();
    const text = root.querySelector('a')!.firstChild!;
    range.setStart(text, 6);
    range.setEnd(text, 11);
    window.getSelection()!.addRange(range);
    expect(copy().clipboardData.setData).toHaveBeenCalledWith('text/html', '<p><strong><a href="https://example.com">world</a></strong></p>');
  });

  // PR #6609 review: user messages preserve literal newlines/indentation via
  // CSS, while measurement mirrors and quote summaries must not enter HTML.
  // These outputs were not covered by the original theme-only fixtures.
  it('preserves multiline whitespace inherited by a partial inline selection', () => {
    const { root, select, copy } = setup('<div style="white-space:pre-wrap;background:red"><span>first\n  second</span></div>');
    select(root.querySelector('span')!.firstChild!);
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.textContent).toBe('first\n  second');
    expect(pasted.querySelector('[style]')?.getAttribute('style')).toMatch(/white-space:\s*pre-wrap/);
    expect(html).not.toContain('background');
  });

  it('excludes hidden mirrors and non-selectable quote summaries across messages', () => {
    const { select, copy } = setup('<p>start</p><div style="visibility:hidden"><span>hidden full message</span></div><span style="user-select:none"><span>quote summary</span></span><div style="display:none">hidden panel</div><p><code role="button">file.ts</code> end</p>');
    select();
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    expect(html).not.toMatch(/hidden full message|quote summary|hidden panel/);
    expect(html).toContain('<code role="button">file.ts</code>');
    expect(html).toContain('start');
    expect(html).toContain('end');
  });

  // Review regressions: HTML consumers must keep table coordinates, omit
  // collapsed mail-history fields, and receive one equation representation.
  // Tier: renderer unit, exercising the production copy event entry point.
  it('preserves empty header and body cells without shifting later columns', () => {
    const { select, copy } = setup('<table><thead><tr><th>A</th><th></th><th>C</th></tr></thead><tbody><tr><td>1</td><td></td><td>3</td></tr></tbody></table>');
    select();
    const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect([...pasted.querySelectorAll('tr')].map(row => [...row.children].map(cell => cell.textContent)))
      .toEqual([['A', '', 'C'], ['1', '', '3']]);
  });

  it.each([false, true])('copies only rendered disclosure content (open=%s)', (open) => {
    const { select, copy } = setup(`<p>before</p><details${open ? ' open' : ''}><summary>mail updated</summary><dl><dt>to</dt><dd>recipient@example.com</dd></dl><summary>secondary summary</summary></details><p>after</p>`);
    select();
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const plain = clipboardData.setData.mock.calls.find(([type]) => type === 'text/plain')?.[1];
    expect(html).toContain('mail updated');
    expect(html).toContain('before');
    expect(html).toContain('after');
    expect(html.includes('recipient@example.com')).toBe(open);
    expect(html.includes('secondary summary')).toBe(open);
    expect(plain.includes('recipient@example.com')).toBe(open);
    expect(plain.includes('secondary summary')).toBe(open);
  });

  it.each([false, true])('exports a rendered KaTeX equation once as semantic MathML (equation only=%s)', (equationOnly) => {
    const equation = katex.renderToString('x^2 + y^2');
    const { root, select, copy } = setup(`<p>before ${equation} after</p>`);
    select(equationOnly ? root.querySelector('.katex')! : root);
    const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.querySelectorAll('math')).toHaveLength(1);
    expect(pasted.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(pasted.querySelector('annotation')?.textContent).toBe('x^2 + y^2');
    if (equationOnly) expect(pasted.textContent).not.toMatch(/before|after/);
    else expect(pasted.textContent).toMatch(/^before .* after$/);
    expect(html).not.toMatch(/class=|height:|vertical-align:/);
  });

  // New review boundaries: a prose-to-formula drag must not acquire an
  // unselected suffix, and GFM task items must retain their distinct states.
  it.each(['end', 'start'])('limits a partial equation at the selection %s', (boundary) => {
    const { root, copy } = setup(`<p>before ${katex.renderToString('x + y')} after</p>`);
    const range = document.createRange();
    const letters = root.querySelectorAll('.katex-html .mord.mathnormal');
    if (boundary === 'end') {
      range.setStart(root.querySelector('p')!.firstChild!, 0);
      range.setEnd(letters[0].firstChild!, 1);
    } else {
      range.setStart(letters[1].firstChild!, 0);
      const last = root.querySelector('p')!.lastChild!;
      range.setEnd(last, last.textContent!.length);
    }
    window.getSelection()!.addRange(range);
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.textContent).toBe(boundary === 'end' ? 'before x' : 'y after');
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', boundary === 'end' ? 'before x' : 'y after');
    expect(pasted.querySelector('math, annotation')).toBeNull();
    // The visual slice is now the only representation, so it must be exposed
    // to assistive technology rather than retaining KaTeX's duplicate-hiding.
    expect(pasted.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it.each(['\\frac{a}{b}', '\\sqrt{x^2}'])('exports MathML when dragging only the visible formula %s', (source) => {
    const { root, copy } = setup(`<p>before ${katex.renderToString(source)} after</p>`);
    const visual = root.querySelector('.katex-html')!;
    const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.replace(/[\s\u200b]/g, '')) nodes.push(walker.currentNode as Text);
    }
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
    window.getSelection()!.addRange(range);
    const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.querySelectorAll('math')).toHaveLength(1);
    expect(pasted.querySelector('annotation')?.textContent).toBe(source);
    expect(pasted.querySelector('math mfrac, math msqrt')).not.toBeNull();
    expect(html).not.toMatch(/before|after|aria-hidden|class=/);
  });

  it('does not expand an internal partial formula selection', () => {
    const { root, copy } = setup(katex.renderToString('x + y'));
    const letter = root.querySelector('.katex-html .mord.mathnormal')!.firstChild!;
    const range = document.createRange();range.selectNodeContents(letter);
    window.getSelection()!.addRange(range);
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');pasted.innerHTML = html;
    expect(pasted.textContent).toBe('x');
    expect(pasted.querySelector('math, [aria-hidden="true"]')).toBeNull();
    expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', 'x');
  });

  it('preserves checked and unchecked GFM task markers in both clipboard formats', () => {
    const { select, copy } = setup('<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> done</li><li class="task-list-item"><input type="checkbox" disabled> todo</li></ul>');
    select();
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const plain = clipboardData.setData.mock.calls.find(([type]) => type === 'text/plain')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect([...pasted.querySelectorAll('li')].map(item => item.textContent)).toEqual(['☑ done', '☐ todo']);
    expect(plain).toContain('☑ done');
    expect(plain).toContain('☐ todo');
    expect(pasted.querySelector('input')).toBeNull();
  });

  it('retains separators, empty list positions and labelled SVG geometry', () => {
    const { select, copy } = setup('<p>before</p><hr><ol><li>one</li><li></li><li>three</li></ol><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="1" y="1" width="40" height="20"/><path d="M 1 30 L 80 30"/><line x1="1" y1="40" x2="80" y2="40"/><text x="2" y="15">diagram label</text></svg><p>after</p>');
    select();
    const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.querySelector('hr')).not.toBeNull();
    expect([...pasted.querySelectorAll('li')].map(item => item.textContent)).toEqual(['one', '', 'three']);
    expect(pasted.querySelector('svg rect')?.getAttribute('width')).toBe('40');
    expect(pasted.querySelector('svg path')?.getAttribute('d')).toBe('M 1 30 L 80 30');
    expect(pasted.querySelector('svg line')?.getAttribute('y2')).toBe('40');
    expect(pasted.querySelector('svg text')?.textContent).toBe('diagram label');
  });

  it('omits transparent hover toolbars without losing visible code or graphics', () => {
    const { select, copy } = setup('<p>before</p><div style="opacity:0"><button><svg><path d="M0 0L2 2"/></svg>hidden toolbar</button></div><pre><code>visible code</code></pre><p>after</p>');
    select();
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const plain = clipboardData.setData.mock.calls.find(([type]) => type === 'text/plain')?.[1];
    expect(html).not.toMatch(/hidden toolbar|button|<svg/);
    expect(plain).not.toContain('hidden toolbar');
    expect(html).toContain('<code');
    expect(plain).toContain('visible code');
  });

  it.each([false, true])('keeps a fully selected SVG self-contained (diagram only=%s)', (diagramOnly) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" viewBox="0 0 100 50"><style>#diagram .node{fill:aliceblue;stroke:navy}</style><rect class="node" width="90" height="40"/><foreignObject width="90" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="display:table-cell;white-space:nowrap">label</div></foreignObject></svg>';
    const { root, select, copy } = setup(`<div class="chat-theme" style="background:red;color:purple"><p>before</p><div data-chat-mermaid>${svg}</div><p>after</p></div>`);
    const presentation = document.createElement('style');
    presentation.textContent = '#diagram .node { fill: aliceblue; stroke: navy; }';
    document.head.append(presentation);
    select(diagramOnly ? root.querySelector('svg')! : root);
    const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    presentation.remove();
    expect(pasted.querySelector('svg style')?.textContent).toContain('#diagram .node');
    expect(pasted.querySelector('foreignObject div')?.getAttribute('style')).toMatch(/display:\s*table-cell/);
    pasted.querySelectorAll('style').forEach(node => node.remove());
    const rect = pasted.querySelector('rect')!;
    expect(rect.style.fill).toBe('rgb(240, 248, 255)');
    expect(rect.style.stroke).toBe('rgb(0, 0, 128)');
    expect(rect.getAttribute('width')).toBe('90');
    pasted.querySelector('svg')?.remove();
    expect(pasted.innerHTML).not.toMatch(/chat-theme|background|color:/);
  });

  it('localizes SVG fragment references on a hash-router page without changing external references', () => {
    const previous = window.location.href;
    window.history.replaceState(null, '', '#/cc-agent/clipboard');
    try {
      const base = document.URL.split('#')[0];
      const { select, copy } = setup(`<div data-chat-mermaid><svg xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow"/><linearGradient id="gradient"/></defs><path style='marker-end:url("${base}#arrow");fill:url("${base}#gradient");stroke:url("https://example.com/external.svg#paint")' d="M0 0L10 10"/><text>diagram</text></svg></div>`);
      select();
      const html = copy().clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
      const pasted = document.createElement('div');pasted.innerHTML = html;
      const style = pasted.querySelector('path')!.style;
      expect(style.markerEnd.replaceAll('"', '')).toBe('url(#arrow)');
      expect(style.fill.replaceAll('"', '')).toBe('url(#gradient)');
      expect(style.stroke).toContain('https://example.com/external.svg#paint');
    } finally {
      window.history.replaceState(null, '', previous);
    }
  });

  it('keeps sent reference labels without exporting decorative icons or their theme', () => {
    const chip = render(<InlineReferenceChip label="project/file.ts" icon={<File />} textSelectable />);
    const { select, copy } = setup(`<p>before</p><span style="color:purple;font-family:monospace">${chip.container.innerHTML}<svg class="other-icon" style="color:red" viewBox="0 0 10 10"><path class="stroke-theme" style="stroke:purple" d="M0 0L10 10"/><text>ordinary graphic</text></svg></span><p>after</p>`);
    select();
    const { clipboardData } = copy();
    const html = clipboardData.setData.mock.calls.find(([type]) => type === 'text/html')?.[1];
    const plain = clipboardData.setData.mock.calls.find(([type]) => type === 'text/plain')?.[1];
    const pasted = document.createElement('div');
    pasted.innerHTML = html;
    expect(pasted.textContent).toContain('project/file.ts');
    expect(plain).toContain('project/file.ts');
    expect(pasted.querySelector('[aria-hidden] svg')).toBeNull();
    expect(pasted.querySelectorAll('svg')).toHaveLength(1);
    expect(pasted.querySelector('svg path')?.getAttribute('d')).toBe('M0 0L10 10');
    expect(html).not.toMatch(/class=|color:|font-family:|stroke:/);
  });

  it.each(['textarea', 'input', 'div contenteditable="true"'])('leaves %s editing to native copy', (tag) => {
    const { root, select, copy } = setup(`<${tag}>draft</${tag.split(' ')[0]}>`);
    select(root.firstChild!);
    const { event, clipboardData } = copy(root.firstElementChild!);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboardData.setData).not.toHaveBeenCalled();
  });

  it('leaves cross-container selections to native copy', () => {
    const { root, select, copy } = setup('<p>chat</p>');
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    select(root.firstChild!.firstChild!, outside.firstChild!);
    const { event, clipboardData } = copy();
    expect(event.defaultPrevented).toBe(false);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    outside.remove();
  });

  it('leaves image-only and collapsed selections to native copy', () => {
    const { root, select, copy } = setup('<img src="https://example.com/image.png" alt="image">');
    select();
    expect(copy().event.defaultPrevented).toBe(false);
    window.getSelection()!.collapse(root, 0);
    expect(copy().event.defaultPrevented).toBe(false);
  });

  it('respects a nested copy handler', () => {
    const { root, select, copy } = setup('<p>custom copy</p>');
    root.firstElementChild!.addEventListener('copy', (event) => event.preventDefault());
    select();
    expect(copy(root.firstElementChild!).clipboardData.setData).not.toHaveBeenCalled();
  });
});
