import { execSync } from "node:child_process";
import fs from "node:fs";

const textFilePattern = /(^|\/)(AGENTS\.md|README\.md|\.gitignore|\.editorconfig|\.gitattributes)$|(\.(md|json|js|ps1|example)$)/i;
const decoder = new TextDecoder("utf-8", { fatal: true });

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split(/\r?\n/)
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => textFilePattern.test(file.replaceAll("\\", "/")));

const failures = [];

for (const file of files) {
  const bytes = fs.readFileSync(file);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  try {
    decoder.decode(bytes);
  } catch {
    failures.push(`${file}: not valid UTF-8`);
    continue;
  }

  if (hasBom) {
    failures.push(`${file}: UTF-8 BOM is not allowed`);
  }
}

if (failures.length > 0) {
  console.error("Encoding check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Encoding check passed: ${files.length} UTF-8 files without BOM.`);
