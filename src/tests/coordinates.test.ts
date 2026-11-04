import { describe, it, expect } from "vitest";
import { screenToSVG, svgToScreen } from "$lib/utils/coordinates";

/**
 * Helper to create a mock SVG element with specified bounding rect and viewBox.
 *
 * The new BBox-based implementation uses:
 * - getBoundingClientRect() for screen position and size
 * - viewBox for SVG coordinate space
 *
 * To simulate zoom: make rect smaller than viewBox (zoom out) or larger (zoom in)
 * To simulate pan: adjust rect.left/top (screen position of SVG)
 */
function createMockSVG(config: {
  rect: { left: number; top: number; width: number; height: number };
  viewBox: { x: number; y: number; width: number; height: number };
}): SVGSVGElement {
  return {
    getBoundingClientRect() {
      return {
        left: config.rect.left,
        top: config.rect.top,
        width: config.rect.width,
        height: config.rect.height,
        right: config.rect.left + config.rect.width,
        bottom: config.rect.top + config.rect.height,
        x: config.rect.left,
        y: config.rect.top,
      };
    },
    viewBox: {
      baseVal: {
        x: config.viewBox.x,
        y: config.viewBox.y,
        width: config.viewBox.width,
        height: config.viewBox.height,
      },
    },
  } as unknown as SVGSVGElement;
}

describe("screenToSVG", () => {
  it("converts screen coordinates to SVG user space (1:1 mapping)", () => {
    // No zoom: rect and viewBox are same size
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 200, height: 300 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    const result = screenToSVG(mockSvg, 100, 150);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(150);
  });

  it("accounts for zoom transform (2x zoom in)", () => {
    // 2x zoom: rect is 2x the viewBox size (things appear larger on screen)
    // Screen coord 200 maps to SVG coord 100
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 400, height: 600 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    const result = screenToSVG(mockSvg, 200, 300);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(150);
  });

  it("accounts for zoom out (0.5x)", () => {
    // 0.5x zoom: rect is half the viewBox size
    // Screen coord 50 maps to SVG coord 100
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 100, height: 150 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    const result = screenToSVG(mockSvg, 50, 75);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(150);
  });

  it("accounts for SVG offset on page (pan)", () => {
    // SVG positioned at (50, 100) on screen
    const mockSvg = createMockSVG({
      rect: { left: 50, top: 100, width: 200, height: 300 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    // Click at screen (150, 250) should map to SVG (100, 150)
    const result = screenToSVG(mockSvg, 150, 250);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(150);
  });

  it("accounts for combined zoom and pan", () => {
    // 2x zoom + offset at (100, 100)
    const mockSvg = createMockSVG({
      rect: { left: 100, top: 100, width: 400, height: 600 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    // Screen (300, 400) -> SVG: ((300-100)/2, (400-100)/2) = (100, 150)
    const result = screenToSVG(mockSvg, 300, 400);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(150);
  });

  it("handles viewBox with negative origin (like Rackula)", () => {
    // Rackula uses viewBox="0 -4 220 328" for NAME_Y_OFFSET
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 220, height: 328 },
      viewBox: { x: 0, y: -4, width: 220, height: 328 },
    });
    // Screen (110, 160) should map to SVG (110, 156) due to viewBox.y = -4
    const result = screenToSVG(mockSvg, 110, 160);
    expect(result.x).toBeCloseTo(110);
    expect(result.y).toBeCloseTo(156); // 160 + (-4) = 156
  });

  it("returns simple offset when viewBox is not set", () => {
    const mockSvg = {
      getBoundingClientRect() {
        return { left: 50, top: 100, width: 200, height: 300 };
      },
      viewBox: {
        baseVal: { x: 0, y: 0, width: 0, height: 0 },
      },
    } as unknown as SVGSVGElement;

    const result = screenToSVG(mockSvg, 150, 250);
    expect(result.x).toBe(100); // 150 - 50
    expect(result.y).toBe(150); // 250 - 100
  });
});

describe("svgToScreen", () => {
  it("converts SVG coordinates to screen space (1:1 mapping)", () => {
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 200, height: 300 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    const result = svgToScreen(mockSvg, 100, 150);
    expect(result.clientX).toBeCloseTo(100);
    expect(result.clientY).toBeCloseTo(150);
  });

  it("accounts for zoom transform (2x)", () => {
    // 2x zoom: SVG coord 100 maps to screen coord 200
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 400, height: 600 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    const result = svgToScreen(mockSvg, 100, 150);
    expect(result.clientX).toBeCloseTo(200);
    expect(result.clientY).toBeCloseTo(300);
  });

  it("accounts for SVG offset on page", () => {
    const mockSvg = createMockSVG({
      rect: { left: 50, top: 100, width: 200, height: 300 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    // SVG (100, 150) should map to screen (150, 250)
    const result = svgToScreen(mockSvg, 100, 150);
    expect(result.clientX).toBeCloseTo(150);
    expect(result.clientY).toBeCloseTo(250);
  });

  it("accounts for combined zoom and pan", () => {
    const mockSvg = createMockSVG({
      rect: { left: 100, top: 100, width: 400, height: 600 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });
    // SVG (100, 150) at 2x zoom + offset = screen (300, 400)
    const result = svgToScreen(mockSvg, 100, 150);
    expect(result.clientX).toBeCloseTo(300);
    expect(result.clientY).toBeCloseTo(400);
  });

  it("handles viewBox with negative origin", () => {
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 220, height: 328 },
      viewBox: { x: 0, y: -4, width: 220, height: 328 },
    });
    // SVG (110, 156) should map to screen (110, 160)
    const result = svgToScreen(mockSvg, 110, 156);
    expect(result.clientX).toBeCloseTo(110);
    expect(result.clientY).toBeCloseTo(160);
  });

  it("returns simple offset when viewBox is not set", () => {
    const mockSvg = {
      getBoundingClientRect() {
        return { left: 50, top: 100, width: 200, height: 300 };
      },
      viewBox: {
        baseVal: { x: 0, y: 0, width: 0, height: 0 },
      },
    } as unknown as SVGSVGElement;

    const result = svgToScreen(mockSvg, 100, 150);
    expect(result.clientX).toBe(150); // 100 + 50
    expect(result.clientY).toBe(250); // 150 + 100
  });
});

describe("round-trip conversion", () => {
  it("screenToSVG then svgToScreen returns original coordinates", () => {
    const mockSvg = createMockSVG({
      rect: { left: 75, top: 50, width: 300, height: 450 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });

    const screenX = 250;
    const screenY = 300;

    const svg = screenToSVG(mockSvg, screenX, screenY);
    const back = svgToScreen(mockSvg, svg.x, svg.y);

    expect(back.clientX).toBeCloseTo(screenX);
    expect(back.clientY).toBeCloseTo(screenY);
  });

  it("svgToScreen then screenToSVG returns original coordinates", () => {
    const mockSvg = createMockSVG({
      rect: { left: 30, top: 20, width: 150, height: 225 },
      viewBox: { x: 0, y: 0, width: 200, height: 300 },
    });

    const svgX = 150;
    const svgY = 200;

    const screen = svgToScreen(mockSvg, svgX, svgY);
    const back = screenToSVG(mockSvg, screen.clientX, screen.clientY);

    expect(back.x).toBeCloseTo(svgX);
    expect(back.y).toBeCloseTo(svgY);
  });

  it("round-trip with negative viewBox origin", () => {
    // Matches Rackula's actual viewBox
    const mockSvg = createMockSVG({
      rect: { left: 40, top: 500, width: 220, height: 328 },
      viewBox: { x: 0, y: -4, width: 220, height: 328 },
    });

    const screenX = 150;
    const screenY = 650;

    const svg = screenToSVG(mockSvg, screenX, screenY);
    const back = svgToScreen(mockSvg, svg.x, svg.y);

    expect(back.clientX).toBeCloseTo(screenX);
    expect(back.clientY).toBeCloseTo(screenY);
  });
});

describe("Rackula-specific scenarios", () => {
  it("handles panzoom CSS scale correctly", () => {
    // When panzoom applies CSS scale(0.5), the SVG's bounding rect shrinks
    // but the viewBox stays the same. This is the key Safari fix scenario.
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 110, height: 164 }, // Half size due to CSS scale(0.5)
      viewBox: { x: 0, y: -4, width: 220, height: 328 }, // Original viewBox
    });

    // Click at screen center (55, 82) should map to SVG center (110, 160)
    const result = screenToSVG(mockSvg, 55, 82);
    expect(result.x).toBeCloseTo(110);
    expect(result.y).toBeCloseTo(160); // 82 * 2 + (-4) = 160
  });

  it("handles panzoom CSS scale(1.5) correctly", () => {
    // zoom in 1.5x
    const mockSvg = createMockSVG({
      rect: { left: 0, top: 0, width: 330, height: 492 }, // 1.5x size
      viewBox: { x: 0, y: -4, width: 220, height: 328 },
    });

    // Click at screen (165, 246) should map to SVG center (110, 160)
    const result = screenToSVG(mockSvg, 165, 246);
    expect(result.x).toBeCloseTo(110);
    expect(result.y).toBeCloseTo(160); // 246 / 1.5 + (-4) = 160
  });
});
