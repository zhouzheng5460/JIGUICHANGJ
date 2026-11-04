/**
 * Coordinate transformation utilities using getBoundingClientRect().
 *
 * These utilities handle CSS transforms (zoom, pan) correctly across all browsers.
 *
 * Note: Previously used getScreenCTM(), but Safari 18.x has a bug where it ignores
 * CSS scale() transforms on ancestor elements (e.g., from panzoom). The BBox approach
 * works correctly in all browsers. See #424 for details.
 */

/**
 * Convert screen coordinates (clientX/clientY) to SVG user space coordinates.
 * Accounts for all transforms (zoom, pan, CSS) correctly in all browsers.
 *
 * @param svg - The SVG element to transform coordinates for
 * @param clientX - Screen X coordinate (from mouse event)
 * @param clientY - Screen Y coordinate (from mouse event)
 * @returns SVG user space coordinates { x, y }
 */
export function screenToSVG(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;

  // Handle case where viewBox isn't set or has zero dimensions
  if (!viewBox || viewBox.width === 0 || viewBox.height === 0) {
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Calculate scale factors from screen space to SVG user space
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;

  // Transform screen coordinates to SVG coordinates
  const x = (clientX - rect.left) * scaleX + viewBox.x;
  const y = (clientY - rect.top) * scaleY + viewBox.y;

  return { x, y };
}

/**
 * Convert SVG user space coordinates to screen coordinates.
 * Useful for positioning DOM elements relative to SVG content.
 *
 * @param svg - The SVG element to transform coordinates for
 * @param x - SVG X coordinate
 * @param y - SVG Y coordinate
 * @returns Screen coordinates { clientX, clientY }
 */
export function svgToScreen(
  svg: SVGSVGElement,
  x: number,
  y: number,
): { clientX: number; clientY: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;

  // Handle case where viewBox isn't set or has zero dimensions
  if (!viewBox || viewBox.width === 0 || viewBox.height === 0) {
    return { clientX: x + rect.left, clientY: y + rect.top };
  }

  // Calculate scale factors from SVG user space to screen space
  const scaleX = rect.width / viewBox.width;
  const scaleY = rect.height / viewBox.height;

  // Transform SVG coordinates to screen coordinates
  const clientX = (x - viewBox.x) * scaleX + rect.left;
  const clientY = (y - viewBox.y) * scaleY + rect.top;

  return { clientX, clientY };
}
