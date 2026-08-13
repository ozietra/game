type Attributes = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'html') {
      node.innerHTML = String(value);
      continue;
    }
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  node.addEventListener(event, handler);
}

export function setText(node: HTMLElement | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export function setWidth(node: HTMLElement | null, fraction: number): void {
  if (!node) return;
  const percent = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  if (node.style.width !== percent) node.style.width = percent;
}
