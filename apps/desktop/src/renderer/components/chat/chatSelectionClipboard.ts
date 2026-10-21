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
  let omittedDisclosureBody = false;
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
    // Closed disclosures hide their body through UA rendering, not computed
    // display/visibility. Only their first direct summary is rendered.
    const parent = node.parentElement;
    if (parent?.matches('details:not([open])') &&
        node !== [...parent.children].find(child => child.matches('summary'))) {
      omittedDisclosureBody = true;
      return null;
    }
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
    if (element.matches('.katex')) {
      const math = element.querySelector('.katex-mathml > math');
      const visual = element.querySelector('.katex-html');
      if (math && visual && range.comparePoint(math, 0) === 0 &&
          range.comparePoint(math, math.childNodes.length) === 0) {
        // KaTeX's clipped accessibility MathML and its visual layout describe
        // the same equation. Export just the semantic tree, without unwrapping
        // the visual spans into a second, unstyled equation. Visual-only partial
        // selections continue through the normal range-aware path below.
        const copy = math.cloneNode(true) as Element;
        for (const part of [copy, ...copy.querySelectorAll('*')]) {
          for (const attribute of ['style', 'class', 'bgcolor', 'color']) part.removeAttribute(attribute);
        }
        return copy;
      }
    }
    const copy = shell(element);
    for (const child of element.childNodes) {
      const selected = cloneSelected(child);
      if (selected) copy.appendChild(selected);
    }
    // Empty cells carry column coordinates even when they contain no text.
    if (!copy.hasChildNodes() && !element.matches('br, img, th, td')) return null;
    if (!copy.hasChildNodes() && (['hidden', 'collapse'].includes(inheritedStyle(element, 'visibility')) ||
        inheritedStyle(element, 'user-select') === 'none')) return null;
    return copy;
  };

  const content = doc.createElement('div');
  let fragment: Node = doc.createDocumentFragment();
  const common = range.commonAncestorContainer;
  const commonIsEquation = common.nodeType === Node.ELEMENT_NODE && (common as Element).matches('.katex');
  // Walk the original selected DOM before stripping styles. cloneContents would
  // resurrect hidden measurement mirrors and non-selectable quote summaries.
  for (const node of common.nodeType === Node.TEXT_NODE || commonIsEquation ? [common] : common.childNodes) {
    const selected = cloneSelected(node);
    if (selected) fragment.appendChild(selected);
  }
  // Retain semantic ancestors so
  // selecting a word inside a link or bold text does not lose its meaning.
  let ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  if (commonIsEquation) ancestor = common.parentElement;
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

  let plainText = text;
  if (omittedDisclosureBody) {
    // Chromium Selection.toString() can include a closed details body even
    // though native copy excludes it. Read the filtered fragment's rendered
    // text so the plain flavor cannot disclose fields omitted from the HTML.
    // Layout is needed for paragraph/table separators; never change the source.
    const staging = doc.createElement('div');
    staging.setAttribute('aria-hidden', 'true');
    staging.style.cssText = 'position:fixed;left:-100000px;top:0;';
    staging.appendChild(content);
    try {
      doc.body.appendChild(staging);
      plainText = content.innerText ?? content.textContent ?? '';
    } finally {
      staging.remove();
    }
  }
  event.clipboardData.setData('text/plain', plainText);
  event.clipboardData.setData('text/html', content.innerHTML);
  event.preventDefault();
}
