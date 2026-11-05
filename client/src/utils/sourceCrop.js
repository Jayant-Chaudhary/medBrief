/**
 * Which part of a report page to show when the doctor checks a value.
 *
 * Boxes are fractions of the page ([x0, y0, x1, y1] in 0..1), as stored in
 * lab_report_metrics.source_box, so this works the same for PDFs and photos
 * and at any drawing size.
 */

/**
 * Rows of context shown above and below the value's own row. Enough that the
 * clipping visibly belongs to the page (neighbouring tests, table rules,
 * section headings), not just the one line.
 */
export const CONTEXT_ROWS = 3;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The crop to show: the full page width (so every column of the row is
 * visible) and the row plus some lines of context, clamped to the page.
 * A very short row still gets a readable band.
 *
 * @param {number[]} row   [x0, y0, x1, y1] fractions of the page
 * @returns {{x: number, y: number, w: number, h: number}} fractions of the page
 */
export function cropForRow(row, { contextRows = CONTEXT_ROWS, minHeight = 0.14 } = {}) {
  const [, y0, , y1] = row;
  const rowHeight = Math.max(y1 - y0, 0.005);
  let top = y0 - rowHeight * contextRows;
  let bottom = y1 + rowHeight * contextRows;
  if (bottom - top < minHeight) {
    const grow = (minHeight - (bottom - top)) / 2;
    top -= grow;
    bottom += grow;
  }
  // Near a page edge, slide the band inward rather than cutting the context.
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > 1) {
    top -= bottom - 1;
    bottom = 1;
  }
  top = clamp01(top);
  return { x: 0, y: top, w: 1, h: bottom - top };
}

/**
 * The value's highlight, relative to the crop (0..1 of the crop's size), with
 * a little padding so the outline doesn't touch the digits. Null if the value
 * box is missing or falls outside the crop.
 */
export function highlightInCrop(value, crop, pad = 0.004) {
  if (!value) return null;
  const [x0, y0, x1, y1] = value;
  const left = (x0 - pad - crop.x) / crop.w;
  const top = (y0 - pad - crop.y) / crop.h;
  const right = (x1 + pad - crop.x) / crop.w;
  const bottom = (y1 + pad - crop.y) / crop.h;
  if (right <= 0 || bottom <= 0 || left >= 1 || top >= 1) return null;
  return {
    left: clamp01(left),
    top: clamp01(top),
    width: clamp01(right) - clamp01(left),
    height: clamp01(bottom) - clamp01(top),
  };
}

/** "pdf" or "image", from the stored file's path; the preview draws them differently. */
export function fileKindOf(storagePath) {
  if (!storagePath) return null;
  return /\.pdf$/i.test(storagePath) ? 'pdf' : /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(storagePath) ? 'image' : null;
}
