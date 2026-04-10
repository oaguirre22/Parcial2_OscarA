export async function loadOBJ(url: string) {
  const text = await fetch(url).then(r => r.text());

  const positions: number[][] = [];
  const finalData: number[] = [];

  const lines = text.split("\n");

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);

    if (parts[0] === "v") {
      positions.push([
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
      ]);
    }

    if (parts[0] === "f") {
      const indices = parts.slice(1).map(p => parseInt(p) - 1);

      const a = positions[indices[0]];
      const b = positions[indices[1]];
      const c = positions[indices[2]];

      // 🔥 vector AB
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];

      // 🔥 vector AC
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];

      // 🔥 normal (producto cruz)
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;

      // 🔥 normalizar
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      // 🔥 meter datos (posición + normal)
      for (const v of [a, b, c]) {
        finalData.push(v[0], v[1], v[2], nx, ny, nz);
      }
    }
  }

  return new Float32Array(finalData);
}