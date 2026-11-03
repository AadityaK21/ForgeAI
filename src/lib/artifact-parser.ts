export type ArtifactEvent =
  | { type: "artifact"; id: string; title: string }
  | { type: "fileStart" | "fileComplete"; path: string }
  | { type: "fileChunk"; path: string; text: string }
  | { type: "shell" | "start"; command: string };

export interface ParserHooks {
  onFileStart?(path: string): void;
  onFileChunk?(path: string, text: string): void;
  onFileComplete?(path: string): void;
  onShellCommand?(command: string): void;
  onStartServer?(command: string): void;
}

export function safePath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          [".git", ".next", "node_modules"].includes(p) ||
          !/^[\w.()[\]@+-]+$/.test(p),
      )
  )
    throw Error("Unsafe project path: " + path);
  return path;
}

function attributes(tag: string, name: string) {
  const values: Record<string, string> = Object.create(null);
  let rest = tag.slice(name.length + 1, -1);
  while (rest.trim()) {
    const match = /^\s+([a-zA-Z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
    if (!match || match[1] in values)
      throw Error("Malformed " + name + " attributes.");
    values[match[1]] = match[2] ?? match[3];
    rest = rest.slice(match[0].length);
  }
  return values;
}

export class ArtifactParser {
  private buffer = "";
  private state: "root" | "actions" | "body" | "done" = "root";
  private action = "";
  private path = "";
  private command = "";
  private encoding: "unknown" | "raw" | "cdata" | "afterCdata" = "unknown";
  private shellSeen = false;
  private started = false;
  private actions = 0;
  private size = 0;
  constructor(private hooks: ParserHooks = {}) {}

  push(token: string): ArtifactEvent[] {
    this.size += token.length;
    if (this.size > 700000) throw Error("Artifact exceeded the size limit.");
    this.buffer += token;
    const events: ArtifactEvent[] = [];
    const content = (text: string) => {
      if (!text) return;
      if (this.action === "file") {
        events.push({ type: "fileChunk", path: this.path, text });
        this.hooks.onFileChunk?.(this.path, text);
      } else this.command += text;
    };
    while (this.buffer) {
      if (this.state === "body") {
        const marker = "<![CDATA[";
        if (this.encoding === "unknown") {
          const candidate = this.buffer.trimStart();
          if (
            marker.startsWith(candidate) &&
            candidate.length < marker.length
          )
            break;
          this.encoding = candidate.startsWith(marker) ? "cdata" : "raw";
          if (this.encoding === "cdata")
            this.buffer = candidate.slice(marker.length);
        }
        if (this.encoding === "afterCdata") {
          this.buffer = this.buffer.trimStart();
          if (
            marker.startsWith(this.buffer) &&
            this.buffer.length < marker.length
          )
            break;
          if (this.buffer.startsWith(marker)) {
            this.buffer = this.buffer.slice(marker.length);
            this.encoding = "cdata";
            continue;
          }
          if ("</action>".startsWith(this.buffer) && this.buffer.length < 9)
            break;
          if (!this.buffer.startsWith("</action>"))
            throw Error("Expected an action closing tag after CDATA.");
          this.encoding = "raw";
        }
        const delimiter = this.encoding === "cdata" ? "]]>" : "</action>";
        const at = this.buffer.indexOf(delimiter);
        if (at === -1) {
          let keep = Math.min(delimiter.length - 1, this.buffer.length);
          while (keep && !delimiter.startsWith(this.buffer.slice(-keep)))
            keep--;
          content(this.buffer.slice(0, this.buffer.length - keep));
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        content(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(at + delimiter.length);
        if (this.encoding === "cdata") {
          this.encoding = "afterCdata";
          continue;
        }
        if (this.action === "file") {
          this.hooks.onFileComplete?.(this.path);
          events.push({ type: "fileComplete", path: this.path });
        } else {
          const command = this.command.trim();
          if (!command || command.length > 5000)
            throw Error("Invalid shell command.");
          if (this.action === "start") {
            this.hooks.onStartServer?.(command);
            events.push({ type: "start", command });
          } else {
            this.hooks.onShellCommand?.(command);
            events.push({ type: "shell", command });
          }
        }
        this.state = "actions";
        continue;
      }
      this.buffer = this.buffer.trimStart();
      if (!this.buffer) break;
      if (this.state === "done" || this.buffer[0] !== "<")
        throw Error("Expected one XML artifact without surrounding prose.");
      // A title can contain a greater-than sign inside a quoted attribute.
      const tagMatch = /^<(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(this.buffer);
      const end = tagMatch ? tagMatch[0].length - 1 : -1;
      if (end < 0) {
        if (this.buffer.length > 2000) throw Error("Tag too long.");
        break;
      }
      const tag = this.buffer.slice(0, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      if (this.state === "root" && /^<artifact\s/.test(tag)) {
        const { id, title } = attributes(tag, "artifact");
        if (!id || !title) throw Error("Artifact needs an id and title.");
        events.push({ type: "artifact", id, title });
        this.state = "actions";
        continue;
      }
      if (
        this.state === "actions" &&
        tag === "</artifact>" &&
        this.actions > 0
      ) {
        this.state = "done";
        continue;
      }
      if (
        this.state !== "actions" ||
        !/^<action\s/.test(tag) ||
        this.started ||
        ++this.actions > 100
      )
        throw Error("Invalid action order or action limit.");
      const { type, filePath } = attributes(tag, "action");
      if (!["file", "shell", "start"].includes(type))
        throw Error("Unknown action.");
      if (type === "file") {
        if (this.shellSeen) throw Error("Write all files before commands.");
        this.path = safePath(filePath);
        this.hooks.onFileStart?.(this.path);
        events.push({ type: "fileStart", path: this.path });
      } else {
        this.shellSeen = true;
        this.started = type === "start";
      }
      this.encoding = "unknown";
      this.action = type;
      this.command = "";
      this.state = "body";
    }
    return events;
  }
  finish() {
    if (this.state !== "done" || this.buffer.trim())
      throw Error("Incomplete XML artifact.");
  }
}
