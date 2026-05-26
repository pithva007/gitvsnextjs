import React, { useState } from "react";
import { X, FolderMinus, Plus } from "lucide-react";

interface ExclusionFilterProps {
  excludedDirs: string[];
  onChange: (exclusions: string[]) => void;
}

export function ExclusionFilter({ excludedDirs, onChange }: ExclusionFilterProps) {
  const [inputValue, setInputValue] = useState("");

  const handleAddExclusion = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    const trimmed = inputValue.trim().toLowerCase();
    if (!trimmed) return;

    // Prevent duplicate entries
    if (!excludedDirs.some((d) => d.toLowerCase() === trimmed)) {
      onChange([...excludedDirs, inputValue.trim()]);
    }
    setInputValue("");
  };

  const handleRemoveExclusion = (dirToRemove: string) => {
    const updated = excludedDirs.filter(
      (d) => d.toLowerCase() !== dirToRemove.toLowerCase()
    );
    onChange(updated);
  };

  return (
    <div className="rounded-xl border border-white/5 bg-slate-950/20 p-4 sm:p-5 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 mb-3">
        <FolderMinus className="h-4 w-4 text-purple-400 flex-shrink-0" />
        <h4 className="text-sm font-semibold text-foreground">
          Exclusion Directory Filter
        </h4>
      </div>
      
      <p className="text-xs text-muted-foreground mb-4">
        Prune unneeded folders (e.g. tests, assets, configuration) to simplify the dependency graph and optimize prompt tokens.
      </p>

      {/* Tag Pills Container */}
      <div className="flex flex-wrap gap-2 mb-4">
        {excludedDirs.map((dir) => (
          <span
            key={dir}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:border-purple-500/40 hover:bg-purple-500/15 transition-all duration-200"
          >
            {dir}
            <button
              type="button"
              onClick={() => handleRemoveExclusion(dir)}
              className="p-0.5 rounded-full hover:bg-purple-500/25 hover:text-white transition-colors"
              aria-label={`Remove ${dir} from exclusions`}
              title={`Remove ${dir}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {excludedDirs.length === 0 && (
          <span className="text-xs text-muted-foreground/60 italic">
            No active directory exclusions.
          </span>
        )}
      </div>

      {/* Input Field */}
      <form onSubmit={handleAddExclusion} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type folder name (e.g., tests, docs) and press Enter..."
            className="w-full h-10 px-3 py-2 text-sm rounded-lg bg-background/50 border border-white/10 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
          />
        </div>
        <button
          type="submit"
          className="h-10 px-3.5 rounded-lg bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white font-medium text-sm flex items-center justify-center gap-1 transition-all"
          title="Add exclusion"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </form>
    </div>
  );
}
