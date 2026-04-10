// ═══════════════════════════════════════════════════════════════════════════
//  Indexed mesh data structure + OBJ loader
//  Layout per vertex in flat buffer: px py pz  nx ny nz  u v   (8 floats)
// ═══════════════════════════════════════════════════════════════════════════

export class IndexedMesh {
  positions : Float32Array;   // 3 floats per vertex
  normals   : Float32Array;   // 3 floats per vertex  (vertex normals)
  uvs       : Float32Array;   // 2 floats per vertex
  indices   : Uint32Array;    // 3 indices per triangle
  vertexCount : number;
  faceCount   : number;

  // Bounding info (axis-aligned)
  bboxMin : [number,number,number] = [0,0,0];
  bboxMax : [number,number,number] = [0,0,0];
  center  : [number,number,number] = [0,0,0];
  radius  : number = 1;

  constructor(
    positions: Float32Array,
    normals:   Float32Array,
    uvs:       Float32Array,
    indices:   Uint32Array,
  ) {
    this.positions   = positions;
    this.normals     = normals;
    this.uvs         = uvs;
    this.indices     = indices;
    this.vertexCount = positions.length / 3;
    this.faceCount   = indices.length   / 3;
    this._computeBounds();
  }

  _computeBounds() {
    let minX=Infinity,minY=Infinity,minZ=Infinity;
    let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (let i=0; i<this.positions.length; i+=3) {
      const x=this.positions[i], y=this.positions[i+1], z=this.positions[i+2];
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
    }
    this.bboxMin = [minX,minY,minZ];
    this.bboxMax = [maxX,maxY,maxZ];
    this.center  = [(minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2];
    const dx=maxX-minX, dy=maxY-minY, dz=maxZ-minZ;
    this.radius = Math.hypot(dx,dy,dz) / 2;
  }

  // Returns a flat Float32Array ready for GPU: pos + normal + uv per vertex (interleaved)
  // Uses indexed expansion (no index buffer on GPU, plain triangle list)
  toFlatBuffer(): Float32Array {
    const data = new Float32Array(this.indices.length * 8);
    for (let i=0; i<this.indices.length; i++) {
      const vi = this.indices[i];
      const base = i * 8;
      data[base+0] = this.positions[vi*3+0];
      data[base+1] = this.positions[vi*3+1];
      data[base+2] = this.positions[vi*3+2];
      data[base+3] = this.normals[vi*3+0];
      data[base+4] = this.normals[vi*3+1];
      data[base+5] = this.normals[vi*3+2];
      data[base+6] = this.uvs[vi*2+0];
      data[base+7] = this.uvs[vi*2+1];
    }
    return data;
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  OBJ Loader → IndexedMesh
//  • Per-face normals computed via cross product (task 3)
//  • Vertex normals averaged from face normals (task 3)
//  • Spherical UV coordinates (task 10)
// ───────────────────────────────────────────────────────────────────────────
export async function loadOBJMesh(url: string): Promise<IndexedMesh> {
  const text = await fetch(url).then(r => r.text());

  // ── Parse raw OBJ data ──────────────────────────────────────────────────
  const rawPos  : number[][] = [];
  const rawUV   : number[][] = [];
  const rawNorm : number[][] = [];

  // Each face vertex is a unique combination of (posIdx, uvIdx, normIdx)
  // We de-duplicate them into a unique vertex list
  const keyToIdx  = new Map<string, number>();
  const positions : number[] = [];
  const uvs       : number[] = [];
  const normalsOBJ: number[] = [];
  const indices   : number[] = [];

  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v')  rawPos .push([+p[1], +p[2], +p[3]]);
    if (p[0] === 'vt') rawUV  .push([+p[1], 1 - +p[2]]);
    if (p[0] === 'vn') rawNorm.push([+p[1], +p[2], +p[3]]);
    if (p[0] === 'f') {
      const faceVerts = p.slice(1).map(s => {
        const [vi, ti, ni] = s.split('/').map(x => x ? +x - 1 : -1);
        return { vi, ti, ni };
      });
      // Fan triangulation for quads/polygons
      for (let i = 1; i < faceVerts.length - 1; i++) {
        for (const w of [faceVerts[0], faceVerts[i], faceVerts[i+1]]) {
          const key = `${w.vi}/${w.ti}/${w.ni}`;
          if (!keyToIdx.has(key)) {
            const idx = positions.length / 3;
            keyToIdx.set(key, idx);
            const pos = rawPos[w.vi] ?? [0,0,0];
            positions.push(pos[0], pos[1], pos[2]);
            // UV from OBJ or placeholder (will be overwritten by spherical UV below)
            const uv = w.ti >= 0 ? rawUV[w.ti] : [0, 0];
            uvs.push(uv[0], uv[1]);
            // Store OBJ normal (may be overridden below)
            const n = w.ni >= 0 ? rawNorm[w.ni] : [0,0,0];
            normalsOBJ.push(n[0], n[1], n[2]);
          }
          indices.push(keyToIdx.get(key)!);
        }
      }
    }
  }

  const posArr = new Float32Array(positions);
  const idxArr = new Uint32Array(indices);

  // ── Task 3: Per-face normals → accumulate into vertex normals ──────────
  const vertNormals = new Float32Array(positions.length); // zero-init

  for (let f = 0; f < idxArr.length; f += 3) {
    const ia = idxArr[f], ib = idxArr[f+1], ic = idxArr[f+2];
    const ax=posArr[ia*3],ay=posArr[ia*3+1],az=posArr[ia*3+2];
    const bx=posArr[ib*3],by=posArr[ib*3+1],bz=posArr[ib*3+2];
    const cx=posArr[ic*3],cy=posArr[ic*3+1],cz=posArr[ic*3+2];

    // Edge vectors AB, AC
    const ux=bx-ax, uy=by-ay, uz=bz-az;
    const vx=cx-ax, vy=cy-ay, vz=cz-az;

    // Cross product AB × AC = face normal (not yet normalized → weighted by area)
    const nx = uy*vz - uz*vy;
    const ny = uz*vx - ux*vz;
    const nz = ux*vy - uy*vx;

    // Accumulate into each vertex
    for (const iv of [ia, ib, ic]) {
      vertNormals[iv*3+0] += nx;
      vertNormals[iv*3+1] += ny;
      vertNormals[iv*3+2] += nz;
    }
  }

  // Normalize accumulated vertex normals
  for (let i = 0; i < vertNormals.length; i += 3) {
    const l = Math.hypot(vertNormals[i], vertNormals[i+1], vertNormals[i+2]) || 1;
    vertNormals[i]   /= l;
    vertNormals[i+1] /= l;
    vertNormals[i+2] /= l;
  }

  // ── Task 10: Spherical UV parameterization ──────────────────────────────
  // Compute center of the mesh for spherical projection
  let cx2=0, cy2=0, cz2=0;
  const vc = posArr.length / 3;
  for (let i=0; i<posArr.length; i+=3){ cx2+=posArr[i]; cy2+=posArr[i+1]; cz2+=posArr[i+2]; }
  cx2/=vc; cy2/=vc; cz2/=vc;

  const uvArr = new Float32Array(vc * 2);
  for (let i=0; i<vc; i++) {
    const dx = posArr[i*3]   - cx2;
    const dy = posArr[i*3+1] - cy2;
    const dz = posArr[i*3+2] - cz2;
    const l  = Math.hypot(dx, dy, dz) || 1;
    // Spherical coordinates
    const u = 0.5 + Math.atan2(dz/l, dx/l) / (2 * Math.PI);
    const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, dy/l))) / Math.PI;
    uvArr[i*2]   = u;
    uvArr[i*2+1] = v;
  }

  return new IndexedMesh(posArr, vertNormals, uvArr, idxArr);
}

// ── Legacy flat-buffer helpers kept for compatibility ────────────────────────
export async function loadOBJ(url: string): Promise<Float32Array> {
  const mesh = await loadOBJMesh(url);
  return mesh.toFlatBuffer();
}

// ─── Procedural Sphere ───────────────────────────────────────────────────────
export function createSphereMesh(radius = 1, stacks = 32, slices = 32): IndexedMesh {
  const positions: number[] = [];
  const normals:   number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;          // 0 … π
    const sinP = Math.sin(phi), cosP = Math.cos(phi);
    for (let j = 0; j <= slices; j++) {
      const theta = (j / slices) * 2 * Math.PI; // 0 … 2π
      const sinT = Math.sin(theta), cosT = Math.cos(theta);
      const nx = sinP * cosT, ny = cosP, nz = sinP * sinT;
      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
      uvs.push(j / slices, i / stacks);
    }
  }

  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = a + slices + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return new IndexedMesh(
    new Float32Array(positions),
    new Float32Array(normals),
    new Float32Array(uvs),
    new Uint32Array(indices),
  );
}

// ─── Procedural Cube ─────────────────────────────────────────────────────────
export function createCubeMesh(size = 1): IndexedMesh {
  const h = size / 2;
  // Each face: 4 vertices (pos, normal, uv)
  const faceData: Array<{ pos: [number,number,number], n: [number,number,number], uv: [number,number] }>[] = [
    // +X
    [{pos:[h,-h,-h],n:[1,0,0],uv:[0,1]},{pos:[h, h,-h],n:[1,0,0],uv:[0,0]},{pos:[h, h, h],n:[1,0,0],uv:[1,0]},{pos:[h,-h, h],n:[1,0,0],uv:[1,1]}],
    // -X
    [{pos:[-h,-h, h],n:[-1,0,0],uv:[0,1]},{pos:[-h, h, h],n:[-1,0,0],uv:[0,0]},{pos:[-h, h,-h],n:[-1,0,0],uv:[1,0]},{pos:[-h,-h,-h],n:[-1,0,0],uv:[1,1]}],
    // +Y
    [{pos:[-h, h,-h],n:[0,1,0],uv:[0,1]},{pos:[-h, h, h],n:[0,1,0],uv:[0,0]},{pos:[h, h, h],n:[0,1,0],uv:[1,0]},{pos:[h, h,-h],n:[0,1,0],uv:[1,1]}],
    // -Y
    [{pos:[-h,-h, h],n:[0,-1,0],uv:[0,1]},{pos:[-h,-h,-h],n:[0,-1,0],uv:[0,0]},{pos:[h,-h,-h],n:[0,-1,0],uv:[1,0]},{pos:[h,-h, h],n:[0,-1,0],uv:[1,1]}],
    // +Z
    [{pos:[-h,-h, h],n:[0,0,1],uv:[0,1]},{pos:[h,-h, h],n:[0,0,1],uv:[1,1]},{pos:[h, h, h],n:[0,0,1],uv:[1,0]},{pos:[-h, h, h],n:[0,0,1],uv:[0,0]}],
    // -Z
    [{pos:[h,-h,-h],n:[0,0,-1],uv:[1,1]},{pos:[-h,-h,-h],n:[0,0,-1],uv:[0,1]},{pos:[-h, h,-h],n:[0,0,-1],uv:[0,0]},{pos:[h, h,-h],n:[0,0,-1],uv:[1,0]}],
  ];

  const positions: number[] = [];
  const normals:   number[] = [];
  const uvs:       number[] = [];
  const indices:   number[] = [];

  for (const face of faceData) {
    const base = positions.length / 3;
    for (const v of face) {
      positions.push(...v.pos);
      normals.push(...v.n);
      uvs.push(...v.uv);
    }
    // Two triangles per face
    indices.push(base, base+1, base+2, base, base+2, base+3);
  }

  return new IndexedMesh(
    new Float32Array(positions),
    new Float32Array(normals),
    new Float32Array(uvs),
    new Uint32Array(indices),
  );
}
