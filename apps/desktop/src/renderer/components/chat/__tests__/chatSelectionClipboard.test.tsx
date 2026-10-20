// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
