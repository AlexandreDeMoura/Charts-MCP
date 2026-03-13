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

const port = Number.parseInt(process.env.PORT ?? process.env.MCP_PORT ?? "3003", 10);
const host = process.env.HOST ?? "127.0.0.1";

function createServer(): McpServer {
  const server = new McpServer({
    name: "charts-mcp-server",
    version: "1.0.0",
  });

  registerAppResource(
    server,
    "Pie Chart Sandbox",
    RESOURCE_URI,
    {
      title: "Pie Chart Sandbox",
      description: "Sandbox UI that renders an interactive pie chart.",
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
        "Render a pie chart in the sandbox UI. The textual response includes the data summary while the UI contains only the chart.",
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
        const hasValidColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(slice.color ?? "");

        return {
          label: slice.label,
          value: slice.value,
          percentage: Number(percentage.toFixed(2)),
          color: hasValidColor ? (slice.color as string) : DEFAULT_COLORS[index % DEFAULT_COLORS.length],
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
              "Interactive chart is rendered in the sandbox. Hover slices to see details.",
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
