import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface CapabilityDefinition {
  id: number;
  default?: boolean;
  rules: unknown[];
}

interface TagDefinition {
  id: number;
  default?: number | null;
  enums?: unknown[];
  flags?: unknown[];
}

interface CompilerOutput {
  config: {
    rules: unknown[];
    capabilities: CapabilityDefinition[];
    tags: Array<{ id: number; default: number | null }>;
  };
  capabilitiesByName: Record<string, number>;
  tagsByName: Record<string, TagDefinition>;
}

export class RuleCompileError extends Error {
  constructor(
    public line: number,
    public column: number,
    message: string,
  ) {
    super(message);
  }
}

function compilerPath() {
  return path.join(
    process.cwd(),
    "node_modules",
    "zerotier-rule-compiler",
    "cli.js",
  );
}

export function compileRules(source: string): CompilerOutput {
  const directory = mkdtempSync(path.join(tmpdir(), "zt-rules-"));
  const sourcePath = path.join(directory, "policy.ztrules");
  try {
    writeFileSync(sourcePath, source, { encoding: "utf8", mode: 0o600 });
    const result = spawnSync(process.execPath, [compilerPath(), sourcePath], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error)
      throw new RuleCompileError(
        0,
        0,
        result.error.message || "The rule compiler could not be started.",
      );
    if (result.status !== 0) {
      const diagnostic = result.stderr.match(
        / line (\d+) column (\d+):\s*(.+)$/m,
      );
      if (diagnostic)
        throw new RuleCompileError(
          Number(diagnostic[1]),
          Number(diagnostic[2]),
          diagnostic[3].trim(),
        );
      throw new RuleCompileError(0, 0, "The rule compiler rejected the policy.");
    }
    try {
      return JSON.parse(result.stdout) as CompilerOutput;
    } catch {
      throw new RuleCompileError(
        0,
        0,
        "The rule compiler returned an invalid response.",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
