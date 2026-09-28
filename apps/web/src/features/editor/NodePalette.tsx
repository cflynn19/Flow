import type { NodeKind } from '@flow/shared';
import { NODE_KIND_META, NODE_KIND_ORDER } from './node-registry';

/**
 * The node palette. Nodes can be dragged onto the canvas or clicked to drop one in the
 * middle of the current view.
 */
export function NodePalette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-3 py-2.5">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
          Nodes
        </h2>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-3">
        {NODE_KIND_ORDER.map((kind) => {
          const meta = NODE_KIND_META[kind];
          const Icon = meta.icon;
          return (
            <button
              key={kind}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/flow-node', kind);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onAdd(kind)}
              title={meta.description}
              className="group flex cursor-grab items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-hover active:cursor-grabbing"
            >
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-xs"
                style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)` }}
              >
                <Icon className="size-3.5" style={{ color: meta.color }} />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-text">{meta.label}</span>
                <span className="block truncate text-[11px] text-text-subtle">
                  {meta.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-auto border-t border-border px-3 py-2.5 text-[11px] leading-relaxed text-text-subtle">
        Drag onto the canvas, or click to drop one in view. Connect nodes by dragging
        between handles.
      </p>
    </aside>
  );
}
