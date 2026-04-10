import { OrbitCamera } from './camera';
import {
  mat4Mul, mat4Perspective, mat4LookAt,
  mat4Translate, mat4Scale, mat4RotateX, mat4RotateY, mat4RotateZ,
  mat4Transpose, mat4Inverse,
} from './math';
import { loadOBJMesh, IndexedMesh, createSphereMesh, createCubeMesh } from './mesh';

// ─── Render modes ────────────────────────────────────────────────────────────
export const RENDER_MODES = ['Gouraud','Phong','Normals','Wireframe','Depth','Texture','UVCoords'] as const;
export type RenderMode = typeof RENDER_MODES[number];

const MODE_IDX: Record<RenderMode, number> = {
  Gouraud:0, Phong:1, Normals:2, Wireframe:3, Depth:4, Texture:5, UVCoords:6
};

// ─── Scene Object ─────────────────────────────────────────────────────────────
export class SceneObject {
  id   = 0;
  name = '';
  translateX = 0; translateY = 0; translateZ = 0;
  rotateX    = 0; rotateY    = 0; rotateZ    = 0;
  scaleX     = 1; scaleY     = 1; scaleZ     = 1;
  ka = 0.12; kd = 0.75; ks = 0.55; shininess = 48;
  color: [number,number,number] = [0.27, 0.57, 0.82];
  useTexture  = false;
  textureData : ImageBitmap | null = null;

  // GPU resources
  _vbuf   : GPUBuffer     | null = null;
  _wbuf   : GPUBuffer     | null = null;   // wireframe edge buffer
  _vcnt   = 0;
  _wcnt   = 0;
  _texBuf : GPUTexture    | null = null;
  _texView: GPUTextureView| null = null;

  // Bounding info for arcball fit
  boundCenter : [number,number,number] = [0,0,0];
  boundRadius  = 1;
}

let nextId = 1;
function makeObj(name: string): SceneObject {
  const o = new SceneObject(); o.id = nextId++; o.name = name; return o;
}

// ─── Renderer ────────────────────────────────────────────────────────────────
export class Renderer {
  device !: GPUDevice;
  context!: GPUCanvasContext;
  format !: GPUTextureFormat;
  canvas !: HTMLCanvasElement;

  fillPipeline!: GPURenderPipeline;
  wirePipeline!: GPURenderPipeline;
  bindGroupLayout!: GPUBindGroupLayout;

  camUniform  !: GPUBuffer;
  mdlUniform  !: GPUBuffer;
  matUniform  !: GPUBuffer;
  lightUniform!: GPUBuffer;
  depthTex    !: GPUTexture;

  camera     = new OrbitCamera();
  renderMode : RenderMode = 'Phong';
  lightColor : [number,number,number] = [1,1,1];
  scene      : SceneObject[] = [];
  selectedId : number | null = null;

  defaultSampler!: GPUSampler;
  fallbackTex   !: GPUTexture;
  fallbackView  !: GPUTextureView;

  // ── init ──────────────────────────────────────────────────────────────────
  async init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter found.');
    this.device  = await adapter.requestDevice();
    this.context = canvas.getContext('webgpu')!;
    this.format  = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this._buildUniforms();
    await this._buildPipelines();
    this._rebuildDepth();

    this.defaultSampler = this.device.createSampler({
      magFilter:'linear', minFilter:'linear', mipmapFilter:'linear',
      addressModeU:'repeat', addressModeV:'repeat',
    });
    this.fallbackTex = this.device.createTexture({
      size:[1,1,1], format:'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.fallbackTex },
      new Uint8Array([255,255,255,255]),
      { bytesPerRow:4 }, { width:1, height:1 }
    );
    this.fallbackView = this.fallbackTex.createView();
  }

  // ── uniforms ──────────────────────────────────────────────────────────────
  _buildUniforms() {
    const d = this.device;
    this.camUniform   = d.createBuffer({ size:144, usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    this.mdlUniform   = d.createBuffer({ size:128, usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    this.matUniform   = d.createBuffer({ size:48,  usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
    this.lightUniform = d.createBuffer({ size:32,  usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST });
  }

  // ── pipelines (fill + wireframe overlay) ──────────────────────────────────
  async _buildPipelines() {
    const d    = this.device;
    const code = await fetch('/shader.wgsl').then(r => r.text());
    const sh   = d.createShaderModule({ code });

    this.bindGroupLayout = d.createBindGroupLayout({ entries:[
      { binding:0, visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT, buffer:{type:'uniform'} },
      { binding:1, visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT, buffer:{type:'uniform'} },
      { binding:2, visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT, buffer:{type:'uniform'} },
      { binding:3, visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT, buffer:{type:'uniform'} },
      { binding:4, visibility:GPUShaderStage.FRAGMENT, sampler:{type:'filtering'} },
      { binding:5, visibility:GPUShaderStage.FRAGMENT, texture:{sampleType:'float'} },
    ]});

    const layout = d.createPipelineLayout({ bindGroupLayouts:[this.bindGroupLayout] });
    const buffers: GPUVertexBufferLayout[] = [{
      arrayStride: 8*4,
      attributes:[
        { shaderLocation:0, offset:0,  format:'float32x3' },
        { shaderLocation:1, offset:12, format:'float32x3' },
        { shaderLocation:2, offset:24, format:'float32x2' },
      ]
    }];
    const ds: GPUDepthStencilState = { format:'depth24plus', depthWriteEnabled:true, depthCompare:'less' };

    // Solid fill pipeline
    this.fillPipeline = await d.createRenderPipelineAsync({
      layout,
      vertex:   { module:sh, entryPoint:'vs_main', buffers },
      fragment: { module:sh, entryPoint:'fs_main', targets:[{format:this.format}] },
      primitive:{ topology:'triangle-list', cullMode:'back' },
      depthStencil: ds,
    });

    // Wireframe edge pipeline (line-list, no cull → hidden surface handled by depth)
    this.wirePipeline = await d.createRenderPipelineAsync({
      layout,
      vertex:   { module:sh, entryPoint:'vs_wire', buffers },
      fragment: { module:sh, entryPoint:'fs_wire', targets:[{format:this.format}] },
      primitive:{ topology:'line-list' },
      depthStencil:{ format:'depth24plus', depthWriteEnabled:false, depthCompare:'less-equal' },
    });
  }

  _rebuildDepth() {
    if (this.depthTex) this.depthTex.destroy();
    this.depthTex = this.device.createTexture({
      size:[this.canvas.width, this.canvas.height],
      format:'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  // ── bind group per object ─────────────────────────────────────────────────
  _makeBindGroup(obj: SceneObject): GPUBindGroup {
    const tv = (obj.useTexture && obj._texView) ? obj._texView : this.fallbackView;
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries:[
        { binding:0, resource:{ buffer:this.camUniform   } },
        { binding:1, resource:{ buffer:this.mdlUniform   } },
        { binding:2, resource:{ buffer:this.matUniform   } },
        { binding:3, resource:{ buffer:this.lightUniform } },
        { binding:4, resource:this.defaultSampler },
        { binding:5, resource:tv },
      ]
    });
  }

  // ── upload helpers ────────────────────────────────────────────────────────
  _uploadCamera() {
    const eye  = this.camera.getPosition();
    const view = mat4LookAt(eye, this.camera.target, [0,1,0]);
    const proj = mat4Perspective(
      Math.PI/4,
      this.canvas.width / this.canvas.height,
      this.camera.getNear(),
      this.camera.getFar()
    );
    const buf = new Float32Array(36);
    buf.set(view,0); buf.set(proj,16);
    buf[32]=eye[0]; buf[33]=eye[1]; buf[34]=eye[2];
    this.device.queue.writeBuffer(this.camUniform, 0, buf);
  }

  _uploadModel(obj: SceneObject) {
    const model = mat4Mul(
      mat4Translate(obj.translateX, obj.translateY, obj.translateZ),
      mat4Mul(
        mat4RotateY(obj.rotateY * Math.PI/180),
        mat4Mul(
          mat4RotateX(obj.rotateX * Math.PI/180),
          mat4Mul(
            mat4RotateZ(obj.rotateZ * Math.PI/180),
            mat4Scale(obj.scaleX, obj.scaleY, obj.scaleZ)
          )
        )
      )
    );
    const nmat = mat4Transpose(mat4Inverse(model));
    const buf  = new Float32Array(32);
    buf.set(model,0); buf.set(nmat,16);
    this.device.queue.writeBuffer(this.mdlUniform, 0, buf);
  }

  _uploadMaterial(obj: SceneObject) {
    const buf = new Float32Array(12);
    buf[0]=obj.color[0]; buf[1]=obj.color[1]; buf[2]=obj.color[2]; buf[3]=1;
    buf[4]=obj.ka; buf[5]=obj.kd; buf[6]=obj.ks; buf[7]=obj.shininess;
    const dv = new DataView(buf.buffer);
    dv.setUint32(32, MODE_IDX[this.renderMode] ?? 1, true);
    dv.setUint32(36, (obj.useTexture && obj._texView) ? 1 : 0, true);
    this.device.queue.writeBuffer(this.matUniform, 0, buf);
  }

  _uploadLight() {
    // Light placed above-behind the camera (task 8)
    const eye = this.camera.getPosition();
    const buf = new Float32Array(8);
    buf[0]=eye[0]+0; buf[1]=eye[1]+5; buf[2]=eye[2]+3;
    buf[4]=this.lightColor[0]; buf[5]=this.lightColor[1]; buf[6]=this.lightColor[2];
    this.device.queue.writeBuffer(this.lightUniform, 0, buf);
  }

  // ── load OBJ mesh (task 1 + 2 + 3) ──────────────────────────────────────
  async addOBJ(url: string, name='Model', fitCamera=true): Promise<SceneObject> {
    const mesh = await loadOBJMesh(url);
    const obj  = makeObj(name);
    obj.boundCenter = mesh.center;
    obj.boundRadius = mesh.radius;

    this._uploadVerts(obj, mesh);

    this.scene.push(obj);

    // Task 2: auto-fit camera to bounding box
    if (fitCamera) {
      this.camera.fitObject(mesh.center, mesh.radius);
    }

    return obj;
  }

  addSphere(radius = 1, fitCamera = true): SceneObject {
    const mesh = createSphereMesh(radius, 32, 32);
    const obj  = makeObj('Sphere');
    obj.boundCenter = mesh.center;
    obj.boundRadius = mesh.radius;
    this._uploadVerts(obj, mesh);
    this.scene.push(obj);
    if (fitCamera) this.camera.fitObject(mesh.center, mesh.radius);
    return obj;
  }

  addCube(size = 1, fitCamera = true): SceneObject {
    const mesh = createCubeMesh(size);
    const obj  = makeObj('Cube');
    obj.boundCenter = mesh.center;
    obj.boundRadius = mesh.radius;
    this._uploadVerts(obj, mesh);
    this.scene.push(obj);
    if (fitCamera) this.camera.fitObject(mesh.center, mesh.radius);
    return obj;
  }

  _uploadVerts(obj: SceneObject, mesh: IndexedMesh) {
    // Flat triangle-list buffer for fill pass
    const flat = mesh.toFlatBuffer();
    if (obj._vbuf) obj._vbuf.destroy();
    obj._vbuf = this.device.createBuffer({
      size: flat.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(obj._vbuf, 0, flat);
    obj._vcnt = flat.length / 8;

    // Task 11: build edge list for wireframe (each triangle → 3 edges)
    // Hidden surface removal is handled by the depth buffer in the wire pipeline
    const edgeData: number[] = [];
    const idx = mesh.indices;
    for (let f=0; f<idx.length; f+=3) {
      for (const [a,b] of [[idx[f],idx[f+1]],[idx[f+1],idx[f+2]],[idx[f+2],idx[f]]]) {
        const pa = mesh.positions, na = mesh.normals, ua = mesh.uvs;
        edgeData.push(
          pa[a*3],pa[a*3+1],pa[a*3+2], na[a*3],na[a*3+1],na[a*3+2], ua[a*2],ua[a*2+1],
          pa[b*3],pa[b*3+1],pa[b*3+2], na[b*3],na[b*3+1],na[b*3+2], ua[b*2],ua[b*2+1],
        );
      }
    }
    const edgeArr = new Float32Array(edgeData);
    if (obj._wbuf) obj._wbuf.destroy();
    obj._wbuf = this.device.createBuffer({
      size: edgeArr.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(obj._wbuf, 0, edgeArr);
    obj._wcnt = edgeArr.length / 8;
  }

  removeObject(id: number) {
    const idx = this.scene.findIndex(o => o.id===id);
    if (idx<0) return;
    const o = this.scene[idx];
    o._vbuf?.destroy(); o._wbuf?.destroy(); o._texBuf?.destroy();
    this.scene.splice(idx,1);
  }

  async setTexture(obj: SceneObject, bitmap: ImageBitmap) {
    obj._texBuf?.destroy();
    const tex = this.device.createTexture({
      size:[bitmap.width, bitmap.height, 1],
      format:'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source:bitmap },{ texture:tex },[bitmap.width,bitmap.height]);
    obj._texBuf  = tex;
    obj._texView = tex.createView();
    obj.textureData = bitmap;
  }

  // ── render ────────────────────────────────────────────────────────────────
  render() {
    if (this.canvas.width<1 || this.canvas.height<1) return;
    this._uploadCamera();
    this._uploadLight();

    const enc   = this.device.createCommandEncoder();
    const cv    = this.context.getCurrentTexture().createView();
    const dv    = this.depthTex.createView();
    const isWire = this.renderMode === 'Wireframe';

    const pass = enc.beginRenderPass({
      colorAttachments:[{ view:cv, clearValue:{r:0.05,g:0.06,b:0.1,a:1}, loadOp:'clear', storeOp:'store' }],
      depthStencilAttachment:{ view:dv, depthClearValue:1, depthLoadOp:'clear', depthStoreOp:'store' }
    });

    for (const obj of this.scene) {
      if (!obj._vbuf || obj._vcnt===0) continue;
      this._uploadModel(obj);
      const bg = this._makeBindGroup(obj);

      if (isWire) {
        // Task 11: draw solid fill first (writes depth), then wire overlay
        this._uploadMaterial(obj);          // mode=3 → solid fill colour
        pass.setPipeline(this.fillPipeline);
        pass.setBindGroup(0, bg);
        pass.setVertexBuffer(0, obj._vbuf);
        pass.draw(obj._vcnt);

        // Wire edges on top — depth test rejects hidden lines
        if (obj._wbuf && obj._wcnt>0) {
          pass.setPipeline(this.wirePipeline);
          pass.setBindGroup(0, bg);
          pass.setVertexBuffer(0, obj._wbuf);
          pass.draw(obj._wcnt);
        }
      } else {
        this._uploadMaterial(obj);
        pass.setPipeline(this.fillPipeline);
        pass.setBindGroup(0, bg);
        pass.setVertexBuffer(0, obj._vbuf);
        pass.draw(obj._vcnt);
      }
    }

    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
