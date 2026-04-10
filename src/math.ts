export function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0]=m[5]=m[10]=m[15]=1;
  return m;
}

export function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
    let s=0; for (let k=0;k<4;k++) s+=a[i+k*4]*b[k+j*4];
    out[i+j*4]=s;
  }
  return out;
}

export function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0/Math.tan(fov/2);
  const out = new Float32Array(16);
  out[0]=f/aspect; out[5]=f;
  out[10]=far/(near-far); out[11]=-1;
  out[14]=(near*far)/(near-far);
  return out;
}

export function mat4LookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z=normalize(sub(eye,target));
  const x=normalize(cross(up,z));
  const y=cross(z,x);
  const out=new Float32Array(16);
  out[0]=x[0]; out[4]=x[1]; out[8] =x[2];
  out[1]=y[0]; out[5]=y[1]; out[9] =y[2];
  out[2]=z[0]; out[6]=z[1]; out[10]=z[2];
  out[12]=-dot(x,eye); out[13]=-dot(y,eye); out[14]=-dot(z,eye); out[15]=1;
  return out;
}

export function mat4Translate(tx: number, ty: number, tz: number): Float32Array {
  const m=mat4Identity();
  m[12]=tx; m[13]=ty; m[14]=tz;
  return m;
}

export function mat4Scale(sx: number, sy: number, sz: number): Float32Array {
  const m=new Float32Array(16);
  m[0]=sx; m[5]=sy; m[10]=sz; m[15]=1;
  return m;
}

export function mat4RotateX(a: number): Float32Array {
  const m=mat4Identity();
  m[5]=Math.cos(a); m[6]=Math.sin(a);
  m[9]=-Math.sin(a); m[10]=Math.cos(a);
  return m;
}

export function mat4RotateY(a: number): Float32Array {
  const m=mat4Identity();
  m[0]=Math.cos(a); m[2]=-Math.sin(a);
  m[8]=Math.sin(a); m[10]=Math.cos(a);
  return m;
}

export function mat4RotateZ(a: number): Float32Array {
  const m=mat4Identity();
  m[0]=Math.cos(a); m[1]=Math.sin(a);
  m[4]=-Math.sin(a); m[5]=Math.cos(a);
  return m;
}

export function mat4Transpose(m: Float32Array): Float32Array {
  const out=new Float32Array(16);
  for(let i=0;i<4;i++) for(let j=0;j<4;j++) out[i*4+j]=m[j*4+i];
  return out;
}

export function mat4Inverse(m: Float32Array): Float32Array {
  // cofactor expansion
  const inv=new Float32Array(16);
  inv[0]  = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
  inv[4]  =-m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
  inv[8]  = m[4]*m[9] *m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
  inv[12] =-m[4]*m[9] *m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
  inv[1]  =-m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
  inv[5]  = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
  inv[9]  =-m[0]*m[9] *m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9] *m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
  inv[2]  = m[1]*m[6] *m[15]-m[1]*m[7] *m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7] -m[13]*m[3]*m[6];
  inv[6]  =-m[0]*m[6] *m[15]+m[0]*m[7] *m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7] +m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5] *m[15]-m[0]*m[7] *m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7] -m[12]*m[3]*m[5];
  inv[14] =-m[0]*m[5] *m[14]+m[0]*m[6] *m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6] +m[12]*m[2]*m[5];
  inv[3]  =-m[1]*m[6] *m[11]+m[1]*m[7] *m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9] *m[2]*m[7] +m[9] *m[3]*m[6];
  inv[7]  = m[0]*m[6] *m[11]-m[0]*m[7] *m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8] *m[2]*m[7] -m[8] *m[3]*m[6];
  inv[11] =-m[0]*m[5] *m[11]+m[0]*m[7] *m[9] +m[4]*m[1]*m[11]-m[4]*m[3]*m[9] -m[8] *m[1]*m[7] +m[8] *m[3]*m[5];
  inv[15] = m[0]*m[5] *m[10]-m[0]*m[6] *m[9] -m[4]*m[1]*m[10]+m[4]*m[2]*m[9] +m[8] *m[1]*m[6] -m[8] *m[2]*m[5];
  let det=m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
  if(Math.abs(det)<1e-10) return mat4Identity();
  det=1/det;
  for(let i=0;i<16;i++) inv[i]*=det;
  return inv;
}

function sub(a:number[],b:number[]){return a.map((v,i)=>v-b[i]);}
function dot(a:number[],b:number[]){return a.reduce((s,v,i)=>s+v*b[i],0);}
function cross(a:number[],b:number[]){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function normalize(v:number[]){const l=Math.hypot(...v)||1;return v.map(x=>x/l);}
