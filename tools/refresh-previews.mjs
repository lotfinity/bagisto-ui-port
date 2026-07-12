import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const explicitFiles = process.argv.slice(2);

function collectPreviewFiles(directory) {
  const results = [];

  if (!fs.existsSync(directory)) return results;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectPreviewFiles(absolute));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith("-preview.html")) {
      results.push(absolute);
    }
  }

  return results;
}

const previewFiles = explicitFiles.length
  ? explicitFiles.map((file) => path.resolve(root, file))
  : collectPreviewFiles(path.resolve(root, "pages"));

if (!previewFiles.length) {
  console.log("No preview HTML files found.");
  process.exit(0);
}

const themeCss = path.resolve(root, "assets/css/bagisto-theme.css");
const fixesCss = path.resolve(root, "assets/css/port-fixes.css");
const shellJs = path.resolve(root, "assets/js/site-shell.js");

for (const required of [themeCss, fixesCss, shellJs]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Missing required asset: ${required}`);
  }
}

function relativeUrl(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
}

function removeExistingInjectedAssets(html) {
  return html
    .replace(/\s*<link[^>]+data-bagisto-port-css[^>]*>\s*/gi, "\n")
    .replace(/\s*<link[^>]+data-bagisto-port-fixes[^>]*>\s*/gi, "\n")
    .replace(/\s*<script[^>]+data-bagisto-theme-bootstrap[^>]*>[\s\S]*?<\/script>\s*/gi, "\n")
    .replace(/\s*<script[^>]+data-bagisto-shell-js[^>]*><\/script>\s*/gi, "\n");
}

for (const previewFile of previewFiles) {
  if (!fs.existsSync(previewFile)) {
    console.warn(`Skipping missing preview: ${previewFile}`);
    continue;
  }

  let html = fs.readFileSync(previewFile, "utf8");
  html = removeExistingInjectedAssets(html);

  if (!html.includes("</head>") || !html.includes("</body>")) {
    console.warn(`Skipping malformed HTML: ${previewFile}`);
    continue;
  }

  const themeHref = relativeUrl(previewFile, themeCss);
  const fixesHref = relativeUrl(previewFile, fixesCss);
  const shellSrc = relativeUrl(previewFile, shellJs);

  const headAssets = [
    '<script data-bagisto-theme-bootstrap>',
    '(() => {',
    '  try {',
    '    const saved = localStorage.getItem("bagisto-theme");',
    '    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;',
    '    const dark = saved === "dark" || (saved !== "light" && prefersDark);',
    '    document.documentElement.classList.toggle("dark", dark);',
    '    document.documentElement.classList.toggle("light", !dark);',
    '    document.documentElement.style.colorScheme = dark ? "dark" : "light";',
    '  } catch (_) {}',
    '})();',
    '</script>',
    `<link rel="stylesheet" href="${themeHref}" data-bagisto-port-css>`,
    `<link rel="stylesheet" href="${fixesHref}" data-bagisto-port-fixes>`,
    "",
  ].join("\n");

  const bodyAsset = `<script src="${shellSrc}" data-bagisto-shell-js defer></script>\n`;

  html = html.replace("</head>", `${headAssets}</head>`);
  html = html.replace("</body>", `${bodyAsset}</body>`);

  fs.writeFileSync(previewFile, html);
  console.log(`Refreshed ${path.relative(root, previewFile)}`);
}
