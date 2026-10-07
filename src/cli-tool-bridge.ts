import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateSelectorList } from "./settings.js";
import { selectResourcesByLayers } from "./utils.js";

export const TOOL_LAYERS_FLAG = "pi-role-tool-layers";
export function parseToolLayers(value: unknown): readonly (readonly string[] | undefined)[] {
  if (typeof value !== "string") throw new Error("Missing tool selector payload");
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 4) throw new Error("Invalid tool selector layers");
  return parsed.map(layer => layer === null ? undefined : validateSelectorList(layer, TOOL_LAYERS_FLAG, "tools"));
}

export default function toolBridge(pi: ExtensionAPI) {
  pi.registerFlag(TOOL_LAYERS_FLAG, { type: "string", description: "Private pi-role ordered tool loadout" });
  const apply = () => {
    try {
      const layers = parseToolLayers(pi.getFlag(TOOL_LAYERS_FLAG));
      pi.setActiveTools(selectResourcesByLayers(layers, pi.getAllTools().map(tool => tool.name)));
    } catch (error) {
      pi.setActiveTools([]);
      process.stderr.write(`pi-role: invalid tool selector payload: ${String(error)}\n`);
      // This extension is CLI-only. Do not continue with native defaults after a bad boundary.
      process.exit(1);
    }
  };
  pi.on("session_start", apply);
  pi.on("before_agent_start", apply);
}
