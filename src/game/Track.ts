export type Entity = {
  lane: number; // 0 = left, 1 = center, 2 = right
  z: number; // world-space depth: negative = far ahead, 0 = at player
  kind: "obstacle" | "coin";
};

export const SPAWN_Z = -60;
export const PLAYER_Z = 0;
export const DESPAWN_Z = 4;

const MAX_LANE_BIAS = 0.8;

function randomLane(): number {
  return Math.floor(Math.random() * 3);
}

/**
 * Spawns obstacles/coins scrolling toward the player. The market picks the lanes:
 * in a dump, candles pile into the long (right) lane and coins into the short (left) lane.
 */
export class Track {
  entities: Entity[] = [];
  private spawnTimer = 0;

  update(dt: number, speed: number, priceMomentum: number): void {
    for (const e of this.entities) e.z += speed * dt;
    this.entities = this.entities.filter((e) => e.z < DESPAWN_Z);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn(priceMomentum);
      this.spawnTimer = 0.47 + Math.random() * 0.27;
    }
  }

  private spawn(priceMomentum: number): void {
    const bias = Math.min(1, Math.abs(priceMomentum)) * MAX_LANE_BIAS;
    const losingLane = priceMomentum < 0 ? 2 : 0;
    const winningLane = 2 - losingLane;
    if (Math.random() < 0.6) {
      const lane = Math.random() < bias ? losingLane : randomLane();
      this.entities.push({ lane, z: SPAWN_Z, kind: "obstacle" });
    } else {
      const lane = Math.random() < bias ? winningLane : randomLane();
      this.entities.push({ lane, z: SPAWN_Z, kind: "coin" });
    }
  }
}
