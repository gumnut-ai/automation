const AUTOMATION = new Set([
  "charliehelps", "charliecreates", "github-actions", "gumnut-bot",
  "chatgpt-codex-connector", "copilot",
]);

function isHumanReviewer(login) {
  return typeof login === "string" && /^[a-zA-Z0-9-]+$/.test(login) &&
    !AUTOMATION.has(login.toLowerCase());
}

module.exports = { isHumanReviewer };
