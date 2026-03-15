type FunnelStep = {
  label: string;
  value: number;
  percentage: number;
  color: string;
  dropOff: number;
};

type FunnelData = {
  title: string;
  total: number;
  steps: FunnelStep[];
};

type FunnelChartDom = {
  chartElement: HTMLElement;
  legendElement: HTMLElement;
  titleElement: HTMLElement;
  totalElement: HTMLElement;
  tooltipElement: HTMLElement;
};

type FunnelChartView = {
  renderFromUnknown(raw: unknown): boolean;
  hideTooltip(): void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHexColor(value: unknown, fallbackIndex: number): string {
  if (typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    return value;
  }

  return DEFAULT_COLORS[fallbackIndex % DEFAULT_COLORS.length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function normalizeFunnelInput(raw: unknown): FunnelData | null {
  if (!isRecord(raw)) {
    return null;
  }

  const inputSteps = raw.steps;
  if (!Array.isArray(inputSteps) || inputSteps.length === 0) {
    return null;
  }

  const normalizedSteps: FunnelStep[] = inputSteps
    .map((step, index) => {
      if (!isRecord(step) || typeof step.label !== "string" || typeof step.value !== "number") {
        return null;
      }

      if (!Number.isFinite(step.value) || step.value <= 0) {
        return null;
      }

      const percentage =
        typeof step.percentage === "number" && Number.isFinite(step.percentage) ? step.percentage : 0;
      const dropOff = typeof step.dropOff === "number" && Number.isFinite(step.dropOff) ? step.dropOff : -1;

      return {
        label: step.label,
        value: step.value,
        percentage,
        color: normalizeHexColor(step.color, index),
        dropOff,
      };
    })
    .filter((step): step is FunnelStep => step !== null);

  if (normalizedSteps.length === 0) {
    return null;
  }

  const firstStepValue = normalizedSteps[0]?.value ?? 0;
  if (!Number.isFinite(firstStepValue) || firstStepValue <= 0) {
    return null;
  }

  const total =
    typeof raw.total === "number" && Number.isFinite(raw.total) && raw.total > 0
      ? raw.total
      : normalizedSteps.reduce((sum, step) => sum + step.value, 0);

  const steps = normalizedSteps.map((step, index) => {
    const computedPercentage = (step.value / firstStepValue) * 100;
    const computedDropOff = index === 0 ? 0 : Math.max((normalizedSteps[index - 1]?.value ?? step.value) - step.value, 0);

    return {
      ...step,
      percentage: step.percentage > 0 ? step.percentage : computedPercentage,
      dropOff: step.dropOff >= 0 ? step.dropOff : computedDropOff,
    };
  });

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Funnel Chart",
    total,
    steps,
  };
}

function buildTrapezoidPath(centerX: number, yTop: number, yBottom: number, topWidth: number, bottomWidth: number): string {
  const leftTopX = centerX - topWidth / 2;
  const rightTopX = centerX + topWidth / 2;
  const rightBottomX = centerX + bottomWidth / 2;
  const leftBottomX = centerX - bottomWidth / 2;

  return [
    `M ${leftTopX} ${yTop}`,
    `L ${rightTopX} ${yTop}`,
    `L ${rightBottomX} ${yBottom}`,
    `L ${leftBottomX} ${yBottom}`,
    "Z",
  ].join(" ");
}

export function createFunnelChartView(dom: FunnelChartDom): FunnelChartView {
  const { chartElement, legendElement, titleElement, totalElement, tooltipElement } = dom;

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

  function renderFunnel(data: FunnelData): void {
    chartElement.innerHTML = "";
    legendElement.innerHTML = "";
    chartElement.classList.add("chart--funnel");
    chartElement.classList.remove("chart--pie");
    titleElement.textContent = data.title;
    const startValue = data.steps[0].value;
    const endValue = data.steps[data.steps.length - 1].value;
    totalElement.textContent = `Start ${formatNumber(startValue)} • End ${formatNumber(endValue)}`;

    const width = 360;
    const height = 560;
    const topPadding = 16;
    const bottomPadding = 16;
    const segmentGap = 7;
    const maxBodyWidth = 304;
    const minBodyWidth = 86;
    const maxValue = Math.max(...data.steps.map((step) => step.value));

    const usableHeight = height - topPadding - bottomPadding;
    const segmentHeight = usableHeight / data.steps.length;
    const centerX = width / 2;

    const widthForValue = (value: number): number => {
      if (maxValue <= 0) {
        return minBodyWidth;
      }

      const ratio = value / maxValue;
      return minBodyWidth + ratio * (maxBodyWidth - minBodyWidth);
    };

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.title);

    const segments: SVGPathElement[] = [];
    const legendItems: HTMLLIElement[] = [];

    const setActiveStep = (activeIndex: number | null): void => {
      segments.forEach((segment, index) => {
        segment.classList.toggle("is-active", index === activeIndex);
      });

      legendItems.forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
      });
    };

    data.steps.forEach((step, index) => {
      const topWidth = widthForValue(step.value);
      const nextValue = data.steps[index + 1]?.value ?? step.value * 0.58;
      const bottomWidth = Math.max(widthForValue(nextValue), minBodyWidth * 0.6);
      const yTop = topPadding + index * segmentHeight;
      const yBottom = yTop + segmentHeight - segmentGap;

      const segment = document.createElementNS(SVG_NS, "path");
      segment.setAttribute("d", buildTrapezoidPath(centerX, yTop, yBottom, topWidth, bottomWidth));
      segment.setAttribute("fill", step.color);
      segment.setAttribute("class", "funnel-segment");
      segment.setAttribute("tabindex", "0");
      segments.push(segment);

      const tooltipText = [
        `${step.label}: ${formatNumber(step.value)}`,
        `${step.percentage.toFixed(1)}% of first step`,
        `Drop-off ${formatNumber(step.dropOff)}`,
      ].join(" • ");

      segment.addEventListener("pointerenter", (event) => {
        setActiveStep(index);
        showTooltip(tooltipText, event.clientX, event.clientY);
      });

      segment.addEventListener("pointermove", (event) => {
        moveTooltip(event.clientX, event.clientY);
      });

      segment.addEventListener("pointerleave", () => {
        setActiveStep(null);
        hideTooltip();
      });

      segment.addEventListener("focus", () => {
        setActiveStep(index);
        const rect = segment.getBoundingClientRect();
        showTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      segment.addEventListener("blur", () => {
        setActiveStep(null);
        hideTooltip();
      });

      const legendItem = document.createElement("li");
      legendItem.className = "legend-item";
      legendItem.tabIndex = 0;

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = step.color;

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = step.label;

      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `${formatNumber(step.value)} • ${step.percentage.toFixed(1)}%`;

      legendItem.append(swatch, label, value);
      legendItems.push(legendItem);

      legendItem.addEventListener("pointerenter", () => {
        setActiveStep(index);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("pointerleave", () => {
        setActiveStep(null);
        hideTooltip();
      });

      legendItem.addEventListener("focus", () => {
        setActiveStep(index);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(tooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("blur", () => {
        setActiveStep(null);
        hideTooltip();
      });

      legendElement.appendChild(legendItem);
      svg.appendChild(segment);
    });

    setActiveStep(null);
    chartElement.appendChild(svg);
  }

  return {
    renderFromUnknown(raw: unknown): boolean {
      const data = normalizeFunnelInput(raw);
      if (!data) {
        return false;
      }

      renderFunnel(data);
      return true;
    },
    hideTooltip,
  };
}
