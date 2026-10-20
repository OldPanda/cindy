import type { ClipboardEvent } from 'react';

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
const SEMANTIC_CONTAINER_SELECTOR = 'a, strong, b, em, i, u, s, del, code, pre, p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li, table, thead, tbody, tfoot, tr, th, td';

function isEditable(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(EDITABLE_SELECTOR));
}

/** Keep chat theme styling out of rich-text destinations. */
export function copyChatSelection(event: ClipboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || !event.clipboardData) return;

  const container = event.currentTarget;
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;

  const range = selection.getRangeAt(0);
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer) ||
    isEditable(event.target as Node) ||
    isEditable(range.startContainer) ||
    isEditable(range.endContainer)
  ) return;

  const text = selection.toString();
  // Leave image-only selections to Chromium's native image clipboard handling.
  if (!text) return;

  const content = container.ownerDocument.createElement('div');
  let fragment: Node = range.cloneContents();
  // cloneContents omits the common ancestor. Retain semantic ancestors so
  // selecting a word inside a link or bold text does not lose its meaning.
  let ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  while (ancestor && ancestor !== container) {
    if (ancestor.matches(SEMANTIC_CONTAINER_SELECTOR)) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(fragment);
      fragment = wrapper;
    }
    ancestor = ancestor.parentElement;
  }
  content.append(fragment);
  // Supplying our own HTML prevents Chromium from inlining computed ancestor
  // backgrounds. Strip theme presentation from the clone, never the live DOM;
  // semantic markup (links, headings, lists, tables and code) remains portable.
  for (const element of content.querySelectorAll('*')) {
    for (const attribute of ['style', 'class', 'bgcolor', 'color']) {
      element.removeAttribute(attribute);
    }
  }

  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', content.innerHTML);
  event.preventDefault();
}
