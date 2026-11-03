export type Finding = {
  path: string;
  line: number;
  level: "High" | "Review";
  check: string;
  advice: string;
};
type Files = Record<string, string>;
const credentials =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:ant-(?:api\d*-)?|proj-|svcacct-)?[\w-]{18,}|\b(?:e2b_|ghp_|github_pat_|sk_live_|AKIA)[\w-]{16,}/;
const sourceCode = /\.(?:[cm]?[jt]sx?|prisma|sql)$/i;
export function reviewSources(files: Files): Finding[] {
  const findings: Finding[] = [];
  for (const [path, content] of Object.entries(files)) {
    const lines = content.split(/\r?\n/);
    const add = (
      line: number,
      level: Finding["level"],
      check: string,
      advice: string,
    ) => findings.push({ path, line, level, check, advice });
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (credentials.test(line))
        add(
          i + 1,
          "High",
          "Possible embedded credential",
          "Remove the value from source and rotate the affected credential.",
        );
      if (!sourceCode.test(path)) continue;
      if (/\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(/.test(line))
        add(
          i + 1,
          "High",
          "Unsafe SQL method",
          "Use parameterized queries and bind incoming values.",
        );
      if (
        /\b(?:exec|execSync)\s*\(\s*(?:req\.|request\.|.*\$\{|.*\+\s*\w)/.test(
          line,
        )
      )
        add(
          i + 1,
          "High",
          "Dynamic shell command",
          "Pass arguments separately and allow only expected values.",
        );
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(line))
        add(
          i + 1,
          "Review",
          "HTML injection surface",
          "Trace the value to its source and sanitize any user-controlled markup.",
        );
    }
    if (
      /(?:^|\/)api\/.*route\.[jt]s$/.test(path) &&
      /\b(?:POST|PUT|PATCH|DELETE)\b/.test(content)
    ) {
      if (
        /(?:\.json|\.formData)\s*\(/.test(content) &&
        !/\.safeParse(?:Async)?\(|\.parse(?:Async)?\(|\b(?:validate|assertValid)\w*\s*\(/.test(
          content,
        )
      )
        add(
          1,
          "Review",
          "Check incoming data",
          "This route accepts a body without a recognized schema check. Validate allowed fields, formats and sizes.",
        );
      if (
        !/\b(?:auth|getUser|getServerSession|authorize|getSession|requireUser|requireAuth|verifyToken)\s*\(/.test(
          content,
        )
      )
        add(
          1,
          "Review",
          "Check write permissions",
          "Verify that this route checks identity and resource ownership, or is intentionally public.",
        );
    }
    if (/(?:^|\/)package\.json$/.test(path)) {
      try {
        const manifest = JSON.parse(content);
        for (const [name, version] of Object.entries({
          ...manifest.dependencies,
          ...manifest.devDependencies,
        })) {
          if (
            typeof version === "string" &&
            /^(?:\*|latest|https?:|git\+|github:|file:|\.\.)/.test(version)
          )
            add(
              1,
              "Review",
              "Review dependency " + name,
              "Pin a supported release or confirm that the external dependency is trusted.",
            );
        }
        for (const script of ["preinstall", "install", "postinstall"]) {
          const cmd = manifest.scripts?.[script];
          if (
            typeof cmd === "string" &&
            /\b(?:curl|wget|Invoke-WebRequest)\b/i.test(cmd)
          )
            add(
              1,
              "High",
              "Install script downloads code",
              "Inspect the dependency lifecycle command and verify the downloaded artifact before running it.",
            );
        }
      } catch {
        add(
          1,
          "High",
          "Invalid package manifest",
          "Correct the JSON syntax before installing packages.",
        );
      }
    }
  }
  return findings.sort(
    (a, b) =>
      Number(b.level === "High") - Number(a.level === "High") ||
      a.path.localeCompare(b.path) ||
      a.line - b.line,
  );
}

export async function projectZip(files: Files): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    if (
      !path ||
      path.length > 240 ||
      /[:\\\x00-\x1F]/.test(path) ||
      path
        .split("/")
        .some(
          (p) => !p || [".", "..", ".git", "node_modules", ".next"].includes(p),
        )
    )
      throw Error("Unexpected path in saved project.");
    if (/(?:^|\/)(?:\.env(?:\..*)?)$/.test(path)) {
      const template = content
        .split(/\r?\n/)
        .flatMap((line) => {
          const assignment =
            /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
              line.trim(),
            );
          if (!assignment) return [];
          const value = assignment[2].replace(/^["']|["']$/g, "");
          return [
            assignment[1] +
              "=" +
              (assignment[1] === "DATABASE_URL" &&
              /^file:\.\/[\w.-]+\.db$/.test(value)
                ? JSON.stringify(value)
                : ""),
          ];
        })
        .join("\n");
      zip.file(path, template + "\n");
    } else {
      zip.file(path, content);
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
