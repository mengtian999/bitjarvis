#!/usr/bin/env node

// generate-appx-assets.cjs — 生成 AppX/MSIX 磁贴资源到 build/appx/
//
// build/ 不进版本库（见 .gitignore），所以这四个 PNG 必须在打包前现生成，
// 否则 electron-builder 会回落到 winCodeSign 工具集里的 SampleAppx 占位图，
// 应用在开始菜单和商店页面上就会顶着别人的图标。
//
// 下采样与 generate-windows-icon.cjs 同一套：按目标像素反投影到源图做面积平均，
// 透明区域按 alpha 加权，不做锐化，避免小尺寸下出现锯齿和暗边。
// 与 .ico 不同的是，磁贴要的是"内容居中、四周留白"的构图：先裁到不透明内容的
// 包围盒，再等比缩放进目标画布并留出固定内边距。

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "desktop", "src", "icon.png");
const TARGET_DIR = path.join(ROOT, "build", "appx");
const PADDING_RATIO = 0.08;

// 名字是 AppxManifest 里的硬约定，改文件名等于改清单。
const TILES = [
  ["StoreLogo.png", 50, 50],
  ["Square44x44Logo.png", 44, 44],
  ["Square150x150Logo.png", 150, 150],
  ["Wide310x150Logo.png", 310, 150],
];

function alphaAt(source, x, y) {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return 0;
  return source.data[(y * source.width + x) * 4 + 3];
}

// 源图四周有留白（1024 画布里内容只占约 810px），直接整图缩放会让磁贴里的
// 图标显得偏小，所以先找出不透明内容的包围盒作为构图基准。
function opaqueBounds(source) {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (alphaAt(source, x, y) <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return { x: 0, y: 0, width: source.width, height: source.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function sampleArea(source, left, top, right, bottom) {
  const x0 = Math.floor(left);
  const x1 = Math.ceil(right);
  const y0 = Math.floor(top);
  const y1 = Math.ceil(bottom);
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (let sy = y0; sy < y1; sy++) {
    if (sy < 0 || sy >= source.height) continue;
    const oy = Math.max(0, Math.min(bottom, sy + 1) - Math.max(top, sy));
    if (oy <= 0) continue;

    for (let sx = x0; sx < x1; sx++) {
      if (sx < 0 || sx >= source.width) continue;
      const ox = Math.max(0, Math.min(right, sx + 1) - Math.max(left, sx));
      if (ox <= 0) continue;

      const weight = ox * oy;
      const index = (sy * source.width + sx) * 4;
      const alpha = source.data[index + 3] / 255;
      const weightedAlpha = alpha * weight;
      r += source.data[index] * weightedAlpha;
      g += source.data[index + 1] * weightedAlpha;
      b += source.data[index + 2] * weightedAlpha;
      a += weightedAlpha;
      total += weight;
    }
  }

  if (total === 0 || a === 0) return [0, 0, 0, 0];

  return [
    Math.round(r / a),
    Math.round(g / a),
    Math.round(b / a),
    Math.round((a / total) * 255),
  ];
}

function renderTile(source, bounds, width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  const pad = Math.round(Math.min(width, height) * PADDING_RATIO);
  const scale = Math.min(
    (width - pad * 2) / bounds.width,
    (height - pad * 2) / bounds.height,
  );
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  const originX = (width - drawWidth) / 2;
  const originY = (height - drawHeight) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = bounds.x + (x - originX) / scale;
      const top = bounds.y + (y - originY) / scale;
      const right = bounds.x + (x + 1 - originX) / scale;
      const bottom = bounds.y + (y + 1 - originY) / scale;
      const [r, g, b, a] = sampleArea(source, left, top, right, bottom);
      const index = (y * width + x) * 4;

      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = a;
    }
  }

  return png;
}

function main() {
  const source = PNG.sync.read(fs.readFileSync(SOURCE));
  const bounds = opaqueBounds(source);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const written = [];
  for (const [name, width, height] of TILES) {
    const png = renderTile(source, bounds, width, height);
    fs.writeFileSync(path.join(TARGET_DIR, name), PNG.sync.write(png, { colorType: 6 }));
    written.push(`${name} (${width}x${height})`);
  }

  console.log(
    `Generated build/appx/${written.join(", ")} from ${path.relative(ROOT, SOURCE)} `
    + `[content ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}]`,
  );
}

main();