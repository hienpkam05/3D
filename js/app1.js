import { createApp, ref, reactive, computed, onMounted } from 'vue';
import * as THREE from 'three';

import LibraryPanel from './components/LibraryPanel.js';
import PropertiesPanel from './components/PropertiesPanel.js';
import EditorToolbar from './components/EditorToolbar.js';

import {
  loadMainModel, loadDecoration, updateAnimations,
  getWaterMaterial, doRaycast, intersectGround,
  findModelGroup, addOutline, removeOutlines, pulseOutline,
} from './lib/sceneUtils.js';

const toRad = (d) => (d * Math.PI) / 180;
const MAP_CENTER = { lng: 105.807406, lat: 21.402464 };
// Keep navigation focused on the site: ~130 m from the configured coordinate.
const BOUNDS_PADDING = 0.0012;
const NEARBY_BUILDINGS = [
  { id: 'den-dan-ha', name: 'Đền Đan Hà', path: './DinhDanHa-20260827T040936Z-1-001/DinhDanHa/Den_Dan_Ha.glb' },
  { id: 'chua-van-kim', name: 'Chùa Vạn Kim', path: './DinhDanHa-20260827T040936Z-1-001/DinhDanHa/Chua_Van_Kim.glb' },
  { id: 'dinh-chua-nguyen-tan', name: 'Đình Chùa Nguyễn Tân', path: './DinhDanHa-20260827T040936Z-1-001/DinhDanHa/Dinh_Chua_Nguyen_Tan.glb' },
];

const app = createApp({
  components: { LibraryPanel, PropertiesPanel, EditorToolbar },

  setup() {
    // ---- Library items ----
    const libraryItems = ref([]);
    const placementMode = ref(false);
    const placingItem = ref(null);
    const showBuildingPicker = ref(false);
    // Models are editable by default; the toolbar can lock them afterwards.
    const moveUnlocked = ref(true);

    // ---- Decorations state ----
    const decorations = reactive([]);
    const mainModelConfigs = reactive([]);
    const selectedDecoId = ref(null);

    const selectedDeco = computed(() =>
      [...mainModelConfigs, ...decorations].find(d => d.id === selectedDecoId.value) || null
    );
    const canDelete = computed(() => selectedDeco.value?.type === 'decoration');

    function getModelConfig(id) {
      return mainModelConfigs.find(m => m.id === id)
        || decorations.find(d => d.id === id)
        || null;
    }

    function getTransformTarget(group) {
      return group.userData.isDecoration ? group : group.children[0];
    }

    // ---- Drag state ----
    const isDragging = ref(false);

    // ---- Three.js references (non-reactive) ----
    let threeScene = null;
    let storedProjMatrix = new THREE.Matrix4();
    let canvasEl = null;
    let decoGroups = {};  // id -> THREE.Group
    let selectedGroup = null;
    let mapRef = null;

    // Drag internals
    let dragging = false;
    let dragStartMouse = null;
    let dragGroup = null;
    let dragTarget = null;
    let dragDecoId = null;
    let dragOffset = new THREE.Vector3();
    const DRAG_THRESHOLD = 4; // px before drag starts
    let dragDidMove = false;
    let mapInteractionSuspended = false;

    function suspendMapInteraction() {
      if (!mapRef || mapInteractionSuspended) return;
      mapRef.dragPan.disable();
      mapRef.dragRotate.disable();
      mapInteractionSuspended = true;
    }

    function resumeMapInteraction() {
      if (!mapRef || !mapInteractionSuspended) return;
      mapRef.dragPan.enable();
      mapRef.dragRotate.enable();
      mapInteractionSuspended = false;
    }

    // ---- Load library manifest ----
    async function loadLibrary() {
      const res = await fetch('./libs-manifest.json');
      libraryItems.value = await res.json();
    }

    // ---- Placement mode ----
    function startPlacement(item) {
      showBuildingPicker.value = false;
      placingItem.value = item;
      placementMode.value = true;
      deselectDeco();
      document.body.classList.add('placement-mode');
    }

    function cancelPlacement() {
      placementMode.value = false;
      placingItem.value = null;
      document.body.classList.remove('placement-mode');
    }

    async function placeAtPosition(worldPos) {
      if (!placingItem.value || !threeScene) return;

      const item = placingItem.value;
      const id = item.id + '-' + Date.now();
      const decoConfig = {
        id,
        name: item.name,
        type: 'decoration',
        path: item.path,
        position: { x: parseFloat(worldPos.x.toFixed(2)), y: 0, z: parseFloat(worldPos.z.toFixed(2)) },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        libraryId: item.id,
      };

      const group = await loadDecoration(decoConfig, threeScene);
      decoGroups[id] = group;
      decorations.push(decoConfig);

      cancelPlacement();
      selectDecoById(id);
      if (mapRef) mapRef.triggerRepaint();
    }

    // ---- Selection ----
    function selectDecoById(id) {
      removeOutlines();
      selectedGroup = null;

      const group = decoGroups[id];
      if (!group) return;

      selectedDecoId.value = id;
      selectedGroup = group;
      addOutline(group);
      if (mapRef) mapRef.triggerRepaint();
    }

    function deselectDeco() {
      removeOutlines();
      selectedGroup = null;
      selectedDecoId.value = null;
      if (mapRef) mapRef.triggerRepaint();
    }

    // ---- Mouse handlers (click, drag-to-move) ----
    function getCanvasXY(e) {
      const rect = canvasEl.getBoundingClientRect();
      return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
    }

    function handleMouseDown(e) {
      if (!threeScene || !canvasEl || e.button !== 0) return;
      const { cx, cy } = getCanvasXY(e);

      // Placement mode: place on click
      if (placementMode.value) {
        const worldPos = intersectGround(cx, cy, canvasEl, storedProjMatrix);
        if (worldPos) placeAtPosition(worldPos);
        return;
      }

      // Raycast to check if a model (main model or decoration) is hit
      const hits = doRaycast(cx, cy, canvasEl, storedProjMatrix, threeScene);
      if (hits.length > 0) {
        const group = findModelGroup(hits[0]);
        if (group && getModelConfig(group.name)) {
          // A locked model remains selectable, but cannot be dragged.
          if (!moveUnlocked.value) {
            selectDecoById(group.name);
            return;
          }

          // Prevent MapLibre from treating a model drag as a map-pan gesture.
          e.preventDefault();
          e.stopPropagation();
          // Prepare for potential drag
          dragStartMouse = { x: e.clientX, y: e.clientY };
          dragGroup = group;
          dragTarget = getTransformTarget(group);
          dragDecoId = group.name;
          dragDidMove = false;

          // Calculate offset: difference between object position and ground hit point
          const groundPt = intersectGround(cx, cy, canvasEl, storedProjMatrix);
          if (groundPt) {
            dragOffset.set(
              dragTarget.position.x - groundPt.x,
              0,
              dragTarget.position.z - groundPt.z
            );
          }
          suspendMapInteraction();
        }
      }
    }

    function handleMouseMove(e) {
      if (!dragStartMouse || !dragGroup || !canvasEl) return;

      const dx = e.clientX - dragStartMouse.x;
      const dy = e.clientY - dragStartMouse.y;

      // Only start dragging past threshold
      if (!dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragging = true;
        isDragging.value = true;
        dragDidMove = true;

        // Select the object being dragged
        selectDecoById(dragDecoId);

        document.body.classList.add('dragging-mode');
      }

      if (!dragging) return;

      // Move object to cursor ground position + offset
      const { cx, cy } = getCanvasXY(e);
      const groundPt = intersectGround(cx, cy, canvasEl, storedProjMatrix);
      if (!groundPt) return;

      const newX = parseFloat((groundPt.x + dragOffset.x).toFixed(2));
      const newZ = parseFloat((groundPt.z + dragOffset.z).toFixed(2));

      dragTarget.position.x = newX;
      dragTarget.position.z = newZ;

      // Sync reactive data
      const deco = getModelConfig(dragDecoId);
      if (deco) {
        deco.position.x = newX;
        deco.position.z = newZ;
      }

      removeOutlines();
      addOutline(dragGroup);
      if (mapRef) mapRef.triggerRepaint();
    }

    function handleMouseUp() {
      if (dragging) {
        // End drag
        dragging = false;
        isDragging.value = false;
        document.body.classList.remove('dragging-mode');

      } else if (dragStartMouse && !dragDidMove) {
        // It was a click (no drag happened) -> select or deselect
        if (dragGroup && getModelConfig(dragDecoId)) {
          selectDecoById(dragDecoId);
        }
      }
      // Deselect on empty canvas click is handled by handleCanvasClick

      // Reset drag state
      dragStartMouse = null;
      dragGroup = null;
      dragTarget = null;
      dragDecoId = null;
      resumeMapInteraction();
    }

    function handleCanvasClick(e) {
      if (!threeScene || !canvasEl) return;
      // Only deselect on click-on-empty (not after drag)
      if (isDragging.value) return;
      const { cx, cy } = getCanvasXY(e);
      if (placementMode.value) return;
      const hits = doRaycast(cx, cy, canvasEl, storedProjMatrix, threeScene);
      if (hits.length === 0) deselectDeco();
    }

    // ---- Property update ----
    function handlePropertyUpdate({ field, axis, value }) {
      const deco = selectedDeco.value;
      if (!deco) return;
      const group = decoGroups[deco.id];
      if (!group) return;
      const target = getTransformTarget(group);

      if (field === 'position') {
        deco.position[axis] = value;
        target.position.set(deco.position.x, deco.position.y, deco.position.z);
      } else if (field === 'rotation') {
        deco.rotation[axis] = value;
        target.rotation.set(toRad(deco.rotation.x), toRad(deco.rotation.y), toRad(deco.rotation.z));
      } else if (field === 'scale') {
        if (axis === 'uniform') {
          deco.scale.x = deco.scale.y = deco.scale.z = value;
        } else {
          deco.scale[axis] = value;
        }
        target.scale.set(deco.scale.x, deco.scale.y, deco.scale.z);
      }

      removeOutlines();
      addOutline(group);
      if (mapRef) mapRef.triggerRepaint();
    }

    // ---- Delete ----
    function deleteDeco(id) {
      const idx = decorations.findIndex(d => d.id === (id || selectedDecoId.value));
      if (idx < 0) return;

      const decoId = decorations[idx].id;
      const group = decoGroups[decoId];
      if (group && threeScene) threeScene.remove(group);
      delete decoGroups[decoId];
      decorations.splice(idx, 1);

      if (selectedDecoId.value === decoId) deselectDeco();
      if (mapRef) mapRef.triggerRepaint();
    }

    // ---- Save config ----
    function saveConfig() {
      const output = {
        models: [...mainModelConfigs, ...decorations].map(model => ({
          ...model,
          position: { ...model.position },
          rotation: { ...model.rotation },
          scale: { ...model.scale },
        })),
      };
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'models-config.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    // ---- Map & Three.js init ----
    onMounted(async () => {
      await loadLibrary();

      const { lng, lat } = MAP_CENTER;
      const modelOrigin = [lng, lat];

      mapRef = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/bright',
        zoom: 19,
        center: modelOrigin,
        pitch: 60,
        canvasContextAttributes: { antialias: true },
        maxBounds: [
          [lng - BOUNDS_PADDING, lat - BOUNDS_PADDING],
          [lng + BOUNDS_PADDING, lat + BOUNDS_PADDING],
        ],
        minZoom: 18,
        maxZoom: 23,
      });

      const mc = maplibregl.MercatorCoordinate.fromLngLat(modelOrigin, 0);
      const modelTransform = {
        translateX: mc.x, translateY: mc.y, translateZ: mc.z,
        rotateX: Math.PI / 2, rotateY: 0, rotateZ: 0,
        scale: mc.meterInMercatorCoordinateUnits(),
      };

      const customLayer = {
        id: '3d-model',
        type: 'custom',
        renderingMode: '3d',

        onAdd(mapInstance, gl) {
          this.camera = new THREE.Camera();
          this.scene = new THREE.Scene();
          threeScene = this.scene;

          // Lighting
          this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c7, 1.0));
          const d1 = new THREE.DirectionalLight(0xffffff, 1.1);
          d1.position.set(10, 12, 6);
          this.scene.add(d1);
          const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
          d2.position.set(-8, 6, -4);
          this.scene.add(d2);

          // Ground plane (invisible, for raycasting reference)
          const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(2000, 2000),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          ground.rotation.x = -Math.PI / 2;
          ground.userData.isGround = true;
          this.scene.add(ground);

          this.map = mapInstance;
          this.clock = new THREE.Clock();

          this.renderer = new THREE.WebGLRenderer({
            canvas: mapInstance.getCanvas(), context: gl, antialias: true,
          });
          this.renderer.autoClear = false;
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          this.renderer.toneMappingExposure = 1.0;

          canvasEl = mapInstance.getCanvas();

          // Load main model from viewer config
          fetch('./models-config.json')
            .then(r => r.json())
            .then(cfg => {
              const mainModels = cfg.models.filter(m => m.type !== 'decoration');
              const decoModels = cfg.models.filter(m => m.type === 'decoration');

              // Main models can now be selected, dragged, rotated and scaled.
              mainModels.forEach(async (m) => {
                const group = await loadMainModel(m, this.scene);
                decoGroups[m.id] = group;
                mainModelConfigs.push(reactive({ ...m }));
              });

              // Load existing decorations
              decoModels.forEach(async (d) => {
                const group = await loadDecoration(d, this.scene);
                decoGroups[d.id] = group;
                decorations.push(reactive({ ...d }));
              });

              mapInstance.triggerRepaint();
            });
        },

        render(gl, args) {
          const elapsed = this.clock.getElapsedTime();

          const wm = getWaterMaterial();
          if (wm?.uniforms?.time) wm.uniforms.time.value = elapsed;

          updateAnimations(elapsed);
          pulseOutline(elapsed);

          const { rotateX, rotateY, rotateZ } = modelTransform;
          const rx = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), rotateX);
          const ry = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), rotateY);
          const rz = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), rotateZ);

          const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
          const l = new THREE.Matrix4()
            .makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ)
            .scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale))
            .multiply(rx).multiply(ry).multiply(rz);

          this.camera.projectionMatrix = m.multiply(l);
          storedProjMatrix.copy(this.camera.projectionMatrix);

          this.renderer.resetState();
          this.renderer.render(this.scene, this.camera);
          this.map.triggerRepaint();
        },
      };

      mapRef.on('style.load', () => { mapRef.addLayer(customLayer); });

      // Mouse events for click + drag
      // Capture the press so MapLibre does not consume a model-drag gesture.
      mapRef.getCanvas().addEventListener('mousedown', handleMouseDown, true);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      mapRef.getCanvas().addEventListener('click', handleCanvasClick);
    });

    return {
      libraryItems,
      placementMode,
      placingItem,
      decorations,
      selectedDecoId,
      selectedDeco,
      canDelete,
      isDragging,
      showBuildingPicker,
      nearbyBuildings: NEARBY_BUILDINGS,
      moveUnlocked,
      startPlacement,
      cancelPlacement,
      selectDecoById,
      handlePropertyUpdate,
      deleteDeco,
      saveConfig,
    };
  },
});

app.mount('#app');
