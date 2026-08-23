import { useMemo } from 'react';
import { layoutWorkflow } from '@/lib/workflow/layout';
import type { WorkflowGraph } from '@/lib/workflow/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Visual workflow diagram: states as nodes laid out left→right from the
 * initial state, transition commands as labelled edges.
 *
 * Nodes are real HTML buttons layered over an SVG edge layer, so the
 * diagram is keyboard-accessible and screen-reader-friendly without any
 * canvas library. Pages that embed this should also render (or link to)
 * a plain list of states as a non-visual fallback.
 */

const NODE_W = 168;
const NODE_H = 64;
const GAP_X = 88;
const GAP_Y = 28;
const PAD = 12;

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  /** Items currently sitting in each state (live count). */
  countsByState?: Record<string, number>;
  /** Highlight one node (e.g. the selected state). */
  selectedStateId?: string | null;
  onSelectState?: (stateId: string) => void;
  className?: string;
}

export function WorkflowCanvas({
  graph,
  countsByState,
  selectedStateId,
  onSelectState,
  className,
}: WorkflowCanvasProps) {
  const { positions, width, height } = useMemo(() => {
    const layout = layoutWorkflow(graph);
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) {
      pos.set(n.stateId, {
        x: PAD + n.col * (NODE_W + GAP_X),
        y: PAD + n.row * (NODE_H + GAP_Y),
      });
    }
    return {
      positions: pos,
      width: PAD * 2 + Math.max(1, layout.cols) * NODE_W + Math.max(0, layout.cols - 1) * GAP_X,
      height: PAD * 2 + Math.max(1, layout.rows) * NODE_H + Math.max(0, layout.rows - 1) * GAP_Y,
    };
  }, [graph]);

  const edges = useMemo(
    () =>
      graph.transitions
        .filter((t) => t.toStateId && positions.has(t.fromStateId) && positions.has(t.toStateId))
        .map((t) => {
          const from = positions.get(t.fromStateId)!;
          const to = positions.get(t.toStateId!)!;
          const forward = to.x > from.x;
          // Forward edges leave the right side and enter the left side;
          // backward edges (e.g. Reject) loop underneath.
          const x1 = forward ? from.x + NODE_W : from.x;
          const y1 = from.y + NODE_H / 2;
          const x2 = forward ? to.x : to.x + NODE_W;
          const y2 = to.y + NODE_H / 2;
          const bend = forward ? (x2 - x1) / 2 : 56;
          const path = forward
            ? `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1 - bend} ${y1 + NODE_H}, ${x2 + bend} ${y2 + NODE_H}, ${x2} ${y2}`;
          const labelX = (x1 + x2) / 2;
          const labelY = forward
            ? (y1 + y2) / 2 - 8
            : Math.max(y1, y2) + NODE_H * 0.75;
          return { ...t, path, labelX, labelY, forward };
        }),
    [graph.transitions, positions],
  );

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border bg-neutral-bg/40', className)}>
      <div
        className="relative"
        style={{ width, height: height + 36 /* room for backward-edge labels */ }}
        role="group"
        aria-label={`Workflow diagram with ${graph.states.length} states and ${edges.length} transitions`}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height + 36}
          aria-hidden
        >
          <defs>
            <marker
              id="wf-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {edges.map((e) => (
            <g key={e.commandId}>
              <path
                d={e.path}
                fill="none"
                strokeWidth={1.5}
                markerEnd="url(#wf-arrow)"
                className={e.forward ? 'stroke-muted-foreground' : 'stroke-muted-foreground/70'}
                strokeDasharray={e.forward ? undefined : '4 3'}
              />
              <text
                x={e.labelX}
                y={e.labelY}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] font-medium"
              >
                {e.displayName}
              </text>
            </g>
          ))}
        </svg>

        {graph.states.map((state) => {
          const pos = positions.get(state.stateId)!;
          const count = countsByState?.[state.stateId];
          const selected = selectedStateId === state.stateId;
          const Tag = onSelectState ? 'button' : 'div';
          return (
            <Tag
              key={state.stateId}
              type={onSelectState ? 'button' : undefined}
              onClick={onSelectState ? () => onSelectState(state.stateId) : undefined}
              className={cn(
                'absolute flex flex-col justify-center gap-0.5 rounded-lg border bg-card px-3 text-left shadow-sm transition-colors',
                onSelectState && 'cursor-pointer hover:border-primary/60',
                selected ? 'border-primary ring-1 ring-primary' : 'border-border',
              )}
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
              data-testid={`canvas-state-${state.stateId}`}
              aria-pressed={onSelectState ? selected : undefined}
            >
              <span className="truncate text-xs font-semibold text-foreground">
                {state.displayName}
              </span>
              <span className="flex items-center gap-1.5">
                {state.initial && (
                  <Badge colorScheme="neutral" className="px-1.5 py-0 text-[9px]">
                    initial
                  </Badge>
                )}
                {state.final && (
                  <Badge colorScheme="neutral" className="px-1.5 py-0 text-[9px]">
                    final
                  </Badge>
                )}
                {count != null && (
                  <Badge
                    colorScheme={count > 0 && !state.final ? 'primary' : 'neutral'}
                    className="px-1.5 py-0 text-[9px]"
                  >
                    {count} item{count === 1 ? '' : 's'}
                  </Badge>
                )}
              </span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
