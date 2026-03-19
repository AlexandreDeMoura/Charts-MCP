import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import { createDistributionChartView } from "./charts/distribution";
import { createFunnelChartView } from "./charts/funnel";
import { createPieChartView } from "./charts/pie";

const chartNode = document.getElementById("chart");
const legendNode = document.getElementById("legend");
const titleNode = document.getElementById("chart-title");
const totalNode = document.getElementById("chart-total");
const tooltipNode = document.getElementById("tooltip");
const chartActionsNode = document.getElementById("chart-actions");
const exportTriggerNode = document.getElementById("export-trigger");
const exportMenuNode = document.getElementById("export-menu");
const exportStatusNode = document.getElementById("export-status");

if (
  !(chartNode instanceof HTMLElement) ||
  !(legendNode instanceof HTMLElement) ||
  !(titleNode instanceof HTMLElement) ||
  !(totalNode instanceof HTMLElement) ||
  !(tooltipNode instanceof HTMLElement) ||
  !(chartActionsNode instanceof HTMLElement) ||
  !(exportTriggerNode instanceof HTMLButtonElement) ||
  !(exportMenuNode instanceof HTMLElement) ||
  !(exportStatusNode instanceof HTMLElement)
) {
  throw new Error("Missing required chart DOM elements.");
}

const chartElement: HTMLElement = chartNode;
const legendElement: HTMLElement = legendNode;
const titleElement: HTMLElement = titleNode;
const totalElement: HTMLElement = totalNode;
const tooltipElement: HTMLElement = tooltipNode;
const chartActionsElement: HTMLElement = chartActionsNode;
const exportTriggerButton: HTMLButtonElement = exportTriggerNode;
const exportMenuElement: HTMLElement = exportMenuNode;
const exportStatusElement: HTMLElement = exportStatusNode;

const exportActionNodes = Array.from(
  exportMenuElement.querySelectorAll<HTMLButtonElement>("[data-export-format]"),
);

if (exportActionNodes.length === 0) {
  throw new Error("Missing required export action buttons.");
}

const pieChartView = createPieChartView({
  chartElement,
  legendElement,
  titleElement,
  totalElement,
  tooltipElement,
});

const funnelChartView = createFunnelChartView({
  chartElement,
  legendElement,
  titleElement,
  totalElement,
  tooltipElement,
});

const distributionChartView = createDistributionChartView({
  chartElement,
  legendElement,
  titleElement,
  totalElement,
  tooltipElement,
});

const app = new App({
  name: "charts-view",
  version: "1.0.0",
});

const SVG_NS = "http://www.w3.org/2000/svg";
const EXPORT_SCALE = 2;
const EXPORT_STYLE_PROPERTIES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "filter",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
] as const;

type ChartView = {
  renderFromUnknown(raw: unknown): boolean;
  hideTooltip(): void;
};

type ExportFormat = "svg" | "png";

type SvgExportPayload = {
  svgText: string;
  width: number;
  height: number;
};

const chartViews: ChartView[] = [distributionChartView, funnelChartView, pieChartView];
let exportMenuOpen = false;
let exportInProgress = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExportFormat(value: string | undefined): value is ExportFormat {
  return value === "svg" || value === "png";
}

function setExportStatus(message: string, state: "info" | "error" = "info"): void {
  if (!message) {
    exportStatusElement.hidden = true;
    exportStatusElement.textContent = "";
    exportStatusElement.removeAttribute("data-state");
    return;
  }

  exportStatusElement.hidden = false;
  exportStatusElement.textContent = message;
  exportStatusElement.dataset.state = state;
}

function setExportMenuOpen(next: boolean): void {
  exportMenuOpen = next;
  exportMenuElement.hidden = !next;
  exportTriggerButton.setAttribute("aria-expanded", next ? "true" : "false");
}

function getCurrentSvgElement(): SVGSVGElement | null {
  const candidate = chartElement.querySelector("svg");
  return candidate instanceof SVGSVGElement ? candidate : null;
}

function updateExportAvailability(): void {
  exportTriggerButton.disabled = exportInProgress || getCurrentSvgElement() === null;
  if (exportTriggerButton.disabled) {
    setExportMenuOpen(false);
  }
}

function sanitizeFilenameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function inferChartKind(): "distribution" | "pie" | "funnel" | "chart" {
  if (chartElement.classList.contains("chart--distribution")) {
    return "distribution";
  }

  if (chartElement.classList.contains("chart--funnel")) {
    return "funnel";
  }

  if (chartElement.classList.contains("chart--pie")) {
    return "pie";
  }

  return "chart";
}

function buildExportFileName(format: ExportFormat): string {
  const titleSegment = sanitizeFilenameSegment(titleElement.textContent?.trim() ?? "") || "chart";
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace("T", "_").replace(/\..+$/, "");
  return `${titleSegment}-${inferChartKind()}-${stamp}.${format}`;
}

function getSvgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox");
  if (typeof viewBox === "string") {
    const parts = viewBox
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseFloat(value));

    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      const width = Math.abs(parts[2]);
      const height = Math.abs(parts[3]);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  }

  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }

  const rect = svg.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || 360),
    height: Math.max(1, rect.height || 360),
  };
}

function inlineSvgStyles(sourceSvg: SVGSVGElement, targetSvg: SVGSVGElement): void {
  const sourceElements: Element[] = [sourceSvg, ...Array.from(sourceSvg.querySelectorAll("*"))];
  const targetElements: Element[] = [targetSvg, ...Array.from(targetSvg.querySelectorAll("*"))];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    if (!targetElement) {
      return;
    }

    const computedStyles = window.getComputedStyle(sourceElement);
    const inlineStyles: string[] = [];

    EXPORT_STYLE_PROPERTIES.forEach((property) => {
      const value = computedStyles.getPropertyValue(property).trim();
      if (!value) {
        return;
      }

      inlineStyles.push(`${property}:${value}`);
    });

    if (inlineStyles.length > 0) {
      targetElement.setAttribute("style", inlineStyles.join(";"));
    }
  });
}

function serializeSvgForExport(svg: SVGSVGElement): SvgExportPayload {
  const { width, height } = getSvgDimensions(svg);
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) {
    throw new Error("Failed to clone chart SVG.");
  }

  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  inlineSvgStyles(svg, clone);
  const svgText = new XMLSerializer().serializeToString(clone);

  return { svgText, width, height };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to encode export file."));
        return;
      }

      const commaIndex = reader.result.indexOf(",");
      resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read export blob."));
    };

    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load generated SVG for PNG export."));
    image.src = url;
  });
}

async function renderPngBlobFromSvg(svgText: string, width: number, height: number): Promise<Blob> {
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const pixelRatio = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const scale = Math.max(EXPORT_SCALE, Math.min(3, Math.ceil(pixelRatio)));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context is unavailable.");
    }

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to encode PNG export."));
          return;
        }

        resolve(blob);
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function publishExportContext(
  format: ExportFormat,
  fileName: string,
  mimeType: string,
  width: number,
  height: number,
  byteLength: number,
): Promise<void> {
  await app
    .updateModelContext({
      content: [
        {
          type: "text",
          text: `Exported chart as ${fileName} (${format.toUpperCase()}, ${width}x${height}).`,
        },
      ],
      structuredContent: {
        export: {
          fileName,
          format,
          mimeType,
          width,
          height,
          byteLength,
          exportedAt: new Date().toISOString(),
        },
      },
    })
    .catch(() => undefined);
}

async function exportChart(format: ExportFormat): Promise<void> {
  if (exportInProgress) {
    return;
  }

  const svg = getCurrentSvgElement();
  if (!svg) {
    setExportStatus("Render a chart before exporting.", "error");
    updateExportAvailability();
    return;
  }

  exportInProgress = true;
  setExportMenuOpen(false);
  updateExportAvailability();
  setExportStatus(`Exporting ${format.toUpperCase()}...`);
  chartViews.forEach((view) => view.hideTooltip());

  try {
    const { svgText, width, height } = serializeSvgForExport(svg);
    const fileName = buildExportFileName(format);
    const uri = `file:///${fileName}`;

    if (format === "svg") {
      const result = await app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri,
              mimeType: "image/svg+xml",
              text: svgText,
            },
          },
        ],
      });

      if (result.isError) {
        throw new Error("Host denied the SVG export.");
      }

      const byteLength = new TextEncoder().encode(svgText).byteLength;
      await publishExportContext(format, fileName, "image/svg+xml", width, height, byteLength);
      await app
        .sendLog({
          level: "info",
          data: { event: "chart_exported", format, fileName, mimeType: "image/svg+xml", width, height },
        })
        .catch(() => undefined);
      setExportStatus(`Exported ${fileName}`);
      return;
    }

    const pngBlob = await renderPngBlobFromSvg(svgText, width, height);
    const pngBase64 = await blobToBase64(pngBlob);
    const result = await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri,
            mimeType: "image/png",
            blob: pngBase64,
          },
        },
      ],
    });

    if (result.isError) {
      throw new Error("Host denied the PNG export.");
    }

    await publishExportContext(format, fileName, "image/png", width, height, pngBlob.size);
    await app
      .sendLog({
        level: "info",
        data: { event: "chart_exported", format, fileName, mimeType: "image/png", width, height },
      })
      .catch(() => undefined);
    setExportStatus(`Exported ${fileName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    setExportStatus(message, "error");
    await app
      .sendLog({
        level: "error",
        data: {
          event: "chart_export_failed",
          format,
          message,
        },
      })
      .catch(() => undefined);
  } finally {
    exportInProgress = false;
    updateExportAvailability();
  }
}

function applyHostContextStyling(ctx: Record<string, unknown> | undefined): void {
  if (!ctx) {
    return;
  }

  if (ctx.theme === "light" || ctx.theme === "dark") {
    applyDocumentTheme(ctx.theme);
  }

  if (
    isRecord(ctx.styles) &&
    isRecord(ctx.styles.variables) &&
    Object.keys(ctx.styles.variables).length > 0
  ) {
    applyHostStyleVariables(
      ctx.styles.variables as Parameters<typeof applyHostStyleVariables>[0],
    );
  }

  if (isRecord(ctx.styles) && isRecord(ctx.styles.css) && typeof ctx.styles.css.fonts === "string") {
    applyHostFonts(ctx.styles.css.fonts);
  }

  if (isRecord(ctx.safeAreaInsets)) {
    const top = typeof ctx.safeAreaInsets.top === "number" ? ctx.safeAreaInsets.top : 0;
    const right = typeof ctx.safeAreaInsets.right === "number" ? ctx.safeAreaInsets.right : 0;
    const bottom = typeof ctx.safeAreaInsets.bottom === "number" ? ctx.safeAreaInsets.bottom : 0;
    const left = typeof ctx.safeAreaInsets.left === "number" ? ctx.safeAreaInsets.left : 0;

    document.documentElement.style.setProperty("--safe-area-top", `${top}px`);
    document.documentElement.style.setProperty("--safe-area-right", `${right}px`);
    document.documentElement.style.setProperty("--safe-area-bottom", `${bottom}px`);
    document.documentElement.style.setProperty("--safe-area-left", `${left}px`);
  }
}

app.ontoolinput = (params) => {
  const rendered = chartViews.some((view) => view.renderFromUnknown(params.arguments));
  if (rendered) {
    setExportStatus("");
  }

  updateExportAvailability();
};

app.ontoolresult = (params) => {
  if (params.isError) {
    chartViews.forEach((view) => view.hideTooltip());
    updateExportAvailability();
    return;
  }

  const rendered = chartViews.some((view) =>
    view.renderFromUnknown((params as { structuredContent?: unknown }).structuredContent),
  );
  if (rendered) {
    setExportStatus("");
  }

  updateExportAvailability();
};

app.onhostcontextchanged = (ctx) => {
  applyHostContextStyling(ctx);
};

app.onteardown = async () => {
  chartViews.forEach((view) => view.hideTooltip());
  return {};
};

exportTriggerButton.addEventListener("click", () => {
  if (exportTriggerButton.disabled) {
    return;
  }

  setExportMenuOpen(!exportMenuOpen);
});

exportActionNodes.forEach((button) => {
  button.addEventListener("click", () => {
    const format = button.dataset.exportFormat;
    if (!isExportFormat(format)) {
      return;
    }

    void exportChart(format);
  });
});

document.addEventListener("click", (event) => {
  if (!exportMenuOpen) {
    return;
  }

  if (!(event.target instanceof Node)) {
    return;
  }

  if (!chartActionsElement.contains(event.target)) {
    setExportMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  setExportMenuOpen(false);
});

async function bootstrap(): Promise<void> {
  await app.connect();
  applyHostContextStyling(app.getHostContext() as Record<string, unknown> | undefined);
  updateExportAvailability();
}

bootstrap().catch((error) => {
  console.error("Failed to initialize charts app:", error);
});
