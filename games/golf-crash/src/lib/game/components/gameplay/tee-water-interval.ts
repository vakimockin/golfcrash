import { game } from "../../../stores/game.svelte.js";
import { getMapLayout } from "../map/map.js";
import { visualWorldFromMode } from "../themes/visual-world-theme.js";

/** Horizontal span where procedural water must not carve under the golfer / tee. */
export const proceduralWaterForbiddenInterval = (): {
  minX: number;
  maxX: number;
} => {
  const start = getMapLayout(visualWorldFromMode(game.visualTimeMode)).start;
  const teeLeft = Math.min(start.characterX, start.ballX);
  const teeRight = Math.max(start.characterX, start.ballX);
  return {
    minX: Math.max(0, teeLeft - 240),
    maxX: teeRight + 420,
  };
};
