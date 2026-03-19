# Commit History

## feat: mcp server with pie chart mcp-apps tool
**How:** This initial commit bootstrapped the TypeScript/Vite project, added the MCP server entrypoint, and wired an `mcp-apps` sandbox resource so the browser UI could be rendered from the tool response. It also introduced the first interactive pie-chart implementation with SVG slice rendering, tooltip behavior, schema validation, and a structured payload passed from `server.ts` into `src/mcp-app.ts`.

**Why:** The goal was to establish the repository as a working Charts MCP server instead of just a static frontend experiment. Creating the first pie-chart tool proved the end-to-end pattern for exposing chart data, rendering it in the sandbox, and returning a useful textual summary alongside the UI.

## feat: add legend to pie chart
**How:** This change redesigned the sandbox shell into a richer card layout, added chart title and total metadata, and introduced a synchronized legend beside the pie graphic. The frontend logic was extended so hovering or focusing either a slice or a legend item activates the same state and tooltip, while the server descriptions were updated to reflect the expanded UI behavior.

**Why:** A pie chart is easier to interpret when users can read labels and values without relying on color recognition alone. Adding the legend also made the chart more accessible and gave the sandbox a clearer, more polished presentation.

## refactor: extract render_pie logic to it's own file
**How:** The pie-chart rendering code was moved out of the monolithic app bootstrap file into `src/charts/pie/pie-chart-view.ts`, with a small index export to keep imports clean. That extraction isolated input normalization, SVG path generation, legend interactions, and tooltip handling behind a `createPieChartView` interface consumed by the main app shell.

**Why:** This refactor reduced coupling in `src/mcp-app.ts` and created a reusable chart-view pattern for future chart types. It prepared the codebase to grow beyond a single chart without turning the app entrypoint into an unmaintainable file.

## feat: funnel chart
**How:** This commit generalized the sandbox from a pie-only experience into a multi-chart container, then added a new MCP tool and frontend view for vertical funnel charts. The implementation computes step percentages and drop-off values on the server, renders trapezoid segments in a dedicated funnel chart view, and reuses the shared card, legend, and tooltip interaction model in the browser.

**Why:** Funnel charts capture stage-by-stage conversion better than pie slices for ordered process data. Adding this chart expanded the server’s usefulness and validated the modular chart-view architecture introduced in the previous refactor.

## feat: improve data insights for render funnel
**How:** The funnel header summary was tightened so the top metadata line shows `Start` and `End` values instead of mixing a starting value with a summed total across all stages. This small frontend adjustment makes the derived insight align more closely with the semantics of a funnel, which is about progression from entry to final conversion.

**Why:** Totaling every funnel stage can be misleading because the same cohort is represented repeatedly as it moves downward. Showing start-versus-end gives users a clearer snapshot of conversion performance at a glance.

## feat: export png and svg
**How:** This update added an export action area to the sandbox header, including a menu, status messaging, and browser-side logic for generating downloadable SVG and PNG assets from the rendered chart. The app code now captures the active SVG, inlines the necessary styles, rasterizes when needed for PNG output, and manages export availability and menu state centrally in `src/mcp-app.ts`.

**Why:** Once the charts were interactive and presentation-ready, users needed a way to reuse them outside the sandbox. Export support made the tool more practical for reporting, sharing, and downstream documentation workflows.

## feat: distribution chart
**How:** This commit introduced a new `render_distribution_chart` MCP tool plus a dedicated distribution chart view that normalizes bucket data, computes percentages and cumulative percentages, and draws an axis-based bar chart in SVG. It also added a distribution-specific color strategy so later buckets are visually highlighted, while keeping the existing legend and tooltip interaction model consistent with the other chart types.

**Why:** Distribution data is better communicated with ordered bars and axis context than with funnels or pies. Adding this chart broadened the server’s analytical range and made it suitable for histogram-like and bucketed summary use cases.

## feat: annoted time series chart
**How:** This large feature added a new annotated time-series chart module, expanded the sandbox styles for line and area rendering, and registered an MCP tool that supports multiple series, optional dual Y-axes, custom line styles, and required point annotations. The frontend implementation parses series data, calculates plotting domains, renders axes/gridlines/lines/points/legend state, and surfaces annotations through hover interactions so the chart remains both analytical and narrative.

**Why:** Time-based trends and milestone callouts are common reporting needs that cannot be expressed well with the existing categorical charts. Supporting annotated multi-series timelines made the project substantially more capable for storytelling and operational dashboards.

## feat: improve tooltip for annoted series
**How:** The time-series point tooltip string was reformatted to separate the value summary from the temporal and annotation context, producing a cleaner `series/value • time/annotation` structure. This was a focused change inside the time-series view, preserving the chart behavior while improving the readability of the hover content.

**Why:** Annotation-heavy tooltips can become hard to scan when too many details are packed into one phrase. The revised wording makes the most important number easier to identify while still retaining the contextual note.

## feat: add clarity and visual hierarchy to tooltip UI
**How:** This commit extracted tooltip logic into a shared controller module and upgraded all chart views to pass structured tooltip content instead of preformatted plain strings. With that abstraction in place, the tooltip UI could present title, value, detail text, and color cues consistently across pie, funnel, distribution, and time-series charts while removing duplicated positioning code from each chart implementation.

**Why:** Tooltips had become a repeated concern across several chart types, and inconsistencies were starting to accumulate. Centralizing the behavior improved maintainability and gave the product a more coherent, polished interaction design.
