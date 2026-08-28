import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  NODE_H,
  NODE_W,
  canvasExtents,
  connectionProblem,
  type BuilderDraft,
} from '@/lib/workflow/builder-draft';

/**
 * Interactive authoring canvas for the workflow builder.
 *
 * - Drag a node body to reposition it.
 * - Drag from a node's connection handle (the ring on its right edge) and
 *   release over another node to create a transition.
 * - Click a node or an edge label to select it for the inspector.
 *
 * Nodes are real HTML buttons over an SVG edge layer, so everything stays
 * keyboard-focusable; keyboard users create transitions through the
 * inspector's "connect to" control instead of the pointer gesture.
 */

export type BuilderSelection =
  | { kind: 'state'; key: string }
  | { kind: 'transition'; index: number }
  | null;

export interface BuilderCanvasProps {
  draft: BuilderDraft;
  selection: BuilderSelection;
  onSelect: (selection: BuilderSelection) => void;
  onMoveState: (key: string, to: { x: number; y: number }) => void;
  onConnect: (fromKey: string, toKey: string) => void;
  /** Invalid connection attempt feedback (self-loop, duplicate). */
  onConnectRejected?: (problem: string) => void;
  className?: string;
}

interface DragState {
  kind: 'move' | 'connect';
  key: string;
  /** Pointer that started the gesture; other pointers are ignored. */
  pointerId: number;
  /** Pointer offset inside the node (move) — keeps the grab point stable. */
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

export function BuilderCanvas({
  draft,
  selection,
  onSelect,
  onMoveState,
  onConnect,
  onConnectRejected,
  className,
}: BuilderCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scaleRef = useRef(1);
  // Live connect-preview endpoint (canvas coordinates) + hovered drop target.
  const [connectPreview, setConnectPreview] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const scale = scaleRef.current || 1;
    return {
      x: (clientX - (rect?.left ?? 0)) / scale,
      y: (clientY - (rect?.top ?? 0)) / scale,
    };
  }, []);

  const finishDrag = useCallback(() => {
    dragRef.current = null;
    setConnectingKey(null);
    setConnectPreview(null);
    setHoverTarget(null);
  }, []);

  // Latest props/state in refs so the global listeners are installed once
  // and never rebound during high-frequency pointer activity.
  const latest = useRef({ draft, selection, hoverTarget, onMoveState, onConnect, onConnectRejected, onSelect });
  latest.current = { draft, selection, hoverTarget, onMoveState, onConnect, onConnectRejected, onSelect };

  // Global listeners drive both gestures so the pointer can leave the node.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const p = toCanvas(e.clientX, e.clientY);
      drag.moved = true;
      if (drag.kind === 'move') {
        latest.current.onMoveState(drag.key, { x: p.x - drag.offsetX, y: p.y - drag.offsetY });
      } else {
        setConnectPreview(p);
      }
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { draft, selection, hoverTarget, onConnect, onConnectRejected, onSelect } = latest.current;
      if (drag.kind === 'connect') {
        // Resolve the drop target from the node under the pointer.
        const target =
          hoverTarget ??
          (document
            .elementFromPoint?.(e.clientX, e.clientY)
            ?.closest?.('[data-state-key]')
            ?.getAttribute('data-state-key') ??
            null);
        if (target) {
          const problem = connectionProblem(draft, drag.key, target);
          if (problem) onConnectRejected?.(problem);
          else onConnect(drag.key, target);
        }
      } else if (!drag.moved) {
        // A click (no movement): toggle selection.
        onSelect(
          selection?.kind === 'state' && selection.key === drag.key
            ? null
            : { kind: 'state', key: drag.key },
        );
      }
      finishDrag();
    };
    // A canceled gesture (touch interrupted, window blur, capture lost) must
    // never leave a live drag behind — a later unrelated pointer would move
    // nodes or complete connections.
    const onCancel = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && e.pointerId === drag.pointerId) finishDrag();
    };
    const onBlur = () => {
      if (dragRef.current) finishDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
    };
  }, [toCanvas, finishDrag]);

  const { width, height } = canvasExtents(draft);
  const scale =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(1, (viewport.width - 24) / width, (viewport.height - 24) / height)
      : 1;
  // Keep every state and transition inside the viewport even for large
  // workflows. The list view remains available when a dense graph becomes
  // too small for comfortable visual editing.
  scaleRef.current = Math.max(0.05, scale);
  const visibleWidth = width * scaleRef.current;
  const visibleHeight = height * scaleRef.current;

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const edges = draft.transitions.map((t, index) => {
    const from = draft.positions[t.fromKey];
    const to = draft.positions[t.toKey];
    if (!from || !to) return null;
    const forward = to.x >= from.x;
    const x1 = forward ? from.x + NODE_W : from.x;
    const y1 = from.y + NODE_H / 2;
    const x2 = forward ? to.x : to.x + NODE_W;
    const y2 = to.y + NODE_H / 2;
    const bend = forward ? Math.max(24, (x2 - x1) / 2) : 56;
    const path = forward
      ? `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 - bend} ${y1 + NODE_H}, ${x2 + bend} ${y2 + NODE_H}, ${x2} ${y2}`;
    const labelX = (x1 + x2) / 2;
    const labelY = forward ? (y1 + y2) / 2 - 8 : Math.max(y1, y2) + NODE_H * 0.75;
    return { t, index, path, labelX, labelY, forward };
  });

  const activeConnect = connectingKey;
  const previewFrom = activeConnect ? draft.positions[activeConnect] : null;

  return (
    <div
      ref={canvasRef}
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-neutral-bg/40',
        'bg-[radial-gradient(circle,_var(--color-border)_1px,_transparent_1px)] bg-[length:20px_20px]',
        className,
      )}
      role="group"
      aria-label={`Workflow canvas with ${draft.states.length} states and ${draft.transitions.length} transitions. Drag states to move them; drag a state's connection handle onto another state to add a transition. Keyboard: arrow keys move a focused state; use the inspector to add transitions.`}
      data-testid="builder-canvas"
      onPointerDown={(e) => {
        // Clicking empty canvas clears the selection.
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.canvasBg != null) {
          onSelect(null);
        }
      }}
    >
      <div
        className="relative"
        style={{
          width: Math.max(visibleWidth, 1),
          height: Math.max(340, visibleHeight),
          minWidth: '100%',
        }}
        data-canvas-bg
      >
        <div
          className="relative"
          style={{
            width,
            height,
            transform: `scale(${scaleRef.current})`,
            transformOrigin: 'top left',
          }}
        >
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
          <defs>
            <marker
              id="builder-arrow"
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
          {edges.map(
            (e) =>
              e && (
                <path
                  key={`edge-${e.index}`}
                  d={e.path}
                  fill="none"
                  strokeWidth={selection?.kind === 'transition' && selection.index === e.index ? 2.5 : 1.5}
                  markerEnd="url(#builder-arrow)"
                  className={cn(
                    selection?.kind === 'transition' && selection.index === e.index
                      ? 'stroke-primary'
                      : e.forward
                        ? 'stroke-muted-foreground'
                        : 'stroke-muted-foreground/70',
                  )}
                  strokeDasharray={e.forward ? undefined : '4 3'}
                />
              ),
          )}
          {previewFrom && connectPreview && (
            <line
              x1={previewFrom.x + NODE_W}
              y1={previewFrom.y + NODE_H / 2}
              x2={connectPreview.x}
              y2={connectPreview.y}
              strokeWidth={2}
              strokeDasharray="5 4"
              className="stroke-primary"
            />
          )}
        </svg>

        {/* Clickable edge labels (above the SVG, below the nodes). */}
        {edges.map(
          (e) =>
            e && (
              <button
                key={`edge-label-${e.index}`}
                type="button"
                onClick={() =>
                  onSelect(
                    selection?.kind === 'transition' && selection.index === e.index
                      ? null
                      : { kind: 'transition', index: e.index },
                  )
                }
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-sm transition-colors',
                  selection?.kind === 'transition' && selection.index === e.index
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground',
                )}
                style={{ left: e.labelX, top: e.labelY }}
                aria-label={`Transition ${e.t.name.trim() || '(unnamed)'} from ${stateName(draft, e.t.fromKey)} to ${stateName(draft, e.t.toKey)}`}
                data-testid={`edge-label-${e.index}`}
              >
                {e.t.name.trim() || '(unnamed)'}
              </button>
            ),
        )}

        {draft.states.map((state) => {
          const pos = draft.positions[state.key] ?? { x: 0, y: 0 };
          const selected = selection?.kind === 'state' && selection.key === state.key;
          const isDropTarget =
            activeConnect != null &&
            activeConnect !== state.key &&
            hoverTarget === state.key &&
            connectionProblem(draft, activeConnect, state.key) == null;
          return (
            <div
              key={state.key}
              className="absolute"
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
              data-state-key={state.key}
              onPointerEnter={() => activeConnect && setHoverTarget(state.key)}
              onPointerLeave={() => activeConnect && setHoverTarget((h) => (h === state.key ? null : h))}
            >
              <button
                type="button"
                className={cn(
                  'flex size-full cursor-grab touch-none flex-col justify-center gap-0.5 rounded-lg border bg-card px-3 text-left shadow-sm transition-colors active:cursor-grabbing',
                  selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60',
                  isDropTarget && 'border-primary ring-2 ring-primary',
                )}
                onPointerDown={(e) => {
                  if (e.button !== 0 || dragRef.current) return;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  const p = toCanvas(e.clientX, e.clientY);
                  dragRef.current = {
                    kind: 'move',
                    key: state.key,
                    pointerId: e.pointerId,
                    offsetX: p.x - pos.x,
                    offsetY: p.y - pos.y,
                    moved: false,
                  };
                }}
                onLostPointerCapture={(e) => {
                  if (dragRef.current?.pointerId === e.pointerId) finishDrag();
                }}
                onKeyDown={(e) => {
                  // Keyboard nudge: arrow keys move the focused node.
                  const step = e.shiftKey ? 24 : 8;
                  const deltas: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0],
                    ArrowRight: [step, 0],
                    ArrowUp: [0, -step],
                    ArrowDown: [0, step],
                  };
                  const d = deltas[e.key];
                  if (d) {
                    e.preventDefault();
                    onMoveState(state.key, { x: pos.x + d[0], y: pos.y + d[1] });
                  }
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(selected ? null : { kind: 'state', key: state.key });
                  }
                }}
                aria-pressed={selected}
                aria-label={`State ${state.name.trim() || '(unnamed)'}${state.initial ? ', initial' : ''}${state.final ? ', final' : ''}. Press Enter to select; arrow keys to move.`}
                data-testid={`builder-node-${state.key}`}
              >
                <span className="truncate text-xs font-semibold text-foreground">
                  {state.name.trim() || '(unnamed)'}
                </span>
                <span className="flex items-center gap-1.5">
                  {state.initial && (
                    <Badge colorScheme="primary" className="px-1.5 py-0 text-[9px]">
                      initial
                    </Badge>
                  )}
                  {state.final && (
                    <Badge colorScheme="neutral" className="px-1.5 py-0 text-[9px]">
                      final
                    </Badge>
                  )}
                </span>
              </button>
              {/* Connection handle on the right edge. */}
              <button
                type="button"
                className={cn(
                  'absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 cursor-crosshair touch-none rounded-full border-2 bg-background transition-colors',
                  activeConnect === state.key
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/60 hover:border-primary hover:bg-primary/20',
                )}
                title="Drag to another state to add a transition"
                aria-label={`Start a transition from ${state.name.trim() || '(unnamed)'}. Drag onto another state, or press Enter to open this state's inspector and pick a target.`}
                onPointerDown={(e) => {
                  if (e.button !== 0 || dragRef.current) return;
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  dragRef.current = {
                    kind: 'connect',
                    key: state.key,
                    pointerId: e.pointerId,
                    offsetX: 0,
                    offsetY: 0,
                    moved: false,
                  };
                  setConnectingKey(state.key);
                  setConnectPreview(toCanvas(e.clientX, e.clientY));
                }}
                onLostPointerCapture={(e) => {
                  if (dragRef.current?.pointerId === e.pointerId) finishDrag();
                }}
                onKeyDown={(e) => {
                  // Keyboard path: select the state so the inspector's
                  // "Add transition to…" control is available.
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect({ kind: 'state', key: state.key });
                  }
                }}
                data-testid={`connect-handle-${state.key}`}
              />
            </div>
          );
        })}

        {draft.states.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="max-w-xs text-center text-sm text-muted-foreground">
              No states yet. Use <strong>Add state</strong> to place your first state on the canvas.
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function stateName(draft: BuilderDraft, key: string): string {
  return draft.states.find((s) => s.key === key)?.name.trim() || '(unnamed)';
}
