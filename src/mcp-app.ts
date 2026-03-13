import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";

import { createFunnelChartView } from "./charts/funnel";
import { createPieChartView } from "./charts/pie";

const chartNode = document.getElementById("chart");
const legendNode = document.getElementById("legend");
const titleNode = document.getElementById("chart-title");
const totalNode = document.getElementById("chart-total");
const tooltipNode = document.getElementById("tooltip");

if (
  !(chartNode instanceof HTMLElement) ||
  !(legendNode instanceof HTMLElement) ||
  !(titleNode instanceof HTMLElement) ||
  !(totalNode instanceof HTMLElement) ||
  !(tooltipNode instanceof HTMLElement)
) {
  throw new Error("Missing required chart DOM elements.");
}

const pieChartView = createPieChartView({
  chartElement: chartNode,
  legendElement: legendNode,
  titleElement: titleNode,
  totalElement: totalNode,
  tooltipElement: tooltipNode,
});

const funnelChartView = createFunnelChartView({
  chartElement: chartNode,
  legendElement: legendNode,
  titleElement: titleNode,
  totalElement: totalNode,
  tooltipElement: tooltipNode,
});

const app = new App({
  name: "charts-view",
  version: "1.0.0",
});

type ChartView = {
  renderFromUnknown(raw: unknown): boolean;
  hideTooltip(): void;
};

const chartViews: ChartView[] = [funnelChartView, pieChartView];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  chartViews.some((view) => view.renderFromUnknown(params.arguments));
};

app.ontoolresult = (params) => {
  if (params.isError) {
    chartViews.forEach((view) => view.hideTooltip());
    return;
  }

  chartViews.some((view) =>
    view.renderFromUnknown((params as { structuredContent?: unknown }).structuredContent),
  );
};

app.onhostcontextchanged = (ctx) => {
  applyHostContextStyling(ctx);
};

app.onteardown = async () => {
  chartViews.forEach((view) => view.hideTooltip());
  return {};
};

async function bootstrap(): Promise<void> {
  await app.connect();
  applyHostContextStyling(app.getHostContext() as Record<string, unknown> | undefined);
}

bootstrap().catch((error) => {
  console.error("Failed to initialize charts app:", error);
});
