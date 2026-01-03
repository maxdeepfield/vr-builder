import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(10, 10, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.enableDamping = true;

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
scene.add(dirLight);

// Sun angle (spherical coordinates)
let sunAzimuth = 45; // horizontal angle in degrees
let sunElevation = 60; // vertical angle in degrees

function updateSunPosition() {
  const azimuthRad = sunAzimuth * Math.PI / 180;
  const elevationRad = sunElevation * Math.PI / 180;
  const dist = 30;
  dirLight.position.set(
    dist * Math.cos(elevationRad) * Math.sin(azimuthRad),
    dist * Math.sin(elevationRad),
    dist * Math.cos(elevationRad) * Math.cos(azimuthRad)
  );
}
updateSunPosition();

// Shadow ground plane
const shadowGround = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.ShadowMaterial({ opacity: 0.3 })
);
shadowGround.rotation.x = -Math.PI / 2;
shadowGround.position.y = -0.01;
shadowGround.receiveShadow = true;
scene.add(shadowGround);

// Grid
let gridSize = 0.5;
// Minor grid lines (every 1 unit)
const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x333333);
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.5;
scene.add(gridHelper);
// Major grid lines (every 10 units)
const gridHelperMajor = new THREE.GridHelper(50, 5, 0x666666, 0x666666);
gridHelperMajor.material.transparent = true;
gridHelperMajor.material.opacity = 0.7;
gridHelperMajor.position.y = 0.001; // Slightly above to avoid z-fighting
scene.add(gridHelperMajor);

// State
const boxes = [];
let selectedBoxes = []; // Multi-select support
let selectedBox = null; // Primary selected box (for gizmo positioning)
let activeHandle = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
const intersection = new THREE.Vector3();

// Drawing state
let drawMode = 'none'; // 'none', 'base', 'height'
let drawStart = null;
let drawPlaneY = 0;
let drawNormal = new THREE.Vector3(0, 1, 0);
let drawFaceNormal = new THREE.Vector3(0, 1, 0); // The actual face we're drawing on
let drawAxis1 = 'x'; // First axis for base rectangle
let drawAxis2 = 'z'; // Second axis for base rectangle  
let extrudeAxis = 'y'; // Axis for extrusion
let extrudeSign = 1; // Direction of extrusion

// Draw guide helpers
const drawGuideMat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false });
const drawDotGeo = new THREE.SphereGeometry(0.08, 8, 8);
const drawDotMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
const drawDot = new THREE.Mesh(drawDotGeo, drawDotMat);
drawDot.visible = false;
drawDot.renderOrder = 1000;
scene.add(drawDot);

// Line for single-axis drawing
const drawLineGeo = new THREE.BufferGeometry();
drawLineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
const drawLine = new THREE.Line(drawLineGeo, drawGuideMat);
drawLine.visible = false;
drawLine.renderOrder = 1000;
scene.add(drawLine);

// Rectangle outline for base drawing
const drawRectGeo = new THREE.BufferGeometry();
drawRectGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0, 0,0,0, 0,0,0], 3));
const drawRect = new THREE.LineLoop(drawRectGeo, drawGuideMat);
drawRect.visible = false;
drawRect.renderOrder = 1000;
scene.add(drawRect);
let previewBox = null;
const previewMat = new THREE.MeshLambertMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });

// Ground plane for raycasting
const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshBasicMaterial({ visible: false })
);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.userData.isGround = true;
scene.add(groundMesh);

// Edit mode: 'scale' or 'move'
let editMode = 'scale';

// Move gizmo (3 axis arrows)
const gizmoGroup = new THREE.Group();
gizmoGroup.visible = false;
scene.add(gizmoGroup);

const arrowLength = 1.5;
const arrowColors = { x: 0xff4444, y: 0x44ff44, z: 0x4444ff };
const moveArrows = {};
const movePlanes = {};

['x', 'y', 'z'].forEach(axis => {
  const dir = new THREE.Vector3();
  dir[axis] = 1;
  
  // Arrow line (visual only)
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    dir.clone().multiplyScalar(arrowLength)
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: arrowColors[axis], linewidth: 2, depthTest: false });
  const line = new THREE.Line(lineGeo, lineMat);
  line.renderOrder = 1000;
  gizmoGroup.add(line);
  
  // Clickable cylinder along the line
  const cylGeo = new THREE.CylinderGeometry(0.08, 0.08, arrowLength, 8);
  const cylMat = new THREE.MeshBasicMaterial({ color: arrowColors[axis], depthTest: false, transparent: true, opacity: 0.01 });
  const cylinder = new THREE.Mesh(cylGeo, cylMat);
  cylinder.position.copy(dir.clone().multiplyScalar(arrowLength / 2));
  
  // Rotate cylinder to align with axis
  if (axis === 'x') cylinder.rotation.z = Math.PI / 2;
  else if (axis === 'z') cylinder.rotation.x = Math.PI / 2;
  
  cylinder.userData.isMoveArrow = true;
  cylinder.userData.axis = axis;
  cylinder.renderOrder = 1000;
  gizmoGroup.add(cylinder);
  
  // Arrow cone at end
  const coneGeo = new THREE.ConeGeometry(0.12, 0.3, 8);
  const coneMat = new THREE.MeshBasicMaterial({ color: arrowColors[axis], depthTest: false });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.copy(dir.clone().multiplyScalar(arrowLength));
  
  // Rotate cone to point along axis
  if (axis === 'x') cone.rotation.z = -Math.PI / 2;
  else if (axis === 'y') cone.rotation.x = 0;
  else if (axis === 'z') cone.rotation.x = Math.PI / 2;
  
  cone.userData.isMoveArrow = true;
  cone.userData.axis = axis;
  cone.renderOrder = 1000;
  gizmoGroup.add(cone);
  
  moveArrows[axis] = { line, cylinder, cone, lineMat, coneMat, originalColor: arrowColors[axis] };
});

// Plane squares for 2-axis movement (XY, XZ, YZ)
const planeSize = 0.3;
const planeOffset = 0.15;
const planeConfigs = [
  { name: 'xy', axes: ['x', 'y'], color: 0x4444ff, pos: [planeOffset, planeOffset, 0], rot: [0, 0, 0] },
  { name: 'xz', axes: ['x', 'z'], color: 0x44ff44, pos: [planeOffset, 0, planeOffset], rot: [Math.PI / 2, 0, 0] },
  { name: 'yz', axes: ['y', 'z'], color: 0xff4444, pos: [0, planeOffset, planeOffset], rot: [0, Math.PI / 2, 0] }
];

planeConfigs.forEach(cfg => {
  const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
  const planeMat = new THREE.MeshBasicMaterial({ 
    color: cfg.color, 
    transparent: true, 
    opacity: 0.3, 
    side: THREE.DoubleSide,
    depthTest: false 
  });
  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.position.set(...cfg.pos);
  planeMesh.rotation.set(...cfg.rot);
  planeMesh.userData.isMovePlane = true;
  planeMesh.userData.axes = cfg.axes;
  planeMesh.renderOrder = 1000;
  gizmoGroup.add(planeMesh);
  
  movePlanes[cfg.name] = { mesh: planeMesh, mat: planeMat, originalColor: cfg.color, axes: cfg.axes };
});

function updateGizmo() {
  if (selectedBoxes.length > 0 && editMode === 'move') {
    // Position gizmo at center of all selected boxes
    const center = new THREE.Vector3();
    selectedBoxes.forEach(box => center.add(box.position));
    center.divideScalar(selectedBoxes.length);
    gizmoGroup.position.copy(center);
    gizmoGroup.visible = true;
    
    // Scale gizmo based on camera distance to keep constant screen size
    const dist = camera.position.distanceTo(center);
    const scale = dist * 0.1;
    gizmoGroup.scale.setScalar(scale);
  } else {
    gizmoGroup.visible = false;
  }
}

function getMoveArrows() {
  const arrows = [];
  Object.values(moveArrows).forEach(a => {
    arrows.push(a.cone, a.cylinder);
  });
  return arrows;
}

function getMovePlanes() {
  return Object.values(movePlanes).map(p => p.mesh);
}

function getAllGizmoObjects() {
  const objects = [];
  Object.values(moveArrows).forEach(a => {
    objects.push(a.cone, a.cylinder);
  });
  Object.values(movePlanes).forEach(p => {
    objects.push(p.mesh);
  });
  return objects;
}


// Handle materials
const handleMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.4 });
const handleHoverMat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.9 });
const selectedMat = new THREE.MeshLambertMaterial({ color: 0x66ff66 });

let currentColor = 0xffffff;

function snap(val) {
  return Math.round(val / gridSize) * gridSize;
}

function createBox(x, y, z, w = 1, h = 1, d = 1, color = null) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ 
    color: color || currentColor,
    transparent: true,
    opacity: 1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.scale.set(w, h, d);
  mesh.userData.isBox = true;
  mesh.userData.baseColor = color || currentColor;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  boxes.push(mesh);
  
  // Create edge highlight wireframe
  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.visible = false;
  edges.renderOrder = 998;
  edges.raycast = () => {}; // Disable raycasting on edges
  mesh.add(edges);
  mesh.userData.edges = edges;
  
  // Create resize handles (6 faces) - cones pointing outward
  mesh.userData.handles = [];
  const dirs = [
    { axis: 'x', sign: 1, rot: [0, 0, -Math.PI / 2] },
    { axis: 'x', sign: -1, rot: [0, 0, Math.PI / 2] },
    { axis: 'y', sign: 1, rot: [0, 0, 0] },
    { axis: 'y', sign: -1, rot: [Math.PI, 0, 0] },
    { axis: 'z', sign: 1, rot: [Math.PI / 2, 0, 0] },
    { axis: 'z', sign: -1, rot: [-Math.PI / 2, 0, 0] }
  ];
  
  dirs.forEach(dir => {
    const handleGeo = new THREE.ConeGeometry(0.08, 0.15, 8);
    const handleMatClone = new THREE.MeshBasicMaterial({ 
      color: 0xffff00, 
      depthTest: false, 
      transparent: true, 
      opacity: 0.4 
    });
    const handle = new THREE.Mesh(handleGeo, handleMatClone);
    handle.rotation.set(...dir.rot);
    handle.userData.isHandle = true;
    handle.userData.axis = dir.axis;
    handle.userData.sign = dir.sign;
    handle.userData.parentBox = mesh;
    handle.visible = false;
    handle.renderOrder = 999;
    scene.add(handle);
    mesh.userData.handles.push(handle);
  });
  
  updateHandles(mesh);
  return mesh;
}

function updateHandles(box) {
  const handles = box.userData.handles;
  const p = box.position;
  const s = box.scale;
  
  handles[0].position.set(p.x + s.x / 2, p.y, p.z); // +X
  handles[1].position.set(p.x - s.x / 2, p.y, p.z); // -X
  handles[2].position.set(p.x, p.y + s.y / 2, p.z); // +Y
  handles[3].position.set(p.x, p.y - s.y / 2, p.z); // -Y
  handles[4].position.set(p.x, p.y, p.z + s.z / 2); // +Z
  handles[5].position.set(p.x, p.y, p.z - s.z / 2); // -Z
}

function selectBox(box, addToSelection = false) {
  if (!addToSelection) {
    // Clear all selections
    selectedBoxes.forEach(b => {
      b.material.transparent = true;
      b.material.opacity = 1;
      b.material.needsUpdate = true;
      b.userData.handles.forEach(h => h.visible = false);
      if (b.userData.edges) b.userData.edges.visible = false;
    });
    selectedBoxes = [];
    selectedBox = null;
  }
  
  if (box) {
    const idx = selectedBoxes.indexOf(box);
    if (idx >= 0 && addToSelection) {
      // Remove from selection if Ctrl+clicking already selected box
      selectedBoxes.splice(idx, 1);
      box.material.opacity = 1;
      box.material.needsUpdate = true;
      box.userData.handles.forEach(h => h.visible = false);
      if (box.userData.edges) box.userData.edges.visible = false;
      selectedBox = selectedBoxes.length > 0 ? selectedBoxes[selectedBoxes.length - 1] : null;
    } else if (idx < 0) {
      // Add to selection
      selectedBoxes.push(box);
      selectedBox = box;
      box.material.transparent = true;
      box.material.opacity = 0.5;
      box.material.needsUpdate = true;
      if (editMode === 'scale' && selectedBoxes.length === 1) {
        box.userData.handles.forEach(h => h.visible = true);
      }
      if (box.userData.edges) box.userData.edges.visible = true;
      // Update color picker to match selected box
      const colorHex = '#' + (box.userData.baseColor || 0x4a9eff).toString(16).padStart(6, '0');
      document.getElementById('boxColor').value = colorHex;
    }
  }
  
  // Only show handles for single selection in scale mode
  if (editMode === 'scale') {
    selectedBoxes.forEach(b => {
      b.userData.handles.forEach(h => h.visible = selectedBoxes.length === 1);
    });
  }
  
  updateGizmo();
}

function deleteSelected() {
  if (selectedBoxes.length === 0) return;
  selectedBoxes.forEach(box => {
    box.userData.handles.forEach(h => scene.remove(h));
    scene.remove(box);
    boxes.splice(boxes.indexOf(box), 1);
  });
  selectedBoxes = [];
  selectedBox = null;
  updateGizmo();
}


// Mouse handling
function updateMouse(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function getGroundPoint() {
  raycaster.setFromCamera(mouse, camera);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, pt);
  return pt;
}

let dragStart = null;
let dragData = null;
let activeMoveArrow = null;
let activeMovePlane = null;
let moveStartPos = null;

// Click vs drag detection
let mouseDownPos = null;
let pendingHit = null;
let pendingCtrlKey = false;
const DRAG_THRESHOLD = 5; // pixels

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);
  
  mouseDownPos = { x: e.clientX, y: e.clientY };
  pendingCtrlKey = e.ctrlKey;
  
  // Check handles FIRST (scale mode) - priority over everything (single selection only)
  if (selectedBoxes.length === 1 && editMode === 'scale' && drawMode === 'none') {
    // Use a separate raycaster check that ignores other geometry
    const handleHits = raycaster.intersectObjects(selectedBoxes[0].userData.handles, false);
    if (handleHits.length > 0) {
      activeHandle = handleHits[0].object;
      controls.enabled = false;
      
      const axis = activeHandle.userData.axis;
      const normal = new THREE.Vector3();
      normal[axis] = 1;
      plane.setFromNormalAndCoplanarPoint(
        camera.position.clone().sub(activeHandle.position).normalize(),
        activeHandle.position
      );
      
      dragStart = activeHandle.position.clone();
      dragData = {
        startScale: selectedBoxes[0].scale.clone(),
        startPos: selectedBoxes[0].position.clone()
      };
      // Show edges while resizing
      if (selectedBoxes[0].userData.edges) selectedBoxes[0].userData.edges.visible = true;
      return;
    }
  }
  
  // Check move arrows and planes
  if (selectedBoxes.length > 0 && editMode === 'move' && drawMode === 'none') {
    const gizmoHits = raycaster.intersectObjects(getAllGizmoObjects(), false);
    if (gizmoHits.length > 0) {
      const hitObj = gizmoHits[0].object;
      controls.enabled = false;
      
      // Calculate center of all selected boxes for gizmo position
      const center = new THREE.Vector3();
      selectedBoxes.forEach(box => center.add(box.position));
      center.divideScalar(selectedBoxes.length);
      
      if (hitObj.userData.isMovePlane) {
        activeMovePlane = hitObj;
        const axes = hitObj.userData.axes;
        const normal = new THREE.Vector3();
        if (!axes.includes('x')) normal.x = 1;
        else if (!axes.includes('y')) normal.y = 1;
        else normal.z = 1;
        plane.setFromNormalAndCoplanarPoint(normal, center);
      } else if (hitObj.userData.isMoveArrow) {
        activeMoveArrow = hitObj;
        plane.setFromNormalAndCoplanarPoint(
          camera.position.clone().sub(center).normalize(),
          center
        );
      }
      
      // Store start positions for all selected boxes
      moveStartPos = selectedBoxes.map(box => box.position.clone());
      raycaster.ray.intersectPlane(plane, intersection);
      dragStart = intersection.clone();
      selectedBoxes.forEach(box => {
        if (box.userData.edges) box.userData.edges.visible = true;
      });
      return;
    }
  }
  
  // Store hit for potential draw or select
  if (drawMode === 'none') {
    const allTargets = [groundMesh, ...boxes];
    const hits = raycaster.intersectObjects(allTargets, false);
    
    if (hits.length > 0) {
      pendingHit = hits[0];
      controls.enabled = false;
    }
  }
  
  // Confirm height, finalize box
  if (drawMode === 'height' && previewBox) {
    if (previewBox.scale[extrudeAxis] >= gridSize) {
      const p = previewBox.position;
      const s = previewBox.scale;
      // Calculate base position (where extrusion started)
      const basePos = p.clone();
      basePos[extrudeAxis] -= extrudeSign * s[extrudeAxis] / 2;
      const box = createBox(basePos.x, basePos.y - s.y / 2, basePos.z, s.x, s.y, s.z);
      box.position.copy(p);
      selectBox(box);
    }
    scene.remove(previewBox);
    previewBox = null;
    drawMode = 'none';
    controls.enabled = true;
    return;
  }
});

renderer.domElement.addEventListener('mousemove', (e) => {
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);
  
  // Check if we should start drawing (drag threshold)
  if (pendingHit && mouseDownPos && drawMode === 'none') {
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > DRAG_THRESHOLD) {
      // Start drawing
      const hit = pendingHit;
      pendingHit = null;
      
      // Determine face normal and drawing axes
      let faceNormal = new THREE.Vector3(0, 1, 0);
      
      if (hit.object.userData.isBox) {
        faceNormal = hit.face.normal.clone();
        faceNormal.transformDirection(hit.object.matrixWorld);
      }
      
      const absX = Math.abs(faceNormal.x);
      const absY = Math.abs(faceNormal.y);
      const absZ = Math.abs(faceNormal.z);
      
      // Snap normal to dominant axis
      if (absY > absX && absY > absZ) {
        // Horizontal face (top/bottom) - draw on XZ, extrude Y
        drawFaceNormal.set(0, Math.sign(faceNormal.y), 0);
        drawAxis1 = 'x';
        drawAxis2 = 'z';
        extrudeAxis = 'y';
        extrudeSign = Math.sign(faceNormal.y);
      } else if (absX > absZ) {
        // Vertical face (X normal) - draw on YZ, extrude X
        drawFaceNormal.set(Math.sign(faceNormal.x), 0, 0);
        drawAxis1 = 'z';
        drawAxis2 = 'y';
        extrudeAxis = 'x';
        extrudeSign = Math.sign(faceNormal.x);
      } else {
        // Vertical face (Z normal) - draw on XY, extrude Z
        drawFaceNormal.set(0, 0, Math.sign(faceNormal.z));
        drawAxis1 = 'x';
        drawAxis2 = 'y';
        extrudeAxis = 'z';
        extrudeSign = Math.sign(faceNormal.z);
      }
      
      selectBox(null);
      drawMode = 'base';
      
      drawStart = hit.point.clone();
      drawStart.x = snap(drawStart.x);
      drawStart.y = snap(drawStart.y);
      drawStart.z = snap(drawStart.z);
      
      previewBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat.clone());
      previewBox.position.copy(drawStart);
      previewBox.scale.set(0.01, 0.01, 0.01);
      previewBox.visible = false;
      previewBox.castShadow = true;
      scene.add(previewBox);
    }
  }
  
  // Moving with plane (2 axes)
  if (activeMovePlane && moveStartPos) {
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      const axes = activeMovePlane.userData.axes;
      
      selectedBoxes.forEach((box, i) => {
        box.position.copy(moveStartPos[i]);
        axes.forEach(axis => {
          let delta = intersection[axis] - dragStart[axis];
          delta = snap(delta);
          box.position[axis] = moveStartPos[i][axis] + delta;
        });
        updateHandles(box);
      });
      updateGizmo();
    }
    return;
  }
  
  // Moving with arrow
  if (activeMoveArrow && moveStartPos) {
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      const axis = activeMoveArrow.userData.axis;
      let delta = intersection[axis] - dragStart[axis];
      delta = snap(delta);
      
      selectedBoxes.forEach((box, i) => {
        box.position.copy(moveStartPos[i]);
        box.position[axis] += delta;
        updateHandles(box);
      });
      updateGizmo();
    }
    return;
  }
  
  // Drawing base rectangle
  if (drawMode === 'base' && previewBox && drawStart) {
    // Create plane perpendicular to face normal at drawStart
    const drawPlane = new THREE.Plane();
    drawPlane.setFromNormalAndCoplanarPoint(drawFaceNormal, drawStart);
    
    const pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(drawPlane, pt)) {
      pt.x = snap(pt.x);
      pt.y = snap(pt.y);
      pt.z = snap(pt.z);
      
      const min1 = Math.min(drawStart[drawAxis1], pt[drawAxis1]);
      const max1 = Math.max(drawStart[drawAxis1], pt[drawAxis1]);
      const min2 = Math.min(drawStart[drawAxis2], pt[drawAxis2]);
      const max2 = Math.max(drawStart[drawAxis2], pt[drawAxis2]);
      
      const size1 = max1 - min1;
      const size2 = max2 - min2;
      
      // Position for guides (slightly offset from surface)
      const guidePos = drawStart.clone();
      guidePos[extrudeAxis] += extrudeSign * 0.02;
      
      // Show dot at start point
      drawDot.position.copy(guidePos);
      drawDot.visible = true;
      
      // Calculate corner positions for guides
      const c1 = new THREE.Vector3().copy(drawStart);
      const c2 = new THREE.Vector3().copy(drawStart);
      const c3 = new THREE.Vector3().copy(drawStart);
      const c4 = new THREE.Vector3().copy(drawStart);
      
      c1[drawAxis1] = min1; c1[drawAxis2] = min2;
      c2[drawAxis1] = max1; c2[drawAxis2] = min2;
      c3[drawAxis1] = max1; c3[drawAxis2] = max2;
      c4[drawAxis1] = min1; c4[drawAxis2] = max2;
      
      const offset = extrudeSign * 0.02;
      c1[extrudeAxis] += offset;
      c2[extrudeAxis] += offset;
      c3[extrudeAxis] += offset;
      c4[extrudeAxis] += offset;
      
      // Show line if only one axis has movement
      if ((size1 >= gridSize && size2 < gridSize) || (size1 < gridSize && size2 >= gridSize)) {
        drawLine.visible = true;
        drawRect.visible = false;
        previewBox.visible = false;
        const positions = drawLine.geometry.attributes.position.array;
        positions[0] = guidePos.x; positions[1] = guidePos.y; positions[2] = guidePos.z;
        const endPt = guidePos.clone();
        endPt[drawAxis1] = pt[drawAxis1];
        endPt[drawAxis2] = pt[drawAxis2];
        positions[3] = endPt.x; positions[4] = endPt.y; positions[5] = endPt.z;
        drawLine.geometry.attributes.position.needsUpdate = true;
      }
      // Show rectangle outline when both axes have movement
      else if (size1 >= gridSize && size2 >= gridSize) {
        drawLine.visible = false;
        drawRect.visible = true;
        previewBox.visible = true;
        
        // Set preview box scale and position
        const scale = new THREE.Vector3(0.05, 0.05, 0.05);
        scale[drawAxis1] = size1;
        scale[drawAxis2] = size2;
        previewBox.scale.copy(scale);
        
        const pos = new THREE.Vector3();
        pos[drawAxis1] = min1 + size1 / 2;
        pos[drawAxis2] = min2 + size2 / 2;
        pos[extrudeAxis] = drawStart[extrudeAxis] + extrudeSign * 0.025;
        previewBox.position.copy(pos);
        
        const positions = drawRect.geometry.attributes.position.array;
        positions[0] = c1.x; positions[1] = c1.y; positions[2] = c1.z;
        positions[3] = c2.x; positions[4] = c2.y; positions[5] = c2.z;
        positions[6] = c3.x; positions[7] = c3.y; positions[8] = c3.z;
        positions[9] = c4.x; positions[10] = c4.y; positions[11] = c4.z;
        drawRect.geometry.attributes.position.needsUpdate = true;
      } else {
        // Just dot, no movement yet
        drawLine.visible = false;
        drawRect.visible = false;
        previewBox.visible = false;
      }
    }
    return;
  }
  
  // Drawing height/extrusion
  if (drawMode === 'height' && previewBox && drawStart) {
    const heightPlane = new THREE.Plane();
    heightPlane.setFromNormalAndCoplanarPoint(
      camera.position.clone().sub(previewBox.position).normalize(),
      previewBox.position
    );
    const pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(heightPlane, pt)) {
      // Calculate extrusion along the extrude axis
      let extrudeAmount = pt[extrudeAxis] - drawStart[extrudeAxis];
      extrudeAmount = extrudeAmount * extrudeSign; // Make it always positive in extrude direction
      extrudeAmount = snap(extrudeAmount);
      extrudeAmount = Math.max(gridSize, extrudeAmount);
      
      previewBox.scale[extrudeAxis] = extrudeAmount;
      previewBox.position[extrudeAxis] = drawStart[extrudeAxis] + extrudeSign * extrudeAmount / 2;
    }
    return;
  }
  
  // Move arrow and plane hover effect
  if (selectedBoxes.length > 0 && editMode === 'move' && !activeMoveArrow && !activeMovePlane) {
    // Reset all colors
    Object.values(moveArrows).forEach(a => {
      a.coneMat.color.setHex(a.originalColor);
      a.lineMat.color.setHex(a.originalColor);
    });
    Object.values(movePlanes).forEach(p => {
      p.mat.color.setHex(p.originalColor);
      p.mat.opacity = 0.3;
    });
    
    // Check all gizmo objects
    const gizmoHits = raycaster.intersectObjects(getAllGizmoObjects(), false);
    if (gizmoHits.length > 0) {
      const hitObj = gizmoHits[0].object;
      if (hitObj.userData.isMovePlane) {
        const planeName = Object.keys(movePlanes).find(k => movePlanes[k].mesh === hitObj);
        if (planeName) {
          movePlanes[planeName].mat.color.setHex(0xffff00);
          movePlanes[planeName].mat.opacity = 0.5;
        }
      } else if (hitObj.userData.isMoveArrow) {
        const axis = hitObj.userData.axis;
        moveArrows[axis].coneMat.color.setHex(0xffff00);
        moveArrows[axis].lineMat.color.setHex(0xffff00);
      }
      renderer.domElement.style.cursor = 'pointer';
    } else {
      renderer.domElement.style.cursor = 'default';
    }
  }
  
  // Handle hover effect (scale mode - single selection only)
  if (selectedBoxes.length === 1 && editMode === 'scale' && !activeHandle) {
    const handleHits = raycaster.intersectObjects(selectedBoxes[0].userData.handles);
    selectedBoxes[0].userData.handles.forEach(h => h.material.color.setHex(0xffff00));
    if (handleHits.length > 0) {
      handleHits[0].object.material.color.setHex(0xffff00);
      renderer.domElement.style.cursor = 'pointer';
    } else {
      renderer.domElement.style.cursor = 'default';
    }
  }
  
  // Handle dragging (scale)
  if (activeHandle && dragData) {
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      const axis = activeHandle.userData.axis;
      const sign = activeHandle.userData.sign;
      const box = activeHandle.userData.parentBox;
      
      let delta = intersection[axis] - dragStart[axis];
      delta = snap(delta);
      
      if (sign > 0) {
        const newScale = Math.max(gridSize, dragData.startScale[axis] + delta);
        box.scale[axis] = newScale;
        const diff = newScale - dragData.startScale[axis];
        box.position[axis] = dragData.startPos[axis] + diff / 2;
      } else {
        const newScale = Math.max(gridSize, dragData.startScale[axis] - delta);
        box.scale[axis] = newScale;
        const diff = newScale - dragData.startScale[axis];
        box.position[axis] = dragData.startPos[axis] - diff / 2;
      }
      
      updateHandles(box);
    }
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  // If we had a pending hit and didn't drag, it's a click = select
  if (pendingHit && drawMode === 'none') {
    if (pendingHit.object.userData.isBox) {
      selectBox(pendingHit.object, pendingCtrlKey);
    } else {
      if (!pendingCtrlKey) {
        selectBox(null);
      }
    }
  }
  
  // Auto-transition from base to height phase on mouse up
  if (drawMode === 'base' && previewBox) {
    // Hide base drawing guides
    drawDot.visible = false;
    drawLine.visible = false;
    drawRect.visible = false;
    
    const size1 = previewBox.scale[drawAxis1];
    const size2 = previewBox.scale[drawAxis2];
    
    if (previewBox.visible && size1 >= gridSize && size2 >= gridSize) {
      drawMode = 'height';
      drawStart = previewBox.position.clone();
      // Adjust drawStart to be at the base of extrusion
      drawStart[extrudeAxis] = previewBox.position[extrudeAxis] - extrudeSign * previewBox.scale[extrudeAxis] / 2;
    } else {
      // Cancel if no valid rectangle drawn
      scene.remove(previewBox);
      previewBox = null;
      drawMode = 'none';
      controls.enabled = true;
    }
  }
  
  pendingHit = null;
  pendingCtrlKey = false;
  mouseDownPos = null;
  activeHandle = null;
  activeMoveArrow = null;
  activeMovePlane = null;
  moveStartPos = null;
  dragData = null;
  if (drawMode === 'none') {
    controls.enabled = true;
  }
});


// UI
document.getElementById('gridSize').addEventListener('change', (e) => {
  gridSize = parseFloat(e.target.value) || 0.5;
});
document.getElementById('gridSize').addEventListener('input', (e) => {
  gridSize = parseFloat(e.target.value) || 0.5;
});
document.getElementById('boxColor').addEventListener('input', (e) => {
  currentColor = parseInt(e.target.value.slice(1), 16);
  // Apply to all selected boxes
  selectedBoxes.forEach(box => {
    box.userData.baseColor = currentColor;
    box.material.color.setHex(currentColor);
  });
});
document.getElementById('sunAzimuth').addEventListener('input', (e) => {
  sunAzimuth = parseFloat(e.target.value);
  updateSunPosition();
});
document.getElementById('sunElevation').addEventListener('input', (e) => {
  sunElevation = parseFloat(e.target.value);
  updateSunPosition();
});

// Mode buttons
document.getElementById('modeScale').addEventListener('click', () => setMode('scale'));
document.getElementById('modeMove').addEventListener('click', () => setMode('move'));

function setMode(mode) {
  editMode = mode;
  // Only show handles for single selection in scale mode
  selectedBoxes.forEach(box => {
    box.userData.handles.forEach(h => h.visible = mode === 'scale' && selectedBoxes.length === 1);
  });
  updateGizmo();
  updateModeUI();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if ((e.key === 'd' || e.key === 'D') && e.ctrlKey) {
    e.preventDefault();
    duplicateSelected();
  }
  if (e.key === 'w' || e.key === 'W') {
    setMode('move');
  }
  if (e.key === 's' || e.key === 'S') {
    setMode('scale');
  }
  if (e.key === 'Escape') {
    selectBox(null);
    // Cancel drawing
    if (previewBox) {
      scene.remove(previewBox);
      previewBox = null;
    }
    // Hide draw guides
    drawDot.visible = false;
    drawLine.visible = false;
    drawRect.visible = false;
    drawMode = 'none';
    controls.enabled = true;
  }
});

// Mouse4 button toggles scale mode
document.addEventListener('mousedown', (e) => {
  if (e.button === 3) { // Mouse4 (back button)
    e.preventDefault();
    setMode(editMode === 'scale' ? 'move' : 'scale');
  }
});

function duplicateSelected() {
  if (selectedBoxes.length === 0) return;
  const newBoxes = [];
  selectedBoxes.forEach(box => {
    const s = box.scale;
    const p = box.position;
    const baseY = p.y - s.y / 2;
    const newBox = createBox(p.x, baseY, p.z, s.x, s.y, s.z, box.userData.baseColor);
    newBox.position.copy(p);
    newBoxes.push(newBox);
  });
  // Select all new boxes
  selectBox(null);
  newBoxes.forEach(box => selectBox(box, true));
}

function updateModeUI() {
  document.getElementById('modeScale').classList.toggle('active', editMode === 'scale');
  document.getElementById('modeMove').classList.toggle('active', editMode === 'move');
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  
  // Update gizmo scale based on camera distance
  if (gizmoGroup.visible && selectedBoxes.length > 0) {
    const center = new THREE.Vector3();
    selectedBoxes.forEach(box => center.add(box.position));
    center.divideScalar(selectedBoxes.length);
    const dist = camera.position.distanceTo(center);
    const scale = dist * 0.08;
    gizmoGroup.scale.setScalar(scale);
  }
  
  renderer.render(scene, camera);
}
animate();
