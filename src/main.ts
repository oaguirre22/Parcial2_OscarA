import { Renderer } from './renderer';
import './style.css';

const renderer = new Renderer();

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.id = 'gpuCanvas';
document.body.appendChild(canvas);

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  if (renderer.depthTex) renderer._rebuildDepth();
}
resize();
window.addEventListener('resize', resize);

// ─── Arcball controls (task 4) ────────────────────────────────────────────────
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', e => { dragging=true; lastX=e.clientX; lastY=e.clientY; e.preventDefault(); });
window.addEventListener('mouseup',   () => dragging = false);
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (renderer.selectedId !== null) {
    const obj = renderer.scene.find(o => o.id === renderer.selectedId);
    if (obj) { obj.rotateY += dx * 0.5; obj.rotateX += dy * 0.5; updatePanel(); }
  } else {
    // Arcball orbit around object center (task 4)
    renderer.camera.orbit(dx, dy);
  }
});
// Zoom (task 9) — scroll moves camera radius (no clipping: near/far auto-adjust)
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  renderer.camera.zoom(e.deltaY * 0.05);
}, { passive: false });

// ─── Build UI ─────────────────────────────────────────────────────────────────
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

ui.innerHTML = `
<div class="panel left-panel">
  <div class="panel-title">PIPELINE</div>

  <div class="section-label">ADD OBJECT</div>
  <div class="add-obj-row">
    <button class="add-btn sphere-btn" id="btnAddSphere">
      <span class="add-icon">●</span> Sphere
    </button>
    <button class="add-btn cube-btn" id="btnAddCube">
      <span class="add-icon">■</span> Cube
    </button>
  </div>
  <div class="add-obj-row">
    <button class="add-btn teapot-btn" id="btnAddTeapot">
      <span class="add-icon">🫖</span> Teapot
    </button>
    <button class="add-btn beacon-btn" id="btnAddBeacon">
      <span class="add-icon">◆</span> Beacon
    </button>
  </div>

  <div class="section-label">ADD OBJ MODEL</div>
  <label class="file-label"><input type="file" id="objFile" accept=".obj">Select .obj file</label>

  <div class="section-label">RENDER MODE (GLOBAL)</div>
  <div class="mode-grid">
    <button class="mode-btn" data-mode="Gouraud">Gouraud</button>
    <button class="mode-btn active" data-mode="Phong">Phong</button>
    <button class="mode-btn" data-mode="Normals">Normals</button>
    <button class="mode-btn" data-mode="Wireframe">Wireframe</button>
    <button class="mode-btn" data-mode="Depth">Depth</button>
    <button class="mode-btn" data-mode="Texture">Texture</button>
    <button class="mode-btn wide" data-mode="UVCoords">UV Coords</button>
  </div>
  <div class="mode-desc" id="modeDesc">Phong: normals interpolated per fragment, lighting per pixel.</div>

  <div class="section-label">GLOBAL LIGHT COLOR</div>
  <div class="color-row"><span>Light</span><input type="color" id="lightColor" value="#ffffff"></div>

  <div class="hint">
    No selection: drag orbits camera<br>
    Object selected: drag rotates object<br>
    Scroll: zoom toward target
  </div>
</div>

<div class="panel right-panel">
  <div class="panel-title">SCENE</div>
  <div id="sceneList"></div>
  <button class="btn deselect-btn" id="btnDeselect">Deselect</button>
  <button class="btn remove-btn"   id="btnRemove">Remove</button>

  <div id="selectionInfo" class="no-sel-info">NO SELECTION — CAMERA ORBIT MODE</div>

  <div id="transformSection" style="display:none">
    <div class="section-label">TRANSFORM</div>
    <div id="transformSliders"></div>
    <div class="section-label">MATERIAL</div>
    <div id="materialSliders"></div>
    <div class="section-label">TEXTURE (SPHERICAL UV)</div>
    <label class="file-label"><input type="file" id="texFile" accept="image/*">Select image</label>
    <label class="checkbox-row"><input type="checkbox" id="useTexture"> Use texture</label>
  </div>
</div>
`;

// ─── Mode descriptions ────────────────────────────────────────────────────────
const modeDescs: Record<string,string> = {
  Gouraud:  'Gouraud: lighting computed per vertex, interpolated.',
  Phong:    'Phong: normals interpolated per fragment, lighting per pixel.',
  Normals:  'Normals: world-space normal buffer as RGB.',
  Wireframe:'Wireframe: edges only, hidden surface removed via depth.',
  Depth:    'Depth: depth buffer visualization.',
  Texture:  'Texture: spherical UV + Blinn-Phong lighting.',
  UVCoords: 'UV Coords: spherical texture coordinates as RG.',
};

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = (btn as HTMLElement).dataset.mode as any;
    renderer.renderMode = mode;
    document.getElementById('modeDesc')!.textContent = modeDescs[mode] ?? '';
  });
});

// ─── Scene list ───────────────────────────────────────────────────────────────
function updateSceneList() {
  const list = document.getElementById('sceneList')!;
  list.innerHTML = '';
  renderer.scene.forEach((obj, i) => {
    const el = document.createElement('div');
    el.className = 'scene-item' + (obj.id === renderer.selectedId ? ' selected' : '');
    el.textContent = `${i+1}. ${obj.name}`;
    el.addEventListener('click', () => { renderer.selectedId = obj.id; updateAll(); });
    list.appendChild(el);
  });
}

// ─── Sliders ──────────────────────────────────────────────────────────────────
const transformDefs = [
  { label:'Translate X', key:'translateX', min:-200, max:200, step:0.1  },
  { label:'Translate Y', key:'translateY', min:-200, max:200, step:0.1  },
  { label:'Translate Z', key:'translateZ', min:-200, max:200, step:0.1  },
  { label:'Rotate X',    key:'rotateX',    min:-180, max:180, step:0.5  },
  { label:'Rotate Y',    key:'rotateY',    min:-180, max:180, step:0.5  },
  { label:'Rotate Z',    key:'rotateZ',    min:-180, max:180, step:0.5  },
  { label:'Scale X',     key:'scaleX',     min:0.001,max:10,  step:0.001},
  { label:'Scale Y',     key:'scaleY',     min:0.001,max:10,  step:0.001},
  { label:'Scale Z',     key:'scaleZ',     min:0.001,max:10,  step:0.001},
];
const materialDefs = [
  { label:'Ambient (Ka)',  key:'ka',        min:0, max:1,   step:0.01 },
  { label:'Diffuse (Kd)',  key:'kd',        min:0, max:1,   step:0.01 },
  { label:'Specular (Ks)', key:'ks',        min:0, max:1,   step:0.01 },
  { label:'Shininess (n)', key:'shininess', min:1, max:128, step:1    },
];

function buildSliders(containerId: string, defs: typeof transformDefs) {
  const container = document.getElementById(containerId)!;
  container.innerHTML = '';
  for (const def of defs) {
    const row = document.createElement('div');
    row.className = 'slider-row';
    row.innerHTML = `<span class="slider-lbl">${def.label}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" data-key="${def.key}">
      <span class="slider-val" data-val="${def.key}">0</span>`;
    container.appendChild(row);
    row.querySelector('input')!.addEventListener('input', e => {
      const obj = getSelected(); if (!obj) return;
      const v = parseFloat((e.target as HTMLInputElement).value);
      (obj as any)[def.key] = v;
      row.querySelector<HTMLElement>(`[data-val="${def.key}"]`)!.textContent = v.toFixed(3);
    });
  }
  if (containerId === 'materialSliders') {
    const cr = document.createElement('div');
    cr.className = 'color-row mat';
    cr.innerHTML = `<span>Object color</span><input type="color" id="objColor" value="#4592d2">`;
    container.appendChild(cr);
    document.getElementById('objColor')!.addEventListener('input', e => {
      const obj = getSelected(); if (!obj) return;
      const hex = (e.target as HTMLInputElement).value;
      obj.color = [
        parseInt(hex.slice(1,3),16)/255,
        parseInt(hex.slice(3,5),16)/255,
        parseInt(hex.slice(5,7),16)/255,
      ];
    });
  }
}

buildSliders('transformSliders', transformDefs);
buildSliders('materialSliders',  materialDefs);

function updatePanel() {
  const obj  = getSelected();
  const info = document.getElementById('selectionInfo')!;
  const sec  = document.getElementById('transformSection')!;
  if (!obj) {
    info.textContent   = 'NO SELECTION — CAMERA ORBIT MODE';
    info.style.display = 'block';
    sec.style.display  = 'none';
    return;
  }
  info.style.display = 'none';
  sec.style.display  = 'block';
  [...transformDefs, ...materialDefs].forEach(def => {
    const inp = document.querySelector<HTMLInputElement>(`input[data-key="${def.key}"]`);
    const val = document.querySelector<HTMLElement>(`[data-val="${def.key}"]`);
    if (inp && val) {
      inp.value       = String((obj as any)[def.key]);
      val.textContent = Number((obj as any)[def.key]).toFixed(3);
    }
  });
  const oc = document.getElementById('objColor') as HTMLInputElement|null;
  if (oc) {
    const h = (v:number) => Math.round(v*255).toString(16).padStart(2,'0');
    oc.value = `#${h(obj.color[0])}${h(obj.color[1])}${h(obj.color[2])}`;
  }
  const utx = document.getElementById('useTexture') as HTMLInputElement;
  if (utx) utx.checked = obj.useTexture;
}

function updateAll() { updateSceneList(); updatePanel(); }
function getSelected() { return renderer.scene.find(o => o.id === renderer.selectedId) ?? null; }

// ─── Buttons ──────────────────────────────────────────────────────────────────
document.getElementById('btnDeselect')!.addEventListener('click', () => {
  renderer.selectedId = null; updateAll();
});
document.getElementById('btnRemove')!.addEventListener('click', () => {
  if (renderer.selectedId === null) return;
  renderer.removeObject(renderer.selectedId);
  renderer.selectedId = null;
  updateAll();
});

// ─── Add Sphere / Cube ────────────────────────────────────────────────────────
document.getElementById('btnAddSphere')!.addEventListener('click', () => {
  const obj = renderer.addSphere(1, true);
  renderer.selectedId = obj.id;
  updateAll();
});
document.getElementById('btnAddCube')!.addEventListener('click', () => {
  const obj = renderer.addCube(1, true);
  renderer.selectedId = obj.id;
  updateAll();
});

document.getElementById('btnAddTeapot')!.addEventListener('click', async () => {
  const obj = await renderer.addOBJ('/teapot.obj', 'Teapot', true);
  renderer.selectedId = obj.id;
  updateAll();
});
document.getElementById('btnAddBeacon')!.addEventListener('click', async () => {
  const obj = await renderer.addOBJ('/KAUST_Beacon.obj', 'KAUST_Beacon', true);
  renderer.selectedId = obj.id;
  updateAll();
});

// ─── OBJ file (only OBJ supported, task 1) ───────────────────────────────────
document.getElementById('objFile')!.addEventListener('change', async e => {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  const url  = URL.createObjectURL(file);
  const name = file.name.replace(/\.obj$/i, '');
  const obj  = await renderer.addOBJ(url, name, true);
  renderer.selectedId = obj.id;
  updateAll();
  (e.target as HTMLInputElement).value = '';
});

// ─── Texture (task 10) ───────────────────────────────────────────────────────
document.getElementById('texFile')!.addEventListener('change', async e => {
  const file = (e.target as HTMLInputElement).files?.[0];
  const obj  = getSelected(); if (!file || !obj) return;
  const bmp  = await createImageBitmap(file);
  await renderer.setTexture(obj, bmp);
  updateAll();
});
document.getElementById('useTexture')!.addEventListener('change', e => {
  const obj = getSelected(); if (!obj) return;
  obj.useTexture = (e.target as HTMLInputElement).checked;
});

// ─── Light color ──────────────────────────────────────────────────────────────
document.getElementById('lightColor')!.addEventListener('input', e => {
  const hex = (e.target as HTMLInputElement).value;
  renderer.lightColor = [
    parseInt(hex.slice(1,3),16)/255,
    parseInt(hex.slice(3,5),16)/255,
    parseInt(hex.slice(5,7),16)/255,
  ];
});

// ─── Init + loop ──────────────────────────────────────────────────────────────
(async () => {
  try {
    await renderer.init(canvas);
    updateAll();
    function loop() { renderer.render(); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  } catch(err) {
    document.body.innerHTML = `<div style="color:#f88;font-family:monospace;padding:2em;font-size:1.1em">
      WebGPU error: ${err}<br><br>Requires Chrome 113+ with WebGPU enabled.</div>`;
  }
})();
