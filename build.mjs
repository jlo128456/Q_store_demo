// Builds one self-contained page: dist/index.html (what GitHub Pages serves)
import { build } from "esbuild";
import { readFileSync, writeFileSync, rmSync } from "fs";
await build({ entryPoints: ["src/main.jsx"], bundle: true, minify: true, outdir: "dist/tmp", format: "iife",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, target: "es2019" });
const js = readFileSync("dist/tmp/main.js", "utf8").replace(/<\/script/g, "<\\/script");
const css = readFileSync("dist/tmp/main.css", "utf8");
writeFileSync("dist/index.html", `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q Store Demo</title><style>${css}</style></head>
<body><div id="root"></div>
<script>new MutationObserver(()=>{for(const c of document.querySelectorAll('.stack td:not([data-l])')){let i=0,p=c;while(p=p.previousElementSibling)i+=p.colSpan;const h=c.closest('table').rows[0].cells[i];c.dataset.l=h?h.textContent:''}}).observe(document,{childList:true,subtree:true});</script>
<script>${js}</script></body></html>`);
console.log("built", (js.length/1024).toFixed(0)+"KB js");
rmSync("dist/tmp", { recursive: true, force: true });
