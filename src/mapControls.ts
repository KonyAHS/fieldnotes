// Map behaviour shared by the route map and the day map.
import L from "leaflet";
// Loads a ring of tiles beyond the visible area, so panning shows the map
// at once instead of blank squares while tiles download.
export const BufferedTiles = L.TileLayer.extend({
  _getTiledPixelBounds(this: L.TileLayer, center: L.LatLng) {
    const bounds = (
      L.TileLayer.prototype as unknown as {
        _getTiledPixelBounds(c: L.LatLng): L.Bounds;
      }
    )._getTiledPixelBounds.call(this, center);
    const pad = this.getTileSize().multiplyBy(1.5);
    return L.bounds(bounds.min!.subtract(pad), bounds.max!.add(pad));
  },
}) as unknown as typeof L.TileLayer;
// Leaflet's wheel zoom ignores the wheel while a zoom animates, so zooming
// several levels needed pauses. Here every wheel event moves a target zoom
// and the map eases toward it each frame (as a pinch does), keeping the point
// under the pointer in place.
export function smoothWheel(map: L.Map) {
  const m = map as L.Map & {
    _move(center: L.LatLng, zoom: number, data: object): void;
    _moveStart(zoomChanged: boolean, noMoveStart: boolean): void;
    _moveEnd(zoomChanged: boolean): void;
    _stop(): void;
  };
  const el = map.getContainer();
  let goal = 0,
    zoom = 0,
    frame = 0,
    last = 0,
    anchor = L.point(0, 0);
  const step = () => {
    zoom += (goal - zoom) * 0.3;
    if (Math.abs(goal - zoom) < 0.002) zoom = goal;
    const half = map.getSize().divideBy(2);
    const scale = map.getZoomScale(zoom, map.getZoom());
    const shift = anchor.subtract(half).multiplyBy(1 - 1 / scale);
    m._move(map.containerPointToLatLng(half.add(shift)), zoom, {
      pinch: true,
    });
    // Once the wheel has been still a moment, settles on the nearest whole
    // level (tiles are sharp there and show no seams), then ends.
    if (zoom === goal && performance.now() - last > 150) {
      if (goal !== Math.round(goal)) goal = Math.round(goal);
      else {
        frame = 0;
        m._moveEnd(true);
        return;
      }
    }
    frame = requestAnimationFrame(step);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    last = performance.now();
    anchor = map.mouseEventToContainerPoint(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    // A wheel notch (about 100 px) is one level; trackpad pinches (sent
    // with ctrlKey) have small steps and get more weight.
    const delta = (-e.deltaY * unit) / (e.ctrlKey ? 40 : 100);
    if (!frame) {
      m._stop();
      zoom = goal = map.getZoom();
      m._moveStart(true, false);
      frame = requestAnimationFrame(step);
    }
    goal = Math.min(
      map.getMaxZoom(),
      Math.max(map.getMinZoom(), goal + Math.max(-1, Math.min(1, delta))),
    );
  };
  el.addEventListener("wheel", wheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", wheel);
    cancelAnimationFrame(frame);
  };
}
