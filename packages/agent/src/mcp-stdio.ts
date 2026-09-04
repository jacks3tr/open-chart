import {
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';

import { createOpenChartMcpServer } from './mcp.js';
import type { OpenChartToolKernel } from './tools.js';

/** Serve the shared tool registry over process stdio. */
export function serveOpenChartMcpStdio(
  kernel: OpenChartToolKernel,
): StdioServerHandle {
  return serveStdio(() => createOpenChartMcpServer(kernel), {
    legacy: 'reject',
  });
}
