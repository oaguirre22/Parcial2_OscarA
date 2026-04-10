// ═══════════════════════════════════════════════════════════════════════════
//  WebGPU shader — object-order pipeline
//  Supports: Gouraud(0) Phong(1) Normals(2) Wireframe(3) Depth(4) Texture(5) UVCoords(6)
// ═══════════════════════════════════════════════════════════════════════════

struct Camera {
  view     : mat4x4<f32>,
  proj     : mat4x4<f32>,
  position : vec3<f32>,
  _pad     : f32,
}
struct Model {
  model    : mat4x4<f32>,
  normalMat: mat4x4<f32>,
}
struct Material {
  color     : vec4<f32>,
  ka        : f32,
  kd        : f32,
  ks        : f32,
  shininess : f32,
  mode      : u32,   // 0=Gouraud 1=Phong 2=Normals 3=Wireframe 4=Depth 5=Texture 6=UVCoords
  useTexture: u32,
  _p0       : f32,
  _p1       : f32,
}
struct Light {
  position : vec3<f32>,
  _p0      : f32,
  color    : vec3<f32>,
  _p1      : f32,
}

@group(0) @binding(0) var<uniform> cam   : Camera;
@group(0) @binding(1) var<uniform> mdl   : Model;
@group(0) @binding(2) var<uniform> mat   : Material;
@group(0) @binding(3) var<uniform> light : Light;
@group(0) @binding(4) var samp           : sampler;
@group(0) @binding(5) var tex            : texture_2d<f32>;

// ── Vertex I/O ────────────────────────────────────────────────────────────
struct VIn {
  @location(0) pos : vec3<f32>,
  @location(1) nor : vec3<f32>,
  @location(2) uv  : vec2<f32>,
}
struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) wpos  : vec3<f32>,
  @location(1) wnor  : vec3<f32>,
  @location(2) uv    : vec2<f32>,
  @location(3) gcol  : vec3<f32>,  // Gouraud colour
  @location(4) ndcz  : f32,
}

// ── Blinn-Phong helper ────────────────────────────────────────────────────
fn blinnPhong(wpos: vec3<f32>, N: vec3<f32>) -> vec3<f32> {
  let L    = normalize(light.position - wpos);
  let V    = normalize(cam.position   - wpos);
  let H    = normalize(L + V);
  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), mat.shininess);
  return (mat.ka * light.color
        + mat.kd * diff * light.color
        + mat.ks * spec * light.color) * mat.color.rgb;
}

// ── Vertex shader ─────────────────────────────────────────────────────────
@vertex fn vs_main(v: VIn) -> VOut {
  var o: VOut;
  let wp4  = mdl.model      * vec4<f32>(v.pos, 1.0);
  let wn4  = mdl.normalMat  * vec4<f32>(v.nor, 0.0);
  let wp   = wp4.xyz;
  let wn   = normalize(wn4.xyz);
  o.clip   = cam.proj * cam.view * wp4;
  o.wpos   = wp;
  o.wnor   = wn;
  o.uv     = v.uv;
  o.ndcz   = o.clip.z / o.clip.w;
  // Gouraud: lighting per vertex (task 8)
  o.gcol = select(vec3<f32>(0.0), blinnPhong(wp, wn), mat.mode == 0u);
  return o;
}

// ── Fragment shader ───────────────────────────────────────────────────────
@fragment fn fs_main(i: VOut) -> @location(0) vec4<f32> {
  let N = normalize(i.wnor);
  switch (mat.mode) {
    // Gouraud (task 8) — colour already interpolated from vs
    case 0u: { return vec4<f32>(i.gcol, 1.0); }

    // Phong (task 8) — lighting per fragment using normal buffer value
    case 1u: { return vec4<f32>(blinnPhong(i.wpos, N), 1.0); }

    // Normal buffer visualisation (task 6) — rgb = xyz of world normal
    case 2u: { return vec4<f32>(N * 0.5 + 0.5, 1.0); }

    // Wireframe — solid fill; edges drawn via separate pipeline (task 11)
    case 3u: { return vec4<f32>(blinnPhong(i.wpos, N), 1.0); }

    // Depth buffer (task 9)
    case 4u: {
      let d = clamp((i.ndcz + 1.0) * 0.5, 0.0, 1.0);
      return vec4<f32>(d, d, d, 1.0);
    }

    // Texture + Blinn-Phong (task 10)
    case 5u: {
      let tc   = textureSample(tex, samp, i.uv).rgb;
      let L    = normalize(light.position - i.wpos);
      let V    = normalize(cam.position   - i.wpos);
      let H    = normalize(L + V);
      let diff = max(dot(N, L), 0.0);
      let spec = pow(max(dot(N, H), 0.0), mat.shininess);
      let base = select(mat.color.rgb, tc, mat.useTexture == 1u);
      let lit  = (mat.ka + mat.kd * diff) * base + mat.ks * spec * light.color;
      return vec4<f32>(lit, 1.0);
    }

    // UV coordinates as colour (task 10 debug)
    case 6u: { return vec4<f32>(i.uv, 0.0, 1.0); }

    default: { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }
  }
}

// ── Wireframe overlay vertex shader ──────────────────────────────────────
@vertex fn vs_wire(v: VIn) -> VOut {
  var o: VOut;
  let wp4 = mdl.model * vec4<f32>(v.pos, 1.0);
  // Slight depth bias so wire draws in front of fill
  o.clip  = cam.proj * cam.view * wp4;
  o.clip.z -= 0.0002 * o.clip.w;
  o.wpos  = wp4.xyz;
  o.wnor  = v.nor;
  o.uv    = v.uv;
  o.ndcz  = 0.0;
  o.gcol  = vec3<f32>(1.0);
  return o;
}

@fragment fn fs_wire(i: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.9, 0.95, 1.0, 1.0);
}
