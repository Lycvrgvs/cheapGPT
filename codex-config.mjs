export const TOML_START = "# cheapgpt:multi-agent-v2:start";
export const TOML_END = "# cheapgpt:multi-agent-v2:end";
export const TABLE_HEADER = "[features.multi_agent_v2]";

export const REQUIRED_MULTI_AGENT = {
  enabled: "true",
  wait_agent_enabled: "true",
  expose_spawn_agent_model_overrides: "true",
  min_wait_timeout_ms: "60000",
  default_wait_timeout_ms: "1800000",
  max_wait_timeout_ms: "3600000",
};

const REQUIRED_KEYS = Object.keys(REQUIRED_MULTI_AGENT);

export class CodexConfigError extends Error {
  constructor(message, code = "TOML") {
    super(message);
    this.code = code;
  }
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeValue(raw) {
  let value = String(raw).trim();
  if (value.endsWith(",")) value = value.slice(0, -1).trim();
  const comment = value.indexOf(" #");
  if (comment >= 0) value = value.slice(0, comment).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value === "True") return "true";
  if (value === "False") return "false";
  return value;
}

function parseAssignment(line) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/);
  if (!match) return null;
  return { key: match[1], value: normalizeValue(match[2]), raw: line };
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function assertSafeShape(text) {
  if (/^\s*features\.multi_agent_v2\./m.test(text)) {
    throw new CodexConfigError(
      "Refusing to merge dotted-key features.multi_agent_v2.* in .codex/config.toml. Convert that subtree to a [features.multi_agent_v2] table first.",
      "TOML"
    );
  }
  if (/^\s*\[features\.multi_agent_v2\./m.test(text)) {
    throw new CodexConfigError(
      "Refusing to merge nested [features.multi_agent_v2.*] tables in .codex/config.toml.",
      "TOML"
    );
  }
  const starts = countOccurrences(text, TOML_START);
  const ends = countOccurrences(text, TOML_END);
  if (starts !== ends || starts > 1) {
    throw new CodexConfigError(
      `Malformed CheapGPT TOML markers in .codex/config.toml (start=${starts}, end=${ends}).`,
      "TOML"
    );
  }
  const tables = [...text.matchAll(/^\s*\[features\.multi_agent_v2\]\s*$/gm)];
  if (tables.length > 1) {
    throw new CodexConfigError(
      "Duplicate [features.multi_agent_v2] tables in .codex/config.toml. Refusing to guess.",
      "TOML"
    );
  }
}

function findTableRange(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\[features\.multi_agent_v2\]\s*$/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function findMarkerRange(lines) {
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === TOML_START) start = i;
    if (lines[i].trim() === TOML_END) end = i;
  }
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < 0 || end < start) {
    throw new CodexConfigError("CheapGPT TOML markers are malformed in .codex/config.toml.", "TOML");
  }
  return { start, end };
}

function collectKeys(lines, from, to, skipMarkers = false) {
  const keys = new Map();
  let inManaged = false;
  for (let i = from; i < to; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === TOML_START) {
      inManaged = true;
      continue;
    }
    if (trimmed === TOML_END) {
      inManaged = false;
      continue;
    }
    if (skipMarkers && inManaged) continue;
    const parsed = parseAssignment(lines[i]);
    if (parsed) keys.set(parsed.key, parsed);
  }
  return keys;
}

function managedKeyLines(keys) {
  return keys.map((key) => `${key} = ${REQUIRED_MULTI_AGENT[key]}`);
}

function fullManagedBlock(eol) {
  return [
    TOML_START,
    TABLE_HEADER,
    ...managedKeyLines(REQUIRED_KEYS),
    TOML_END,
  ].join(eol);
}

export function inspectCodexConfig(text) {
  const source = text == null ? "" : String(text);
  if (!source.trim()) {
    return { kind: "absent", text: source, effective: {}, userKeys: {}, managedKeys: [] };
  }
  assertSafeShape(source);
  const eol = detectEol(source);
  const lines = source.split(/\r?\n/);
  const table = findTableRange(lines);
  const markers = findMarkerRange(lines);
  const userKeys = table ? collectKeys(lines, table.start + 1, table.end, true) : new Map();
  const managed = markers
    ? collectKeys(lines, markers.start + 1, markers.end, false)
    : new Map();
  const effective = {};
  for (const [key, parsed] of userKeys) effective[key] = parsed.value;
  for (const [key, parsed] of managed) effective[key] = parsed.value;
  return {
    kind: table ? "table" : "no-table",
    text: source,
    eol,
    lines,
    table,
    markers,
    userKeys,
    managed,
    effective,
    createdTable: Boolean(markers && table && markers.start < table.start),
  };
}

export function requiredEffectiveOk(effective) {
  return REQUIRED_KEYS.every((key) => effective[key] === REQUIRED_MULTI_AGENT[key]);
}

export function mergeMultiAgentConfig(existingText) {
  const source = existingText == null ? "" : String(existingText);
  if (!source.trim()) {
    const block = `${fullManagedBlock("\n")}\n`;
    return {
      text: block,
      createdFile: true,
      createdTable: true,
      managedKeys: [...REQUIRED_KEYS],
    };
  }
  assertSafeShape(source);
  const eol = detectEol(source);
  const lines = source.split(/\r?\n/);
  const trailingNewline = source.endsWith("\n") || source.endsWith("\r\n");
  const table = findTableRange(lines);
  const markers = findMarkerRange(lines);

  if (!table) {
    const block = fullManagedBlock(eol);
    let next = source.replace(/\s+$/, "");
    next = `${next}${eol}${eol}${block}`;
    if (trailingNewline) next += eol;
    else next += eol;
    return {
      text: next,
      createdFile: false,
      createdTable: true,
      managedKeys: [...REQUIRED_KEYS],
    };
  }

  const userKeys = collectKeys(lines, table.start + 1, table.end, true);
  const missing = [];
  for (const key of REQUIRED_KEYS) {
    if (!userKeys.has(key)) {
      missing.push(key);
      continue;
    }
    if (userKeys.get(key).value !== REQUIRED_MULTI_AGENT[key]) {
      throw new CodexConfigError(
        `CheapGPT config conflict in .codex/config.toml: ${key} is ${userKeys.get(key).value}, required ${REQUIRED_MULTI_AGENT[key]}. Refusing to overwrite.`,
        "TOML"
      );
    }
  }

  const managedLines = missing.length ? [TOML_START, ...managedKeyLines(missing), TOML_END] : [];

  if (!markers && missing.length === 0) {
    return {
      text: source,
      createdFile: false,
      createdTable: false,
      managedKeys: [],
    };
  }

  let nextLines;
  if (markers) {
    nextLines = [...lines.slice(0, markers.start), ...managedLines, ...lines.slice(markers.end + 1)];
    if (managedLines.length === 0) {
      nextLines = [...lines.slice(0, markers.start), ...lines.slice(markers.end + 1)];
    }
  } else {
    const insertAt = table.end;
    nextLines = [...lines.slice(0, insertAt), ...managedLines, ...lines.slice(insertAt)];
  }

  while (nextLines.length && nextLines[nextLines.length - 1] === "") nextLines.pop();
  let next = nextLines.join(eol);
  if (trailingNewline || true) next += eol;
  return {
    text: next,
    createdFile: false,
    createdTable: false,
    managedKeys: missing,
  };
}

export function removeMultiAgentConfig(existingText, ownership = {}) {
  const source = existingText == null ? "" : String(existingText);
  if (!source.trim()) return { text: "", deleteFile: Boolean(ownership.createdFile) };
  assertSafeShape(source);
  const eol = detectEol(source);
  const lines = source.split(/\r?\n/);
  const trailingNewline = source.endsWith("\n") || source.endsWith("\r\n");
  const markers = findMarkerRange(lines);
  if (!markers) {
    return { text: source, deleteFile: false };
  }
  let nextLines = [...lines.slice(0, markers.start), ...lines.slice(markers.end + 1)];
  if (ownership.createdTable) {
    const table = findTableRange(nextLines);
    if (table) {
      const onlyBlank = nextLines.slice(table.start, table.end).every((line) => !line.trim() || /^\s*\[features\.multi_agent_v2\]\s*$/.test(line));
      if (onlyBlank) {
        nextLines = [...nextLines.slice(0, table.start), ...nextLines.slice(table.end)];
      }
    }
  }
  while (nextLines.length && nextLines[0] === "") nextLines.shift();
  while (nextLines.length && nextLines[nextLines.length - 1] === "") nextLines.pop();
  if (nextLines.every((line) => !line.trim())) {
    return { text: "", deleteFile: Boolean(ownership.createdFile) || ownership.createdTable };
  }
  let next = nextLines.join(eol);
  if (trailingNewline) next += eol;
  return { text: next, deleteFile: false };
}

export function doctorCodexConfig(text, ownership = {}) {
  const issues = [];
  const warnings = [];
  try {
    const inspected = inspectCodexConfig(text);
    if (inspected.kind === "absent") {
      issues.push("missing .codex/config.toml CheapGPT multi-agent wait configuration");
      return { issues, warnings };
    }
    if (!requiredEffectiveOk(inspected.effective)) {
      for (const key of REQUIRED_KEYS) {
        if (inspected.effective[key] !== REQUIRED_MULTI_AGENT[key]) {
          issues.push(
            `Codex multi-agent ${key} is ${inspected.effective[key] ?? "missing"}, required ${REQUIRED_MULTI_AGENT[key]}`
          );
        }
      }
    }
    if (inspected.markers) {
      const expected = mergeMultiAgentConfig(removeMultiAgentConfig(text, ownership).text);
      const currentManaged = text.slice(
        text.indexOf(TOML_START),
        text.indexOf(TOML_END) + TOML_END.length
      );
      const expectedManaged = expected.text.includes(TOML_START)
        ? expected.text.slice(
            expected.text.indexOf(TOML_START),
            expected.text.indexOf(TOML_END) + TOML_END.length
          )
        : "";
      if (expectedManaged && currentManaged.replace(/\s+/g, " ") !== expectedManaged.replace(/\s+/g, " ")) {
        warnings.push("CheapGPT TOML block differs from current sources; run update");
      }
    }
  } catch (err) {
    issues.push(err.message);
  }
  return { issues, warnings };
}
