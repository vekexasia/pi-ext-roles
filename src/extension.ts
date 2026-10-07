import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRoleContribution } from "./contributions.js";

export default function rolesExtension(api: ExtensionAPI) {
  registerRoleContribution(api, { owner: import.meta.url, roleDirectories: [{ path: "../starter/roles", scope: "builtin", builtin: true }], extension: { headline: "Pi roles", version: "0.1.0" } });
}
