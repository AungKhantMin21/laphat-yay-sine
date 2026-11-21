// Area tile data. M0 has one placeholder street; real areas load from src/data in M3.
import { FLOOR, M0_AREA_H, M0_AREA_W } from '../shared/layout';

export interface Area {
  id: number;
  w: number;
  h: number;
  floor: Uint8Array;
  wall: Uint8Array;
}

export function createM0Area(): Area {
  const w = M0_AREA_W;
  const h = M0_AREA_H;
  const floor = new Uint8Array(w * h).fill(FLOOR.dirt);
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) floor[y * w + x] = t;
  };
  fill(0, 22, w, 28, FLOOR.road);
  fill(0, 19, w, 22, FLOOR.pavement);
  fill(0, 28, w, 31, FLOOR.pavement);
  fill(24, 9, 36, 19, FLOOR.shopTile); // the tea shop
  return { id: 0, w, h, floor, wall: new Uint8Array(w * h) };
}
