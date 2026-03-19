import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Request, Response } from "express";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

const RESOURCE_URI = "ui://charts/pie-chart.html";
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
const DISTRIBUTION_NEUTRAL_COLOR = "#6b7280";
const DISTRIBUTION_HIGHLIGHT_COLOR = "#3b82f6";

const port = Number.parseInt(process.env.PORT ?? process.env.MCP_PORT ?? "3003", 10);
const host = process.env.HOST ?? "127.0.0.1";

function isHexColor(value: string | undefined): value is string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value ?? "");
}

function pickColor(color: string | undefined, index: number): string {
  return isHexColor(color) ? color : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function pickDistributionColor(color: string | undefined, index: number, totalBins: number): string {
  if (isHexColor(color)) {
    return color;
  }

  const highlightStartIndex = Math.floor(totalBins / 2);
  return index >= highlightStartIndex ? DISTRIBUTION_HIGHLIGHT_COLOR : DISTRIBUTION_NEUTRAL_COLOR;
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "charts-mcp-server",
    version: "1.0.0",
  });

  registerAppResource(
    server,
    "Charts Sandbox",
    RESOURCE_URI,
    {
      title: "Charts Sandbox",
      description: "Sandbox UI that renders interactive charts with hover tooltip and legend.",
    },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(new URL("./dist/mcp-app.html", import.meta.url), "utf8"),
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "render_pie_chart",
    {
      title: "Render Pie Chart",
      description:
        "Render a pie chart in the sandbox UI. The textual response includes the data summary while the UI contains the chart and legend.",
      inputSchema: {
        title: z.string().optional().describe("Optional chart title for textual output context."),
        slices: z
          .array(
            z.object({
              label: z.string().min(1).describe("Slice label."),
              value: z.number().positive().describe("Slice value (must be > 0)."),
              color: z
                .string()
                .optional()
                .describe("Optional hex color for this slice (for example #1f77b4)."),
            }),
          )
          .min(1)
          .describe("Pie slices to render."),
      },
      outputSchema: {
        title: z.string(),
        total: z.number(),
        slices: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            percentage: z.number(),
            color: z.string(),
          }),
        ),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["model", "app"],
        },
      },
    },
    async ({ title, slices }) => {
      const total = slices.reduce((sum, slice) => sum + slice.value, 0);

      const normalizedSlices = slices.map((slice, index) => {
        const percentage = total > 0 ? (slice.value / total) * 100 : 0;

        return {
          label: slice.label,
          value: slice.value,
          percentage: Number(percentage.toFixed(2)),
          color: pickColor(slice.color, index),
        };
      });

      const chartTitle = title?.trim() ? title.trim() : "Pie Chart";
      const textLines = normalizedSlices.map(
        (slice) => `- ${slice.label}: ${slice.value} (${slice.percentage.toFixed(2)}%)`,
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `${chartTitle}`,
              `Total: ${total}`,
              "",
              ...textLines,
              "",
              "Interactive chart and legend are rendered in the sandbox. Hover slices or legend items to see details.",
            ].join("\n"),
          },
        ],
        structuredContent: {
          title: chartTitle,
          total,
          slices: normalizedSlices,
        },
      };
    },
  );

  registerAppTool(
    server,
    "render_funnel_chart",
    {
      title: "Render Funnel Chart",
      description:
        "Render a vertical funnel chart in the sandbox UI. The first step is shown on top and the last step on the bottom, with interactive tooltip and legend.",
      inputSchema: {
        title: z.string().optional().describe("Optional chart title for textual output context."),
        steps: z
          .array(
            z.object({
              label: z.string().min(1).describe("Funnel step label."),
              value: z.number().positive().describe("Step value (must be > 0)."),
              color: z
                .string()
                .optional()
                .describe("Optional hex color for this step (for example #1f77b4)."),
            }),
          )
          .min(1)
          .describe("Ordered funnel steps from top (entry) to bottom (final conversion)."),
      },
      outputSchema: {
        title: z.string(),
        total: z.number(),
        steps: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            percentage: z.number(),
            dropOff: z.number(),
            color: z.string(),
          }),
        ),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["model", "app"],
        },
      },
    },
    async ({ title, steps }) => {
      const total = steps.reduce((sum, step) => sum + step.value, 0);
      const firstStepValue = steps[0].value;

      const normalizedSteps = steps.map((step, index) => {
        const previousValue = index > 0 ? steps[index - 1].value : step.value;
        const percentage = firstStepValue > 0 ? (step.value / firstStepValue) * 100 : 0;
        const dropOff = index > 0 ? Math.max(previousValue - step.value, 0) : 0;

        return {
          label: step.label,
          value: step.value,
          percentage: Number(percentage.toFixed(2)),
          dropOff,
          color: pickColor(step.color, index),
        };
      });

      const chartTitle = title?.trim() ? title.trim() : "Funnel Chart";
      const textLines = normalizedSteps.map(
        (step) =>
          `- ${step.label}: ${step.value} (${step.percentage.toFixed(2)}% of first step, drop-off ${step.dropOff})`,
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `${chartTitle}`,
              `Start: ${firstStepValue}`,
              `Total across steps: ${total}`,
              "",
              ...textLines,
              "",
              "Interactive vertical funnel and legend are rendered in the sandbox. Hover funnel steps or legend items to see details.",
            ].join("\n"),
          },
        ],
        structuredContent: {
          title: chartTitle,
          total,
          steps: normalizedSteps,
        },
      };
    },
  );

  registerAppTool(
    server,
    "render_distribution_chart",
    {
      title: "Render Distribution Chart",
      description:
        "Render a distribution chart with ordered buckets in the sandbox UI. The textual response includes bucket percentages while the UI shows bars, axes, tooltip, and legend.",
      inputSchema: {
        title: z.string().optional().describe("Optional chart title for textual output context."),
        bins: z
          .array(
            z.object({
              label: z.string().min(1).describe("Bucket label shown on the X axis."),
              value: z.number().nonnegative().describe("Bucket value (must be >= 0)."),
              color: z
                .string()
                .optional()
                .describe("Optional hex color for this bucket (for example #6b7280)."),
            }),
          )
          .min(1)
          .refine((bins) => bins.some((bin) => bin.value > 0), {
            message: "At least one bucket must have value greater than zero.",
          })
          .describe("Ordered distribution buckets from left to right."),
      },
      outputSchema: {
        title: z.string(),
        total: z.number(),
        bins: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            percentage: z.number(),
            cumulative: z.number(),
            color: z.string(),
          }),
        ),
      },
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ["model", "app"],
        },
      },
    },
    async ({ title, bins }) => {
      const total = bins.reduce((sum, bin) => sum + bin.value, 0);
      let cumulativeValue = 0;

      const normalizedBins = bins.map((bin, index) => {
        cumulativeValue += bin.value;

        const percentage = total > 0 ? (bin.value / total) * 100 : 0;
        const cumulative = total > 0 ? (cumulativeValue / total) * 100 : 0;

        return {
          label: bin.label,
          value: bin.value,
          percentage: Number(percentage.toFixed(2)),
          cumulative: Number(cumulative.toFixed(2)),
          color: pickDistributionColor(bin.color, index, bins.length),
        };
      });

      const chartTitle = title?.trim() ? title.trim() : "Distribution Chart";
      const peakValue = Math.max(...normalizedBins.map((bin) => bin.value));
      const textLines = normalizedBins.map(
        (bin) =>
          `- ${bin.label}: ${bin.value} (${bin.percentage.toFixed(2)}%, cumulative ${bin.cumulative.toFixed(2)}%)`,
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `${chartTitle}`,
              `Total: ${total}`,
              `Peak bucket value: ${peakValue}`,
              "",
              ...textLines,
              "",
              "Interactive distribution bars and legend are rendered in the sandbox. Hover bars or legend items to see details.",
            ].join("\n"),
          },
        ],
        structuredContent: {
          title: chartTitle,
          total,
          bins: normalizedBins,
        },
      };
    },
  );

  return server;
}

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const sessions: Record<string, Session> = {};
const app = createMcpExpressApp({ host });

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  try {
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions[sid] = { server, transport };
        },
        onsessionclosed: async (sid) => {
          const existing = sessions[sid];
          if (!existing) {
            return;
          }

          await existing.server.close().catch(() => undefined);
          delete sessions[sid];
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions[sid]) {
          delete sessions[sid];
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid MCP session",
      },
      id: null,
    });
  } catch (error) {
    console.error("Failed to handle MCP POST request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing MCP session ID");
    return;
  }

  try {
    await sessions[sessionId].transport.handleRequest(req, res);
  } catch (error) {
    console.error("Failed to handle MCP GET request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing MCP session ID");
    return;
  }

  try {
    await sessions[sessionId].transport.handleRequest(req, res);
  } catch (error) {
    console.error("Failed to handle MCP DELETE request:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

const httpServer = app.listen(port, host, () => {
  console.error(`Charts MCP server listening on http://${host}:${port}/mcp`);
});

async function shutdown(): Promise<void> {
  const entries = Object.entries(sessions);
  await Promise.all(
    entries.map(async ([sid, session]) => {
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
      delete sessions[sid];
    }),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await shutdown();
    httpServer.close(() => {
      process.exit(0);
    });
  });
}
