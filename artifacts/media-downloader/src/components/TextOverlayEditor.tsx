import React, { useState, useRef, useEffect, useCallback } from "react";
import { MoveDiagonal, AlignLeft, AlignCenter, AlignRight, Maximize, Type, RefreshCcw, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TextOverlayEditorProps {
  initialText: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onEditingChange?: (editing: boolean) => void;
}

export function TextOverlayEditor({ initialText, containerRef, onEditingChange }: TextOverlayEditorProps) {
  const [text, setText] = useState(initialText);
  const [isEditing, setIsEditing] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 20 });
  const [size, setSize] = useState({ w: 300, h: 100 });
  const [isFullWidth, setIsFullWidth] = useState(true);
  const [align, setAlign] = useState<"left" | "center" | "right">("center");
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [fontSize, setFontSize] = useState<"text-sm" | "text-base" | "text-lg" | "text-xl" | "text-2xl">("text-lg");

  const boxRef = useRef<HTMLDivElement>(null);

  const dragState = useRef<{
    pending: boolean;
    isDragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  }>({
    pending: false,
    isDragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  const DRAG_THRESHOLD = 4;

  const resizeState = useRef<{ isResizing: boolean; startX: number; startY: number; initialW: number; initialH: number }>({
    isResizing: false,
    startX: 0,
    startY: 0,
    initialW: 0,
    initialH: 0,
  });

  // Report editing state to the parent so the player can suppress
  // the Dialog's Escape-to-close while editing. Reset on unmount.
  useEffect(() => {
    onEditingChange?.(isEditing);
    return () => onEditingChange?.(false);
  }, [isEditing, onEditingChange]);

  // Keep full-width geometry in sync when the container resizes
  // (e.g. viewport resize / orientation change while the player is open).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isFullWidth) {
        setPos((p) => ({ ...p, x: 0 }));
        setSize((s) => ({ ...s, w: el.clientWidth }));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFullWidth, containerRef]);

  // Handle Full Width initialization
  useEffect(() => {
    if (isFullWidth && containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      setPos((p) => ({ ...p, x: 0 }));
      setSize((s) => ({ ...s, w: containerW }));
    }
  }, [isFullWidth, containerRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest(".no-drag")) return;

    // Mark a potential drag, but do not capture the pointer yet so that
    // clicks and double-clicks still reach the content for editing.
    dragState.current = {
      pending: true,
      isDragging: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state.pending && !state.isDragging) return;
    if (!containerRef.current || !boxRef.current) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    // Only begin dragging once the pointer moves past the threshold.
    if (!state.isDragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      state.isDragging = true;
      try {
        e.currentTarget.setPointerCapture(state.pointerId);
      } catch {
        /* pointer capture may fail if pointer already released */
      }
    }

    let newX = state.initialX + dx;
    let newY = state.initialY + dy;

    const containerRect = containerRef.current.getBoundingClientRect();
    const boxRect = boxRef.current.getBoundingClientRect();

    // Constrain to container
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX + boxRect.width > containerRect.width) newX = containerRect.width - boxRect.width;
    if (newY + boxRect.height > containerRect.height) newY = containerRect.height - boxRect.height;

    setPos({ x: newX, y: newY });
    if (isFullWidth && dx !== 0) {
      setIsFullWidth(false); // break out of full width if dragged horizontally
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (state.isDragging) {
      try {
        e.currentTarget.releasePointerCapture(state.pointerId);
      } catch {
        /* no-op */
      }
    }
    state.pending = false;
    state.isDragging = false;
    state.pointerId = -1;
  };

  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeState.current = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      initialW: boxRef.current?.offsetWidth || size.w,
      initialH: boxRef.current?.offsetHeight || size.h,
    };
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeState.current.isResizing && containerRef.current) {
      const dx = e.clientX - resizeState.current.startX;
      const dy = e.clientY - resizeState.current.startY;

      let newW = Math.max(100, resizeState.current.initialW + dx);
      let newH = Math.max(40, resizeState.current.initialH + dy);

      const containerRect = containerRef.current.getBoundingClientRect();
      if (pos.x + newW > containerRect.width) newW = containerRect.width - pos.x;
      if (pos.y + newH > containerRect.height) newH = containerRect.height - pos.y;

      setSize({ w: newW, h: newH });
      setIsFullWidth(false);
    }
  };

  const handleResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeState.current.isResizing) {
      resizeState.current.isResizing = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const toggleFullWidth = () => {
    setIsFullWidth(!isFullWidth);
    if (!isFullWidth && containerRef.current) {
      setPos((p) => ({ ...p, x: 0 }));
      setSize((s) => ({ ...s, w: containerRef.current!.clientWidth }));
    }
  };

  const reset = () => {
    setIsFullWidth(true);
    setPos({ x: 0, y: 20 });
    setAlign("center");
    if (containerRef.current) {
      setSize((s) => ({ ...s, w: containerRef.current!.clientWidth }));
    }
  };

  if (!isVisible) {
    return (
      <Button
        variant="secondary"
        size="icon"
        className="absolute top-4 right-4 z-50 rounded-full bg-black/50 hover:bg-black/70 text-white border-0"
        onClick={() => setIsVisible(true)}
      >
        <Type className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <div
      ref={boxRef}
      className={cn(
        "absolute z-40 rounded-xl group/overlay transition-shadow",
        !isEditing && "cursor-grab active:cursor-grabbing hover:bg-black/20 hover:backdrop-blur-sm hover:shadow-lg hover:border hover:border-white/10"
      )}
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        width: isFullWidth ? "100%" : `${size.w}px`,
        height: size.h > 0 ? `${size.h}px` : "auto",
        minHeight: "40px",
        touchAction: "none",
        userSelect: dragState.current.isDragging ? "none" : "auto",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={() => {
        if (!isEditing) setIsEditing(true);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="overlay-text-box"
    >
      {/* Toolbar */}
      <div
        className={cn(
          "absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 bg-black/80 backdrop-blur-md rounded-lg shadow-xl border border-white/10 transition-opacity duration-200 no-drag",
          isHovered || isEditing ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => setAlign("left")} data-testid="align-left">
          <AlignLeft className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => setAlign("center")} data-testid="align-center">
          <AlignCenter className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => setAlign("right")} data-testid="align-right">
          <AlignRight className="w-4 h-4" />
        </Button>
        <div className="w-px h-4 bg-white/20 mx-1" />
        <Button variant="ghost" size="icon" className={cn("h-8 w-8 text-white hover:bg-white/20", isFullWidth && "bg-white/20")} onClick={toggleFullWidth}>
          <Maximize className="w-4 h-4" />
        </Button>
        <div className="w-px h-4 bg-white/20 mx-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={reset}>
          <RefreshCcw className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => setIsVisible(false)}>
          <EyeOff className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <div className={cn("w-full h-full p-4 flex flex-col justify-center drop-shadow-md", `text-${align}`)}>
        {isEditing ? (
          <textarea
            autoFocus
            className={cn(
              "w-full h-full bg-black/40 text-white placeholder-white/50 border border-white/20 rounded-lg p-2 resize-none outline-none focus:ring-2 focus:ring-primary backdrop-blur-md no-drag",
              `text-${align}`,
              fontSize
            )}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setIsEditing(false);
              }
            }}
          />
        ) : (
          <div
            className={cn("w-full h-full flex items-center break-words text-white font-semibold drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]", `justify-${align === 'center' ? 'center' : align === 'right' ? 'end' : 'start'}`, fontSize)}
            onDoubleClick={() => setIsEditing(true)}
            style={{ textShadow: "0 2px 4px rgba(0,0,0,0.5), 0 0 10px rgba(0,0,0,0.5)" }}
          >
            {text || "Double click to edit..."}
          </div>
        )}
      </div>

      {/* Resize Handle */}
      {!isFullWidth && !isEditing && (
        <div
          className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center cursor-nwse-resize text-white/50 hover:text-white no-drag opacity-0 group-hover/overlay:opacity-100 transition-opacity"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          data-testid="resize-handle"
        >
          <MoveDiagonal className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
