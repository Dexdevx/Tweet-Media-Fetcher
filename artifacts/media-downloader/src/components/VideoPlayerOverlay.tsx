import React, { useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { TextOverlayEditor } from "./TextOverlayEditor";

interface VideoPlayerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  selectedUrl: string;
  mediaOptions: Array<{ url: string; quality?: string | null; type: string }>;
  onSelectQuality: (url: string) => void;
}

export function VideoPlayerOverlay({
  isOpen,
  onClose,
  title,
  selectedUrl,
  mediaOptions,
  onSelectQuality,
}: VideoPlayerOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(false);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-5xl w-full p-0 overflow-hidden bg-black/95 border-white/10 h-[90dvh] flex flex-col"
        data-testid="player-container"
        onEscapeKeyDown={(e) => {
          // While editing the overlay caption, Escape should exit edit mode
          // only — not close the entire player.
          if (isEditingRef.current) e.preventDefault();
        }}
      >
        <div className="hidden">
          <DialogTitle>Video Player</DialogTitle>
          <DialogDescription>Play and edit video overlay</DialogDescription>
        </div>

        {/* Header Bar */}
        <div className="flex items-center justify-between p-4 bg-black/50 backdrop-blur-md absolute top-0 left-0 right-0 z-50">
          <div className="flex gap-2 items-center">
            {mediaOptions.map((media, idx) => (
              <Button
                key={idx}
                variant={media.url === selectedUrl ? "default" : "secondary"}
                size="sm"
                onClick={() => onSelectQuality(media.url)}
                className="rounded-full text-xs font-semibold"
                data-testid={`quality-switch-${idx}`}
              >
                {media.quality || media.type.toUpperCase()}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm" className="rounded-full font-semibold" data-testid="player-download-btn">
              <a href={selectedUrl} download target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-2" />
                Download
              </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full text-white hover:bg-white/20" data-testid="close-player">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Video Area */}
        <div ref={containerRef} className="relative flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden pt-16">
          {selectedUrl && (
            <video
              src={selectedUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
              data-testid="video-element"
              // crossOrigin="anonymous" // Omitted as it often breaks playback on external domains if CORS isn't set up perfectly.
            />
          )}

          {/* Text Overlay */}
          {isOpen && (
            <TextOverlayEditor
              initialText={title}
              containerRef={containerRef}
              onEditingChange={(editing) => {
                isEditingRef.current = editing;
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
