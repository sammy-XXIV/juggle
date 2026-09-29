import * as THREE from "three";
import type { Player } from "./Player";
import type { Entity } from "./Track";

const LANE_X = [-2, 0, 2];

const SOLANA_PURPLE = "#9945FF";
const SOLANA_GREEN = "#14F195";
const FOG_COLOR = 0x6b4fc9; // blend of the gradient for depth fade
const CLOUD_SPAN_Z: [number, number] = [-80, 20];
const CLOUD_DRIFT_SPEED = 0.6;

function buildSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, SOLANA_PURPLE);
  gradient.addColorStop(1, SOLANA_GREEN);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Renderer3D {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private playerMesh: THREE.Group;
  private bonk: BonkModel;
  private runTime = 0;
  private meshes = new Map<Entity, THREE.Object3D>();
  private clouds: THREE.Group[] = [];
  private coinTexture: THREE.Texture;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = buildSkyTexture();
    this.scene.fog = new THREE.Fog(FOG_COLOR, 25, 65);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 4.2, 7);
    this.camera.lookAt(0, 1.2, -8);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xfff6e0, 1.1);
    sun.position.set(-5, 12, 6);
    this.scene.add(sun);

    this.coinTexture = new THREE.TextureLoader().load("/textures/solana-coin.png");
    this.coinTexture.colorSpace = THREE.SRGBColorSpace;
    this.coinTexture.center.set(0.5, 0.5);
    this.coinTexture.rotation = Math.PI / 2;

    this.buildGround();
    this.buildClouds();

    this.bonk = buildBonkModel();
    this.playerMesh = this.bonk.group;
    this.playerMesh.position.set(0, 0.7, 0);
    this.scene.add(this.playerMesh);

    window.addEventListener("resize", () => this.onResize());
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 120),
      new THREE.MeshStandardMaterial({ color: 0x14201a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -50;
    this.scene.add(ground);

    const laneMat = new THREE.MeshStandardMaterial({ color: 0x2c4535 });
    for (const x of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 120), laneMat);
      line.position.set(x, 0.01, -50);
      this.scene.add(line);
    }
  }

  private buildClouds(): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      emissive: 0x223344,
      emissiveIntensity: 0.06,
    });

    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const puffs = 5 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.7, 12, 10), material);
        puff.position.set((Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.8);
        cloud.add(puff);
      }
      cloud.position.set(
        (Math.random() - 0.5) * 40,
        9 + Math.random() * 5,
        CLOUD_SPAN_Z[0] + Math.random() * (CLOUD_SPAN_Z[1] - CLOUD_SPAN_Z[0]),
      );
      cloud.scale.setScalar(1 + Math.random());
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  private updateClouds(dt: number): void {
    for (const cloud of this.clouds) {
      cloud.position.z += CLOUD_DRIFT_SPEED * dt;
      if (cloud.position.z > CLOUD_SPAN_Z[1]) cloud.position.z = CLOUD_SPAN_Z[0];
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  update(player: Player, entities: Entity[], dt: number): void {
    this.syncEntities(entities);
    this.updatePlayerMesh(player, dt);
    this.updateClouds(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayerMesh(player: Player, dt: number): void {
    const targetX = LANE_X[player.lane];
    this.playerMesh.position.x += (targetX - this.playerMesh.position.x) * 0.25;
    this.playerMesh.rotation.z = (targetX - this.playerMesh.position.x) * -0.15; // lean into lane changes

    this.playerMesh.position.y = 0.7;
    this.playerMesh.scale.y = 1;

    if (player.alive) {
      const gaitSpeed = 14;
      this.runTime += dt * gaitSpeed;
      const swing = Math.sin(this.runTime);
      // legs[0]=leftFront, [1]=leftBack, [2]=rightFront, [3]=rightBack — diagonal pairs swing together
      this.bonk.legs[0].rotation.x = swing * 0.9;
      this.bonk.legs[3].rotation.x = swing * 0.9;
      this.bonk.legs[1].rotation.x = -swing * 0.9;
      this.bonk.legs[2].rotation.x = -swing * 0.9;
      this.bonk.tail.rotation.z = Math.sin(this.runTime * 0.6) * 0.3;
      this.bonk.head.position.y = 0.95 + Math.abs(Math.cos(this.runTime)) * 0.05;
    }

    for (const mat of this.bonk.tintMaterials) {
      const orig = mat.userData.origColor as THREE.Color;
      if (player.alive) mat.color.copy(orig);
      else mat.color.set(0x555555);
    }
  }

  private syncEntities(entities: Entity[]): void {
    const live = new Set(entities);

    for (const [entity, mesh] of this.meshes) {
      if (!live.has(entity)) {
        this.scene.remove(mesh);
        this.meshes.delete(entity);
      }
    }

    for (const entity of entities) {
      let mesh = this.meshes.get(entity);
      if (!mesh) {
        mesh = this.createMesh(entity);
        this.meshes.set(entity, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(LANE_X[entity.lane], mesh.position.y, entity.z);
      if (entity.kind === "coin") mesh.rotation.y = (mesh.rotation.y + 0.09) % (Math.PI * 2);
    }
  }

  private createMesh(entity: Entity): THREE.Object3D {
    if (entity.kind === "coin") {
      const token = buildSolanaCoin(this.coinTexture);
      token.position.y = 1.1;
      return token;
    }
    const bodyHeight = 1.6;
    const candle = buildRedCandle(bodyHeight);
    candle.position.y = bodyHeight / 2;
    return candle;
  }
}

const CANDLE_RED = 0xff2222;

/** A bearish candlestick: body + wick, both red. */
function buildRedCandle(bodyHeight: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: CANDLE_RED,
    emissive: 0x660000,
    emissiveIntensity: 0.6,
    roughness: 0.35,
    metalness: 0.1,
  });

  const visualHeight = bodyHeight * 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, visualHeight, 0.5), mat);
  body.position.y = (visualHeight - bodyHeight) / 2; // grow upward, keep base anchored
  group.add(body);

  const wickHeight = bodyHeight * 3;
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, wickHeight, 8), mat);
  wick.position.y = body.position.y;
  group.add(wick);

  const glow = new THREE.Sprite(getCandleGlowMaterial());
  glow.position.y = body.position.y;
  glow.scale.set(0.85 * 2.4, visualHeight * 1.5, 1);
  group.add(glow);

  return group;
}

let candleGlowMaterial: THREE.SpriteMaterial | null = null;

/** Shared soft red halo: a radial gradient sprite, additively blended. */
function getCandleGlowMaterial(): THREE.SpriteMaterial {
  if (candleGlowMaterial) return candleGlowMaterial;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 60, 60, 0.55)");
  gradient.addColorStop(0.45, "rgba(255, 40, 40, 0.2)");
  gradient.addColorStop(1, "rgba(255, 30, 30, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  candleGlowMaterial = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  return candleGlowMaterial;
}

export interface BonkModel {
  group: THREE.Group;
  tintMaterials: THREE.MeshStandardMaterial[];
  legs: THREE.Group[];
  tail: THREE.Mesh;
  head: THREE.Mesh;
}

/** Grayscale speckle noise, tiled — gives a mottled fur look via map + bumpMap. */
function buildFurTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#dcdcdc";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const shade = 170 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.5)`;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 1 + Math.random() * 2.5;
    const angle = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillRect(-len / 2, -0.4, len, 0.8);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/** Low-poly BONK (Shiba Inu) runner, facing -Z (away from the chase camera). */
function buildBonkModel(): BonkModel {
  const group = new THREE.Group();
  const tintMaterials: THREE.MeshStandardMaterial[] = [];
  const legs: THREE.Group[] = [];
  const furTexture = buildFurTexture();

  const tinted = (hex: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) => {
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.85,
      map: furTexture,
      bumpMap: furTexture,
      bumpScale: 0.02,
      ...extra,
    });
    mat.userData.origColor = mat.color.clone();
    tintMaterials.push(mat);
    return mat;
  };

  const furMat = tinted(0xe8934a);
  const creamMat = tinted(0xf3e0c4);
  const darkMat = tinted(0x2a1c14, { map: undefined, bumpMap: undefined });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), furMat);
  body.scale.set(1, 0.95, 1.55);
  body.position.set(0, 0.55, 0.05);
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), creamMat);
  belly.scale.set(1, 0.85, 1.5);
  belly.position.set(0, 0.32, 0.05);
  group.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), furMat);
  head.scale.set(1, 0.95, 1.05);
  head.position.set(0, 0.95, -0.55);
  group.add(head);

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), creamMat);
  snout.scale.set(1, 0.8, 1.2);
  snout.position.set(0, 0.82, -0.85);
  group.add(snout);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), darkMat);
  nose.position.set(0, 0.85, -1.02);
  group.add(nose);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 16), furMat);
    ear.position.set(side * 0.2, 1.28, -0.6);
    ear.rotation.y = Math.PI / 4;
    group.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), darkMat);
    eye.position.set(side * 0.15, 0.95, -0.8);
    group.add(eye);

    for (const legZ of [-0.3, 0.35]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.22, 0.42, legZ);
      const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.28, 4, 8), furMat);
      legMesh.position.set(0, -0.22, 0); // hangs below the pivot so rotation swings it
      hip.add(legMesh);
      group.add(hip);
      legs.push(hip);
    }
  }

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), furMat);
  tail.position.set(0, 0.85, 0.65);
  group.add(tail);

  return { group, tintMaterials, legs, tail, head };
}

/** A coin disc textured with the Solana logo PNG on its flat faces. */
function buildSolanaCoin(texture: THREE.Texture): THREE.Mesh {
  const faceMat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    metalness: 0.3,
    roughness: 0.4,
  });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.3 });
  const geometry = new THREE.CylinderGeometry(0.65, 0.65, 0.16, 32);
  geometry.rotateX(Math.PI / 2); // bake the tilt in so runtime rotation.y is a clean spin
  // group 0 = side wall, group 1 = top cap, group 2 = bottom cap
  return new THREE.Mesh(geometry, [edgeMat, faceMat, faceMat]);
}
