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

// 실제 업로드된 코트 GLB를 조사해서 맞춘 값.
// 코트 원본 링 중심 높이 ≈ 2.238 (코트 표면 기준), 이를 3.05m로 맞춤.
const COURT_SCALE = 3.05 / 2.238;
const COURT_NATIVE_FLOOR_Y = -0.133;
const FLOOR_Y = 0;

// 왼쪽 링의 원본 중심 좌표를 실제 코트 스케일로 변환.
const HOOP = new THREE.Vector3(
  0.020 * COURT_SCALE,
  (2.105 - COURT_NATIVE_FLOOR_Y) * COURT_SCALE,
  -7.898 * COURT_SCALE
);

// 반코트 플레이 범위
const PLAY = {
  minX: -7.8,
  maxX: 7.8,
  minZ: -8.8,
  maxZ: 3.0,
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
    if(o.isMesh){
      o.receiveShadow = true;
      // 코트가 무거워지는 걸 피하려고 배경 오브젝트 castShadow는 끔.
      o.castShadow = false;
    }
  });
  scene.add(court);

  status('캐릭터 로딩...');
  const p = await loader.loadAsync('/assets/player.glb');
  player = p.scene;
  normalizeHeight(player, 1.92);
  player.position.set(0, FLOOR_Y, 1.5);
  player.rotation.y = Math.PI; // 처음엔 왼쪽 링(-Z)을 바라봄
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

  // 업로드한 공의 원본 지름 약 1.94 -> 실제 농구공 지름 약 0.24m
  const bb = new THREE.Box3().setFromObject(ball);
  const bs = new THREE.Vector3();
  bb.getSize(bs);
  const d = Math.max(bs.x,bs.y,bs.z);
  ball.scale.multiplyScalar(0.24/d);
  ball.traverse(o=>{
    if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; }
  });
  scene.add(ball);

  status('에셋 적용 완료');
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
    play(actions.Idle ? 'Idle' : Object.keys(actions)[0]);
  }

  if(!grounded){
    vy -= 12.2*dt;
    player.position.y += vy*dt;
    if(player.position.y <= FLOOR_Y){
      player.position.y = FLOOR_Y;
      vy = 0;
      grounded = true;
      if(ballMode !== 'shot') play('Idle');
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

  // 슛 때 자동으로 링 방향을 보게 함
  const dx = HOOP.x - player.position.x;
  const dz = HOOP.z - player.position.z;
  player.rotation.y = Math.atan2(dx,dz);

  if(actions.Shot) play('Shot',.04,false);

  ballMode='shot';
  shotClock=0;
  shotStart.copy(ball.position);
  shotStart.y = Math.max(shotStart.y, player.position.y + 1.65);

  // 살짝 링 위를 통과하도록 설정
  shotEnd.copy(HOOP);
  shotEnd.y += 0.03;
}

function updateBall(dt, elapsed){
  if(!player || !ball) return;

  if(ballMode==='held'){
    // 오른손 쪽 간단 드리블. 나중에 손 본에 붙일 예정.
    const bounce = Math.abs(Math.sin(elapsed*8.0));
    const local = new THREE.Vector3(.48, .17 + bounce*.72, .12);
    local.applyAxisAngle(new THREE.Vector3(0,1,0), player.rotation.y);
    ball.position.copy(player.position).add(local);
    ball.rotation.x += 5.5*dt;
    ball.rotation.z += 3.5*dt;
  } else {
    shotClock += dt;
    const duration=.92;
    const t=Math.min(shotClock/duration,1);

    ball.position.lerpVectors(shotStart,shotEnd,t);

    // 거리 기반 아크
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
      play('Idle');
    }
  }
}

function updateCamera(dt){
  if(!player) return;

  // 3on3 스타일: 플레이어 뒤 + 링이 전방에 보이도록 카메라 배치
  const toHoop = HOOP.clone().sub(player.position);
  toHoop.y=0;
  if(toHoop.lengthSq()<0.01) toHoop.set(0,0,-1);
  toHoop.normalize();

  const desired = player.position.clone()
    .addScaledVector(toHoop,-5.4)
    .add(new THREE.Vector3(0,3.6,0));

  camera.position.lerp(desired, 1-Math.pow(.001,dt));

  const look = player.position.clone()
    .lerp(HOOP,.18)
    .add(new THREE.Vector3(0,1.0,0));
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
