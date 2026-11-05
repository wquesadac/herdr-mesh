import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ToolDef, execTool } from "./tools/types.js";
import { taskTools } from "./tools/task.js";
import { agentTools } from "./tools/agent.js";
import { sessionTools } from "./tools/session.js";
import { paneTools } from "./tools/pane.js";
import { tabTools, workspaceTools } from "./tools/workspace.js";
import { integrationTools } from "./tools/integration.js";
import { compositeTools } from "./tools/composite.js";

const allTools: ToolDef[] = [
  ...taskTools,
  ...compositeTools,
  ...agentTools,
  ...sessionTools,
  ...paneTools,
  ...tabTools,
  ...workspaceTools,
  ...integrationTools,
];

export function createServer(): McpServer {
  const server = new McpServer({
    name: "herdr-mesh",
    version: "0.3.2",
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args, extra) => execTool(tool, args ?? {}, extra),
    );
  }

  return server;
}
