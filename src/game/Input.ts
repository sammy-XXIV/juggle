import type { Player } from "./Player";
import { Haptics } from "../haptics";
import { Sounds } from "../sounds";

const SWIPE_THRESHOLD = 30;

/** Binds keyboard + swipe/tap to player actions. Left/right only — no jump or duck. */
export function bindInput(player: Player, target: HTMLElement): void {
  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft") { player.moveLeft(); Haptics.lane(); Sounds.lane(); }
    if (e.code === "ArrowRight") { player.moveRight(); Haptics.lane(); Sounds.lane(); }
  });

  let startX = 0;
  let startY = 0;

  target.addEventListener("touchstart", (e) => {
    startX = e.touches[0]?.clientX ?? 0;
    startY = e.touches[0]?.clientY ?? 0;
  });

  target.addEventListener("touchend", (e) => {
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const dx = endX - startX;
    const dy = (e.changedTouches[0]?.clientY ?? startY) - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      dx > 0 ? player.moveRight() : player.moveLeft();
      Haptics.lane(); Sounds.lane();
    }
  });
}
