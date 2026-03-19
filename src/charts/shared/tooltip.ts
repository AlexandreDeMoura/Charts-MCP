export type ChartTooltipContent = {
  title: string;
  value: string;
  details?: string;
  color?: string;
};

type ChartTooltipController = {
  moveTooltip(x: number, y: number): void;
  showTooltip(content: ChartTooltipContent, x: number, y: number): void;
  hideTooltip(): void;
};

type ChartTooltipElements = {
  titleElement: HTMLElement;
  swatchElement: HTMLElement;
  valueElement: HTMLElement;
  separatorElement: HTMLElement;
  detailsElement: HTMLElement;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createTooltipController(tooltipElement: HTMLElement): ChartTooltipController {
  function ensureTooltipElements(): ChartTooltipElements {
    const existingTitleElement = tooltipElement.querySelector<HTMLElement>(".chart-tooltip-title");
    const existingSwatchElement = tooltipElement.querySelector<HTMLElement>(".chart-tooltip-swatch");
    const existingValueElement = tooltipElement.querySelector<HTMLElement>(".chart-tooltip-value");
    const existingSeparatorElement = tooltipElement.querySelector<HTMLElement>(".chart-tooltip-separator");
    const existingDetailsElement = tooltipElement.querySelector<HTMLElement>(".chart-tooltip-details");

    if (
      existingTitleElement &&
      existingSwatchElement &&
      existingValueElement &&
      existingSeparatorElement &&
      existingDetailsElement
    ) {
      return {
        titleElement: existingTitleElement,
        swatchElement: existingSwatchElement,
        valueElement: existingValueElement,
        separatorElement: existingSeparatorElement,
        detailsElement: existingDetailsElement,
      };
    }

    const titleElement = document.createElement("div");
    titleElement.className = "chart-tooltip-title";

    const detailRowElement = document.createElement("div");
    detailRowElement.className = "chart-tooltip-row";

    const swatchElement = document.createElement("span");
    swatchElement.className = "chart-tooltip-swatch";

    const valueElement = document.createElement("span");
    valueElement.className = "chart-tooltip-value";

    const separatorElement = document.createElement("span");
    separatorElement.className = "chart-tooltip-separator";
    separatorElement.textContent = "•";

    const detailsElement = document.createElement("span");
    detailsElement.className = "chart-tooltip-details";

    detailRowElement.append(swatchElement, valueElement, separatorElement, detailsElement);
    tooltipElement.replaceChildren(titleElement, detailRowElement);

    return {
      titleElement,
      swatchElement,
      valueElement,
      separatorElement,
      detailsElement,
    };
  }

  function moveTooltip(x: number, y: number): void {
    const margin = 8;
    const offset = 12;
    const maxX = window.innerWidth - tooltipElement.offsetWidth - margin;
    const maxY = window.innerHeight - tooltipElement.offsetHeight - margin;

    tooltipElement.style.left = `${clamp(x + offset, margin, maxX)}px`;
    tooltipElement.style.top = `${clamp(y + offset, margin, maxY)}px`;
  }

  function showTooltip(content: ChartTooltipContent, x: number, y: number): void {
    const { titleElement, swatchElement, valueElement, separatorElement, detailsElement } = ensureTooltipElements();
    const details = content.details?.trim() ?? "";
    const color = content.color?.trim() ?? "";

    titleElement.textContent = content.title;
    valueElement.textContent = content.value;
    detailsElement.textContent = details;
    detailsElement.hidden = details.length === 0;
    separatorElement.hidden = details.length === 0;

    if (color.length > 0) {
      swatchElement.style.backgroundColor = color;
      swatchElement.hidden = false;
    } else {
      swatchElement.hidden = true;
    }

    tooltipElement.hidden = false;
    moveTooltip(x, y);
  }

  function hideTooltip(): void {
    tooltipElement.hidden = true;
  }

  return {
    moveTooltip,
    showTooltip,
    hideTooltip,
  };
}
