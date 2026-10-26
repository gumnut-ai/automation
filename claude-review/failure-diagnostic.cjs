const fs = require('node:fs');
const path = require('node:path');

// SDK 0.3.278 error categories are fixed strings. Never log model-authored text,
// result/errors fields, tool output, or file/parser exceptions.
const categories = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold',
  'verification_required', 'billing_error', 'cloud_credential_error',
  'rate_limit', 'overloaded', 'invalid_request', 'model_not_found',
  'server_error', 'unknown', 'max_output_tokens',
]);
const preparationFailures = new Set(['image_pull_failed', 'image_pull_timeout']);
const resultFailures = new Set([
  'error_during_execution', 'error_max_turns', 'error_max_budget_usd',
  'error_max_structured_output_retries',
]);

function failureCategory(messages) {
  if (!Array.isArray(messages)) return 'diagnostic_unavailable';
  const assistant = messages.findLast(message => message?.type === 'assistant' && message.error);
  if (assistant) return categories.has(assistant.error) ? assistant.error : 'unknown';
  const result = messages.findLast(message => message?.type === 'result');
  return resultFailures.has(result?.subtype) ? result.subtype : 'unknown';
}

// Every value failureCategory can return; consumers accept nothing else.
function isFailureCategory(value) {
  return value === 'diagnostic_unavailable' || categories.has(value) || resultFailures.has(value) || preparationFailures.has(value);
}

function recordPreparationFailure(category, env = process.env) {
  if (env.RUNNER_TEMP && preparationFailures.has(category)) {
    fs.writeFileSync(path.join(env.RUNNER_TEMP, 'claude-preparation-failure.json'), JSON.stringify({ category }));
  }
}

if (require.main === module) {
  let category = 'diagnostic_unavailable';
  try {
    const file = path.join(process.env.RUNNER_TEMP, 'claude-execution-output.json');
    if (fs.statSync(file).size <= 8 * 1024 * 1024) {
      category = failureCategory(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  } catch {
    // The action may fail before saving its SDK output. Preserve its failure.
  }
  try {
    const file = path.join(process.env.RUNNER_TEMP, 'claude-preparation-failure.json');
    if (fs.statSync(file).size <= 1024) {
      const preparation = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (preparationFailures.has(preparation?.category)) category = preparation.category;
    }
  } catch {
    // Preparation may not have started or produced a receipt.
  }
  console.log(`::notice::Claude review failure category: ${category}. Raw execution output withheld.`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `category=${category}\n`);
}

module.exports = { failureCategory, isFailureCategory, recordPreparationFailure };
