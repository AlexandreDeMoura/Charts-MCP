import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

type PieSlice = {
  label: string;
  value: number;
  percentage: number;
  color: string;
};

type PieData = {
  title: string;
  total: number;
  slices: PieSlice[];
};

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
];

const chartNode = document.getElementById("chart");
const tooltipNode = document.getElementById("tooltip");

if (!(chartNode instanceof HTMLElement) || !(tooltipNode instanceof HTMLElement)) {
  throw new Error("Missing required chart DOM elements.");
}

const chartElement: HTMLElement = chartNode;
const tooltipElement: HTMLElement = tooltipNode;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHexColor(value: unknown, fallbackIndex: number): string {
  if (typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    return value;
  }

  return DEFAULT_COLORS[fallbackIndex % DEFAULT_COLORS.length];
}

function normalizePieInput(raw: unknown): PieData | null {
  if (!isRecord(raw)) {
    return null;
  }

  const inputSlices = raw.slices;
  if (!Array.isArray(inputSlices) || inputSlices.length === 0) {
    return null;
  }

  const normalizedSlices: PieSlice[] = inputSlices
    .map((slice, index) => {
      if (!isRecord(slice) || typeof slice.label !== "string" || typeof slice.value !== "number") {
        return null;
      }

      if (!Number.isFinite(slice.value) || slice.value <= 0) {
        return null;
      }

      const normalizedPercentage =
        typeof slice.percentage === "number" && Number.isFinite(slice.percentage)
          ? slice.percentage
          : 0;

      return {
        label: slice.label,
        value: slice.value,
        percentage: normalizedPercentage,
        color: normalizeHexColor(slice.color, index),
      };
    })
    .filter((slice): slice is PieSlice => slice !== null);

  if (normalizedSlices.length === 0) {
    return null;
  }

  const inputTotal = typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : 0;
  const total = inputTotal > 0 ? inputTotal : normalizedSlices.reduce((sum, slice) => sum + slice.value, 0);

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  const slices = normalizedSlices.map((slice) => {
    const percentage = slice.percentage > 0 ? slice.percentage : (slice.value / total) * 100;

    return {
      ...slice,
      percentage,
    };
  });

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Pie Chart",
    total,
    slices,
  };
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function buildSlicePath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;

  if (sweep >= 360) {
    return [
      `M ${centerX} ${centerY}`,
      `m 0 -${radius}`,
      `a ${radius} ${radius} 0 1 1 0 ${radius * 2}`,
      `a ${radius} ${radius} 0 1 1 0 -${radius * 2}`,
      "z",
    ].join(" ");
  }

  const start = polarToCartesian(centerX, centerY, radius, startAngle);
  const end = polarToCartesian(centerX, centerY, radius, endAngle);
  const largeArcFlag = sweep > 180 ? "1" : "0";

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function moveTooltip(x: number, y: number): void {
  const margin = 8;
  const offset = 12;
  const maxX = window.innerWidth - tooltipElement.offsetWidth - margin;
  const maxY = window.innerHeight - tooltipElement.offsetHeight - margin;

  tooltipElement.style.left = `${clamp(x + offset, margin, maxX)}px`;
  tooltipElement.style.top = `${clamp(y + offset, margin, maxY)}px`;
}

function showTooltip(text: string, x: number, y: number): void {
  tooltipElement.textContent = text;
  tooltipElement.hidden = false;
  moveTooltip(x, y);
}

function hideTooltip(): void {
  tooltipElement.hidden = true;
}

function renderPieChart(data: PieData): void {
  chartElement.innerHTML = "";

  const size = 360;
  const center = size / 2;
  const radius = 160;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", data.title);

  let startAngle = 0;

  data.slices.forEach((slice) => {
    const sweep = (slice.value / data.total) * 360;
    if (sweep <= 0) {
      return;
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", buildSlicePath(center, center, radius, startAngle, startAngle + sweep));
    path.setAttribute("fill", slice.color);
    path.setAttribute("class", "slice");
    path.setAttribute("tabindex", "0");

    const tooltipText = `${slice.label}: ${slice.value} (${slice.percentage.toFixed(2)}%)`;

    path.addEventListener("pointerenter", (event) => {
      showTooltip(tooltipText, event.clientX, event.clientY);
    });

    path.addEventListener("pointermove", (event) => {
      moveTooltip(event.clientX, event.clientY);
    });

    path.addEventListener("pointerleave", () => {
      hideTooltip();
    });

    path.addEventListener("focus", () => {
      const rect = path.getBoundingClientRect();
      showTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    path.addEventListener("blur", () => {
      hideTooltip();
    });

    svg.appendChild(path);
    startAngle += sweep;
  });

  chartElement.appendChild(svg);
}

const app = new App({
  name: "pie-chart-view",
  version: "1.0.0",
});

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

    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

app.ontoolinput = (params) => {
  const data = normalizePieInput(params.arguments);
  if (data) {
    renderPieChart(data);
  }
};

app.ontoolresult = (params) => {
  if (params.isError) {
    hideTooltip();
    return;
  }

  const data = normalizePieInput((params as { structuredContent?: unknown }).structuredContent);
  if (data) {
    renderPieChart(data);
  }
};

app.onhostcontextchanged = (ctx) => {
  applyHostContextStyling(ctx);
};

app.onteardown = async () => {
  hideTooltip();
  return {};
};

async function bootstrap(): Promise<void> {
  await app.connect();
  applyHostContextStyling(app.getHostContext() as Record<string, unknown> | undefined);
}

bootstrap().catch((error) => {
  console.error("Failed to initialize pie chart app:", error);
});
