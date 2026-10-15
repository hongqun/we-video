export type WorldMapCoordinate = {x: number; y: number};

// Coordinates are visual anchors for the bundled simplified map, not geographic
// geometry. The model supplies ISO/value; the renderer owns this lookup.
export const WORLD_MAP_COORDINATES: Record<string, WorldMapCoordinate> = {
  US: {x: 23, y: 43}, CA: {x: 23, y: 30}, MX: {x: 27, y: 57}, BR: {x: 40, y: 70}, AR: {x: 36, y: 83},
  GB: {x: 51, y: 34}, IE: {x: 48, y: 35}, FR: {x: 54, y: 43}, ES: {x: 52, y: 51}, PT: {x: 50, y: 50},
  DE: {x: 58, y: 39}, IT: {x: 59, y: 51}, NL: {x: 57, y: 35}, SE: {x: 61, y: 25}, NO: {x: 59, y: 22},
  RU: {x: 72, y: 29}, TR: {x: 65, y: 51}, EG: {x: 63, y: 63}, ZA: {x: 59, y: 82}, NG: {x: 56, y: 64},
  AE: {x: 69, y: 59}, SA: {x: 67, y: 66}, IN: {x: 76, y: 61}, CN: {x: 83, y: 47}, JP: {x: 91, y: 49},
  KR: {x: 88, y: 48}, ID: {x: 83, y: 71}, SG: {x: 82, y: 75}, AU: {x: 88, y: 82}, NZ: {x: 96, y: 88},
};

export const worldMapCoordinate = (iso: string) => WORLD_MAP_COORDINATES[iso.toUpperCase()];
