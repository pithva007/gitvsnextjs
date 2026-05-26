import { FileNode } from "@/lib/utils/tokenLimits";

/**
 * Common build, dependency, cache, and coverage folders to exclude by default.
 */
export const DEFAULT_EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".next",
  "build",
  "bin",
  "obj",
  ".vercel",
  ".github",
  "out"
];

/**
 * Recursively prunes any branches/leaves from the file node tree if their name matches
 * any entry in the excludedDirs array.
 */
export function pruneTree(tree: FileNode[], excludedDirs: string[]): FileNode[] {
  if (!tree) return [];
  
  // Normalize exclusions for case-insensitive, trimmed matching
  const exclusions = excludedDirs.map((d) => d.toLowerCase().trim());

  return tree
    .filter((node) => exclusions.indexOf(node.name.toLowerCase().trim()) === -1)
    .map((node) => {
      if (node.children && node.children.length > 0) {
        return {
          ...node,
          children: pruneTree(node.children, excludedDirs),
        };
      }
      return node;
    });
}

/**
 * Prunes a flat array of repository files before they are converted to tree structures.
 * Filters out any file whose path contains an excluded directory segment.
 */
export function pruneFlatFiles<T extends { path: string }>(
  files: T[],
  excludedDirs: string[]
): T[] {
  if (!files) return [];
  const exclusions = excludedDirs.map((d) => d.toLowerCase().trim());

  return files.filter((file) => {
    const parts = file.path.split("/").filter(Boolean);
    return !parts.some((part) => exclusions.indexOf(part.toLowerCase().trim()) !== -1);
  });
}
