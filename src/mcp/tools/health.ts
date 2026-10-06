export const healthCheckDefinition = {
  name: "health_check",
  description: "Check the health of the RoutePilot MCP server",
  parameters: {}
};

export const healthCheckHandler = async () => {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "ok",
          service: "RoutePilot MCP",
          version: "0.1.0",
          timestamp: new Date().toISOString()
        })
      }
    ]
  };
};
