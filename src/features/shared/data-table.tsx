import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { cn } from "../../lib/utils";
import { Settings2, Check, ArrowUp, ChevronRight } from "lucide-react";

export type ColumnDef<T> = {
  id: string;
  label: string;
  defaultVisible?: boolean;
  width?: string;
  sortable?: boolean;
  sortValue?: (item: T) => string | number;
  renderHeader?: () => React.ReactNode;
  render: (item: T, index: number, isSelected: boolean) => React.ReactNode;
};

type DataTableProps<T> = {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (item: T) => string;
  onRowClick?: (item: T) => void;
  onRowDoubleClick?: (item: T) => void;
  onRowContextMenu?: (item: T, e: React.MouseEvent) => void;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  storageKey?: string;
  defaultSortColumn?: string;
  defaultSortDirection?: "asc" | "desc";
  renderExpanded?: (item: T) => React.ReactNode;
  expandedIds?: Set<string>;
  onToggleExpand?: (id: string) => void;
};

const STORAGE_PREFIX = "data-table-cols-";
const MIN_COL_WIDTH = 40;

function defaultCompare(a: unknown, b: unknown): number {
  const va = a ?? "";
  const vb = b ?? "";
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return String(va).localeCompare(String(vb));
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  onRowDoubleClick,
  selectedId,
  onSelectedIdChange,
  loading,
  emptyMessage = "No data",
  className,
  storageKey,
  defaultSortColumn,
  defaultSortDirection = "asc",
  renderExpanded,
  expandedIds,
  onToggleExpand,
  onRowContextMenu,
}: DataTableProps<T>) {
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const col of columns) {
      initial[col.id] = col.defaultVisible !== false;
    }
    return initial;
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, string>>(() => {
    if (!storageKey) return {};
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
      if (!saved) return {};
      const parsed = JSON.parse(saved) as Record<string, string>;
      const valid: Record<string, string> = {};
      for (const col of columns) {
        if (parsed[col.id]) valid[col.id] = parsed[col.id];
      }
      return valid;
    } catch (err) {
      console.warn("[data-table] column width parse error:", err);
      return {};
    }
  });
  const [sortColumn, setSortColumn] = useState<string | null>(() => {
    if (defaultSortColumn && columns.find((c) => c.id === defaultSortColumn && c.sortable)) {
      return defaultSortColumn;
    }
    return null;
  });
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultSortDirection);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const headerCellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const resizeState = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);
  const justResized = useRef(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSettings]);

  const visibleColumns = useMemo(
    () => columns.filter((col) => columnVisibility[col.id] !== false),
    [columns, columnVisibility]
  );

  const gridTemplate = useMemo(
    () => {
      const cols = visibleColumns
        .map((col) => columnWidths[col.id] || col.width || "auto");
      if (renderExpanded) cols.unshift("2rem");
      return cols.join(" ");
    },
    [visibleColumns, columnWidths, renderExpanded]
  );

  const toggleableColumns = useMemo(
    () =>
      columns.filter((col) => {
        const visibleCount = columns.filter((c) => columnVisibility[c.id] !== false).length;
        return !(columnVisibility[col.id] !== false && visibleCount <= 1);
      }),
    [columns, columnVisibility]
  );

  const sortedData = useMemo(() => {
    if (!sortColumn) return data;
    const col = columns.find((c) => c.id === sortColumn);
    if (!col?.sortable) return data;

    return [...data].sort((a, b) => {
      const va = col.sortValue ? col.sortValue(a) : (a as Record<string, unknown>)[sortColumn];
      const vb = col.sortValue ? col.sortValue(b) : (b as Record<string, unknown>)[sortColumn];
      const result = defaultCompare(va, vb);
      return sortDirection === "asc" ? result : -result;
    });
  }, [data, sortColumn, sortDirection, columns]);

  const handleHeaderClick = useCallback(
    (colId: string) => {
      if (justResized.current) {
        justResized.current = false;
        return;
      }
      const col = columns.find((c) => c.id === colId);
      if (!col?.sortable) return;

      setSortColumn((prev) => {
        if (prev === colId) {
          setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
          return colId;
        }
        setSortDirection("asc");
        return colId;
      });
    },
    [columns]
  );

  const handleResizeStart = useCallback(
    (colId: string, e: React.MouseEvent) => {
      e.preventDefault();
      const cellEl = headerCellRefs.current.get(colId);
      if (!cellEl) return;
      const startWidth = cellEl.getBoundingClientRect().width;

      resizeState.current = { colId, startX: e.clientX, startWidth };

      const onMouseMove = (e: MouseEvent) => {
        if (!resizeState.current) return;
        const delta = e.clientX - resizeState.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, resizeState.current.startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [colId]: `${Math.round(newWidth)}px` }));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        resizeState.current = null;
        justResized.current = true;
        requestAnimationFrame(() => {
          justResized.current = false;
        });
        if (storageKey) {
          setColumnWidths((prev) => {
            localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(prev));
            return prev;
          });
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [storageKey]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sortedData.length || !selectedId) return;
      const currentIndex = sortedData.findIndex((item) => getRowId(item) === selectedId);
      if (currentIndex === -1) return;

      if (e.key === "ArrowDown" && currentIndex < sortedData.length - 1) {
        e.preventDefault();
        const next = sortedData[currentIndex + 1];
        onSelectedIdChange?.(getRowId(next));
      } else if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault();
        const prev = sortedData[currentIndex - 1];
        onSelectedIdChange?.(getRowId(prev));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onRowDoubleClick?.(sortedData[currentIndex]);
      }
    },
    [sortedData, selectedId, getRowId, onSelectedIdChange, onRowDoubleClick]
  );

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div ref={settingsRef} className="relative mb-2 flex justify-end">
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        {showSettings && toggleableColumns.length > 0 && (
          <div className="absolute right-0 top-7 z-50 w-44 rounded-lg border bg-popover p-1.5 shadow-md">
            {toggleableColumns.map((col) => {
              const isVisible = columnVisibility[col.id] !== false;
              return (
                <button
                  key={col.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
                  onClick={() => {
                    setColumnVisibility((prev) => ({
                      ...prev,
                      [col.id]: !isVisible,
                    }));
                  }}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border transition-colors",
                      isVisible && "border-primary bg-primary"
                    )}
                  >
                    {isVisible && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  {col.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="mb-1 grid gap-2 text-xs text-muted-foreground"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {renderExpanded && <div className="px-2 py-1" />}
        {visibleColumns.map((col, i) => (
          <div
            key={col.id}
            ref={(el) => {
              if (el) headerCellRefs.current.set(col.id, el);
            }}
            className={cn(
              "relative truncate px-2 py-1",
              col.id === "track" && "text-right",
              col.sortable && "cursor-pointer select-none hover:text-foreground"
            )}
            onClick={() => handleHeaderClick(col.id)}
          >
            <div className="flex items-center gap-1">
              <span className="truncate">{col.renderHeader?.() ?? col.label}</span>
              {sortColumn === col.id && (
                <ArrowUp
                  className={cn(
                    "h-3 w-3 shrink-0 transition-transform",
                    sortDirection === "desc" && "rotate-180"
                  )}
                />
              )}
            </div>
            {i < visibleColumns.length - 1 && (
              <div
                className="absolute right-0 top-0 h-full w-[2px] cursor-col-resize bg-gradient-to-b from-transparent via-border/50 to-transparent transition-all hover:w-[3px] hover:via-primary/60 active:via-primary"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleResizeStart(col.id, e);
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div onKeyDown={handleKeyDown} tabIndex={0} className="outline-none">
        {sortedData.map((item, index) => {
          const id = getRowId(item);
          const isSelected = selectedId === id;
          const isExpanded = expandedIds?.has(id) ?? false;
          return (
            <div key={id}>
              <div
                className={cn(
                  "group grid gap-2 rounded-lg px-2 py-2 transition-colors",
                  isSelected && "bg-accent",
                  !isSelected && "hover:bg-accent/50",
                  isExpanded && "rounded-b-none",
                )}
                style={{ gridTemplateColumns: gridTemplate }}
                onClick={() => {
                  onSelectedIdChange?.(id);
                  onRowClick?.(item);
                }}
                onDoubleClick={() => onRowDoubleClick?.(item)}
                onContextMenu={(e) => onRowContextMenu?.(item, e)}
              >
                {renderExpanded && (
                  <div className="flex items-center">
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand?.(id);
                      }}
                    >
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isExpanded && "rotate-90",
                        )}
                      />
                    </button>
                  </div>
                )}
                {visibleColumns.map((col) => (
                  <div key={col.id} className={cn("min-w-0", col.id === "track" && "text-right")}>
                    {col.render(item, index, isSelected)}
                  </div>
                ))}
              </div>
              {isExpanded && renderExpanded && (
                <div className="rounded-b-lg border-t border-border bg-muted/30 px-4 py-3">
                  {renderExpanded(item)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
