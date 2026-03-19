type AxisSide = "left" | "right";
type LineStyle = "solid" | "dashed";

type TimePoint = {
  time: string;
  value: number;
  annotation?: string;
};

type TimeSeries = {
  name: string;
  axis: AxisSide;
  lineStyle: LineStyle;
  fillArea: boolean;
  color: string;
  min: number;
  max: number;
  latest: number;
  points: TimePoint[];
};

type TimeSeriesData = {
  title: string;
  totalPoints: number;
  leftAxisLabel: string;
  rightAxisLabel: string;
  xValues: string[];
  series: TimeSeries[];
};

type TimeSeriesChartDom = {
  chartElement: HTMLElement;
  legendElement: HTMLElement;
  titleElement: HTMLElement;
  totalElement: HTMLElement;
  tooltipElement: HTMLElement;
};

type TimeSeriesChartView = {
  renderFromUnknown(raw: unknown): boolean;
  hideTooltip(): void;
};

type PointCoordinate = {
  x: number;
  y: number;
  point: TimePoint;
};

type AxisDomain = {
  min: number;
  max: number;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_COLORS = [
  "#1f77b4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
  "#f97316",
  "#14b8a6",
  "#e11d48",
  "#6366f1",
];
const GRID_TICK_COUNT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function pickColor(value: unknown, index: number): string {
  if (isHexColor(value)) {
    return value;
  }

  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatAxisTick(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000) {
    const compact = value / 1_000;
    const digits = Math.abs(compact) >= 10 ? 0 : 1;
    return `${compact.toFixed(digits).replace(/\.0$/, "")}k`;
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: absolute >= 100 ? 0 : 1,
  });
}

function buildSmoothLinePath(points: PointCoordinate[]): string {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    const first = points[0];
    return `M ${first.x} ${first.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;

    const controlPoint1X = p1.x + (p2.x - p0.x) / 6;
    const controlPoint1Y = p1.y + (p2.y - p0.y) / 6;
    const controlPoint2X = p2.x - (p3.x - p1.x) / 6;
    const controlPoint2Y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${p2.x} ${p2.y}`;
  }

  return path;
}

function buildAreaPath(points: PointCoordinate[], baselineY: number): string {
  if (points.length === 0) {
    return "";
  }

  const linePath = buildSmoothLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];

  return `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function computeNiceDomain(values: number[]): AxisDomain {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }

  let rawMin = Math.min(...values);
  let rawMax = Math.max(...values);

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return { min: 0, max: 1 };
  }

  if (rawMin === rawMax) {
    const pad = Math.max(1, Math.abs(rawMin) * 0.1);
    rawMin -= pad;
    rawMax += pad;
  }

  const span = rawMax - rawMin;
  const roughStep = Math.max(span / GRID_TICK_COUNT, Number.MIN_VALUE);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;

  let stepMultiplier = 10;
  if (normalized <= 1) {
    stepMultiplier = 1;
  } else if (normalized <= 2) {
    stepMultiplier = 2;
  } else if (normalized <= 5) {
    stepMultiplier = 5;
  }

  const step = stepMultiplier * magnitude;
  const min = Math.floor(rawMin / step) * step;
  const max = Math.ceil(rawMax / step) * step;

  if (min === max) {
    return {
      min: min - step,
      max: max + step,
    };
  }

  return { min, max };
}

function normalizeTimeSeriesInput(raw: unknown): TimeSeriesData | null {
  if (!isRecord(raw)) {
    return null;
  }

  const inputSeries = raw.series;
  if (!Array.isArray(inputSeries) || inputSeries.length === 0) {
    return null;
  }

  const discoveredXValues: string[] = [];
  const discoveredSet = new Set<string>();
  const normalizedSeries: TimeSeries[] = [];

  inputSeries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      return;
    }

    const inputPoints = entry.points;
    if (!Array.isArray(inputPoints) || inputPoints.length < 2) {
      return;
    }

    const points: TimePoint[] = [];

    inputPoints.forEach((point) => {
      if (!isRecord(point) || typeof point.time !== "string" || typeof point.value !== "number") {
        return;
      }

      if (!Number.isFinite(point.value)) {
        return;
      }

      const trimmedTime = point.time.trim();
      const time = trimmedTime.length > 0 ? trimmedTime : point.time;
      if (time.length === 0) {
        return;
      }

      if (!discoveredSet.has(time)) {
        discoveredSet.add(time);
        discoveredXValues.push(time);
      }

      const trimmedAnnotation =
        typeof point.annotation === "string" && point.annotation.trim().length > 0
          ? point.annotation.trim()
          : undefined;

      if (trimmedAnnotation) {
        points.push({
          time,
          value: point.value,
          annotation: trimmedAnnotation,
        });
        return;
      }

      points.push({
        time,
        value: point.value,
      });
    });

    if (points.length < 2) {
      return;
    }

    const values = points.map((point) => point.value);
    const axis: AxisSide = entry.axis === "right" ? "right" : "left";
    const lineStyle: LineStyle = entry.lineStyle === "dashed" ? "dashed" : axis === "right" ? "dashed" : "solid";

    normalizedSeries.push({
      name: entry.name.trim() || `Series ${index + 1}`,
      axis,
      lineStyle,
      fillArea: typeof entry.fillArea === "boolean" ? entry.fillArea : index === 0,
      color: pickColor(entry.color, index),
      min: Math.min(...values),
      max: Math.max(...values),
      latest: values[values.length - 1] ?? values[0],
      points,
    });
  });

  if (normalizedSeries.length === 0) {
    return null;
  }

  const providedXValues =
    Array.isArray(raw.xValues) && raw.xValues.length > 0
      ? raw.xValues
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];

  const xValues: string[] = [];
  const xValueSet = new Set<string>();

  providedXValues.forEach((value) => {
    if (xValueSet.has(value)) {
      return;
    }

    xValueSet.add(value);
    xValues.push(value);
  });

  discoveredXValues.forEach((value) => {
    if (xValueSet.has(value)) {
      return;
    }

    xValueSet.add(value);
    xValues.push(value);
  });

  if (xValues.length < 2) {
    return null;
  }

  const xOrder = new Map(xValues.map((value, index) => [value, index]));

  const sortedSeries: TimeSeries[] = [];

  normalizedSeries.forEach((entry) => {
    const sortedPoints = [...entry.points]
      .filter((point) => xOrder.has(point.time))
      .sort((a, b) => {
        const aIndex = xOrder.get(a.time) ?? 0;
        const bIndex = xOrder.get(b.time) ?? 0;
        return aIndex - bIndex;
      });

    if (sortedPoints.length < 2) {
      return;
    }

    const values = sortedPoints.map((point) => point.value);

    sortedSeries.push({
      ...entry,
      min: Math.min(...values),
      max: Math.max(...values),
      latest: values[values.length - 1] ?? values[0],
      points: sortedPoints,
    });
  });

  if (sortedSeries.length === 0) {
    return null;
  }

  const totalPoints =
    typeof raw.totalPoints === "number" && Number.isFinite(raw.totalPoints) && raw.totalPoints > 0
      ? raw.totalPoints
      : xValues.length;

  return {
    title:
      typeof raw.title === "string" && raw.title.trim().length > 0
        ? raw.title.trim()
        : "Annotated Time Series",
    totalPoints,
    leftAxisLabel:
      typeof raw.leftAxisLabel === "string" && raw.leftAxisLabel.trim().length > 0
        ? raw.leftAxisLabel.trim()
        : "Left Axis",
    rightAxisLabel:
      typeof raw.rightAxisLabel === "string" && raw.rightAxisLabel.trim().length > 0
        ? raw.rightAxisLabel.trim()
        : "Right Axis",
    xValues,
    series: sortedSeries,
  };
}

export function createAnnotatedTimeSeriesChartView(dom: TimeSeriesChartDom): TimeSeriesChartView {
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

  function renderTimeSeries(data: TimeSeriesData): void {
    chartElement.innerHTML = "";
    legendElement.innerHTML = "";
    chartElement.classList.add("chart--time-series");
    chartElement.classList.remove("chart--pie", "chart--funnel", "chart--distribution");
    titleElement.textContent = data.title;

    const annotationCount = data.series.reduce(
      (sum, entry) => sum + entry.points.filter((point) => typeof point.annotation === "string").length,
      0,
    );
    totalElement.textContent = `${formatNumber(data.totalPoints)} points • ${formatNumber(annotationCount)} annotations`;

    const width = 720;
    const height = 430;
    const marginTop = 24;
    const marginRight = 70;
    const marginBottom = 76;
    const marginLeft = 70;
    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;
    const xAxisY = marginTop + plotHeight;

    const xValues = data.xValues;
    const xOrder = new Map(xValues.map((value, index) => [value, index]));
    const labelStride = xValues.length > 8 ? Math.ceil(xValues.length / 6) : 1;

    const leftAxisValues = data.series
      .filter((entry) => entry.axis === "left")
      .flatMap((entry) => entry.points.map((point) => point.value));
    const rightAxisValues = data.series
      .filter((entry) => entry.axis === "right")
      .flatMap((entry) => entry.points.map((point) => point.value));
    const fallbackValues = data.series.flatMap((entry) => entry.points.map((point) => point.value));
    const hasRightAxisSeries = rightAxisValues.length > 0;

    const leftDomain = computeNiceDomain(leftAxisValues.length > 0 ? leftAxisValues : fallbackValues);
    const rightDomain = computeNiceDomain(rightAxisValues.length > 0 ? rightAxisValues : fallbackValues);

    const domainHeightFor = (axis: AxisSide): number => {
      const domain = axis === "right" ? rightDomain : leftDomain;
      return Math.max(1e-9, domain.max - domain.min);
    };

    const xForIndex = (index: number): number => {
      if (xValues.length <= 1) {
        return marginLeft + plotWidth / 2;
      }

      return marginLeft + (index / (xValues.length - 1)) * plotWidth;
    };

    const yForValue = (value: number, axis: AxisSide): number => {
      const domain = axis === "right" ? rightDomain : leftDomain;
      const ratio = (value - domain.min) / domainHeightFor(axis);
      return marginTop + plotHeight - ratio * plotHeight;
    };

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", data.title);

    for (let tick = 0; tick <= GRID_TICK_COUNT; tick += 1) {
      const ratio = tick / GRID_TICK_COUNT;
      const y = marginTop + plotHeight - ratio * plotHeight;
      const leftTickValue = leftDomain.min + ratio * (leftDomain.max - leftDomain.min);
      const rightTickValue = rightDomain.min + ratio * (rightDomain.max - rightDomain.min);

      const gridLine = document.createElementNS(SVG_NS, "line");
      gridLine.setAttribute("x1", `${marginLeft}`);
      gridLine.setAttribute("y1", `${y}`);
      gridLine.setAttribute("x2", `${marginLeft + plotWidth}`);
      gridLine.setAttribute("y2", `${y}`);
      gridLine.setAttribute("class", "time-series-grid-line");
      svg.appendChild(gridLine);

      const leftLabel = document.createElementNS(SVG_NS, "text");
      leftLabel.setAttribute("x", `${marginLeft - 12}`);
      leftLabel.setAttribute("y", `${y + 4}`);
      leftLabel.setAttribute("text-anchor", "end");
      leftLabel.setAttribute("class", "time-series-axis-label");
      leftLabel.textContent = formatAxisTick(leftTickValue);
      svg.appendChild(leftLabel);

      if (hasRightAxisSeries) {
        const rightLabel = document.createElementNS(SVG_NS, "text");
        rightLabel.setAttribute("x", `${marginLeft + plotWidth + 12}`);
        rightLabel.setAttribute("y", `${y + 4}`);
        rightLabel.setAttribute("text-anchor", "start");
        rightLabel.setAttribute("class", "time-series-axis-label");
        rightLabel.textContent = formatAxisTick(rightTickValue);
        svg.appendChild(rightLabel);
      }
    }

    const leftAxisLine = document.createElementNS(SVG_NS, "line");
    leftAxisLine.setAttribute("x1", `${marginLeft}`);
    leftAxisLine.setAttribute("y1", `${marginTop}`);
    leftAxisLine.setAttribute("x2", `${marginLeft}`);
    leftAxisLine.setAttribute("y2", `${xAxisY}`);
    leftAxisLine.setAttribute("class", "time-series-axis-line");
    svg.appendChild(leftAxisLine);

    const xAxisLine = document.createElementNS(SVG_NS, "line");
    xAxisLine.setAttribute("x1", `${marginLeft}`);
    xAxisLine.setAttribute("y1", `${xAxisY}`);
    xAxisLine.setAttribute("x2", `${marginLeft + plotWidth}`);
    xAxisLine.setAttribute("y2", `${xAxisY}`);
    xAxisLine.setAttribute("class", "time-series-axis-line");
    svg.appendChild(xAxisLine);

    if (hasRightAxisSeries) {
      const rightAxisLine = document.createElementNS(SVG_NS, "line");
      rightAxisLine.setAttribute("x1", `${marginLeft + plotWidth}`);
      rightAxisLine.setAttribute("y1", `${marginTop}`);
      rightAxisLine.setAttribute("x2", `${marginLeft + plotWidth}`);
      rightAxisLine.setAttribute("y2", `${xAxisY}`);
      rightAxisLine.setAttribute("class", "time-series-axis-line");
      svg.appendChild(rightAxisLine);
    }

    const leftAxisTitle = document.createElementNS(SVG_NS, "text");
    leftAxisTitle.setAttribute("x", "18");
    leftAxisTitle.setAttribute("y", `${marginTop + plotHeight / 2}`);
    leftAxisTitle.setAttribute("transform", `rotate(-90 18 ${marginTop + plotHeight / 2})`);
    leftAxisTitle.setAttribute("text-anchor", "middle");
    leftAxisTitle.setAttribute("class", "time-series-axis-title");
    leftAxisTitle.textContent = data.leftAxisLabel;
    svg.appendChild(leftAxisTitle);

    if (hasRightAxisSeries) {
      const rightAxisTitle = document.createElementNS(SVG_NS, "text");
      rightAxisTitle.setAttribute("x", `${width - 18}`);
      rightAxisTitle.setAttribute("y", `${marginTop + plotHeight / 2}`);
      rightAxisTitle.setAttribute("transform", `rotate(90 ${width - 18} ${marginTop + plotHeight / 2})`);
      rightAxisTitle.setAttribute("text-anchor", "middle");
      rightAxisTitle.setAttribute("class", "time-series-axis-title");
      rightAxisTitle.textContent = data.rightAxisLabel;
      svg.appendChild(rightAxisTitle);
    }

    xValues.forEach((value, index) => {
      if (index % labelStride !== 0 && index !== xValues.length - 1) {
        return;
      }

      const x = xForIndex(index);
      const xLabel = document.createElementNS(SVG_NS, "text");
      xLabel.setAttribute("x", `${x}`);
      xLabel.setAttribute("y", `${xAxisY + 26}`);
      xLabel.setAttribute("text-anchor", "end");
      xLabel.setAttribute("class", "time-series-x-label");
      xLabel.setAttribute("transform", `rotate(-42 ${x} ${xAxisY + 26})`);
      xLabel.textContent = value;
      svg.appendChild(xLabel);
    });

    const seriesGroups: SVGGElement[] = [];
    const legendItems: HTMLLIElement[] = [];

    const setActiveSeries = (activeIndex: number | null): void => {
      seriesGroups.forEach((group, index) => {
        group.classList.toggle("is-active", index === activeIndex);
        group.classList.toggle("is-muted", activeIndex !== null && index !== activeIndex);
      });

      legendItems.forEach((item, index) => {
        item.classList.toggle("is-active", index === activeIndex);
      });
    };

    data.series.forEach((entry, seriesIndex) => {
      const points: PointCoordinate[] = entry.points
        .map((point) => {
          const index = xOrder.get(point.time);
          if (typeof index !== "number") {
            return null;
          }

          return {
            x: xForIndex(index),
            y: yForValue(point.value, entry.axis),
            point,
          };
        })
        .filter((point): point is PointCoordinate => point !== null);

      if (points.length < 2) {
        return;
      }

      const seriesGroup = document.createElementNS(SVG_NS, "g");
      seriesGroup.setAttribute("class", "time-series-series");

      if (entry.fillArea) {
        const areaPath = document.createElementNS(SVG_NS, "path");
        areaPath.setAttribute("d", buildAreaPath(points, xAxisY));
        areaPath.setAttribute("fill", entry.color);
        areaPath.setAttribute("class", "time-series-area");
        seriesGroup.appendChild(areaPath);
      }

      const linePath = document.createElementNS(SVG_NS, "path");
      linePath.setAttribute("d", buildSmoothLinePath(points));
      linePath.setAttribute("stroke", entry.color);
      linePath.setAttribute(
        "class",
        entry.lineStyle === "dashed" ? "time-series-line time-series-line--dashed" : "time-series-line",
      );
      linePath.setAttribute("tabindex", "0");
      seriesGroup.appendChild(linePath);

      const latestPoint = points[points.length - 1]?.point;
      const axisName = entry.axis === "left" ? data.leftAxisLabel : data.rightAxisLabel;
      const seriesAnnotationCount = points.filter((point) => typeof point.point.annotation === "string").length;
      const seriesTooltipText = [
        `${entry.name} (${axisName})`,
        `Latest ${formatNumber(entry.latest)}`,
        `${seriesAnnotationCount} annotation${seriesAnnotationCount === 1 ? "" : "s"}`,
      ].join(" • ");

      linePath.addEventListener("pointerenter", (event) => {
        setActiveSeries(seriesIndex);
        showTooltip(seriesTooltipText, event.clientX, event.clientY);
      });

      linePath.addEventListener("pointermove", (event) => {
        moveTooltip(event.clientX, event.clientY);
      });

      linePath.addEventListener("pointerleave", () => {
        setActiveSeries(null);
        hideTooltip();
      });

      linePath.addEventListener("focus", () => {
        setActiveSeries(seriesIndex);
        const fallbackPoint = latestPoint ?? points[0].point;
        const index = xOrder.get(fallbackPoint.time) ?? 0;
        showTooltip(seriesTooltipText, xForIndex(index), yForValue(fallbackPoint.value, entry.axis));
      });

      linePath.addEventListener("blur", () => {
        setActiveSeries(null);
        hideTooltip();
      });

      points.forEach((coord) => {
        if (coord.point.annotation) {
          const ring = document.createElementNS(SVG_NS, "circle");
          ring.setAttribute("cx", `${coord.x}`);
          ring.setAttribute("cy", `${coord.y}`);
          ring.setAttribute("r", "8");
          ring.setAttribute("stroke", entry.color);
          ring.setAttribute("class", "time-series-annotation-ring");
          seriesGroup.appendChild(ring);
        }

        const pointNode = document.createElementNS(SVG_NS, "circle");
        pointNode.setAttribute("cx", `${coord.x}`);
        pointNode.setAttribute("cy", `${coord.y}`);
        pointNode.setAttribute("r", coord.point.annotation ? "4.8" : "4");
        pointNode.setAttribute("fill", entry.color);
        pointNode.setAttribute(
          "class",
          coord.point.annotation ? "time-series-point is-annotated" : "time-series-point",
        );
        pointNode.setAttribute("tabindex", "0");

        const tooltipParts = [`${entry.name} • ${coord.point.time}: ${formatNumber(coord.point.value)}`];
        if (coord.point.annotation) {
          tooltipParts.push(coord.point.annotation);
        }

        const pointTooltipText = tooltipParts.join(" • ");

        pointNode.addEventListener("pointerenter", (event) => {
          setActiveSeries(seriesIndex);
          showTooltip(pointTooltipText, event.clientX, event.clientY);
        });

        pointNode.addEventListener("pointermove", (event) => {
          moveTooltip(event.clientX, event.clientY);
        });

        pointNode.addEventListener("pointerleave", () => {
          setActiveSeries(null);
          hideTooltip();
        });

        pointNode.addEventListener("focus", () => {
          setActiveSeries(seriesIndex);
          showTooltip(pointTooltipText, coord.x, coord.y);
        });

        pointNode.addEventListener("blur", () => {
          setActiveSeries(null);
          hideTooltip();
        });

        seriesGroup.appendChild(pointNode);
      });

      svg.appendChild(seriesGroup);
      seriesGroups.push(seriesGroup);

      const legendItem = document.createElement("li");
      legendItem.className = "legend-item";
      legendItem.tabIndex = 0;

      const swatch = document.createElement("span");
      swatch.className =
        entry.lineStyle === "dashed"
          ? "legend-swatch legend-swatch--line legend-swatch--dashed"
          : "legend-swatch legend-swatch--line";
      swatch.style.color = entry.color;

      const label = document.createElement("span");
      label.className = "legend-label";
      label.textContent = entry.name;

      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `${axisName}: ${formatAxisTick(entry.latest)}`;

      legendItem.append(swatch, label, value);
      legendItems.push(legendItem);

      legendItem.addEventListener("pointerenter", () => {
        setActiveSeries(seriesIndex);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(seriesTooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("pointerleave", () => {
        setActiveSeries(null);
        hideTooltip();
      });

      legendItem.addEventListener("focus", () => {
        setActiveSeries(seriesIndex);
        const rect = legendItem.getBoundingClientRect();
        showTooltip(seriesTooltipText, rect.left + rect.width / 2, rect.top + rect.height / 2);
      });

      legendItem.addEventListener("blur", () => {
        setActiveSeries(null);
        hideTooltip();
      });

      legendElement.appendChild(legendItem);
    });

    setActiveSeries(null);
    chartElement.appendChild(svg);
  }

  return {
    renderFromUnknown(raw: unknown): boolean {
      const data = normalizeTimeSeriesInput(raw);
      if (!data) {
        return false;
      }

      renderTimeSeries(data);
      return true;
    },
    hideTooltip,
  };
}
