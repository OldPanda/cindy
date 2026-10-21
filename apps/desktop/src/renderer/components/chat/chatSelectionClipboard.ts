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

  const doc = container.ownerDocument;
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element): CSSStyleDeclaration => {
    let style = styles.get(element);
    if (!style) {
      style = doc.defaultView!.getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  };
  const inheritedStyle = (element: Element, property: string): string => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const value = styleOf(current).getPropertyValue(property);
      // user-select:auto uses the parent's none/all value even when the
      // computed style itself remains auto (notably in DOM test environments).
      if (value && value !== 'inherit' && !(property === 'user-select' && value === 'auto')) return value;
    }
    return '';
  };
  const whitespaceOf = (element: Element): string => inheritedStyle(element, 'white-space');
  const preservesWhitespace = (value: string): boolean => /^(pre|pre-wrap|pre-line|break-spaces)$/.test(value);
  const shell = (element: Element): Element => {
    const copy = element.cloneNode(false) as Element;
    for (const attribute of ['style', 'class', 'bgcolor', 'color']) copy.removeAttribute(attribute);
    // Whitespace is content formatting, not a theme color. Preserve only this
    // allowlisted declaration so user-message newlines/indentation survive HTML paste.
    const whitespace = whitespaceOf(element);
    if (preservesWhitespace(whitespace)) copy.setAttribute('style', `white-space: ${whitespace};`);
    return copy;
  };
  const cloneSelected = (node: Node): Node | null => {
    if (!range.intersectsNode(node)) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement!;
      if (['hidden', 'collapse'].includes(inheritedStyle(parent, 'visibility')) ||
          inheritedStyle(parent, 'user-select') === 'none') return null;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.textContent!.length;
      return doc.createTextNode(node.textContent!.slice(start, end));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const element = node as Element;
    if (styleOf(element).display === 'none' || styleOf(element).contentVisibility === 'hidden') return null;
    const copy = shell(element);
    for (const child of element.childNodes) {
      const selected = cloneSelected(child);
      if (selected) copy.appendChild(selected);
    }
    if (!copy.hasChildNodes() && !element.matches('br, img')) return null;
    if (!copy.hasChildNodes() && (['hidden', 'collapse'].includes(inheritedStyle(element, 'visibility')) ||
        inheritedStyle(element, 'user-select') === 'none')) return null;
    return copy;
  };

  const content = doc.createElement('div');
  let fragment: Node = doc.createDocumentFragment();
  const common = range.commonAncestorContainer;
  // Walk the original selected DOM before stripping styles. cloneContents would
  // resurrect hidden measurement mirrors and non-selectable quote summaries.
  for (const node of common.nodeType === Node.TEXT_NODE ? [common] : common.childNodes) {
    const selected = cloneSelected(node);
    if (selected) fragment.appendChild(selected);
  }
  // Retain semantic ancestors so
  // selecting a word inside a link or bold text does not lose its meaning.
  let ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  while (ancestor && ancestor !== container) {
    if (ancestor.matches(SEMANTIC_CONTAINER_SELECTOR) || preservesWhitespace(whitespaceOf(ancestor))) {
      const wrapper = shell(ancestor);
      wrapper.appendChild(fragment);
      fragment = wrapper;
    }
    ancestor = ancestor.parentElement;
  }
  content.append(fragment);
  // Supplying our own HTML prevents Chromium from inlining ancestor backgrounds.

  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', content.innerHTML);
  event.preventDefault();
}
