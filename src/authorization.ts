import { ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";

export function resolveProjectAuthorization(cwd: string, agentDir: string, override?: boolean): boolean {
  if (override !== undefined) return override;
  const saved = new ProjectTrustStore(agentDir).get(cwd);
  if (saved !== null) return saved;
  return SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getDefaultProjectTrust() === "always";
}
