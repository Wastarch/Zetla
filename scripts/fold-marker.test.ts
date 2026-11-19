// M1-32：折叠 marker 纯逻辑单测（不 import DOM，只测角度映射与尺寸口径）
import { foldChevronAngle, FOLD_CHEV_SIZE } from "../src/editor/foldMarker.ts";

let pass = 0;
let fail = 0;
function eq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
  }
}

eq(foldChevronAngle(true), 90, "展开态（可折叠）→ 90° 向下");
eq(foldChevronAngle(false), 0, "折叠态（可展开）→ 0° 向右");
eq(FOLD_CHEV_SIZE, 12, "尺寸与项目树 chev size=12 一致");

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
