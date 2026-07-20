import { validateGeometry, type LabelGeometry } from "./geometry";

const LETTER = { pageWidthMm: 215.9, pageHeightMm: 279.4 };

// Avery source: official 5160 blank template, 1 x 2-5/8 in, 30/sheet.
// Pitch/margins use the template's US Letter grid: 0.5 in top, 0.1875 in left,
// 2.75 in horizontal pitch, and 1 in vertical pitch.
const AVERY_5160: LabelGeometry = {
  id: "avery-5160", name: "Avery 5160", ...LETTER,
  marginTopMm: 12.7, marginLeftMm: 4.7625,
  labelWidthMm: 66.675, labelHeightMm: 25.4,
  horizontalPitchMm: 69.85, verticalPitchMm: 25.4,
  columns: 3, rows: 10, orientation: "portrait", thermal: false,
  source: "https://www.avery.com/templates/5160",
};

// Avery source: official 5163 blank template, 2 x 4 in, 10/sheet.
// US Letter grid: 0.5 in top, 0.15625 in left, 4.1875 in horizontal
// pitch (0.1875 in gutter), and 2 in vertical pitch.
const AVERY_5163: LabelGeometry = {
  id: "avery-5163", name: "Avery 5163", ...LETTER,
  marginTopMm: 12.7, marginLeftMm: 3.96875,
  labelWidthMm: 101.6, labelHeightMm: 50.8,
  horizontalPitchMm: 106.3625, verticalPitchMm: 50.8,
  columns: 2, rows: 5, orientation: "portrait", thermal: false,
  source: "https://www.avery.com/templates/5163",
};

// Avery source: official 5167 blank template, 1/2 x 1-3/4 in, 80/sheet.
// The published template grid uses the plan-reviewed 7.3 mm left origin and
// 51.6 mm horizontal pitch; rows have no vertical gutter.
const AVERY_5167: LabelGeometry = {
  id: "avery-5167", name: "Avery 5167", ...LETTER,
  marginTopMm: 12.7, marginLeftMm: 7.3,
  labelWidthMm: 44.45, labelHeightMm: 12.7,
  horizontalPitchMm: 51.6, verticalPitchMm: 12.7,
  columns: 4, rows: 20, orientation: "portrait", thermal: false,
  source: "https://www.avery.com/templates/5167",
};

// DYMO LabelWriter technical reference: 30252 is 1-1/8 x 3-1/2 in.
// Page width is the long edge so composition and printing are landscape.
const DYMO_30252: LabelGeometry = {
  id: "dymo-30252", name: "DYMO 30252",
  pageWidthMm: 89, pageHeightMm: 28.6,
  marginTopMm: 0, marginLeftMm: 0,
  labelWidthMm: 89, labelHeightMm: 28.6,
  horizontalPitchMm: 89, verticalPitchMm: 28.6,
  columns: 1, rows: 1, orientation: "landscape", thermal: true,
  source: "https://download.dymo.com/UserManuals/labelwriter%20user%20guides/LWSE450_Tech_Ref/Content/AppendixE.htm",
};

// DYMO LabelWriter technical reference: 30334 is 2-1/4 x 1-1/4 in.
const DYMO_30334: LabelGeometry = {
  id: "dymo-30334", name: "DYMO 30334",
  pageWidthMm: 57.15, pageHeightMm: 31.75,
  marginTopMm: 0, marginLeftMm: 0,
  labelWidthMm: 57.15, labelHeightMm: 31.75,
  horizontalPitchMm: 57.15, verticalPitchMm: 31.75,
  columns: 1, rows: 1, orientation: "landscape", thermal: true,
  source: "https://download.dymo.com/UserManuals/labelwriter%20user%20guides/LWSE450_Tech_Ref/Content/AppendixE.htm",
};

// Zebra standard direct-thermal stock: 2.25 x 1.25 in.
const ZEBRA_225_125: LabelGeometry = {
  id: "zebra-2.25x1.25", name: "Zebra 2.25 x 1.25 in",
  pageWidthMm: 57.15, pageHeightMm: 31.75,
  marginTopMm: 0, marginLeftMm: 0,
  labelWidthMm: 57.15, labelHeightMm: 31.75,
  horizontalPitchMm: 57.15, verticalPitchMm: 31.75,
  columns: 1, rows: 1, orientation: "landscape", thermal: true,
  source: "Zebra 2.25 x 1.25 inch direct-thermal stock dimensions",
};

export const LABEL_TEMPLATES = [
  AVERY_5160, AVERY_5163, AVERY_5167,
  DYMO_30252, DYMO_30334, ZEBRA_225_125,
] as const satisfies readonly LabelGeometry[];

for (const template of LABEL_TEMPLATES) validateGeometry(template);

export type LabelTemplateId = (typeof LABEL_TEMPLATES)[number]["id"];

export function getLabelTemplate(id: string): LabelGeometry {
  const template = LABEL_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`Unknown label template: ${id}`);
  return template;
}

