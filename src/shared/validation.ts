/** Validate a Git branch name. Returns an error message or null if valid. */
export function validateBranchName(name: string): string | null {
  if (!name.trim()) return "Branch name is required";
  if (/\s/.test(name)) return "Branch name cannot contain spaces";
  if (/\.\.|~|\^|:|\\|\[/.test(name))
    return "Branch name contains invalid characters";
  if (name.startsWith("-") || name.startsWith("."))
    return "Branch name cannot start with '-' or '.'";
  if (name.endsWith(".") || name.endsWith(".lock") || name.endsWith("/"))
    return "Branch name has an invalid ending";
  if (name.includes("/.") || name.includes("//"))
    return "Branch name contains invalid sequence";
  return null;
}
