/**
 * Small SVG chart kit. No library, no runtime dependency, no animation.
 *
 * Every mark here follows one set of specs so the charts read as a family:
 * bars at most 24 units thick with a 4 unit rounded cap and a 2 unit gap of
 * surface between neighbours, lines 2 units with round joins and an 8 unit end
 * dot ringed in the surface colour, hairline gridlines one step off the
 * surface, and never a colour doing a job on its own. Text is always a text
 * token, never the series colour.
 */

const NS = 'http://www.w3.org/2000/svg';

type Attributes = Record<string, string | number | undefined>;

export function svg(tag: string, attributes: Attributes = {}, children: (Node | string)[] = []): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

export interface Series {
  label: string;
  colour: string;
  values: number[];
}

const PAD = { left: 48, right: 18, top: 14, bottom: 28 };
const SURFACE = '#15120e';

/**
 * Picks the gap between gridlines so the four ticks land on numbers a reader
 * can divide in their head. Counts ask for whole steps; hours are happy with a
 * half.
 */
export function axisStep(max: number, integer: boolean): number {
  const rough = Math.max(max, 1e-9) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const candidate = factor * magnitude;
    if (candidate >= rough) return integer ? Math.max(1, Math.ceil(candidate)) : candidate;
  }
  return integer ? Math.max(1, Math.ceil(10 * magnitude)) : 10 * magnitude;
}

function frame(width: number, height: number, title: string): SVGElement {
  const node = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    role: 'img',
    'aria-label': title,
  });
  node.append(svg('title', {}, [title]));
  return node;
}

/** A bar with a rounded cap at the data end and a square foot on the baseline. */
function columnPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, width / 2, Math.max(0, height));
  const bottom = y + height;
  return `M${x} ${bottom} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + width - r} ${y} Q${x + width} ${y} ${x + width} ${y + r} L${x + width} ${bottom} Z`;
}

function gridlines(node: SVGElement, width: number, height: number, top: number, format: (value: number) => string): void {
  const plotHeight = height - PAD.top - PAD.bottom;
  for (let i = 0; i <= 4; i += 1) {
    const value = (top / 4) * i;
    const y = PAD.top + plotHeight - (plotHeight * i) / 4;
    node.append(
      svg('line', { class: i === 0 ? 'axis' : 'grid-line', x1: PAD.left, x2: width - PAD.right, y1: y, y2: y }),
    );
    node.append(svg('text', { class: 'tick', x: PAD.left - 8, y: y + 4, 'text-anchor': 'end' }, [format(value)]));
  }
}

export interface LineOptions {
  width?: number;
  height?: number;
  title: string;
  labels: string[];
  series: Series[];
  format?: (value: number) => string;
  /** Counts want whole gridline steps; anything continuous does not. */
  whole?: boolean;
}

export function lineChart(options: LineOptions): SVGElement {
  const width = options.width ?? 1100;
  const height = options.height ?? 260;
  const format = options.format ?? ((value: number) => String(Math.round(value)));
  const node = frame(width, height, options.title);

  const top = axisStep(Math.max(1, ...options.series.flatMap((entry) => entry.values)), options.whole !== false) * 4;
  gridlines(node, width, height, top, format);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;
  const count = Math.max(1, options.labels.length - 1);
  const xAt = (index: number) => PAD.left + (plotWidth * index) / count;
  const yAt = (value: number) => PAD.top + plotHeight - (plotHeight * value) / top;

  // Roughly six dates along the foot, whatever the window length.
  const stride = Math.max(1, Math.ceil(options.labels.length / 6));
  options.labels.forEach((label, index) => {
    if (index % stride !== 0 && index !== options.labels.length - 1) return;
    node.append(
      svg('text', { class: 'tick', x: xAt(index), y: height - PAD.bottom + 18, 'text-anchor': 'middle' }, [label]),
    );
  });

  for (const entry of options.series) {
    const points = entry.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ');
    node.append(
      svg('polyline', {
        points,
        fill: 'none',
        stroke: entry.colour,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );
    const last = entry.values.length - 1;
    if (last >= 0) {
      node.append(
        svg('circle', {
          cx: xAt(last),
          cy: yAt(entry.values[last]),
          r: 4,
          fill: entry.colour,
          stroke: SURFACE,
          'stroke-width': 2,
        }),
      );
    }
  }

  return node;
}

export interface ColumnOptions {
  width?: number;
  height?: number;
  title: string;
  labels: string[];
  series: Series[];
  format?: (value: number) => string;
  /** Prints the value on the cap when there is room for it. */
  labelCaps?: boolean;
  /** Counts want whole gridline steps; anything continuous does not. */
  whole?: boolean;
}

export function columnChart(options: ColumnOptions): SVGElement {
  const width = options.width ?? 520;
  const height = options.height ?? 240;
  const format = options.format ?? ((value: number) => String(Math.round(value)));
  const node = frame(width, height, options.title);

  const highest = Math.max(...options.series.flatMap((entry) => entry.values), 0);
  const top = axisStep(Math.max(highest, options.whole === false ? 1e-6 : 1), options.whole !== false) * 4;
  gridlines(node, width, height, top, format);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = height - PAD.top - PAD.bottom;
  const slots = Math.max(1, options.labels.length);
  const slotWidth = plotWidth / slots;
  const gap = 2;
  const groupWidth = Math.min(24 * options.series.length + gap * (options.series.length - 1), slotWidth * 0.72);
  const barWidth = Math.max(2, (groupWidth - gap * (options.series.length - 1)) / options.series.length);

  const stride = Math.max(1, Math.ceil(slots / 12));
  options.labels.forEach((label, index) => {
    const centre = PAD.left + slotWidth * (index + 0.5);
    if (index % stride === 0) {
      node.append(
        svg('text', { class: 'tick', x: centre, y: height - PAD.bottom + 18, 'text-anchor': 'middle' }, [label]),
      );
    }

    options.series.forEach((entry, seriesIndex) => {
      const value = entry.values[index] ?? 0;
      const barHeight = (plotHeight * value) / top;
      const x = centre - groupWidth / 2 + seriesIndex * (barWidth + gap);
      const y = PAD.top + plotHeight - barHeight;
      if (value > 0) node.append(svg('path', { d: columnPath(x, y, barWidth, barHeight), fill: entry.colour }));
      if (options.labelCaps && value > 0 && stride === 1 && options.series.length === 1) {
        node.append(
          svg('text', { class: 'value', x: x + barWidth / 2, y: y - 6, 'text-anchor': 'middle' }, [format(value)]),
        );
      }
    });
  });

  return node;
}

export interface FunnelRow {
  label: string;
  n: number;
}

/** Horizontal bars against a shared total, with the count at the tip. */
export function funnelChart(rows: FunnelRow[], total: number, width = 520): SVGElement {
  const rowHeight = 34;
  const height = rows.length * rowHeight + 12;
  const node = frame(width, height, 'funnel');
  const labelWidth = 176;
  const trackWidth = width - labelWidth - 84;

  rows.forEach((row, index) => {
    const y = index * rowHeight + 6;
    const share = total > 0 ? row.n / total : 0;
    node.append(svg('text', { x: 0, y: y + 20, 'font-size': 14 }, [row.label]));
    node.append(
      svg('rect', { x: labelWidth, y: y + 6, width: trackWidth, height: 18, rx: 2, fill: '#241d12' }),
    );
    if (share > 0) {
      node.append(
        svg('rect', {
          x: labelWidth,
          y: y + 6,
          width: Math.max(2, trackWidth * share),
          height: 18,
          rx: 2,
          fill: '#bc8b09',
        }),
      );
    }
    node.append(
      svg('text', { class: 'value', x: width, y: y + 20, 'text-anchor': 'end' }, [
        `${row.n}  ${(share * 100).toFixed(0)}%`,
      ]),
    );
  });

  return node;
}
