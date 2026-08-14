'use strict';

/* ============================================================
   VELOCITY RUSH — 3D phone-controlled street racing
   Runs on the laptop screen. Phones join as joysticks by
   scanning the QR code shown on the start screen.
   ============================================================ */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CFG = {
  trackA: 130,          // ellipse semi-axis along X
  trackB: 85,           // ellipse semi-axis along Z
  roadHalf: 8,          // half road width
  maxSpeed: 46,         // m/s on asphalt
  maxSpeedOffroad: 15,
  engineAccel: 24,
  brakeDecel: 34,
  reverseAccel: 11,
  reverseMax: 9,
  steerRate: 2.35,      // rad/s at reference speed
  grip: 7.0,            // lateral grip (per second)
  gripHandbrake: 1.6,
  carRadius: 1.25
};

const $ = (id) => document.getElementById(id);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmtTime = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe0ea);
scene.fog = new THREE.Fog(0xcfe0ea, 260, 900);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2600);
camera.position.set(CFG.trackA - 3, 3.4, -14);

// Environment map (simple gradient) gives the paint its shine
function makeEnvTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, '#2f66c4');
  grad.addColorStop(0.45, '#bcd8f2');
  grad.addColorStop(0.55, '#9fb4c4');
  grad.addColorStop(1.0, '#43503f');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  const sun = g.createRadialGradient(190, 42, 2, 190, 42, 34);
  sun.addColorStop(0, 'rgba(255,250,225,0.95)');
  sun.addColorStop(1, 'rgba(255,250,225,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;
  pmrem.dispose();
}

// Lights
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x3c5a34, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
sun.position.set(190, 280, 130);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -280; sun.shadow.camera.right = 280;
sun.shadow.camera.top = 250;   sun.shadow.camera.bottom = -250;
sun.shadow.camera.near = 40;   sun.shadow.camera.far = 900;
sun.shadow.bias = -0.00045;
scene.add(sun, sun.target);

// Sky dome
{
  const geo = new THREE.SphereGeometry(1500, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top:     { value: new THREE.Color(0x2f66c4) },
      horizon: { value: new THREE.Color(0xd7e6ef) },
      bottom:  { value: new THREE.Color(0x9aa89b) }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      void main() {
        float h = normalize(vWorld).y;
        vec3 c = h > 0.0
          ? mix(horizon, top, pow(h, 0.55))
          : mix(horizon, bottom, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// Sun glare sprite
{
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,252,235,1)');
  grad.addColorStop(0.25, 'rgba(255,244,200,0.85)');
  grad.addColorStop(1, 'rgba(255,244,200,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.position.copy(sun.position).normalize().multiplyScalar(1300);
  spr.scale.set(220, 220, 1);
  scene.add(spr);
}

// ---------------------------------------------------------------------------
// Ground + circuit
// ---------------------------------------------------------------------------
const A = CFG.trackA, B = CFG.trackB, RH = CFG.roadHalf;

{
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1500, 64),
    new THREE.MeshStandardMaterial({ color: 0x4d7c3f, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function ellipseRing(rIn, rOut, segments) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, A + rOut, B + rOut, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, A + rIn, B + rIn, 0, Math.PI * 2, true, 0);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape, segments || 96);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// Asphalt with subtle speckle
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#33373d'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) {
    const v = 45 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.12, 0.12);
  tex.anisotropy = 4;
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

{
  const road = new THREE.Mesh(
    ellipseRing(-RH, RH, 128),
    new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0.05 })
  );
  road.position.y = 0.02;
  road.receiveShadow = true;
  scene.add(road);

  // edge lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.8 });
  for (const off of [RH - 0.9, -RH + 0.55]) {
    const line = new THREE.Mesh(ellipseRing(off, off + 0.35, 128), lineMat);
    line.position.y = 0.045;
    scene.add(line);
  }
}

// Center dashed line (instanced)
{
  const geo = new THREE.BoxGeometry(0.32, 0.03, 2.4);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2e14c, roughness: 0.7 });
  const STEPS = 160, dashes = [];
  for (let i = 0; i < STEPS; i++) {
    if (i % 4 >= 2) continue;
    const t = (i / STEPS) * Math.PI * 2;
    const x = A * Math.cos(t), z = B * Math.sin(t);
    const yaw = Math.atan2(-A * Math.sin(t), B * Math.cos(t));
    dashes.push({ x, z, yaw });
  }
  const inst = new THREE.InstancedMesh(geo, mat, dashes.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  dashes.forEach((d, i) => {
    q.setFromAxisAngle(up, d.yaw);
    m.compose(new THREE.Vector3(d.x, 0.05, d.z), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m);
  });
  scene.add(inst);
}

// Start / finish checkered line
{
  const c = document.createElement('canvas'); c.width = 160; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? '#101010' : '#f4f4f4';
    g.fillRect(i * 16, j * 16, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.encoding = THREE.sRGBEncoding;
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(RH * 2, 2.6),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(A, 0.06, 0);
  scene.add(line);
}

// ---------------------------------------------------------------------------
// Scenery: buildings, trees, mountains, billboard  (colliders collected here)
// ---------------------------------------------------------------------------
const obstacles = []; // {x, z, r}

function radialDistToTrack(x, z) {
  const t = Math.atan2(z, x);
  const re = (A * B) / Math.hypot(B * Math.cos(t), A * Math.sin(t));
  return { re, d: Math.hypot(x, z) - re };
}

function buildingTexture(seed) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = ['#22303e', '#2c2a33', '#3a3f47'][seed % 3];
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 10) {
    for (let x = 5; x < 58; x += 10) {
      const r = Math.random();
      g.fillStyle = r < 0.24 ? '#ffd97a' : (r < 0.55 ? '#5f7488' : '#1b2530');
      g.fillRect(x, y, 6, 7);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

const buildingMats = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({ map: buildingTexture(i), roughness: 0.9 }));
const roofMat = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.95 });

{
  let placed = 0, attempts = 0;
  while (placed < 34 && attempts++ < 400) {
    const t = Math.random() * Math.PI * 2;
    const off = 22 + Math.random() * 100;
    const re = (A * B) / Math.hypot(B * Math.cos(t), A * Math.sin(t));
    const r = re + off;
    const x = Math.cos(t) * r, z = Math.sin(t) * r;
    const w = 8 + Math.random() * 10, d = 8 + Math.random() * 10, h = 10 + Math.random() * 26;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + Math.hypot(w, d) / 2 + 4)) continue;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [buildingMats[placed % 3], buildingMats[(placed + 1) % 3], roofMat, roofMat, buildingMats[(placed + 2) % 3], buildingMats[placed % 3]]
    );
    mesh.position.set(x, h / 2, z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    obstacles.push({ x, z, r: Math.hypot(w, d) / 2 * 0.92 });
    placed++;
  }
}

{
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.7, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1, flatShading: true });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x3d8040, roughness: 1, flatShading: true });
  const cone1 = new THREE.ConeGeometry(1.9, 4.4, 7);
  const cone2 = new THREE.ConeGeometry(1.35, 3.1, 7);

  let placed = 0, attempts = 0;
  while (placed < 130 && attempts++ < 900) {
    const t = Math.random() * Math.PI * 2;
    const inside = Math.random() < 0.42;
    const re = (A * B) / Math.hypot(B * Math.cos(t), A * Math.sin(t));
    const off = inside ? -(RH + 6 + Math.random() * 48) : (RH + 6 + Math.random() * 85);
    const r = re + off;
    if (r < 6) continue;
    const x = Math.cos(t) * r, z = Math.sin(t) * r;
    if (Math.abs(x - A) < 24 && Math.abs(z) < 24) continue;              // keep start area clean
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3.2)) continue;
    const s = 0.75 + Math.random() * 0.9;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 0.85;
    const l1 = new THREE.Mesh(cone1, placed % 2 ? leafMat : leafMat2); l1.position.y = 3.4;
    const l2 = new THREE.Mesh(cone2, leafMat); l2.position.y = 5.3;
    tree.add(trunk, l1, l2);
    tree.scale.setScalar(s);
    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI;
    tree.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(tree);
    obstacles.push({ x, z, r: 0.9 * s });
    placed++;
  }
}

// Distant mountains
for (let i = 0; i < 14; i++) {
  const t = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
  const dist = 680 + Math.random() * 280;
  const h = 120 + Math.random() * 190;
  const mtn = new THREE.Mesh(
    new THREE.ConeGeometry(90 + Math.random() * 110, h, 5),
    new THREE.MeshStandardMaterial({ color: 0x8598ab, roughness: 1, flatShading: true })
  );
  mtn.position.set(Math.cos(t) * dist, h / 2 - 6, Math.sin(t) * dist);
  mtn.rotation.y = Math.random() * Math.PI;
  scene.add(mtn);
}

// Billboard near the start line
{
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0c1020'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#2b355c'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#ff5252'; g.font = '900 58px Arial Black, Arial'; g.textAlign = 'center';
  g.fillText('VELOCITY RUSH', 256, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 5),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 })
  );
  board.position.set(A + 16, 4.4, 14);
  board.rotation.y = -Math.PI / 2 + 0.25;
  board.castShadow = true;
  scene.add(board);
  const legGeo = new THREE.CylinderGeometry(0.16, 0.16, 4.4, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x444a55, roughness: 0.8 });
  for (const dx of [-7, 7]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(A + 16 - dx * Math.cos(0.25), 2.2, 14 + dx * Math.sin(0.25) * -1);
    leg.castShadow = true;
    scene.add(leg);
  }
  obstacles.push({ x: A + 16, z: 14, r: 4 });
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------
function createCar(paintColor) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  const paint = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.8, roughness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x12161d, metalness: 0.95, roughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121317, metalness: 0.35, roughness: 0.75 });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.4), paint);
  hull.position.y = 0.55;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.3, 1.5), paint);
  hood.position.set(0, 0.62, 1.6);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), glass);
  cabin.position.set(0, 1.03, -0.3);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.09, 1.85), paint);
  roof.position.set(0, 1.31, -0.32);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.24, 3.9), dark);
  skirt.position.y = 0.3;
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.34, 0.5), dark);
  bumperF.position.set(0, 0.36, 2.28);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.34, 0.4), dark);
  bumperR.position.set(0, 0.4, -2.3);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.5), dark);
  spoiler.position.set(0, 1.06, -2.1);
  body.add(hull, hood, cabin, roof, skirt, bumperF, bumperR, spoiler);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xffeeb0, emissiveIntensity: 1.8 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xdd1111, emissiveIntensity: 1.4 });
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.13, 0.08), headMat);
    head.position.set(sx, 0.64, 2.33);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.08), tailMat);
    tail.position.set(sx, 0.66, -2.36);
    body.add(head, tail);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.27, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.9, roughness: 0.3 });

  const wheels = [];
  [[0.98, 1.45], [-0.98, 1.45], [0.98, -1.45], [-0.98, -1.45]].forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.35, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(hubGeo, hubMat));
    pivot.add(spin);
    g.add(pivot);
    wheels.push({ pivot, spin, front: i < 2 });
  });

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, body, wheels };
}

class Car {
  constructor(slot, paint, startX) {
    this.slot = slot;
    this.startX = startX;
    this.visual = createCar(paint);
    scene.add(this.visual.group);
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    this.reset();
    this.lap = 0;
    this.lapStart = 0;
    this.lastLap = null;
    this.best = null;
    this.progress = 0;
    this.lastPhi = null;
    this.lastInputAt = -1e9;
  }

  reset() {
    this.pos = new THREE.Vector3(this.startX, 0, -5);
    this.heading = 0;
    this.vel = new THREE.Vector2(0, 0);
    this.spinAngle = 0;
    this.slip = 0;
    this.progress = 0;
    this.lastPhi = null;
    this.lapStart = raceTime;
  }

  isOffroad() {
    const { re, d } = radialDistToTrack(this.pos.x, this.pos.z);
    return Math.abs(d) > RH + 0.7;
  }

  update(dt, time) {
    const inp = this.input;
    const dir = new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
    const right = new THREE.Vector2(dir.y, -dir.x);

    let speed = this.vel.dot(dir);
    const offroad = this.isOffroad();

    let acc = 0;
    if (inp.throttle > 0.02) acc += inp.throttle * CFG.engineAccel;
    if (inp.brake > 0.02) acc += speed > 0.6 ? -inp.brake * CFG.brakeDecel : -inp.brake * CFG.reverseAccel;
    acc -= speed * 0.36;                                   // aero drag
    acc -= Math.sign(speed) * Math.min(Math.abs(speed), 1.7); // rolling resistance
    if (offroad) acc -= speed * 1.5;                       // grass drag

    this.vel.x += dir.x * acc * dt;
    this.vel.y += dir.y * acc * dt;

    // top-speed clamp
    speed = this.vel.dot(dir);
    const cap = speed >= 0 ? (offroad ? CFG.maxSpeedOffroad : CFG.maxSpeed) : -CFG.reverseMax;
    if ((speed > 0 && speed > cap) || (speed < 0 && speed < cap)) {
      this.vel.x -= dir.x * (speed - cap);
      this.vel.y -= dir.y * (speed - cap);
      speed = cap;
    }

    // tire grip: bleed lateral velocity (less with handbrake -> drifts)
    const lat = this.vel.dot(right);
    const grip = inp.handbrake ? CFG.gripHandbrake : CFG.grip;
    const latAfter = lat * Math.max(0, 1 - grip * dt);
    const fwd = this.vel.dot(dir);
    this.vel.x = dir.x * fwd + right.x * latAfter;
    this.vel.y = dir.y * fwd + right.y * latAfter;
    this.slip = Math.abs(lat);

    // steering
    const speedFactor = clamp(Math.abs(fwd) / 7, 0, 1);
    const agility = CFG.steerRate * speedFactor / (1 + Math.abs(fwd) * 0.022);
    let yaw = inp.steer * agility * (fwd >= 0 ? 1 : -1);
    if (inp.handbrake) yaw *= 1.5;
    // camera looks along +z, where screen-right is world -x:
    // positive steer (right) must decrease the heading
    this.heading -= yaw * dt;

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // obstacle collisions
    for (const o of obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const rr = o.r + CFG.carRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        this.pos.x = o.x + nx * rr;
        this.pos.z = o.z + nz * rr;
        const vn = this.vel.x * nx + this.vel.y * nz;
        if (vn < 0) {
          this.vel.x -= nx * vn * 1.5;
          this.vel.y -= nz * vn * 1.5;
          this.vel.multiplyScalar(0.55);
        }
      }
    }

    // world bounds
    const dc = Math.hypot(this.pos.x, this.pos.z);
    if (dc > 900) {
      this.pos.x *= 900 / dc;
      this.pos.z *= 900 / dc;
      this.vel.multiplyScalar(0.5);
    }

    // lap progress (eccentric anomaly around the ellipse)
    const phi = Math.atan2(this.pos.z / B, this.pos.x / A);
    if (this.lastPhi != null) {
      let dphi = phi - this.lastPhi;
      if (dphi > Math.PI) dphi -= Math.PI * 2;
      if (dphi < -Math.PI) dphi += Math.PI * 2;
      this.progress += dphi;
    }
    this.lastPhi = phi;
    if (this.progress >= Math.PI * 2 - 1e-3) {
      const t = time - this.lapStart;
      this.lastLap = t;
      if (this.best == null || t < this.best) this.best = t;
      this.lap++;
      this.lapStart = time;
      this.progress -= Math.PI * 2;
      toast(`P${this.slot} completed lap ${this.lap} — ${fmtTime(t)}${this.best === t ? '  ★ BEST' : ''}`);
    } else if (this.progress <= -(Math.PI * 2)) {
      this.progress += Math.PI * 2;   // drove a full lap backwards: forgive
    }

    // ----- visuals -----
    const v = this.visual;
    v.group.position.copy(this.pos);
    v.group.rotation.y = this.heading;

    const targetRoll = clamp(-latAfter * 0.042, -0.16, 0.16);
    const targetPitch = clamp(-acc * 0.008, -0.06, 0.075);
    v.body.rotation.z = lerp(v.body.rotation.z, targetRoll, Math.min(1, dt * 8));
    v.body.rotation.x = lerp(v.body.rotation.x, targetPitch, Math.min(1, dt * 6));

    this.spinAngle += fwd * dt / 0.35;
    for (const w of v.wheels) {
      w.spin.rotation.x = this.spinAngle;
      if (w.front) w.pivot.rotation.y = -inp.steer * 0.42;
    }

    // drift smoke
    if (this.slip > 4.5 && Math.abs(fwd) > 6 && v.group.visible) {
      for (const w of v.wheels) {
        if (!w.front && Math.random() < 0.55) {
          const wp = new THREE.Vector3();
          w.spin.getWorldPosition(wp);
          spawnSmoke(wp, this.vel);
        }
      }
    }
  }

  speedKmh() { return Math.abs(this.vel.dot(new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)))) * 3.6; }
}

let raceTime = 0;
const car1 = new Car(1, 0xd7263d, A - 2.8);
const car2 = new Car(2, 0x1f7ae0, A + 2.8);

// ---------------------------------------------------------------------------
// Drift smoke particles
// ---------------------------------------------------------------------------
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const smokeTex = radialTexture();
const smokePool = [];
for (let i = 0; i < 80; i++) {
  const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.visible = false;
  scene.add(spr);
  smokePool.push({ spr, mat, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
}

function spawnSmoke(wp, vel) {
  const p = smokePool.find((s) => s.life <= 0);
  if (!p) return;
  p.life = p.maxLife = 0.7 + Math.random() * 0.5;
  p.spr.position.set(wp.x + (Math.random() - 0.5) * 0.4, 0.3, wp.z + (Math.random() - 0.5) * 0.4);
  p.vx = vel.x * 0.22 + (Math.random() - 0.5) * 1.6;
  p.vz = vel.y * 0.22 + (Math.random() - 0.5) * 1.6;
  p.vy = 0.8 + Math.random() * 1.2;
  p.spr.scale.setScalar(0.9 + Math.random() * 0.6);
  p.spr.visible = true;
}

function updateSmoke(dt) {
  for (const p of smokePool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.spr.visible = false; p.mat.opacity = 0; continue; }
    p.spr.position.x += p.vx * dt;
    p.spr.position.y += p.vy * dt;
    p.spr.position.z += p.vz * dt;
    p.vx *= (1 - 1.6 * dt); p.vz *= (1 - 1.6 * dt);
    p.spr.scale.addScalar(dt * 3.2);
    p.mat.opacity = 0.34 * (p.life / p.maxLife);
  }
}

// ---------------------------------------------------------------------------
// Input — keyboard + phone controllers
// ---------------------------------------------------------------------------
const keys = new Set();
let MODE = 'race';   // 'race' (2 cars) | 'coop' (1 car, two drivers)

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  ensureAudio();
  if (!$('overlay').classList.contains('hidden') && (e.code === 'Enter' || e.code === 'Space')) startGame();
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') { car1.reset(); if (MODE === 'race') car2.reset(); }
  if (e.code === 'KeyM') setMode(MODE === 'race' ? 'coop' : 'race');
  if (e.code === 'KeyH') $('overlay').classList.toggle('hidden');
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardInput() {
  const steer = (keys.has('ArrowLeft') || keys.has('KeyA') ? -1 : 0) + (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
  const throttle = (keys.has('ArrowUp') || keys.has('KeyW')) ? 1 : 0;
  const brake = (keys.has('ArrowDown') || keys.has('KeyS')) ? 1 : 0;
  return { steer, throttle, brake, handbrake: keys.has('Space') };
}

const ctrlInput = { 1: null, 2: null };   // latest packet per slot
const ctrlConnected = { 1: false, 2: false };

function freshInput(slot) {
  const p = ctrlInput[slot];
  return p && (performance.now() - p.t < 450) ? p : null;
}

function applyInputs() {
  const kb = keyboardInput();
  const kbActive = kb.steer !== 0 || kb.throttle !== 0 || kb.brake !== 0 || kb.handbrake;
  if (kbActive) car1.lastInputAt = performance.now();

  const p1 = freshInput(1), p2 = freshInput(2);
  const zero = { steer: 0, throttle: 0, brake: 0, handbrake: false };

  if (MODE === 'coop') {
    car1.input = {
      steer: kbActive ? kb.steer : (p1 ? p1.steer : 0),
      throttle: kbActive ? kb.throttle : (p2 ? p2.throttle : 0),
      brake: kbActive ? kb.brake : (p2 ? p2.brake : 0),
      handbrake: kb.handbrake || (p1 && p1.handbrake) || (p2 && p2.handbrake)
    };
    if (p1 || p2) car1.lastInputAt = performance.now();
  } else {
    car1.input = p1 ? p1 : kb;
    car2.input = p2 || zero;
    if (p1) car1.lastInputAt = performance.now();
    if (p2) car2.lastInputAt = performance.now();
  }
}

function focusCar() {
  if (MODE === 'coop') return car1;
  return car2.lastInputAt > car1.lastInputAt && car2.lastInputAt > performance.now() - 3000 ? car2 : car1;
}

// ---------------------------------------------------------------------------
// Networking (screen role)
// ---------------------------------------------------------------------------
const net = new NetLink('screen', {
  onWelcome(msg) {
    (msg.controllers || []).forEach((s) => setConnected(s, true, true));
    setNetBanner(true);
  },
  onMessage(msg) {
    switch (msg.type) {
      case 'controller-joined':
        ctrlInput[msg.slot] = null;
        setConnected(msg.slot, true);
        toast(`📱 Player ${msg.slot} controller connected`);
        break;
      case 'controller-left':
        setConnected(msg.slot, false);
        toast(`Player ${msg.slot} controller disconnected`);
        break;
      case 'input':
        ctrlInput[msg.slot] = {
          steer: clamp(msg.steer || 0, -1, 1),
          throttle: clamp(msg.throttle || 0, 0, 1),
          brake: clamp(msg.brake || 0, 0, 1),
          handbrake: !!msg.handbrake,
          t: performance.now()
        };
        break;
      case 'button':
        if (msg.pressed === false) break;
        if (msg.action === 'cam') cycleCamera();
        else if (msg.action === 'horn') playHorn();
        else if (msg.action === 'reset') {
          if (MODE === 'coop') car1.reset();
          else if (msg.slot === 1) car1.reset(); else car2.reset();
        }
        break;
    }
  },
  onStatus(s) { setNetBanner(s === 'connected'); }
});
net.connect();

function setConnected(slot, on, silent) {
  ctrlConnected[slot] = on;
  const pill = $(`pill-p${slot}`);
  if (pill) pill.classList.toggle('on', on);
  if (!silent) updateModeLabels();
}

function setNetBanner(ok) {
  $('net-banner').classList.toggle('hidden', ok);
}

// telemetry to phones
setInterval(() => {
  if (!net.isOpen()) return;
  const dataFor = (car) => ({
    speed: Math.round(car.speedKmh()),
    lap: car.lap,
    lastLap: car.lastLap != null ? fmtTime(car.lastLap) : null,
    best: car.best != null ? fmtTime(car.best) : null,
    mode: MODE
  });
  if (MODE === 'coop') {
    net.send({ type: 'telemetry', slot: 1, data: dataFor(car1) });
    net.send({ type: 'telemetry', slot: 2, data: dataFor(car1) });
  } else {
    net.send({ type: 'telemetry', slot: 1, data: dataFor(car1) });
    net.send({ type: 'telemetry', slot: 2, data: dataFor(car2) });
  }
}, 140);

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
let camMode = 0;                 // 0 chase, 1 far, 2 hood
const lookTarget = new THREE.Vector3(A - 2.8, 1, 0);

function cycleCamera() { camMode = (camMode + 1) % 3; }

function updateCamera(dt) {
  const car = focusCar();
  const dir = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  let desired, look;
  if (camMode === 0) {
    desired = car.pos.clone().addScaledVector(dir, -8.2).add(new THREE.Vector3(0, 3.2, 0));
    look = car.pos.clone().addScaledVector(dir, 5).add(new THREE.Vector3(0, 1.1, 0));
  } else if (camMode === 1) {
    desired = car.pos.clone().addScaledVector(dir, -14).add(new THREE.Vector3(0, 6.2, 0));
    look = car.pos.clone().addScaledVector(dir, 2).add(new THREE.Vector3(0, 1, 0));
  } else {
    desired = car.pos.clone().addScaledVector(dir, 0.4).add(new THREE.Vector3(0, 1.18, 0));
    look = car.pos.clone().addScaledVector(dir, 40).add(new THREE.Vector3(0, 1.0, 0));
  }
  desired.y = Math.max(desired.y, 0.5);
  const k = camMode === 2 ? 1 : 1 - Math.exp(-5.2 * dt);
  camera.position.lerp(desired, k);
  lookTarget.lerp(look, 1 - Math.exp(-9 * dt));
  camera.lookAt(lookTarget);
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
let audio = null;
function ensureAudio() {
  if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);

  const engines = [0, 1].map(() => {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
    o1.start(); o2.start();
    return { o1, o2, g, lp };
  });

  // skid noise
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.9;
  const skidGain = ctx.createGain(); skidGain.gain.value = 0;
  noise.connect(bp); bp.connect(skidGain); skidGain.connect(master);
  noise.start();

  audio = { ctx, master, engines, skidGain };
}

function playHorn() {
  ensureAudio();
  if (!audio) return;
  const ctx = audio.ctx;
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 415;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  o.connect(g); g.connect(audio.master);
  o.start(); o.stop(ctx.currentTime + 0.4);
}

function updateAudio(dt) {
  if (!audio) return;
  if (audio.ctx.state === 'suspended') { audio.ctx.resume(); return; }
  const t = audio.ctx.currentTime;
  const focus = focusCar();
  [car1, car2].forEach((car, i) => {
    const e = audio.engines[i];
    const sp = clamp(Math.abs(car.vel.length()) / CFG.maxSpeed, 0, 1);
    const gear = Math.min(4, Math.floor(sp * 5));
    const frac = sp * 5 - gear;
    const rpm = 0.22 + 0.78 * frac;
    const freq = 52 + rpm * 165 + sp * 46;
    e.o1.frequency.setTargetAtTime(freq, t, 0.05);
    e.o2.frequency.setTargetAtTime(freq * 0.5 + 1, t, 0.05);
    e.lp.frequency.setTargetAtTime(500 + sp * 1600 + car.input.throttle * 900, t, 0.1);
    let vol = 0.035 + car.input.throttle * 0.13 + sp * 0.05;
    if (car !== focus) {
      const dist = camera.position.distanceTo(car.pos);
      vol *= clamp(1 - dist / 160, 0, 1) * 0.8;
    }
    if (!car.visual.group.visible) vol = 0;
    e.g.gain.setTargetAtTime(vol, t, 0.08);
  });
  const f = focus;
  const skidAmt = (f.slip > 4.5 && f.vel.length() > 6) ? clamp(f.slip * 0.018, 0, 0.2) : 0;
  audio.skidGain.gain.setTargetAtTime(skidAmt, t, 0.06);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

const minimap = $('minimap');
const mctx = minimap.getContext('2d');
const MSCALE = 62 / (A + RH + 4);

function drawMinimap() {
  const w = minimap.width, h = minimap.height;
  mctx.clearRect(0, 0, w, h);
  mctx.save();
  mctx.translate(w / 2, h / 2);
  mctx.strokeStyle = 'rgba(255,255,255,0.16)';
  mctx.lineWidth = (RH * 2) * MSCALE;
  mctx.beginPath();
  mctx.ellipse(0, 0, A * MSCALE, B * MSCALE, 0, 0, Math.PI * 2);
  mctx.stroke();
  mctx.strokeStyle = 'rgba(255,255,255,0.5)';
  mctx.lineWidth = 1;
  mctx.stroke();
  // start line
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 2;
  mctx.beginPath();
  mctx.moveTo((A - RH) * MSCALE, 0);
  mctx.lineTo((A + RH) * MSCALE, 0);
  mctx.stroke();
  for (const car of [car1, car2]) {
    if (!car.visual.group.visible) continue;
    mctx.fillStyle = car.slot === 1 ? '#ff5252' : '#42a5f5';
    mctx.beginPath();
    mctx.arc(car.pos.x * MSCALE, car.pos.z * MSCALE, 3.4, 0, Math.PI * 2);
    mctx.fill();
  }
  mctx.restore();
}

function updateHUD() {
  const car = focusCar();
  const speed = car.speedKmh();
  $('speed-val').textContent = Math.round(speed);
  const fwd = car.vel.dot(new THREE.Vector2(Math.sin(car.heading), Math.cos(car.heading)));
  $('gear').textContent = fwd < -0.5 ? 'R' : (Math.abs(fwd) < 0.4 && car.input.throttle < 0.05 ? 'N' : 'D');

  const row = (c) => {
    const cur = raceTime - c.lapStart;
    return `L${c.lap + 1}  ${fmtTime(c.lastLap)}  <span class="dim">best ${fmtTime(c.best)}</span>`;
  };
  $('lap-p1').innerHTML = `<b style="color:#ff6b6b">P1</b> ${row(car1)}`;
  if (MODE === 'race') {
    $('lap-p2').style.display = '';
    $('lap-p2').innerHTML = `<b style="color:#64b5f6">P2</b> ${row(car2)}`;
  } else {
    $('lap-p2').style.display = 'none';
  }

  drawMinimap();
}

function updateModeLabels() {
  const pill1 = $('pill-p1'), pill2 = $('pill-p2');
  if (MODE === 'coop') {
    pill1.querySelector('span').textContent = 'P1 STEER';
    pill2.querySelector('span').textContent = 'P2 PEDALS';
  } else {
    pill1.querySelector('span').textContent = 'PLAYER 1';
    pill2.querySelector('span').textContent = 'PLAYER 2';
  }
}

// ---------------------------------------------------------------------------
// Overlay / QR / start
// ---------------------------------------------------------------------------
function drawQR() {
  const url = location.origin + '/controller';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const canvas = $('qr-canvas');
    const px = Math.floor(196 / n);
    const size = px * n;
    canvas.width = canvas.height = size + px * 4;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#101014';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) g.fillRect((c + 2) * px, (r + 2) * px, px, px);
      }
    }
    $('ctrl-url').textContent = url;
  } catch (e) {
    $('ctrl-url').textContent = url;
  }
}

function setMode(mode) {
  MODE = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  car2.visual.group.visible = (mode === 'race');
  $('mode-desc').textContent = mode === 'race'
    ? 'Each phone drives its own car. Race your friend!'
    : 'One car, two drivers: P1 steers, P2 handles throttle & brake.';
  updateModeLabels();
}

let started = false;
function startGame() {
  ensureAudio();
  $('overlay').classList.add('hidden');
  if (!started) {
    started = true;
    raceTime = 0;
    car1.reset(); car2.reset();
  }
}

$('start-btn').addEventListener('click', startGame);
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});
$('qr-open').addEventListener('click', () => window.open(location.origin + '/controller', '_blank'));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('pointerdown', ensureAudio, { passive: true });

drawQR();
setMode('race');

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  let dt = clock.getDelta();
  dt = Math.min(dt, 0.05);
  if (started) raceTime += dt;

  applyInputs();
  car1.update(dt, raceTime);
  if (MODE === 'race') car2.update(dt, raceTime);
  updateSmoke(dt);
  updateCamera(dt);
  updateAudio(dt);
  updateHUD();
  renderer.render(scene, camera);
}
frame();
