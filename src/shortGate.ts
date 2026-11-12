// Frozen LondonBreakout ridge fit on signals before 2026-03-22T12:00:00Z.
// The arrays follow the order of the basis values in scoreLondonShort.
const mean = [
  1.2650952641094635, 0.07805077037146442, 0.3414784987871335,
  0.19865162399651506, 0.38410082404264356, 1.9152018406745375,
  0.01462610855252925, 0.12513785587030515, 0.05744759781832879,
  0.4648031453654362, 0.12397341859955857, 0.42551576142631664,
  0.2943512989969644, 0.027422377348176253, 0.024166537832437544,
  0.07006735008205606, 0.5016668459518993, 0.03071103615186005,
  0.12387323758779838, 0.06578601251147889,
];
const scale = [
  0.5610132025205216, 0.09238065704978622, 0.09235957306306475,
  0.1341086503618457, 0.5632669902764961, 1.719554409753902,
  0.051115401683783986, 0.06251220533386745, 0.09124172559872055,
  0.38195301169483414, 0.22603600061930093, 0.21523581181779247,
  0.329131419703309, 0.03566221512633359, 0.06081203969940675,
  0.05677856612585522, 0.8297403970851367, 0.07804853925818499,
  0.20616712239621346, 0.15488763335362304,
];
const beta = [
  0.5511900722613394, -0.23456083022152746, 0.181836930900536,
  0.07616230655821582, 0.16600238586270455, 0.24597516332827135,
  0.017545756197915298, 0.13230885075971477, 0.0849119532208195,
  -0.09852896392269718, -0.44760330908751433, 0.04959635820379604,
  -0.3128654453332634, 0.09950133001166456, 0.07329302307687112,
  -0.25726360075581156, 0.1769566056922914, -0.1875157190743587,
  0.5545225803696298, 0.3452026237676279, -0.28709217027684025,
];

export const SHORT_GATE_THRESHOLD = 0.7166923551749721;

export function scoreLondonShort(
  relativeVolume: number | null,
  overshootAtr: number,
  widthAtr: number,
  bodyAtr: number,
  confirmationTime: number,
): number | null {
  if (
    relativeVolume === null ||
    ![relativeVolume, overshootAtr, widthAtr, bodyAtr].every(Number.isFinite)
  ) {
    return null;
  }
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const volume = Math.log1p(clamp(relativeVolume, 0, 20));
  const overshoot = clamp(overshootAtr, 0, 1);
  const width = clamp(widthAtr, 0, 0.5);
  const body = clamp(bodyAtr, -1, 1);
  const hour = (new Date(confirmationTime).getUTCHours() - 12) / 3;
  const basis = [
    volume,
    overshoot,
    width,
    body,
    hour,
    volume * volume,
    overshoot * overshoot,
    width * width,
    body * body,
    hour * hour,
    volume * overshoot,
    volume * width,
    volume * body,
    overshoot * width,
    overshoot * body,
    width * body,
    hour * volume,
    hour * overshoot,
    hour * width,
    hour * body,
  ];
  return basis.reduce(
    (score, value, index) =>
      score + ((value - mean[index]) / scale[index]) * beta[index + 1],
    beta[0],
  );
}
