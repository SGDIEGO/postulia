import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas } from "canvas";

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  return ctx;
}

const S = 512;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext("2d");

const grad = ctx.createLinearGradient(0, 0, 0, S);
grad.addColorStop(0, "#3563f7");
grad.addColorStop(1, "#1b34b9");
ctx.fillStyle = grad;
roundRect(ctx, 0, 0, S, S, 112).fill();

ctx.fillStyle = "#fff";
roundRect(ctx, 122, 210, 268, 182, 34).fill();
roundRect(ctx, 206, 146, 100, 86, 26).fill();
ctx.clearRect(232, 172, 48, 68);

ctx.fillStyle = "#2144e4";
roundRect(ctx, 122, 284, 268, 22, 10).fill();
roundRect(ctx, 232, 264, 48, 62, 12).fill();
ctx.fillStyle = "#fff";
roundRect(ctx, 242, 282, 28, 26, 6).fill();

const cx = 372, cy = 376, cr = 92;
ctx.fillStyle = "#fff";
ctx.beginPath(); ctx.arc(cx, cy, cr + 14, 0, Math.PI * 2); ctx.fill();
ctx.fillStyle = "#22c55e";
ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
ctx.strokeStyle = "#fff";
ctx.lineWidth = 22;
ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.beginPath();
ctx.moveTo(cx - 44, cy + 2);
ctx.lineTo(cx - 12, cy + 34);
ctx.lineTo(cx + 46, cy - 34);
ctx.stroke();

const outDir = resolve("public/icon");
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const small = createCanvas(size, size);
  const sctx = small.getContext("2d");
  sctx.drawImage(canvas, 0, 0, size, size);
  writeFileSync(resolve(outDir, `${size}.png`), small.toBuffer("image/png"));
}
console.log("Iconos generados en public/icon/");
