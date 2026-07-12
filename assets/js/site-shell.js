(() => {
  "use strict";

  const root = document.documentElement;
  const THEME_KEY = "bagisto-theme";

  const all = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const normalizedText = (element) => element?.textContent?.replace(/\s+/g, " ").trim() || "";

  function themeSwitches() {
    return all('input[type="checkbox"][role="switch"]');
  }

  function storedTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;

    if (root.classList.contains("dark")) return "dark";
    if (root.classList.contains("light")) return "light";

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme, persist = true) {
    const dark = theme === "dark";

    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    root.style.colorScheme = dark ? "dark" : "light";

    themeSwitches().forEach((input) => {
      input.checked = dark;
      input.setAttribute("aria-checked", String(dark));

      const label = input.closest("label");
      if (label) label.dataset.selected = String(dark);
    });

    if (persist) localStorage.setItem(THEME_KEY, theme);
  }

  function initTheme() {
    applyTheme(storedTheme(), false);

    themeSwitches().forEach((input) => {
      input.addEventListener("change", () => {
        applyTheme(input.checked ? "dark" : "light");
      });
    });
  }

  function dialogs() {
    return all('[role="dialog"]');
  }

  function dialogHeading(dialog) {
    return normalizedText(dialog.querySelector("h1, h2, h3"));
  }

  function findDialog(name) {
    const expected = name.toLowerCase();
    return dialogs().find((dialog) => dialogHeading(dialog).toLowerCase() === expected);
  }

  function overlayFor(dialog) {
    const previous = dialog?.previousElementSibling;
    if (!previous) return null;

    return previous.classList.contains("fixed") && previous.classList.contains("inset-0")
      ? previous
      : null;
  }

  function setOverlayState(overlay, open) {
    if (!overlay) return;

    overlay.classList.toggle("opacity-0", !open);
    overlay.classList.toggle("opacity-100", open);
    overlay.classList.toggle("pointer-events-none", !open);
    overlay.hidden = false;
  }

  function openDialog(dialog) {
    if (!dialog) return;

    dialog.hidden = false;
    dialog.classList.remove("translate-x-full");
    dialog.classList.add("translate-x-0");
    dialog.setAttribute("aria-hidden", "false");

    setOverlayState(overlayFor(dialog), true);
    document.body.style.overflow = "hidden";

    const focusTarget = dialog.querySelector("input, button, [href], select, textarea");
    window.setTimeout(() => focusTarget?.focus(), 50);
  }

  function closeDialog(dialog) {
    if (!dialog) return;

    dialog.classList.remove("translate-x-0");
    dialog.classList.add("translate-x-full");
    dialog.setAttribute("aria-hidden", "true");

    setOverlayState(overlayFor(dialog), false);
    document.body.style.overflow = "";
  }

  function initDialogs() {
    dialogs().forEach((dialog) => {
      closeDialog(dialog);

      const overlay = overlayFor(dialog);
      overlay?.addEventListener("click", () => closeDialog(dialog));

      const firstButton = dialog.querySelector("button");
      firstButton?.addEventListener("click", () => closeDialog(dialog));
    });

    all("header button").forEach((button) => {
      let sibling = button.nextElementSibling;

      while (sibling && sibling.getAttribute("role") !== "dialog") {
        sibling = sibling.nextElementSibling;
      }

      if (sibling?.getAttribute("role") === "dialog") {
        button.addEventListener("click", () => openDialog(sibling));
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      dialogs()
        .filter((dialog) => !dialog.classList.contains("translate-x-full"))
        .forEach(closeDialog);
    });
  }

  function initMobileNavigation() {
    const cartDialog = findDialog("Shopping Cart");

    all("button").forEach((button) => {
      const text = normalizedText(button);

      if (text === "Cart") {
        button.addEventListener("click", () => openDialog(cartDialog));
      }

      if (text === "Categories") {
        button.addEventListener("click", () => {
          window.location.href = "/search";
        });
      }

      if (text === "Account") {
        button.addEventListener("click", () => {
          window.location.href = "/customer-details";
        });
      }
    });
  }

  function initProductGallery() {
    const mainImage = document.querySelector("main img.object-cover.transition-transform");
    if (!mainImage) return;

    const thumbnailButtons = all("main button").filter((button) => {
      return Boolean(button.querySelector("img")) && button.classList.contains("aspect-square");
    });

    thumbnailButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const image = button.querySelector("img");
        if (!image?.src) return;

        mainImage.src = image.src;
        mainImage.srcset = image.srcset || "";

        thumbnailButtons.forEach((item) => {
          item.classList.remove("border-neutral-900", "dark:border-white", "ring-2");
          item.classList.add("border-transparent");
        });

        button.classList.remove("border-transparent");
        button.classList.add("border-neutral-900", "dark:border-white", "ring-2");
      });
    });
  }

  function initQuantityControls() {
    all("main").forEach((main) => {
      all("div", main).forEach((container) => {
        const buttons = [...container.children].filter((child) => child.tagName === "BUTTON");
        if (buttons.length !== 2) return;

        const valueNode = [...container.children].find((child) => {
          return child.tagName === "DIV" && /^\d+$/.test(normalizedText(child));
        });

        if (!valueNode) return;

        const [decrease, increase] = buttons;
        decrease.addEventListener("click", () => {
          const current = Number.parseInt(normalizedText(valueNode), 10) || 1;
          valueNode.textContent = String(Math.max(1, current - 1));
        });

        increase.addEventListener("click", () => {
          const current = Number.parseInt(normalizedText(valueNode), 10) || 1;
          valueNode.textContent = String(current + 1);
        });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initDialogs();
    initMobileNavigation();
    initProductGallery();
    initQuantityControls();
  });
})();
