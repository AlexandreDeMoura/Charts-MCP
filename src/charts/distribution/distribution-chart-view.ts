import { createTooltipController, type ChartTooltipContent } from "../shared/tooltip";

type DistributionBin = {
  label: string;
  value: number;
  percentage: number;
  cumulative: number;
  color: string;
};

type DistributionData = {
  title: string;
  total: number;
  bins: DistributionBin[];
};

type DistributionChartDom = {
  chartElement: HTMLElement;
  legendElement: HTMLElement;
  titleElement: HTMLElement;
  totalElement: HTMLElement;
  tooltipElement: HTMLElement;
};

type DistributionChartView = {
  renderFromUnknown(raw: unknown): boolean;
  hideTooltip(): void;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const DISTRIBUTION_NEUTRAL_COLOR = "#6b7280";
const DISTRIBUTION_HIGHLIGHT_COLOR = "#3b82f6";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function pickColor(value: unknown, index: number, totalBins: number): string {
  if (isHexColor(value)) {
    return value;
  }

  const highlightStartIndex = Math.floor(totalBins / 2);
  return index >= highlightStartIndex ? DISTRIBUTION_HIGHLIGHT_COLOR : DISTRIBUTION_NEUTRAL_COLOR;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatAxisTick(value: number): string {
  if (value >= 1_000) {
    const compact = value / 1_000;
    const digits = compact >= 10 ? 0 : 1;
    return `${compact.toFixed(digits).replace(/\.0$/, "")}k`;
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

function normalizeDistributionInput(raw: unknown): DistributionData | null {
  if (!isRecord(raw)) {
    return null;
  }

  const inputBins = raw.bins;
  if (!Array.isArray(inputBins) || inputBins.length === 0) {
    return null;
  }

  const normalizedBins: DistributionBin[] = inputBins
    .map((bin, index) => {
      if (!isRecord(bin) || typeof bin.label !== "string" || typeof bin.value !== "number") {
        return null;
      }

      if (!Number.isFinite(bin.value) || bin.value < 0) {
        return null;
      }

      const percentage =
        typeof bin.percentage === "number" && Number.isFinite(bin.percentage) && bin.percentage >= 0
          ? bin.percentage
          : -1;
      const cumulative =
        typeof bin.cumulative === "number" && Number.isFinite(bin.cumulative) && bin.cumulative >= 0
          ? bin.cumulative
          : -1;

      return {
        label: bin.label,
        value: bin.value,
        percentage,
        cumulative,
        color: pickColor(bin.color, index, inputBins.length),
      };
    })
    .filter((bin): bin is DistributionBin => bin !== null);

  if (normalizedBins.length === 0) {
    return null;
  }

  const total =
    typeof raw.total === "number" && Number.isFinite(raw.total) && raw.total > 0
      ? raw.total
      : normalizedBins.reduce((sum, bin) => sum + bin.value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  let cumulativeValue = 0;
  const bins = normalizedBins.map((bin) => {
    cumulativeValue += bin.value;
    const computedPercentage = (bin.value / total) * 100;
    const computedCumulative = (cumulativeValue / total) * 100;

    return {
      ...bin,
      percentage: bin.percentage >= 0 ? bin.percentage : computedPercentage,
      cumulative: bin.cumulative >= 0 ? bin.cumulative : computedCumulative,
    };
  });

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Distribution Chart",
    total,
    bins,
  };
}

export function createDistributionChartView(dom: DistributionChartDom): DistributionChartView {
  const { chartElement, legendElement, titleElement, totalElement, tooltipElement } = dom;
  const { moveTooltip, showTooltip, hideTooltip } = createTooltipController(tooltipElement);

  function renderDistribution(data: DistributionData): void {
    chartElement.innerHTML = "";
    legendElement.innerHTML = "";
    chartElement.classList.add("chart--distribution");
    chartElement.classList.remove("chart--pie", "chart--funnel", "chart--time-series");
    titleElement.textContent = data.title;

    const maxValue = Math.max(...data.bins.map((bin) => bin.value), 0);
    totalElement.textContent = `Total ${formatNumber(data.total)} • Peak ${formatNumber(maxValue)}`;

    const width = 640;
    const height = 420;
    const marginTop = 22;
    const marginRight = 22;
    const marginBottom = 66;
    const marginLeft = 58;
    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;
    const xAxisY = marginTop + plotHeight;
    const yTickCount = 5;
    const safeMaxValue = Math.max(1, maxValue);

    const bucketCount = data.bins.length;
    const gap = bucketCount > 1 ? Math.min(14, Math.max(4, plotWidth / (bucketCount * 4))) : 0;
    const barWidth = bucketCount > 0 ? (plotWidth - gap * (bucketCount - 1)) / bucketCount : plotWidth;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.title);

    for (let tick = 0; tick <= yTickCount; tick += 1) {
      const ratio = tick / yTickCount;
      const y = marginTop + plotHeight - ratio * plotHeight;
      const tickValue = ratio * safeMaxValue;

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", `${marginLeft}`);
      line.setAttribute("y1", `${y}`);
      line.setAttribute("x2", `${marginLeft + plotWidth}`);
      line.setAttribute("y2", `${y}`);
      line.setAttribute("class", "distribution-grid-line");
      svg.appendChild(line);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", `${marginLeft - 10}`);
      label.setAttribute("y", `${y + 4}`);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "distribution-axis-label");
      label.textContent = formatAxisTick(tickValue);
      svg.appendChild(label);
    }

    const yAxisLine = document.createElementNS(SVG_NS, "line");
    yAxisLine.setAttribute("x1", `${marginLeft}`);
    yAxisLine.setAttribute("y1", `${marginTop}`);
    yAxisLine.setAttribute("x2", `${marginLeft}`);
    yAxisLine.setAttribute("y2", `${xAxisY}`);
    yAxisLine.setAttribute("class", "distribution-axis-line");
    svg.appendChild(yAxisLine);

    const xAxisLine = document.createElementNS(SVG_NS, "line");
    xAxisLine.setAttribute("x1", `${marginLeft}`);
    xAxisLine.setAttribute("y1", `${xAxisY}`);
    xAxisLine.setAttribute("x2", `${marginLeft + plotWidth}`);
    xAxisLine.setAttribute("y2", `${xAxisY}`);
    xAxisLine.setAttribute("class", "distribution-axis-line");
    svg.appendChild(xAxisLine);

    const bars: SVGRectElement[] = [];
    const legendItems: HTMLLIElement[] = [];

    const setActiveBucket = (activeIndex: number | null): void => {
      bars.forEach((bar, index) => {
        bar.classList.toggle("is-active", index === activeIndex);
      });

      legendItems.forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
      });
    };

    data.bins.forEach((bin, index) => {
      const x = marginLeft + index * (barWidth + gap);
      const rawBarHeight = (bin.value / safeMaxValue) * plotHeight;
      const barHeight = bin.value > 0 ? Math.max(2, rawBarHeight) : 1;
      const y = xAxisY - barHeight;
      const tooltipContent: ChartTooltipContent = {
        title: bin.label,
        value: formatNumber(bin.value),
        details: `${bin.percentage.toFixed(2)}% • Cumulative ${bin.cumulative.toFixed(2)}%`,
        color: bin.color,
      };

      const bar = document.createElementNS(SVG_NS, "rect");
      bar.setAttribute("x", `${x}`);
      bar.setAttribute("y", `${y}`);
      bar.setAttribute("width", `${barWidth}`);
      bar.setAttribute("height", `${barHeight}`);
      bar.setAttribute("rx", `${Math.max(2, Math.min(8, barWidth / 3))}`);
      bar.setAttribute("fill", bin.color);
      bar.setAttribute("class", "distribution-bar");
      bar.setAttribute("tabindex", "0");
      bars.push(bar);

      bar.addEventListener("pointerenter", (event) => {
        setActiveBucket(index);
        showTooltip(tooltipContent, event.clientX, event.clientY);
      });

      bar.addEventListener("pointermove", (event) => {
        moveTooltip(event.clientX, event.clientY);
      });

      bar.addEventListener("pointerleave", () => {
        setActiveBucket(null);
        hideTooltip();
      });

      bar.addEventListener("focus", () => {
        setActiveBucket(index);
        const rect = bar.getBoundingClientRect();
        showTooltip(tooltipContent, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      bar.addEventListener("blur", () => {
        setActiveBucket(null);
        hideTooltip();
      });

      const xLabel = document.createElementNS(SVG_NS, "text");
      xLabel.setAttribute("x", `${x + barWidth / 2}`);
      xLabel.setAttribute("y", `${xAxisY + 24}`);
      xLabel.setAttribute("text-anchor", "middle");
      xLabel.setAttribute("class", "distribution-x-label");
      xLabel.textContent = bin.label;

      const legendItem = document.createElement("li");
      legendItem.className = "legend-item";
      legendItem.tabIndex = 0;

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = bin.color;

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = bin.label;

      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `${formatNumber(bin.value)} • ${bin.percentage.toFixed(1)}%`;

      legendItem.append(swatch, label, value);
      legendItems.push(legendItem);

      legendItem.addEventListener("pointerenter", () => {
        setActiveBucket(index);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(tooltipContent, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("pointerleave", () => {
        setActiveBucket(null);
        hideTooltip();
      });

      legendItem.addEventListener("focus", () => {
        setActiveBucket(index);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(tooltipContent, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("blur", () => {
        setActiveBucket(null);
        hideTooltip();
      });

      svg.appendChild(bar);
      svg.appendChild(xLabel);
      legendElement.appendChild(legendItem);
    });

    setActiveBucket(null);
    chartElement.appendChild(svg);
  }

  return {
    renderFromUnknown(raw: unknown): boolean {
      const data = normalizeDistributionInput(raw);
      if (!data) {
        return false;
      }

      renderDistribution(data);
      return true;
    },
    hideTooltip,
  };
}
