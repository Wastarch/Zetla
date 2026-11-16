// Zotero 联动 · P5 picker 分类选择（默认 Zotero 当前分类 + 树形下拉）纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p5.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 一律带 .ts 后缀）
import type { ZoteroCollection } from "../src/types/zotero.ts";
import {
  apiCollectionPaths,
  matchCollectionKey,
  nextPageStart,
  parseSelectedCollection,
  targetPaths,
  type PickerCollectionTarget,
} from "../src/modules/zotero/zoteroPicker.ts";
import { buildCollectionRows } from "../src/modules/zotero/zoteroLibrary.ts";

let failures = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}
function eq<T>(got: T, want: T, msg: string) {
  check(Object.is(got, want), `${msg}（得到 ${String(got)}，期望 ${String(want)}）`);
}

// ── parseSelectedCollection ─────────────────────────────────────────────
console.log("\n[parseSelectedCollection]");

{
  // 真机实测形状（2026-11-16）：文库根选中 → id null
  const raw = JSON.stringify({
    libraryID: 1,
    libraryName: "我的文库",
    editable: true,
    id: null,
    name: "我的文库",
    targets: [
      { id: "L1", name: "我的文库", filesEditable: true, level: 0, recent: true },
      { id: "C28", name: "湖北科技学院", filesEditable: true, level: 1, recent: true },
      { id: "C9", name: "本科毕业论文", filesEditable: true, level: 2 },
    ],
  });
  const sel = parseSelectedCollection(raw);
  check(sel !== null, "实测 JSON 可解析");
  if (sel) {
    eq(sel.id, null, "文库根 id 为 null");
    eq(sel.name, "我的文库", "name 取自根字段");
    eq(sel.targets.length, 3, "targets 保留 3 条");
    eq(sel.targets[1].id, "C28", "target id 原样保留");
    eq(sel.targets[2].level, 2, "level 保留数值");
  }
}
{
  const sel = parseSelectedCollection(
    JSON.stringify({ id: "C9", name: "本科毕业论文", targets: [] }),
  );
  eq(sel?.id ?? null, "C9", "分类选中时 id 为 C 前缀");
  eq(sel?.name ?? "", "本科毕业论文", "分类名解析");
}
{
  const sel = parseSelectedCollection(
    JSON.stringify({ id: "C1", name: "x", targets: [42, null, { id: "", name: "y" }, { id: "C2", name: "" }, { id: "C3", name: "ok", level: "bad" }] }),
  );
  eq(sel?.targets.length, 1, "非法 target（数字/null/空 id/空名/坏 level）被剔除");
  eq(sel?.targets[0]?.id, "C3", "level 非法回落 0 但保留条目");
}
eq(parseSelectedCollection("not json"), null, "坏 JSON → null");
eq(parseSelectedCollection("[]"), null, "数组顶层 → null");
// 实测 connector 顶层 id 是数字（如 30），旧版当成结构不符丢弃 → 默认分类永远定位失败
eq(parseSelectedCollection('{"id": 5, "name": "x"}')?.id ?? null, "C5", "数字 id → 补 C 前缀");
eq(parseSelectedCollection('{"id": 0, "name": "x"}'), null, "id 为 0 → null");
eq(parseSelectedCollection('{"name": "x"}'), null, "缺 id → null");
eq(parseSelectedCollection('{"id": true, "name": "x"}'), null, "布尔 id → null");

// ── targetPaths（level 缩进 → 祖先链）────────────────────────────────────
console.log("\n[targetPaths]");

{
  const targets: PickerCollectionTarget[] = [
    { id: "L1", name: "我的文库", level: 0 },
    { id: "C28", name: "湖北科技学院", level: 1 },
    { id: "C9", name: "本科毕业论文", level: 2 },
    { id: "C10", name: "石墨烯纳米带", level: 3 },
    { id: "C13", name: "宁夏大学", level: 1 },
    { id: "C21", name: "马良财", level: 2 },
    { id: "C27", name: "宇宙学", level: 2 },
  ];
  const paths = targetPaths(targets);
  check(paths.length === targets.length, "每个 target 一条路径");
  eq(paths[0].length, 0, "文库根路径为空");
  eq(paths[1].join("/"), "湖北科技学院", "level1 = 自身");
  eq(paths[2].join("/"), "湖北科技学院/本科毕业论文", "level2 带父级");
  eq(paths[3].join("/"), "湖北科技学院/本科毕业论文/石墨烯纳米带", "level3 带祖父级");
  eq(paths[4].join("/"), "宁夏大学", "回到 level1 后路径重置");
  eq(paths[5].join("/"), "宁夏大学/马良财", "兄弟分支路径正确");
  eq(paths[6].join("/"), "宁夏大学/宇宙学", "同级下一条路径正确");
}

// ── apiCollectionPaths ──────────────────────────────────────────────────
console.log("\n[apiCollectionPaths]");

const COLL: ZoteroCollection[] = [
  { key: "RI3LCSDC", name: "湖北科技学院", parentCollection: false },
  { key: "QDSRE3WT", name: "本科毕业论文", parentCollection: "RI3LCSDC" },
  { key: "SFDZW59W", name: "石墨烯纳米带", parentCollection: "QDSRE3WT" },
  { key: "9I44WK79", name: "宁夏大学", parentCollection: false },
  { key: "KQPZ2DH4", name: "马良财", parentCollection: "9I44WK79" },
  { key: "A1", name: "同名分类", parentCollection: false },
  { key: "A2", name: "同名分类", parentCollection: "KQPZ2DH4" },
  { key: "B1", name: "环甲", parentCollection: "B2" },
  { key: "B2", name: "环乙", parentCollection: "B1" }, // 环
];
{
  const paths = apiCollectionPaths(COLL);
  eq(paths.get("RI3LCSDC")?.join("/"), "湖北科技学院", "顶层分类路径");
  eq(paths.get("SFDZW59W")?.join("/"), "湖北科技学院/本科毕业论文/石墨烯纳米带", "三层祖先链");
  eq(paths.get("B1")?.length, 2, "成环父链在环入口截断（B1 = 环乙/环甲，有限不栈溢出）");
  eq(paths.get("B2")?.length, 1, "环内另一节点路径有限");
}

// ── matchCollectionKey ──────────────────────────────────────────────────
console.log("\n[matchCollectionKey]");

const SEL_TARGETS: PickerCollectionTarget[] = [
  { id: "L1", name: "我的文库", level: 0 },
  { id: "C28", name: "湖北科技学院", level: 1 },
  { id: "C9", name: "本科毕业论文", level: 2 },
  { id: "C10", name: "石墨烯纳米带", level: 3 },
  { id: "C13", name: "宁夏大学", level: 1 },
  { id: "C21", name: "马良财", level: 2 },
  { id: "C25", name: "同名分类", level: 3 }, // 在 马良财 下
  { id: "C77", name: "同名分类", level: 1 }, // 顶层的同名分类
];
const coll = (id: string, name: string, level: number): PickerSelectedShape => ({
  id,
  name,
  targets: SEL_TARGETS,
});
type PickerSelectedShape = ReturnType<typeof coll>;

eq(matchCollectionKey(null, COLL), null, "null 选择 → null");
eq(matchCollectionKey(coll(null as unknown as string, "我的文库", 0), COLL), null, "文库根（id null）→ null");
eq(matchCollectionKey(coll("L1", "我的文库", 0), COLL), null, "L 前缀（文库）→ null");
eq(matchCollectionKey(coll("C28", "湖北科技学院", 1), COLL), "RI3LCSDC", "唯一名命中 → key");
eq(matchCollectionKey(coll("C999", "不存在的分类", 1), COLL), null, "名称不存在 → null");
{
  // 重名 + 路径区分：选中「宁夏大学/马良财/同名分类」→ A2，而非顶层 A1
  const sel = coll("C25", "同名分类", 3);
  eq(matchCollectionKey(sel, COLL), "A2", "重名用祖先路径区分（马良财下 → A2）");
  const selTop = coll("C77", "同名分类", 1);
  eq(matchCollectionKey(selTop, COLL), "A1", "顶层同名分类 → A1");
}
{
  // 重名但 targets 缺路径信息 → 取第一个同名（降级不崩溃）
  const degraded = { id: "C25", name: "同名分类", targets: [] };
  eq(matchCollectionKey(degraded, COLL), "A1", "无路径时降级取第一个同名");
}
{
  // 数字 id + 重名分类仍按祖先路径区分（C25 在马良财下 → A2）
  const sel = parseSelectedCollection(
    JSON.stringify({ id: 25, name: "同名分类", targets: SEL_TARGETS }),
  );
  eq(matchCollectionKey(sel, COLL), "A2", "数字 id 重名也按路径区分");
}
{
  // 真机抓包回归（2026-11-16）：Zotero 打开「宁夏大学/宇宙学/文献」时，
  // connector 顶层 id 是数字 30；必须定位到本地 API key 6MQ8A2DD。
  const raw = JSON.stringify({
    libraryID: 1,
    libraryName: "我的文库",
    editable: true,
    id: 30,
    name: "文献",
    targets: [
      { id: "L1", name: "我的文库", level: 0, recent: true },
      { id: "C13", name: "宁夏大学", level: 1 },
      { id: "C21", name: "马良财", level: 2 },
      { id: "C27", name: "宇宙学", level: 2, recent: true },
      { id: "C30", name: "文献", level: 3, recent: true },
    ],
  });
  const realColls: ZoteroCollection[] = [
    { key: "9I44WK79", name: "宁夏大学", parentCollection: false },
    { key: "KQPZ2DH4", name: "马良财", parentCollection: "9I44WK79" },
    { key: "C62CLFVJ", name: "宇宙学", parentCollection: "9I44WK79" },
    { key: "6MQ8A2DD", name: "文献", parentCollection: "C62CLFVJ" },
    { key: "9YUZBA6Z", name: "学习教材", parentCollection: "C62CLFVJ" },
  ];
  const sel = parseSelectedCollection(raw);
  eq(sel?.id ?? null, "C30", "真机数据数字 id 30 → C30");
  eq(sel?.name ?? "", "文献", "真机数据 name 保留");
  eq(matchCollectionKey(sel, realColls), "6MQ8A2DD", "真机数据定位到「文献」分类 key");
}

// ── buildCollectionRows（picker 下拉直接复用）─────────────────────────────
console.log("\n[buildCollectionRows]");

{
  const rows = buildCollectionRows(COLL);
  eq(rows[0]?.key, "RI3LCSDC", "顶层在前（名称序）");
  const geo = rows.find((r) => r.key === "SFDZW59W");
  eq(geo?.depth, 2, "三层嵌套 depth=2（缩进用）");
  check(
    rows.filter((r) => r.name === "同名分类").length === 2,
    "同名分类在下拉中出现两行（顶层一行 + 马良财下一行）",
  );
}

// ── 翻页判定（分类浏览 total 未知时按「不足一页即到底」）──────────────────
console.log("\n[nextPageStart（分类场景）]");

eq(nextPageStart(0, 30, null), 30, "整页返回 → 有下一页");
eq(nextPageStart(30, 4, null), null, "不足一页 → 到底");
eq(nextPageStart(0, 30, 34), 30, "total 已知且未到 → 继续");
eq(nextPageStart(30, 4, 34), null, "total 已知到头 → 停止");

console.log(`\n${total - failures}/${total} 通过`);
process.exit(failures === 0 ? 0 : 1);
