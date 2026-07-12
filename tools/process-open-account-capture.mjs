import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import * as cheerio from "cheerio";

const root = process.cwd();
const name = "index-account-menu-open";
const captureDir = path.join(root, "captures/home", name);
const analysisDir = path.join(root, "analysis/home", name);
const pagesDir = path.join(root, "pages/home");
const encodedCapture = path.join(captureDir, `${name}.singlefile.html.gz.b64`);
const rawCapture = path.join(captureDir, `${name}.singlefile.html`);
const cleanPage = path.join(pagesDir, `${name}.html`);
const previewPage = path.join(pagesDir, `${name}-preview.html`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

if (!fs.existsSync(encodedCapture)) {
  throw new Error(`Missing encoded capture: ${encodedCapture}`);
}

fs.mkdirSync(captureDir, { recursive: true });
fs.mkdirSync(analysisDir, { recursive: true });
fs.mkdirSync(pagesDir, { recursive: true });

const encoded = fs.readFileSync(encodedCapture, "utf8").replace(/\s+/g, "");
const compressed = Buffer.from(encoded, "base64");
const html = zlib.gunzipSync(compressed).toString("utf8");
fs.writeFileSync(rawCapture, html);
console.log(`Decoded ${path.relative(root, rawCapture)}`);

run(process.execPath, [
  "tools/analyze-page.mjs",
  path.relative(root, rawCapture),
  "assets/css/bagisto-theme.css",
  path.relative(root, analysisDir),
]);

run(process.execPath, [
  "tools/clean-page.mjs",
  path.relative(root, rawCapture),
  path.relative(root, cleanPage),
]);

let cleaned = fs.readFileSync(cleanPage, "utf8");
const $ = cheerio.load(cleaned, { decodeEntities: false });

let accountDialog = null;
$('[role="dialog"]').each((_, element) => {
  const dialog = $(element);
  const text = dialog.text().replace(/\s+/g, " ").trim();

  if (text.includes("Go to Account") || (text.includes("Wishlist") && text.includes("Addresses"))) {
    accountDialog = dialog;
    return false;
  }
});

if (!accountDialog) {
  throw new Error("The captured open Account dialog could not be identified.");
}

accountDialog.attr("data-preview-open", "true");
cleaned = $.html();
fs.writeFileSync(cleanPage, cleaned);
fs.writeFileSync(previewPage, cleaned);

run(process.execPath, [
  "tools/refresh-previews.mjs",
  path.relative(root, previewPage),
]);

let preview = fs.readFileSync(previewPage, "utf8");
const preserveOpenScript = `
<script data-preview-open-account>
window.addEventListener("load", () => {
  const dialog = document.querySelector('[role="dialog"][data-preview-open="true"]');
  if (!dialog) return;

  dialog.hidden = false;
  dialog.classList.remove("translate-x-full");
  dialog.classList.add("translate-x-0");
  dialog.setAttribute("aria-hidden", "false");

  if (dialog.parentElement) dialog.parentElement.hidden = false;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
});
</script>
`;

preview = preview.replace("</body>", `${preserveOpenScript}</body>`);
fs.writeFileSync(previewPage, preview);

const accountSection = path.join(analysisDir, "sections/01-account-dialog.html");
fs.mkdirSync(path.dirname(accountSection), { recursive: true });
fs.writeFileSync(accountSection, accountDialog.toString());

const captureNote = [
  "OPEN ACCOUNT DRAWER CAPTURE",
  "===========================",
  "",
  "This capture was saved while the logged-in Account drawer was visibly open.",
  "The drawer includes Wishlist, Addresses, and the Go to Account action.",
  "The preview intentionally reopens this drawer after the shared shell initializes.",
  "",
].join("\n");
fs.writeFileSync(path.join(analysisDir, "account-drawer-note.txt"), captureNote);

console.log(`Generated ${path.relative(root, cleanPage)}`);
console.log(`Generated ${path.relative(root, previewPage)}`);
console.log(`Extracted ${path.relative(root, accountSection)}`);
