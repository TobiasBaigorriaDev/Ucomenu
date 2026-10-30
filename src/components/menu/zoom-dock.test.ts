import { describe, expect, it } from "vitest";
import { zoomDockStyle } from "./zoom-dock";

describe("zoomDockStyle", () => {
  it("sin zoom deja el dock como lo deja el CSS", () => {
    expect(zoomDockStyle({ scale: 1, offsetLeft: 0, offsetTop: 0, height: 800 }, 120)).toBeNull();
    expect(zoomDockStyle({ scale: 1.005, offsetLeft: 0, offsetTop: 0, height: 800 }, 120)).toBeNull();
  });

  it("con zoom lo achica en la misma proporción y lo apoya abajo del viewport visible", () => {
    // Zoom 2: el viewport visible mide 400 px de alto y empieza en y = 300. El dock de 120 px ocupa 60 px de página.
    const style = zoomDockStyle({ scale: 2, offsetLeft: 50, offsetTop: 300, height: 400 }, 120)!;
    expect(style.transform).toBe("translate(50px, 640px) scale(0.5)");
    expect(style.top).toBe("0px");
    expect(style.bottom).toBe("auto");
    expect(style.transformOrigin).toBe("0 0");
  });

  it("el borde inferior del dock coincide con el del viewport visible", () => {
    const viewport = { scale: 3, offsetLeft: 0, offsetTop: 120, height: 300 };
    const dockHeight = 96;
    const style = zoomDockStyle(viewport, dockHeight)!;
    const y = Number(/translate\([^,]+, ([\d.]+)px\)/.exec(style.transform)![1]);
    expect(y + dockHeight / viewport.scale).toBeCloseTo(viewport.offsetTop + viewport.height);
  });
});
