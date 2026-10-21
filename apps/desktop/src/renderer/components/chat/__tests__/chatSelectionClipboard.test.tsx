// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import katex from 'katex';
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
