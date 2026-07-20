export const MM_TO_PT = 72 / 25.4;

export type LabelOrientation = "portrait" | "landscape";

export interface LabelGeometry {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  horizontalPitchMm: number;
  verticalPitchMm: number;
  columns: number;
  rows: number;
  orientation: LabelOrientation;
  thermal: boolean;
  source: string;
}

export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function mmToPt(value: number): number {
  return value * MM_TO_PT;
}

export function labelsPerPage(geometry: LabelGeometry): number {
  return geometry.columns * geometry.rows;
}

export function labelRect(geometry: LabelGeometry, slot: number): LabelRect {
  const capacity = labelsPerPage(geometry);
  if (!Number.isInteger(slot) || slot < 0 || slot >= capacity) {
    throw new RangeError(`Label slot must be between 0 and ${capacity - 1}.`);
  }
  const column = slot % geometry.columns;
  const row = Math.floor(slot / geometry.columns);
  const width = mmToPt(geometry.labelWidthMm);
  const height = mmToPt(geometry.labelHeightMm);
  return {
    x: mmToPt(geometry.marginLeftMm + column * geometry.horizontalPitchMm),
    y: mmToPt(geometry.pageHeightMm - geometry.marginTopMm - geometry.labelHeightMm - row * geometry.verticalPitchMm),
    width,
    height,
  };
}

export function validateGeometry(geometry: LabelGeometry): void {
  const values = [
    geometry.pageWidthMm, geometry.pageHeightMm, geometry.labelWidthMm,
    geometry.labelHeightMm, geometry.horizontalPitchMm, geometry.verticalPitchMm,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`${geometry.id} has invalid dimensions.`);
  if (!Number.isInteger(geometry.columns) || !Number.isInteger(geometry.rows) || geometry.columns < 1 || geometry.rows < 1) {
    throw new Error(`${geometry.id} has invalid row or column counts.`);
  }
  const last = labelRect(geometry, labelsPerPage(geometry) - 1);
  const tolerance = mmToPt(0.5);
  if (last.x + last.width > mmToPt(geometry.pageWidthMm) + tolerance || last.y < -tolerance) {
    throw new Error(`${geometry.id} label grid does not fit on its page.`);
  }
}

