import fs from "node:fs";
import * as cheerio from "cheerio";

const input =
  process.argv[2] ??
  "captured/smartphones/smartphones.singlefile.html";

const output =
  process.argv[3] ??
  "smartphones-analysis/smartphones-port.html";

const html = fs.readFileSync(input, "utf8");
const $ = cheerio.load(html, {
  decodeEntities: false,
});

/* Remove framework and SingleFile runtime content. */
$("script, style, noscript").remove();

$(
  "link[rel='stylesheet'], link[rel='preload'], link[rel='modulepreload']"
).remove();

$(
  "meta[http-equiv='content-security-policy'], meta[name='generator']"
).remove();

/* Remove Next.js internal markers. */
$("[data-nextjs-scroll-focus-boundary]").removeAttr(
  "data-nextjs-scroll-focus-boundary"
);

$("[data-nextjs-toast]").remove();
$("#__next-build-watcher").remove();

/* Clean generated and ineffective class names. */
$("[class]").each((_, element) => {
  const node = $(element);

  const classes = String(node.attr("class") || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((className) => !className.startsWith("dsv-"))
    .filter((className) => className !== "fill-ptimary");

  if (classes.length) {
    node.attr("class", [...new Set(classes)].join(" "));
  } else {
    node.removeAttr("class");
  }
});

/* Remove React hydration attributes and event remnants. */
$("*").each((_, element) => {
  const node = $(element);

  for (const attribute of Object.keys(element.attribs || {})) {
    if (
      attribute.startsWith("data-react") ||
      attribute.startsWith("data-next") ||
      attribute === "nonce"
    ) {
      node.removeAttr(attribute);
    }
  }
});

/* Remove empty comments left by React. */
$.root()
  .contents()
  .filter((_, node) => node.type === "comment")
  .remove();

const result = "<!DOCTYPE html>\n" + $.html();

fs.writeFileSync(output, result);

console.log(`Created: ${output}`);
console.log(`Size: ${(Buffer.byteLength(result) / 1024).toFixed(2)} KB`);
console.log(`Elements: ${$("*").length}`);
console.log(`Scripts: ${$("script").length}`);
console.log(`Styles: ${$("style").length}`);
