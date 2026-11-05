// Shared I/O for command hooks. Claude Code and Codex both send one JSON object
// on stdin and both treat exit code 2 + stderr as "block this tool call".

export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

export function block(reason) {
  process.stderr.write(reason.endsWith('\n') ? reason : reason + '\n');
  process.exit(2);
}

export function allow() {
  process.exit(0);
}

export function emitContext(eventName, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }) + '\n');
  process.exit(0);
}

// Codex sends shell commands as an argv array; Claude sends a string.
export function commandOf(toolInput) {
  const c = toolInput?.command ?? toolInput?.cmd;
  if (Array.isArray(c)) {
    // ["bash", "-lc", "<script>"] → the script
    if (c.length >= 3 && /(^|\/)(ba|z)?sh$/.test(c[0]) && /^-\w*c$/.test(c[1])) return c.slice(2).join(' ');
    return c.join(' ');
  }
  return typeof c === 'string' ? c : '';
}

// Files an edit-type tool call would write: Claude's Edit/Write/MultiEdit/NotebookEdit,
// Codex's apply_patch (patch text with "*** Update File: path" headers).
export function editedPaths(toolInput) {
  const paths = [];
  for (const key of ['file_path', 'notebook_path', 'path']) {
    if (typeof toolInput?.[key] === 'string') paths.push(toolInput[key]);
  }
  const patch = typeof toolInput?.input === 'string' ? toolInput.input : typeof toolInput?.patch === 'string' ? toolInput.patch : typeof toolInput?.command === 'string' ? toolInput.command : '';
  for (const m of patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) paths.push(m[1].trim());
  for (const m of patch.matchAll(/^\*\*\* Move to: (.+)$/gm)) paths.push(m[1].trim());
  return paths;
}
