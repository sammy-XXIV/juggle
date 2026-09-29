/** Player's in-game state, mirrors a real trading position (long/short/flat). */
export class Player {
  lane = 1; // 0 = left, 1 = center, 2 = right
  score = 0;
  skr = 0;
  alive = true;

  moveLeft(): void {
    if (this.alive) this.lane = Math.max(0, this.lane - 1);
  }

  moveRight(): void {
    if (this.alive) this.lane = Math.min(2, this.lane + 1);
  }

  die(): void {
    this.alive = false;
  }

  reset(): void {
    this.lane = 1;
    this.score = 0;
    this.skr = 0;
    this.alive = true;
  }
}
