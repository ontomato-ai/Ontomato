import { readFile } from "node:fs/promises";

const [path] = process.argv.slice(2);
const run = JSON.parse(await readFile(path));
const { samples, stage, group, count, completed } = run;
const fmt = number => Number.isFinite(number) ? number.toFixed(1) : "—";
const ordered = (rows, value) => rows.map(value).sort((a, b) => a - b);
const p95 = sorted => sorted[Math.ceil(0.95 * sorted.length) - 1];
const median = sorted => {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = (rows, value) => {
  const a = ordered(rows, value);
  return [median(a), p95(a)];
};
const display = values => values.map(fmt).join(" / ");
const compare = {};
const consistentInventory = new Set(samples.map(sample => sample.proof.listFingerprint).filter(Boolean)).size === 1;

console.log("# 定时任务直渲染性能 · " + group + " · " + stage);
console.log();
console.log("版本 " + run.build.version + " · " + run.build.sources.map(source => source.id + " " + source.revision).join(" / "));
console.log("路线 " + run.route.native + " ↔ " + run.route.away + " ↔ " + run.route.panel);
console.log("浏览器 " + run.browser.product + " · " + run.device + " · " + fmt(run.link.bytesPerSecond / 1e6) + " MB/s");
console.log("清单 " + samples.find(sample => sample.step === "first")?.proof.listCount + " 项 · " + (consistentInventory ? "样本内一致" : "不一致"));
console.log();
console.log("| 路径 | 原生 / 面板 N | 原生中位 / p95 ms | 面板中位 / p95 ms | 面板减原生中位 / p95 ms | 面板 SDK 传输 B 中位 / p95 | 原生 / 面板主线程 ms 中位 / p95 |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
let full = completed && consistentInventory && stage === "formal" && count >= 10;
for (const step of ["first", "away", "return", "switch"]) {
  const rows = lane => samples.filter(sample => sample.lane === lane && sample.step === step);
  const native = rows("native");
  const panel = rows("panel");
  full &&= [native, panel].every(list => list.length === count && new Set(list.map(sample => sample.round)).size === count);
  const n = stats(native, sample => sample.durationMs);
  const p = stats(panel, sample => sample.durationMs);
  const delta = p.map((value, index) => value - n[index]);
  compare[step] = { panel, delta };
  const sdk = display(stats(panel, sample => sample.phases.sdk.bytes));
  const busy = lane => display(stats(rows(lane), sample => sample.mainThreadBusyMs));
  console.log("| " + [step, native.length + " / " + panel.length, display(n), display(p), display(delta), sdk,
    busy("native") + " · " + busy("panel")].join(" | ") + " |");
}

const first = compare.first.delta[1] <= 500;
const hot = compare.return.delta[0] <= 200 && compare.return.delta[1] <= 300;
const switchRows = compare.switch.panel;
const rebuild = switchRows.filter(sample => sample.instanceRebuilt === true).length;
const proven = Boolean(run.instanceAttribute && run.lifecycleSource) &&
  switchRows.every(sample => sample.root.before?.stamp && sample.root.after?.stamp && sample.instanceRebuilt !== null);
const label = value => value ? "通过" : "超线";
console.log();
console.log("换选中实例重建 " + rebuild + " / " + switchRows.length + "。实例证据来源 " + (run.lifecycleSource || "仅根 DOM") + "。");
for (const lane of ["native", "panel"]) {
  const rows = samples.filter(sample => sample.lane === lane && sample.preClick);
  console.log(lane + " 首开点击前 SDK 分类传输 B 中位 / p95 " +
    display(stats(rows, sample => sample.preClick.phases.sdk.bytes)) + "。");
}
if (full) {
  const swap = rebuild ? "超线" : proven ? "通过" : "待核实实例生命周期";
  console.log((group === "lan" ? "内网判线" : "本机参考") + " · 首开 " + label(first) + " · 热返回 " + label(hot) + " · 换选中 " + swap);
} else {
  console.log("试跑、未完成或条件不齐，保留数据供排查。");
}

for (const [step, pass] of [["first", first], ["return", hot]]) {
  if (pass || !compare[step].panel.length) continue;
  const worst = [...compare[step].panel].sort((a, b) => a.durationMs - b.durationMs);
  const tail = p95(worst);
  console.log();
  console.log("## " + step + " p95 样本 · 第 " + tail.round + " 轮 · " + fmt(tail.durationMs) + " ms");
  console.log();
  console.log("宿主根出现 " + fmt(tail.root.firstSeenMs) + " ms · 生命周期标记 " +
    (tail.marks.map(mark => mark.name + " " + fmt(mark.offsetMs)).join("、") || "未记录") + "。");
  console.log("各类请求墙钟并集可重叠。脚本 " + fmt(tail.scriptMs) + " ms · 布局及样式 " + fmt(tail.layoutStyleMs) + " ms。");
  console.log();
  console.log("| 类别 | 请求 | 发起 ms | 首包 ms | 完成 ms | 传输 B | 连接 |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const r of tail.requests) {
    console.log("| " + [r.kind, r.method + " " + r.path, fmt(r.startMs), fmt(r.headersAtMs), fmt(r.finishMs),
      r.encodedBytes, r.connectionId ?? "—"].join(" | ") + " |");
  }
}
