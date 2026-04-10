// ═══════════════════════════════════════════════════════════════════════════
//  Arcball / Orbit Camera  (task 4)
//  Orbits around a configurable target point.
//  Radius = distance from target (used for zoom, task 9).
//  Pitch clamped so the object stays visible from all angles without clipping.
// ═══════════════════════════════════════════════════════════════════════════

export class OrbitCamera {
  yaw    = 0.3;
  pitch  = 0.3;
  radius = 8.0;
  target : [number,number,number] = [0, 0, 0];

  // Arcball drag: update yaw/pitch from mouse delta (radians per pixel)
  orbit(dx: number, dy: number, sensitivity = 0.005) {
    this.yaw   += dx * sensitivity;
    this.pitch  = Math.max(-Math.PI/2 + 0.01,
                  Math.min( Math.PI/2 - 0.01, this.pitch - dy * sensitivity));
  }

  // Zoom: scroll wheel moves along the view axis (task 9)
  zoom(delta: number) {
    this.radius = Math.max(0.5, this.radius + delta);
  }

  // Fit the camera so an object with given center + radius fills the view
  fitObject(center: [number,number,number], boundingRadius: number, fovY = Math.PI/4) {
    this.target = [...center] as [number,number,number];
    // Distance so object just fits inside the frustum
    this.radius = (boundingRadius / Math.sin(fovY / 2)) * 1.1;
  }

  getPosition(): [number,number,number] {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw),   sy = Math.sin(this.yaw);
    return [
      this.target[0] + this.radius * cp * cy,
      this.target[1] + this.radius * sp,
      this.target[2] + this.radius * cp * sy,
    ];
  }

  // Near/far planes derived from radius so no clipping (task 9)
  getNear() { return Math.max(0.01, this.radius * 0.01); }
  getFar()  { return this.radius * 10 + 100; }
}
