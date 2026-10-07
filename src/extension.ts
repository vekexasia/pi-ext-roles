import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectRoleContributions } from "./contributions.js";
import { discoverRoles } from "./roles.js";
import { isNodeError } from "./utils.js";

export default async function rolesExtension(api: ExtensionAPI): Promise<void> {
  const agentDir = getAgentDir();
  api.on("before_agent_start", (event, ctx) => {
    const active = api.getActiveTools();
    if (!api.getAllTools().some(tool => (tool.name === "workflow" || tool.name === "subagents_run") &&
      (active.includes(tool.name) || tool.exposure === "codemode" || tool.exposure === "deferred"))) return;
    const roles = Object.entries(discoverRoles({ cwd: ctx.cwd, agentDir, projectTrusted: ctx.isProjectTrusted(),
      extensionRoleDirectories: collectRoleContributions(api.events, { activeOnly: true }) })).filter(([, definition]) => definition.description);
    if (!roles.length) return;
    const content = `Workflow role descriptions:\n${roles.map(([name, definition]) => `- \`${name}\`: ${definition.description}`).join("\n")}`;
    const { appendSystemPrompt } = event.systemPromptOptions;
    event.systemPromptOptions.appendSystemPrompt = appendSystemPrompt ? `${appendSystemPrompt}\n\n${content}` : content;
  });
  try { import.meta.resolve("pi-extensible-workflows"); }
  catch (error) {
    if (error instanceof Error && (
      isNodeError(error, "ERR_MODULE_NOT_FOUND") && error.message.includes("'pi-extensible-workflows'") ||
      isNodeError(error, "MODULE_NOT_FOUND") && error.message.includes("Cannot find module 'pi-extensible-workflows'")
    )) return;
    throw error;
  }
  const registry = await import(import.meta.resolve("pi-extensible-workflows/registry"));
  if (registry.loadingRegistry().frozen) return;
  const { registerWorkflowRoles } = await import("./workflow.js");
  registerWorkflowRoles(api, registry);
}
