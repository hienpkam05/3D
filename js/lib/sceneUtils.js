import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWaterMaterial } from './waterShader.js';

const loader = new GLTFLoader();
const toRad = (d) => (d * Math.PI) / 180;

// Animations
const animations = [];
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function addGrowAnimation(group, targetY, dur = 1.8, delay = 0) {
  group.scale.y = 0.001;
  animations.push({ group, targetY, dur, delay, start: -1, done: false });
}
export function updateAnimations(elapsed) {
  for (const a of animations) {
    if (a.done) continue;
    if (a.start < 0) a.start = elapsed;
    const t = elapsed - a.start - a.delay;
    if (t < 0) continue;
    const p = Math.min(t / a.dur, 1);
    a.group.scale.y = a.targetY * easeOutBack(p);
    if (p >= 1) a.done = true;
  }
}

// Material enhancer
const waterMaterial = createWaterMaterial();
export function getWaterMaterial() { return waterMaterial; }

function applyMaterial(child) {
  if (!child.isMesh) return;
  const mats = Array.isArray(child.material) ? child.material : [child.material];
  for (const m of mats) {
    if (m.reflectivity !== undefined) m.reflectivity = 0;
    if (m.refractionRatio !== undefined) m.refractionRatio = 0;
    if (m.transmission !== undefined) m.transmission = 0;
    m.side = THREE.DoubleSide; m.needsUpdate = true;
  }
  if (typeof child.name === 'string' && child.name.startsWith('Water')) child.material = waterMaterial;
}

// Load main model (with symmetry support)
export function loadMainModel(config, scene, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(config.path, (gltf) => {
      const model = gltf.scene;
      model.position.set(config.position?.x || 0, config.position?.y || 0, config.position?.z || 0);
      model.rotation.set(toRad(config.rotation?.x || 0), toRad(config.rotation?.y || 0), toRad(config.rotation?.z || 0));
      model.scale.set(config.scale?.x || 1, config.scale?.y || 1, config.scale?.z || 1);
      model.traverse(applyMaterial);

      const group = new THREE.Group();
      group.name = config.id;
      group.add(model);

      // x2 symmetry
      if (config.symmetry === 'x2') {
        const axis = config.mirrorAxis || 'x';
        const center = config.mirrorCenter || { x: 0, y: 0, z: 0 };
        const clone = model.clone(true);
        clone.scale[axis] *= -1;
        clone.position[axis] = 2 * center[axis] - model.position[axis];
        clone.traverse(applyMaterial);
        group.add(clone);
      }

      scene.add(group);
      addGrowAnimation(group, group.scale.y || 1);
      resolve(group);
    }, onProgress, reject);
  });
}

// Load decoration model (simple - no symmetry)
export function loadDecoration(config, scene) {
  return new Promise((resolve, reject) => {
    loader.load(config.path, (gltf) => {
      const model = gltf.scene;
      model.traverse(applyMaterial);

      const group = new THREE.Group();
      group.name = config.id;
      group.userData.isDecoration = true;
      group.add(model);

      group.position.set(config.position?.x || 0, config.position?.y || 0, config.position?.z || 0);
      group.rotation.set(toRad(config.rotation?.x || 0), toRad(config.rotation?.y || 0), toRad(config.rotation?.z || 0));
      const s = config.scale?.x || 1;
      group.scale.set(config.scale?.x || s, config.scale?.y || s, config.scale?.z || s);

      scene.add(group);
      resolve(group);
    }, null, reject);
  });
}

// Raycast helpers
export function doRaycast(clickX, clickY, canvas, projMatrix, scene) {
  const ray = screenToRay(clickX, clickY, canvas, projMatrix);
  if (!ray) return [];
  const rc = new THREE.Raycaster();
  rc.set(ray.origin, ray.direction);
  return rc.intersectObjects(scene.children, true)
    .filter(h => !h.object.userData.isOutline && !h.object.userData.isGround);
}

export function intersectGround(clickX, clickY, canvas, projMatrix) {
  const ray = screenToRay(clickX, clickY, canvas, projMatrix);
  if (!ray || Math.abs(ray.direction.y) < 0.0001) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return new THREE.Vector3(
    ray.origin.x + ray.direction.x * t,
    0,
    ray.origin.z + ray.direction.z * t
  );
}

function screenToRay(clickX, clickY, canvas, projMatrix) {
  const ndcX = (clickX / canvas.clientWidth) * 2 - 1;
  const ndcY = -(clickY / canvas.clientHeight) * 2 + 1;
  const inv = projMatrix.clone().invert();
  const near = new THREE.Vector4(ndcX, ndcY, -1, 1).applyMatrix4(inv);
  near.divideScalar(near.w);
  const far = new THREE.Vector4(ndcX, ndcY, 1, 1).applyMatrix4(inv);
  far.divideScalar(far.w);
  return {
    origin: new THREE.Vector3(near.x, near.y, near.z),
    direction: new THREE.Vector3(far.x - near.x, far.y - near.y, far.z - near.z).normalize(),
  };
}

// Find root model group
export function findModelGroup(hit) {
  let obj = hit.object;
  while (obj.parent && obj.parent.type !== 'Scene') obj = obj.parent;
  return obj;
}

// Outline
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x2b6f85, side: THREE.BackSide, transparent: true, opacity: 0.6 });
let outlines = [];

export function addOutline(group) {
  group.traverse((c) => {
    if (!c.isMesh || c.userData.isOutline) return;
    const o = new THREE.Mesh(c.geometry, outlineMat);
    o.userData.isOutline = true; o.scale.setScalar(1.04); o.renderOrder = -1;
    c.add(o); outlines.push(o);
  });
}
export function removeOutlines() {
  for (const o of outlines) { if (o.parent) o.parent.remove(o); }
  outlines = [];
}
export function pulseOutline(t) {
  if (outlines.length) outlineMat.opacity = 0.4 + Math.sin(t * 3) * 0.2;
}
