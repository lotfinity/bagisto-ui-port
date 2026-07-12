import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const htmlPath = path.resolve(
  process.argv[2] ||
  "captured/smartphones/smartphones.singlefile.html"
);

const cssPath = path.resolve(
  process.argv[3] ||
  "extracted-theme/bagisto-theme.css"
);

const outputDir = path.resolve(
  process.argv[4] ||
  "smartphones-analysis"
);

if (!fs.existsSync(htmlPath)) {
  console.error(`HTML capture not found:\n${htmlPath}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) {
  console.error(`Compiled CSS not found:\n${cssPath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const sectionsDir = path.join(outputDir, "sections");
fs.mkdirSync(sectionsDir, { recursive: true });

const html = fs.readFileSync(htmlPath, "utf8");
const compiledCss = fs.readFileSync(cssPath, "utf8");

const $ = cheerio.load(html, {
  decodeEntities: false,
});

const htmlClassFrequency = new Map();
const classSamples = new Map();
const tagFrequency = new Map();
const ids = new Set();

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortedByFrequency(map) {
  return [...map.entries()].sort(
    ([classA, countA], [classB, countB]) =>
      countB - countA || classA.localeCompare(classB)
  );
}

function describeElement(element) {
  const selection = $(element);
  const tag = element.tagName || element.name || "unknown";
  const id = selection.attr("id");
  const classes = String(selection.attr("class") || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

  const text = selection
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return [
    `<${tag}`,
    id ? `#${id}` : "",
    classes.length ? `.${classes.join(".")}` : "",
    ">",
    text ? ` ${JSON.stringify(text)}` : "",
  ].join("");
}

$("*").each((_, element) => {
  const tag = element.tagName || element.name;

  if (tag) {
    increment(tagFrequency, tag.toLowerCase());
  }

  const selection = $(element);
  const id = selection.attr("id");

  if (id) {
    ids.add(id);
  }

  const rawClasses = selection.attr("class");

  if (!rawClasses) {
    return;
  }

  const classes = String(rawClasses)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const className of classes) {
    increment(htmlClassFrequency, className);

    if (!classSamples.has(className)) {
      classSamples.set(className, []);
    }

    const samples = classSamples.get(className);

    if (samples.length < 4) {
      const description = describeElement(element);

      if (!samples.includes(description)) {
        samples.push(description);
      }
    }
  }
});

const htmlClasses = new Set(htmlClassFrequency.keys());

function extractClassesFromSelector(selector) {
  const found = new Set();

  try {
    selectorParser((selectors) => {
      selectors.walkClasses((classNode) => {
        found.add(classNode.value);
      });
    }).processSync(selector);
  } catch {
    // Some browser-generated selectors may be unparsable.
  }

  return found;
}

function extractClassesFromRoot(root) {
  const result = new Set();

  root.walkRules((rule) => {
    for (const className of extractClassesFromSelector(rule.selector)) {
      result.add(className);
    }
  });

  return result;
}

let compiledRoot;

try {
  compiledRoot = postcss.parse(compiledCss, {
    from: cssPath,
  });
} catch (error) {
  console.error("Compiled CSS could not be parsed:");
  console.error(error.message);
  process.exit(1);
}

const compiledClasses = extractClassesFromRoot(compiledRoot);

const inlineClasses = new Set();
const inlineStyleErrors = [];
let inlineRuleCount = 0;
let inlineCssBytes = 0;

$("style").each((index, styleElement) => {
  const styleText = $(styleElement).html() || "";

  inlineCssBytes += Buffer.byteLength(styleText);

  if (!styleText.trim()) {
    return;
  }

  try {
    const styleRoot = postcss.parse(styleText, {
      from: `inline-style-${index + 1}`,
    });

    styleRoot.walkRules(() => {
      inlineRuleCount += 1;
    });

    for (const className of extractClassesFromRoot(styleRoot)) {
      inlineClasses.add(className);
    }
  } catch (error) {
    inlineStyleErrors.push({
      style: index + 1,
      error: error.message,
    });
  }
});

const htmlClassesInCompiled = new Set(
  [...htmlClasses].filter((className) =>
    compiledClasses.has(className)
  )
);

const htmlClassesMissingFromCompiled = new Set(
  [...htmlClasses].filter(
    (className) => !compiledClasses.has(className)
  )
);

const htmlClassesInInlineCss = new Set(
  [...htmlClasses].filter((className) =>
    inlineClasses.has(className)
  )
);

const htmlClassesMissingFromAllCss = new Set(
  [...htmlClasses].filter(
    (className) =>
      !compiledClasses.has(className) &&
      !inlineClasses.has(className)
  )
);

const inlineOnlyClasses = new Set(
  [...inlineClasses].filter(
    (className) => !compiledClasses.has(className)
  )
);

const compiledUnusedOnPage = new Set(
  [...compiledClasses].filter(
    (className) => !htmlClasses.has(className)
  )
);

const totalClassUses = [...htmlClassFrequency.values()].reduce(
  (sum, count) => sum + count,
  0
);

const compiledMatchedUses = [...htmlClassFrequency.entries()]
  .filter(([className]) => compiledClasses.has(className))
  .reduce((sum, [, count]) => sum + count, 0);

const uniqueCoverage = htmlClasses.size
  ? (htmlClassesInCompiled.size / htmlClasses.size) * 100
  : 0;

const weightedCoverage = totalClassUses
  ? (compiledMatchedUses / totalClassUses) * 100
  : 0;

function writeLines(filename, values) {
  fs.writeFileSync(
    path.join(outputDir, filename),
    sorted(values).join("\n") + "\n"
  );
}

function writeFrequencyFile(filename, classSet) {
  const rows = sortedByFrequency(htmlClassFrequency)
    .filter(([className]) => classSet.has(className))
    .map(([className, count]) => {
      const samples = classSamples.get(className) || [];

      return [
        count,
        className,
        samples.join(" | "),
      ].join("\t");
    });

  fs.writeFileSync(
    path.join(outputDir, filename),
    ["count\tclass\tsamples", ...rows].join("\n") + "\n"
  );
}

writeLines("html-classes.txt", htmlClasses);
writeLines("compiled-css-classes.txt", compiledClasses);
writeLines("inline-css-classes.txt", inlineClasses);
writeLines("html-classes-in-compiled-css.txt", htmlClassesInCompiled);
writeLines(
  "html-classes-missing-from-compiled-css.txt",
  htmlClassesMissingFromCompiled
);
writeLines(
  "html-classes-missing-from-all-css.txt",
  htmlClassesMissingFromAllCss
);
writeLines("inline-only-classes.txt", inlineOnlyClasses);
writeLines(
  "compiled-classes-unused-on-smartphones.txt",
  compiledUnusedOnPage
);

writeFrequencyFile(
  "class-frequency.tsv",
  htmlClasses
);

writeFrequencyFile(
  "missing-from-compiled-with-context.tsv",
  htmlClassesMissingFromCompiled
);

writeFrequencyFile(
  "missing-from-all-css-with-context.tsv",
  htmlClassesMissingFromAllCss
);

fs.writeFileSync(
  path.join(outputDir, "tag-frequency.tsv"),
  [
    "count\ttag",
    ...[...tagFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => `${count}\t${tag}`),
  ].join("\n") + "\n"
);

fs.writeFileSync(
  path.join(outputDir, "ids.txt"),
  sorted(ids).join("\n") + "\n"
);

/*
 * Create a readable DOM outline.
 */
const outlineLines = [];

function walkOutline(element, depth = 0) {
  if (!element || element.type !== "tag") {
    return;
  }

  const tag = (element.tagName || element.name || "").toLowerCase();

  if (
    ["script", "style", "path", "meta", "link", "noscript"].includes(tag)
  ) {
    return;
  }

  const selection = $(element);
  const id = selection.attr("id");
  const classes = String(selection.attr("class") || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let label = `${"  ".repeat(depth)}${tag}`;

  if (id) {
    label += `#${id}`;
  }

  if (classes.length) {
    const displayedClasses = classes.slice(0, 10);
    label += `.${displayedClasses.join(".")}`;

    if (classes.length > displayedClasses.length) {
      label += ` [+${classes.length - displayedClasses.length}]`;
    }
  }

  if (
    ["h1", "h2", "h3", "h4", "h5", "button", "label"].includes(tag)
  ) {
    const text = selection
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);

    if (text) {
      label += ` — ${text}`;
    }
  }

  outlineLines.push(label);

  for (const child of element.children || []) {
    walkOutline(child, depth + 1);
  }
}

$("body")
  .children()
  .each((_, element) => walkOutline(element));

fs.writeFileSync(
  path.join(outputDir, "dom-outline.txt"),
  outlineLines.join("\n") + "\n"
);

/*
 * Extract cleaned body and main HTML.
 */
function cleanClone(selection) {
  const clone = selection.clone();

  clone
    .find("script, style, link[rel='stylesheet'], noscript")
    .remove();

  return clone;
}

const bodyClone = cleanClone($("body").first());

fs.writeFileSync(
  path.join(outputDir, "smartphones-body-clean.html"),
  $.html(bodyClone)
);

const mainSelection = $("main").first();

if (mainSelection.length) {
  const mainClone = cleanClone(mainSelection);

  fs.writeFileSync(
    path.join(outputDir, "smartphones-main-clean.html"),
    $.html(mainClone)
  );
}

/*
 * Extract direct children of <main> as separate porting units.
 */
const sectionRoot = mainSelection.length
  ? mainSelection
  : $("body").first();

sectionRoot.children().each((index, element) => {
  const selection = $(element);
  const clone = cleanClone(selection);

  const heading = selection
    .find("h1, h2, h3")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const slug =
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) ||
    `${element.tagName || element.name || "section"}`;

  const filename =
    `${String(index + 1).padStart(2, "0")}-${slug}.html`;

  fs.writeFileSync(
    path.join(sectionsDir, filename),
    $.html(clone)
  );
});

/*
 * Produce an analysis-only CSS subset containing rules whose classes
 * appear on this captured page. Keep global rules, variables, fonts,
 * properties and keyframes.
 */
function shouldKeepRule(rule) {
  const classes = extractClassesFromSelector(rule.selector);

  if (classes.size === 0) {
    return true;
  }

  if (classes.has("dark")) {
    return true;
  }

  return [...classes].some((className) =>
    htmlClasses.has(className)
  );
}

function copyFilteredNodes(sourceContainer, targetContainer) {
  for (const node of sourceContainer.nodes || []) {
    if (node.type === "rule") {
      if (shouldKeepRule(node)) {
        targetContainer.append(node.clone());
      }

      continue;
    }

    if (node.type === "atrule") {
      if (
        /keyframes$/i.test(node.name) ||
        ["font-face", "property", "charset"].includes(node.name)
      ) {
        targetContainer.append(node.clone());
        continue;
      }

      if (node.nodes?.length) {
        const clonedAtRule = node.clone({
          nodes: [],
        });

        copyFilteredNodes(node, clonedAtRule);

        if (clonedAtRule.nodes.length) {
          targetContainer.append(clonedAtRule);
        }

        continue;
      }

      targetContainer.append(node.clone());
      continue;
    }

    if (node.type === "comment") {
      targetContainer.append(node.clone());
    }
  }
}

const pageCssRoot = postcss.root();
copyFilteredNodes(compiledRoot, pageCssRoot);

fs.writeFileSync(
  path.join(outputDir, "smartphones-used-rules.css"),
  pageCssRoot.toString()
);

/*
 * High-level interactive elements.
 */
const interactiveRows = [];

$("button, input, select, textarea, form, details, dialog, [role], a[href]")
  .each((_, element) => {
    const selection = $(element);
    const tag = element.tagName || element.name || "";
    const role = selection.attr("role") || "";
    const type = selection.attr("type") || "";
    const href = selection.attr("href") || "";
    const id = selection.attr("id") || "";
    const classes = selection.attr("class") || "";
    const text = selection
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);

    interactiveRows.push([
      tag,
      role,
      type,
      id,
      href,
      classes,
      text,
    ]);
  });

fs.writeFileSync(
  path.join(outputDir, "interactive-elements.tsv"),
  [
    "tag\trole\ttype\tid\thref\tclasses\ttext",
    ...interactiveRows.map((row) => row.join("\t")),
  ].join("\n") + "\n"
);

const report = {
  page: {
    title: $("title").text().trim(),
    htmlBytes: Buffer.byteLength(html),
    elements: $("*").length,
    bodyElements: $("body *").length,
    hasMain: mainSelection.length > 0,
    styleTags: $("style").length,
    scriptTags: $("script").length,
    stylesheetLinks: $("link[rel='stylesheet']").length,
    images: $("img").length,
    links: $("a[href]").length,
    buttons: $("button").length,
    forms: $("form").length,
    inputs: $("input, select, textarea").length,
  },

  classes: {
    totalClassUses,
    htmlUnique: htmlClasses.size,
    compiledCssUnique: compiledClasses.size,
    inlineCssUnique: inlineClasses.size,
    htmlFoundInCompiled: htmlClassesInCompiled.size,
    htmlMissingFromCompiled: htmlClassesMissingFromCompiled.size,
    htmlFoundInInlineCss: htmlClassesInInlineCss.size,
    htmlMissingFromAllCss: htmlClassesMissingFromAllCss.size,
    inlineOnly: inlineOnlyClasses.size,
    compiledUnusedOnPage: compiledUnusedOnPage.size,
    uniqueCompiledCoveragePercent: Number(
      uniqueCoverage.toFixed(2)
    ),
    weightedCompiledCoveragePercent: Number(
      weightedCoverage.toFixed(2)
    ),
  },

  inlineCss: {
    bytes: inlineCssBytes,
    rules: inlineRuleCount,
    parseErrors: inlineStyleErrors,
  },
};

fs.writeFileSync(
  path.join(outputDir, "report.json"),
  JSON.stringify(report, null, 2)
);

const topMissing = sortedByFrequency(htmlClassFrequency)
  .filter(([className]) =>
    htmlClassesMissingFromCompiled.has(className)
  )
  .slice(0, 25);

const summary = [
  "SMARTPHONES HTML ↔ CSS ANALYSIS",
  "================================",
  "",
  `Title: ${report.page.title}`,
  `HTML size: ${(report.page.htmlBytes / 1024 / 1024).toFixed(2)} MB`,
  `Elements: ${report.page.elements}`,
  `Images: ${report.page.images}`,
  `Links: ${report.page.links}`,
  `Buttons: ${report.page.buttons}`,
  `Forms: ${report.page.forms}`,
  `Style tags: ${report.page.styleTags}`,
  `Script tags: ${report.page.scriptTags}`,
  "",
  `HTML unique classes: ${report.classes.htmlUnique}`,
  `Compiled CSS classes: ${report.classes.compiledCssUnique}`,
  `Inline CSS classes: ${report.classes.inlineCssUnique}`,
  `HTML classes found in compiled CSS: ${report.classes.htmlFoundInCompiled}`,
  `HTML classes missing from compiled CSS: ${report.classes.htmlMissingFromCompiled}`,
  `HTML classes missing from all CSS: ${report.classes.htmlMissingFromAllCss}`,
  `Compiled CSS unique coverage: ${report.classes.uniqueCompiledCoveragePercent}%`,
  `Compiled CSS weighted coverage: ${report.classes.weightedCompiledCoveragePercent}%`,
  "",
  "Top classes missing from compiled CSS:",
  ...topMissing.map(
    ([className, count]) => `  ${count} × ${className}`
  ),
  "",
  `Output directory: ${outputDir}`,
].join("\n");

fs.writeFileSync(
  path.join(outputDir, "summary.txt"),
  summary + "\n"
);

console.log(`\n${summary}\n`);
