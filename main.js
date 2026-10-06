import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const app = document.querySelector('#app');
const statusEl = document.querySelector('#status');
const scoreEl = document.querySelector('#score');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20242b);
scene.fog = new THREE.Fog(0x20242b, 28, 55);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 120);
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x353942, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 3.1);
sun.position.set(-7, 13, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 45;
scene.add(sun);

const loader = new GLTFLoader();
const clock = new THREE.Clock();

let player, ball, mixer;
let actions = {};
let activeAction = null;
let ballMode = 'held';
let shotClock = 0;
let shotStart = new THREE.Vector3();
let shotEnd = new THREE.Vector3();
let score = 0;
let grounded = true;
let vy = 0;

const keys = {};

const COURT_SCALE = 3.05 / 2.238;
const COURT_NATIVE_FLOOR_Y = -0.133;
const FLOOR_Y = 0;

const HOOP = new THREE.Vector3(
  0.020 * COURT_SCALE,
  (2.105 - COURT_NATIVE_FLOOR_Y) * COURT_SCALE,
  -7.898 * COURT_SCALE
);

// 골대 아래/베이스라인까지 접근 가능하게 수정
const PLAY = {
  minX: -8.2,
  maxX: 8.2,
  minZ: HOOP.z - 1.35,
  maxZ: 3.2,
};

// 3on3 스타일 고정 카메라.
// 플레이어를 따라가지 않고 코트 전체를 보여주며,
// 공이 좌우로 움직일 때만 카메라와 시선이 살짝 따라간다.
const CAMERA = {
  basePosition: new THREE.Vector3(0, 6.4, 9.2),
  baseLookAt: new THREE.Vector3(0, 1.45, -4.1),
  positionXFollow: 0.30,
  lookXFollow: 0.16,
  maxXShift: 2.35,
  smoothSpeed: 4.8,
};

function status(s){ statusEl.textContent = s; }

function normalizeHeight(obj, target=1.92){
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  if(size.y > 1e-5) obj.scale.multiplyScalar(target/size.y);

  const box2 = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box2.min.y;
}

function play(name, fade=.14, loop=true){
  const next = actions[name];
  if(!next || next === activeAction) return;
  if(activeAction) activeAction.fadeOut(fade);
  next.reset();
  next.enabled = true;
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.fadeIn(fade).play();
  activeAction = next;
}

async function init(){
  status('코트 로딩...');
  const courtGLTF = await loader.loadAsync('/assets/court.glb');
  const court = courtGLTF.scene;
  court.scale.setScalar(COURT_SCALE);
  court.position.y = -COURT_NATIVE_FLOOR_Y * COURT_SCALE;
  court.traverse(o=>{
    if(o.isMesh){ o.receiveShadow = true; o.castShadow = false; }
  });
  scene.add(court);

  status('캐릭터 로딩...');
  const p = await loader.loadAsync('/assets/player.glb');
  player = p.scene;
  normalizeHeight(player, 1.92);
  player.position.set(0, FLOOR_Y, 1.5);
  player.rotation.y = Math.PI;
  player.traverse(o=>{
    if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }
  });
  scene.add(player);

  mixer = new THREE.AnimationMixer(player);
  for(const clip of p.animations) actions[clip.name] = mixer.clipAction(clip);
  play(actions.Idle ? 'Idle' : Object.keys(actions)[0]);

  status('농구공 로딩...');
  const b = await loader.loadAsync('/assets/ball.glb');
  ball = b.scene;
  const bb = new THREE.Box3().setFromObject(ball);
  const bs = new THREE.Vector3();
  bb.getSize(bs);
  const d = Math.max(bs.x,bs.y,bs.z);
  ball.scale.multiplyScalar(0.24/d);
  ball.traverse(o=>{
    if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }
  });
  scene.add(ball);

  status('플레이 중');
}

function moveVector(){
  const v = new THREE.Vector3(
    (keys.KeyD?1:0) - (keys.KeyA?1:0),
    0,
    (keys.KeyS?1:0) - (keys.KeyW?1:0)
  );
  if(v.lengthSq()>1) v.normalize();
  return v;
}

function updatePlayer(dt){
  if(!player) return;
  const mv = moveVector();
  const moving = mv.lengthSq()>0.001;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = sprint ? 5.0 : 3.35;

  if(moving && ballMode !== 'shot'){
    player.position.addScaledVector(mv, speed*dt);
    player.rotation.y = Math.atan2(mv.x, mv.z);
    if(grounded) play(actions.Run ? 'Run' : 'Idle');
  } else if(grounded && ballMode !== 'shot'){
    if(actions.Dribble) play('Dribble');
    else play(actions.Idle ? 'Idle' : Object.keys(actions)[0]);
  }

  if(!grounded){
    vy -= 12.2*dt;
    player.position.y += vy*dt;
    if(player.position.y <= FLOOR_Y){
      player.position.y = FLOOR_Y;
      vy = 0;
      grounded = true;
      if(ballMode !== 'shot') play(actions.Dribble ? 'Dribble' : 'Idle');
    }
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, PLAY.minX, PLAY.maxX);
  player.position.z = THREE.MathUtils.clamp(player.position.z, PLAY.minZ, PLAY.maxZ);
}

function jump(){
  if(!player || !grounded || ballMode==='shot') return;
  grounded = false;
  vy = 5.0;
  if(actions.Jump) play('Jump',.04,false);
}

function shoot(){
  if(!player || !ball || ballMode==='shot') return;

  const dx = HOOP.x - player.position.x;
  const dz = HOOP.z - player.position.z;
  player.rotation.y = Math.atan2(dx,dz);

  if(actions.Shot) play('Shot',.04,false);

  ballMode='shot';
  shotClock=0;
  shotStart.copy(ball.position);
  shotStart.y = Math.max(shotStart.y, player.position.y + 1.68);

  shotEnd.copy(HOOP);
  shotEnd.y += 0.03;
}

function updateBall(dt, elapsed){
  if(!player || !ball) return;

  if(ballMode==='held'){
    const bounce = Math.abs(Math.sin(elapsed*8.0));
    const local = new THREE.Vector3(.48, .16 + bounce*.72, .12);
    local.applyAxisAngle(new THREE.Vector3(0,1,0), player.rotation.y);
    ball.position.copy(player.position).add(local);
    ball.rotation.x += 5.5*dt;
    ball.rotation.z += 3.5*dt;
  } else {
    shotClock += dt;
    const duration=.92;
    const t=Math.min(shotClock/duration,1);

    ball.position.lerpVectors(shotStart,shotEnd,t);
    const dist = shotStart.distanceTo(shotEnd);
    const arc = THREE.MathUtils.clamp(2.2 + dist*.13, 2.5, 4.0);
    ball.position.y += arc*4*t*(1-t);

    ball.rotation.x += 10*dt;
    ball.rotation.z += 6*dt;

    if(t>=1){
      score += (player.position.distanceTo(HOOP) > 6.75 ? 3 : 2);
      scoreEl.textContent = `${score} PTS`;
      status('SWISH!');
      ballMode='held';
      setTimeout(()=>status('플레이 중'),600);
      play(actions.Dribble ? 'Dribble' : 'Idle');
    }
  }
}

function updateCamera(dt){
  // 카메라 기준은 플레이어가 아니라 공.
  // 3대3에서 패스가 오가더라도 화면 구도가 크게 흔들리지 않게 한다.
  const trackedX = ball ? ball.position.x : 0;

  const cameraShiftX = THREE.MathUtils.clamp(
    trackedX * CAMERA.positionXFollow,
    -CAMERA.maxXShift,
    CAMERA.maxXShift
  );

  const lookShiftX = THREE.MathUtils.clamp(
    trackedX * CAMERA.lookXFollow,
    -CAMERA.maxXShift * 0.65,
    CAMERA.maxXShift * 0.65
  );

  const desired = CAMERA.basePosition.clone();
  desired.x += cameraShiftX;

  const alpha = 1 - Math.exp(-CAMERA.smoothSpeed * dt);
  camera.position.lerp(desired, alpha);

  const look = CAMERA.baseLookAt.clone();
  look.x += lookShiftX;

  camera.lookAt(look);
}

addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='Space' && !e.repeat){ e.preventDefault(); jump(); }
  if(e.code==='KeyF' && !e.repeat) shoot();
});
addEventListener('keyup',e=>keys[e.code]=false);
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

await init();

function frame(){
  requestAnimationFrame(frame);
  const dt=Math.min(clock.getDelta(),.033);
  if(mixer) mixer.update(dt);
  updatePlayer(dt);
  updateBall(dt,clock.elapsedTime);
  updateCamera(dt);
  renderer.render(scene,camera);
}
frame();
